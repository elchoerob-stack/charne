"""Deterministic risk engine. Default answer: no.

Neither model can place an order. A proposal becomes an order only if every
check below passes, and the same checks run again with a fresh quote right
before submission (execution.py).

RISK VALUES ARE CONSTANTS. They are not read from .env, the command line or
the database, and nothing in the program can change them while it runs. To
change one, edit this file, commit it with the reason, and start a new
forward-test period: results from before the change do not count towards
the new settings.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .broker import Broker, round_turn_commission_per_unit
from .journal import Journal, Lock, parse
from .models import AccountState, Position, Proposal, Quote, SymbolSpec


@dataclass(frozen=True)
class RiskPolicy:
    symbol: str = "XAUUSD"
    risk_per_trade: float = 0.005           # 0.5% of capital lost if the stop is hit
    daily_loss_limit: float = 0.015         # 1.5% of start-of-day balance
    weekly_loss_limit: float = 0.03         # 3% of start-of-week balance
    monthly_drawdown_limit: float = 0.06    # 6% from the month's balance peak
    max_open_positions: int = 1             # whole account, any symbol, incl. pending orders
    min_reward_risk: float = 2.0
    max_consecutive_losses: int = 3
    max_trades_per_day: int = 3
    # Broker-dependent. Check them against your demo's real XAUUSD quotes in
    # week 1 (`python -m app.main check`) and set them once, before forward testing.
    max_spread: float = 0.60                # USD/oz
    stop_slippage_allowance: float = 0.30   # USD/oz added to the stop distance when sizing
    min_stop_spreads: float = 3.0           # stop at least 3 spreads from entry
    max_margin_use: float = 0.5             # never use more than half the free margin
    max_quote_age_seconds: float = 15.0
    max_snapshot_age_seconds: float = 240.0


POLICY = RiskPolicy()


# ---- periods (UTC) -------------------------------------------------------------
def day_start(now: datetime) -> datetime:
    return now.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)


def week_start(now: datetime) -> datetime:
    d = day_start(now)
    return d - timedelta(days=d.weekday())  # Monday


def month_start(now: datetime) -> datetime:
    return day_start(now).replace(day=1)


def next_month(now: datetime) -> datetime:
    m = month_start(now)
    return (m + timedelta(days=32)).replace(day=1)


# ---- context ---------------------------------------------------------------------
@dataclass
class PeriodStats:
    realized_today: float = 0.0
    realized_week: float = 0.0
    realized_month: float = 0.0
    month_peak_balance: float = 0.0
    trades_opened_today: int = 0
    consecutive_losses: int = 0


@dataclass
class RiskContext:
    now: datetime
    demo_verified: bool
    account: AccountState
    spec: SymbolSpec
    quote: Quote
    quote_to_account: float
    open_positions: list[Position]
    pending_orders: int
    stats: PeriodStats
    active_locks: list[Lock]
    kill_switch: bool
    snapshot_created_at: datetime

    @property
    def floating_loss(self) -> float:
        """Open losses count against limits; open profits do not offset them."""
        return min(0.0, sum(p.unrealized_net for p in self.open_positions))


def compute_stats(journal: Journal, now: datetime, balance: float) -> PeriodStats:
    """From the ledger of closed trades (net of commission and swap). Assumes no
    deposits or withdrawals inside the month; on a demo that holds."""
    d0, w0, m0 = day_start(now), week_start(now), month_start(now)
    month = journal.trades(since=min(m0, w0))
    s = PeriodStats()
    in_month = []
    for t in month:
        ct = parse(t["close_time"])
        if ct >= d0:
            s.realized_today += t["net"]
        if ct >= w0:
            s.realized_week += t["net"]
        if ct >= m0:
            s.realized_month += t["net"]
            in_month.append(t["net"])
    running = balance - s.realized_month
    s.month_peak_balance = running
    for net in in_month:
        running += net
        s.month_peak_balance = max(s.month_peak_balance, running)
    # Streak counts only trades closed after the last reviewed streak lock.
    since = journal.last_release("losing_streak")
    streak = 0
    for t in journal.trades(since=since):
        streak = streak + 1 if t["net"] < 0 else 0
    s.consecutive_losses = streak
    s.trades_opened_today = journal.orders_opened_since(d0)
    return s


async def build_context(broker: Broker, journal: Journal, *, now: datetime,
                        snapshot_created_at: datetime, kill_switch_path: Path | None,
                        policy: RiskPolicy = POLICY) -> RiskContext:
    account = await broker.account()
    spec = await broker.symbol_spec(policy.symbol)
    quote = await broker.quote(policy.symbol)
    rate = await broker.conversion_rate(spec.quote_currency, account.currency)
    positions = await broker.open_positions()
    pending = await broker.pending_order_labels()
    return RiskContext(
        now=now, demo_verified=broker.demo_verified, account=account, spec=spec, quote=quote,
        quote_to_account=rate, open_positions=positions, pending_orders=len(pending),
        stats=compute_stats(journal, now, account.balance),
        active_locks=journal.active_locks(now),
        kill_switch=bool(kill_switch_path and kill_switch_path.exists()),
        snapshot_created_at=snapshot_created_at)


# ---- circuit breakers ------------------------------------------------------------
@dataclass
class Trip:
    kind: str
    reason: str
    requires_review: bool
    auto_release_at: datetime | None


def loss_figures(ctx: RiskContext, policy: RiskPolicy = POLICY) -> dict[str, tuple[float, float]]:
    """{period: (loss so far, limit)} in account currency, losses as positive numbers."""
    s, bal, fl = ctx.stats, ctx.account.balance, ctx.floating_loss
    day_base = bal - s.realized_today
    week_base = bal - s.realized_week
    equity = min(ctx.account.equity, bal + fl)
    return {
        "daily": (max(0.0, -(s.realized_today + fl)), policy.daily_loss_limit * day_base),
        "weekly": (max(0.0, -(s.realized_week + fl)), policy.weekly_loss_limit * week_base),
        "monthly": (max(0.0, s.month_peak_balance - equity),
                    policy.monthly_drawdown_limit * s.month_peak_balance),
    }


def breaker_trips(ctx: RiskContext, policy: RiskPolicy = POLICY) -> list[Trip]:
    """Which breakers should trip now. A tripped breaker stays locked (in the
    journal) until its reset time, and the review-only ones until a human
    releases them with a note (`python -m app.main unlock`)."""
    active = {lk.kind for lk in ctx.active_locks}
    now, out = ctx.now, []
    figs = loss_figures(ctx, policy)
    tomorrow = day_start(now) + timedelta(days=1)
    rules = [
        ("daily_loss", "daily", False, tomorrow),
        ("weekly_loss", "weekly", False, week_start(now) + timedelta(days=7)),
        ("monthly_drawdown", "monthly", True, next_month(now)),
    ]
    for kind, period, review, release in rules:
        loss, limit = figs[period]
        if kind not in active and loss >= limit > 0:
            out.append(Trip(kind, f"{period} loss {loss:.2f} reached limit {limit:.2f} "
                            f"{ctx.account.currency}", review, release))
    if "losing_streak" not in active and \
            ctx.stats.consecutive_losses >= policy.max_consecutive_losses:
        out.append(Trip("losing_streak", f"{ctx.stats.consecutive_losses} consecutive losses",
                        True, tomorrow))
    return out


def apply_trips(journal: Journal, ctx: RiskContext, policy: RiskPolicy = POLICY) -> list[Trip]:
    trips = breaker_trips(ctx, policy)
    for t in trips:
        journal.add_lock(t.kind, t.reason, requires_review=t.requires_review,
                         auto_release_at=t.auto_release_at, now=ctx.now)
        journal.event("breaker_tripped", ctx.now, kind=t.kind, reason=t.reason)
    if trips:
        ctx.active_locks = journal.active_locks(ctx.now)
    return trips


# ---- the decision ------------------------------------------------------------------
@dataclass
class Check:
    name: str
    passed: bool
    detail: str


@dataclass
class Approval:
    allowed: bool
    reason: str
    units: float = 0.0
    entry: float = 0.0
    stop_loss: float = 0.0
    take_profit: float = 0.0
    risk_amount: float = 0.0       # account currency lost if the stop fills at the allowance
    reward_risk: float = 0.0
    checks: list[Check] = field(default_factory=list)


def evaluate(p: Proposal, ctx: RiskContext, policy: RiskPolicy = POLICY) -> Approval:
    checks: list[Check] = []

    def check(name: str, ok: bool, detail: str) -> bool:
        checks.append(Check(name, bool(ok), detail))
        return bool(ok)

    def reject() -> Approval:
        first = next(c for c in checks if not c.passed)
        return Approval(False, f"{first.name}: {first.detail}", checks=checks)

    q, spec, acct = ctx.quote, ctx.spec, ctx.account
    gates = [
        ("demo_account", ctx.demo_verified and not acct.is_live,
         f"account {acct.account_id} demo_verified={ctx.demo_verified} is_live={acct.is_live}"),
        ("symbol", p.symbol == policy.symbol == spec.symbol, f"{p.symbol}"),
        ("kill_switch", not ctx.kill_switch, "KILL file present" if ctx.kill_switch else "off"),
        ("circuit_breakers", not ctx.active_locks,
         "; ".join(f"#{lk.id} {lk.kind}: {lk.reason}" for lk in ctx.active_locks) or "none"),
        ("quote_valid", q.bid > 0 and q.ask > q.bid, f"bid {q.bid} ask {q.ask}"),
        ("quote_fresh", (ctx.now - q.time).total_seconds() <= policy.max_quote_age_seconds,
         f"{(ctx.now - q.time).total_seconds():.1f}s old"),
        ("snapshot_fresh", (ctx.now - ctx.snapshot_created_at).total_seconds()
         <= policy.max_snapshot_age_seconds,
         f"{(ctx.now - ctx.snapshot_created_at).total_seconds():.0f}s old"),
        ("spread", q.spread <= policy.max_spread, f"{q.spread:.2f} (max {policy.max_spread})"),
        ("open_positions", len(ctx.open_positions) + ctx.pending_orders
         < policy.max_open_positions,
         f"{len(ctx.open_positions)} open, {ctx.pending_orders} pending"),
        ("trades_today", ctx.stats.trades_opened_today < policy.max_trades_per_day,
         f"{ctx.stats.trades_opened_today} of {policy.max_trades_per_day}"),
        ("losing_streak", ctx.stats.consecutive_losses < policy.max_consecutive_losses,
         f"{ctx.stats.consecutive_losses} consecutive losses"),
        ("conversion_rate", ctx.quote_to_account > 0 and math.isfinite(ctx.quote_to_account),
         f"{spec.quote_currency}->{acct.currency} {ctx.quote_to_account}"),
    ]
    for name, ok, detail in gates:
        if not check(name, ok, detail):
            return reject()

    # Direction and placement, measured from the price we would actually get.
    entry = q.ask if p.side == "BUY" else q.bid
    sl, tp = p.stop_loss, p.take_profit
    if p.side == "BUY":
        placed = sl < entry < tp
    else:
        placed = tp < entry < sl
    if not check("stop_target_placement", placed,
                 f"{p.side} entry {entry} SL {sl} TP {tp}"):
        return reject()
    stop_dist, target_dist = abs(entry - sl), abs(tp - entry)
    min_stop = max(spec.min_stop_distance, policy.min_stop_spreads * q.spread)
    if not check("min_stop_distance", stop_dist >= min_stop,
                 f"stop {stop_dist:.2f} vs minimum {min_stop:.2f}"):
        return reject()
    rr = target_dist / stop_dist
    if not check("reward_risk", rr >= policy.min_reward_risk,
                 f"{rr:.2f} (min {policy.min_reward_risk})"):
        return reject()

    # Size from the broker's real contract and today's conversion rate.
    loss_figs = loss_figures(ctx, policy)
    capital = min(acct.balance, acct.equity)
    budget = policy.risk_per_trade * capital
    headroom = min(limit - loss for loss, limit in loss_figs.values())
    allowed_risk = min(budget, headroom)
    if not check("loss_headroom", allowed_risk > 0,
                 f"per-trade {budget:.2f}, tightest limit headroom {headroom:.2f} {acct.currency}"):
        return reject()
    per_unit = (stop_dist + policy.stop_slippage_allowance
                + round_turn_commission_per_unit(spec, entry)) * ctx.quote_to_account
    raw_units = allowed_risk / per_unit
    # Round DOWN to the broker step, never up: float error can only cost volume.
    units = math.floor(raw_units / spec.step_units) * spec.step_units
    units = min(units, spec.max_units)
    min_risk = spec.min_units * per_unit
    if not check("min_volume", units >= spec.min_units,
                 f"broker minimum {spec.min_units:g} units would risk {min_risk:.2f} "
                 f"{acct.currency}; allowed {allowed_risk:.2f}"):
        return reject()
    units = round(units, 8)
    risk_amount = units * per_unit

    free_margin = acct.equity - acct.used_margin
    margin = units * entry * ctx.quote_to_account / max(acct.leverage, 1.0)
    if not check("margin", margin <= policy.max_margin_use * free_margin,
                 f"needs {margin:.2f} of {free_margin:.2f} free"):
        return reject()

    return Approval(True, "approved", units=units, entry=entry, stop_loss=sl, take_profit=tp,
                    risk_amount=round(risk_amount, 2), reward_risk=round(rr, 2), checks=checks)


def max_stop_at_min_volume(spec: SymbolSpec, capital: float, quote_to_account: float,
                           price: float, policy: RiskPolicy = POLICY) -> float:
    """Widest stop (USD/oz) the broker's minimum volume allows at this capital.
    If this is smaller than a normal M15 stop, the bot will almost never trade."""
    budget = policy.risk_per_trade * capital
    per_unit_budget = budget / spec.min_units / quote_to_account
    return per_unit_budget - policy.stop_slippage_allowance \
        - round_turn_commission_per_unit(spec, price)
