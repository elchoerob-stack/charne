"""Make the ledger agree with the broker, and stop if they cannot be made to.

Runs at start-up (after a crash, a PENDING order may or may not have landed)
and on every cycle (closed trades, positions without a stop, positions the
bot did not open)."""

from __future__ import annotations

from datetime import datetime, timedelta

from .broker import Broker
from .journal import ABSENT, FILLED, OPEN_STATES, UNKNOWN, Journal, parse
from .models import ClosedTrade

LABEL_PREFIX = "gab-"
RECON_LOCK = "reconciliation"


def client_order_id(snapshot_id: str) -> str:
    return f"{LABEL_PREFIX}{snapshot_id}"[:50]  # cTrader clientOrderId max length is 50


async def sync_closed_trades(broker: Broker, journal: Journal, now: datetime) -> list[ClosedTrade]:
    synced = parse(journal.get("trades_synced_until"))
    since = (synced - timedelta(hours=6)) if synced else now - timedelta(days=35)
    new = [t for t in await broker.closed_trades(since) if journal.add_trade(t)]
    journal.put("trades_synced_until", now.isoformat())
    for t in new:
        journal.event("trade_closed", now, position_id=t.position_id, side=t.side,
                      net=round(t.net, 2))
    return new


async def resolve_open_orders(broker: Broker, journal: Journal, now: datetime) -> list[str]:
    """Orders the ledger left PENDING/UNKNOWN (crash or lost ack)."""
    issues = []
    positions = {p.label: p for p in await broker.open_positions()}
    pending = set(await broker.pending_order_labels())
    closed = {t.label for t in await broker.closed_trades(now - timedelta(days=7)) if t.label}
    for row in journal.orders_in_states(OPEN_STATES):
        coid = row["client_order_id"]
        if coid in positions:
            p = positions[coid]
            journal.set_order_state(coid, FILLED, position_id=p.position_id,
                                    fill_price=p.entry_price, detail="found on reconcile", now=now)
        elif coid in closed:
            journal.set_order_state(coid, FILLED, detail="found closed on reconcile", now=now)
        elif coid in pending:
            journal.set_order_state(coid, UNKNOWN, detail="pending at broker", now=now)
            issues.append(f"order {coid} is still pending at the broker")
        else:
            journal.set_order_state(coid, ABSENT, detail="not at broker on reconcile", now=now)
    return issues


async def audit_positions(broker: Broker, journal: Journal, notify=None) -> list[str]:
    issues = []
    for p in await broker.open_positions():
        row = journal.get_order(p.label) if p.label.startswith(LABEL_PREFIX) else None
        if not p.label.startswith(LABEL_PREFIX):
            issues.append(f"position {p.position_id} was not opened by this bot "
                          f"(label '{p.label}')")
        elif row is None:
            issues.append(f"position {p.position_id} ({p.label}) is not in the ledger")
        elif row["state"] != FILLED:
            # An order recorded ABSENT/UNKNOWN that landed after all: adopt it.
            journal.set_order_state(p.label, FILLED, position_id=p.position_id,
                                    fill_price=p.entry_price,
                                    detail=f"late fill (was {row['state']})")
            journal.event("late_fill", None, client_order_id=p.label,
                          was=row["state"], position_id=p.position_id)
            if notify:
                notify(f"Late fill adopted: {p.label} (was {row['state']})", priority="high")
        if p.stop_loss is None:
            issues.append(f"position {p.position_id} has no stop loss")
    return issues


def lock_if_issues(journal: Journal, issues: list[str], now: datetime) -> bool:
    if not issues:
        return False
    if not any(lk.kind == RECON_LOCK for lk in journal.active_locks(now)):
        journal.add_lock(RECON_LOCK, "; ".join(issues)[:500], requires_review=True,
                         auto_release_at=None, now=now)
        journal.event("reconciliation_lock", now, issues=issues)
        return True
    return False


async def startup_reconcile(broker: Broker, journal: Journal, now: datetime) -> list[str]:
    await sync_closed_trades(broker, journal, now)
    issues = await resolve_open_orders(broker, journal, now)
    issues += await audit_positions(broker, journal)
    lock_if_issues(journal, issues, now)
    return issues
