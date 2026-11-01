"""The only code that sends orders.

Sequence for one proposal:
  1. Deterministic client order id from the snapshot: one bar, one order.
  2. Re-run every risk check with a fresh quote and fresh account state.
  3. Write the order to the ledger (PENDING) BEFORE sending it.
  4. Send. On a lost acknowledgement, ask the broker whether the order exists
     before doing anything else. Retry at most once, and only after the
     broker has confirmed the first attempt never landed and the risk checks
     still pass.
  5. After a fill, confirm the position really has its stop. If not, close it
     and lock the bot.
"""

from __future__ import annotations

import asyncio
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Callable

from .broker import Broker
from .journal import ABSENT, FILLED, REJECTED, UNKNOWN, Journal, utcnow
from .models import BrokerError, MarketSnapshot, OrderRequest, OrderTimeout, Proposal
from .reconciliation import client_order_id, lock_if_issues
from .risk_engine import POLICY, Approval, RiskPolicy, apply_trips, build_context, evaluate

MAX_ATTEMPTS = 2
CONFIRM_CHECKS = 3
CONFIRM_DELAY_S = 2.0


@dataclass
class ExecutionOutcome:
    status: str  # FILLED | REJECTED | BLOCKED | DUPLICATE | ABSENT | UNKNOWN
    detail: str
    client_order_id: str
    approval: Approval | None = None
    position_id: str = ""


class ExecutionService:
    def __init__(self, broker: Broker, journal: Journal, *, kill_switch_path: Path | None = None,
                 policy: RiskPolicy = POLICY, clock: Callable[[], datetime] = utcnow,
                 sleep=asyncio.sleep, notify=None):
        self.broker, self.journal, self.policy = broker, journal, policy
        self.kill_switch_path, self.clock, self.sleep = kill_switch_path, clock, sleep
        self.notify = notify or (lambda *a, **k: None)

    async def execute(self, proposal: Proposal, snapshot: MarketSnapshot) -> ExecutionOutcome:
        coid = client_order_id(snapshot.snapshot_id)
        existing = self.journal.get_order(coid)
        if existing is not None and existing["state"] != ABSENT:
            return ExecutionOutcome("DUPLICATE", f"order already {existing['state']}", coid)
        if existing is not None and existing["attempts"] >= MAX_ATTEMPTS:
            return ExecutionOutcome("ABSENT", "retry limit reached", coid)

        now = self.clock()
        ctx = await build_context(self.broker, self.journal, now=now,
                                  snapshot_created_at=snapshot.created_at,
                                  kill_switch_path=self.kill_switch_path, policy=self.policy)
        apply_trips(self.journal, ctx, self.policy)
        approval = evaluate(proposal, ctx, self.policy)
        if not approval.allowed:
            self.journal.reject("final_check", approval.reason, snapshot.snapshot_id, now)
            return ExecutionOutcome("BLOCKED", approval.reason, coid, approval)

        req = OrderRequest(client_order_id=coid, symbol=proposal.symbol, side=proposal.side,
                           units=approval.units, entry_reference=approval.entry,
                           stop_loss=approval.stop_loss, take_profit=approval.take_profit)
        try:
            if existing is None:
                self.journal.record_order(client_order_id=coid, snapshot_id=snapshot.snapshot_id,
                                          side=req.side, units=req.units,
                                          entry_reference=req.entry_reference,
                                          stop_loss=req.stop_loss, take_profit=req.take_profit,
                                          risk_amount=approval.risk_amount, now=now)
            else:
                self.journal.retry_order(coid, req.units, req.entry_reference, req.stop_loss,
                                         req.take_profit, approval.risk_amount, now)
        except sqlite3.IntegrityError:
            return ExecutionOutcome("DUPLICATE", "order id already in ledger", coid)

        try:
            result = await self.broker.place_market_order(req)
        except (OrderTimeout, BrokerError) as e:
            self.journal.set_order_state(coid, UNKNOWN, detail=str(e)[:300], now=self.clock())
            return await self._resolve_lost_ack(coid, proposal, snapshot, approval)

        if result.status == "REJECTED":
            self.journal.set_order_state(coid, REJECTED, detail=result.reason, now=self.clock())
            self.journal.reject("broker", result.reason, snapshot.snapshot_id, self.clock())
            return ExecutionOutcome("REJECTED", result.reason, coid, approval)

        self.journal.set_order_state(coid, FILLED, position_id=result.position_id,
                                     fill_price=result.fill_price, now=self.clock())
        await self._confirm_stop(coid, result.position_id)
        self.notify(f"Demo {req.side} {req.units:g} oz XAUUSD @ {result.fill_price} "
                    f"SL {req.stop_loss} TP {req.take_profit} (risk {approval.risk_amount})")
        return ExecutionOutcome("FILLED", "filled", coid, approval, result.position_id)

    async def _resolve_lost_ack(self, coid: str, proposal: Proposal, snapshot: MarketSnapshot,
                                approval: Approval) -> ExecutionOutcome:
        for i in range(CONFIRM_CHECKS):
            if i:
                await self.sleep(CONFIRM_DELAY_S)
            try:
                positions = {p.label: p for p in await self.broker.open_positions()}
                pending = set(await self.broker.pending_order_labels())
            except BrokerError:
                continue
            if coid in positions:
                p = positions[coid]
                self.journal.set_order_state(coid, FILLED, position_id=p.position_id,
                                             fill_price=p.entry_price,
                                             detail="ack lost; found at broker", now=self.clock())
                await self._confirm_stop(coid, p.position_id)
                return ExecutionOutcome("FILLED", "ack lost; position found", coid, approval,
                                        p.position_id)
            if coid in pending:
                continue
            if i == CONFIRM_CHECKS - 1:
                self.journal.set_order_state(coid, ABSENT, detail="confirmed absent",
                                             now=self.clock())
                row = self.journal.get_order(coid)
                if row["attempts"] < MAX_ATTEMPTS:
                    return await self.execute(proposal, snapshot)  # re-checks everything
                return ExecutionOutcome("ABSENT", "confirmed absent; no more retries", coid,
                                        approval)
        now = self.clock()
        lock_if_issues(self.journal, [f"order {coid} state unknown after lost ack"], now)
        self.notify(f"Order {coid} state unknown; bot locked for review", priority="high")
        return ExecutionOutcome("UNKNOWN", "could not confirm with broker; locked", coid, approval)

    async def _confirm_stop(self, coid: str, position_id: str) -> None:
        try:
            p = next((x for x in await self.broker.open_positions()
                      if x.position_id == position_id), None)
        except BrokerError as e:
            p, err = None, str(e)
        else:
            err = ""
        if p is not None and p.stop_loss is not None:
            return
        now = self.clock()
        if p is not None:
            try:
                await self.broker.close_position(position_id)
                what = "closed it"
            except BrokerError as e:
                what = f"COULD NOT CLOSE IT ({e})"
            issue = f"position {position_id} ({coid}) filled without a stop; {what}"
        else:
            issue = f"could not confirm stop on position {position_id} ({coid}) {err}".strip()
        lock_if_issues(self.journal, [issue], now)
        self.notify(issue, priority="high")
