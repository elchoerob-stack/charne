import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.journal import Journal  # noqa: E402
from app.models import (AccountState, Candle, MarketSnapshot, Position, Proposal,  # noqa: E402
                        Quote, SymbolSpec, TradeDecision)
from app.risk_engine import PeriodStats, RiskContext  # noqa: E402

NOW = datetime(2026, 11, 4, 10, 0, 5, tzinfo=timezone.utc)  # a Wednesday, London session


def spec(**kw) -> SymbolSpec:
    base = dict(symbol="XAUUSD", broker_symbol_id=41, digits=2, quote_currency="USD",
                units_per_lot=100.0, min_units=1.0, max_units=5000.0, step_units=1.0)
    base.update(kw)
    return SymbolSpec(**base)


def quote(bid=2650.00, ask=2650.30, t=NOW) -> Quote:
    return Quote(bid=bid, ask=ask, time=t)


def account(balance=100_000.0, equity=None, live=False, **kw) -> AccountState:
    return AccountState(account_id=7, is_live=live, currency="ZAR", balance=balance,
                        equity=balance if equity is None else equity, leverage=100, **kw)


def ctx(**kw) -> RiskContext:
    base = dict(now=NOW, demo_verified=True, account=account(), spec=spec(), quote=quote(),
                quote_to_account=17.5, open_positions=[], pending_orders=0,
                stats=PeriodStats(month_peak_balance=100_000.0), active_locks=[],
                kill_switch=False, snapshot_created_at=NOW)
    base.update(kw)
    if "stats" not in kw:
        base["stats"].month_peak_balance = base["account"].balance
    return RiskContext(**base)


def buy(sl=2645.00, tp=2662.00, sid="XAUUSD-20261104T1000Z") -> Proposal:
    return Proposal(snapshot_id=sid, symbol="XAUUSD", side="BUY", stop_loss=sl,
                    take_profit=tp, rationale="test")


def decision(action="BUY", sl=2645.0, tp=2662.0, sid="XAUUSD-20261104T1000Z",
             valid=True, anchor_time="2026-11-04 08:30", anchor_price=2646.0) -> TradeDecision:
    if action == "HOLD":
        sl = tp = anchor_price = 0
        anchor_time = ""
    return TradeDecision(snapshot_id=sid, action=action, symbol="XAUUSD", stop_loss=sl,
                         take_profit=tp, stop_anchor_time=anchor_time,
                         stop_anchor_price=anchor_price, setup_valid=valid, rationale="r")


def position(pid="1", label="gab-x", sl=2645.0, unreal=0.0, side="BUY") -> Position:
    return Position(position_id=pid, symbol="XAUUSD", side=side, units=1, entry_price=2650,
                    stop_loss=sl, take_profit=2662, label=label, unrealized_net=unreal)


def bars(n: int, start: datetime = datetime(2026, 10, 5, 0, 0, tzinfo=timezone.utc),
         price: float = 2600.0, drift: float = 0.0, vol: float = 1.5, seed: int = 7) -> list[Candle]:
    """Deterministic M15 random walk that skips weekends."""
    rng = random.Random(seed)
    out, t = [], start
    while len(out) < n:
        if t.weekday() < 5:
            o = price
            c = o + drift + rng.gauss(0, vol)
            h = max(o, c) + abs(rng.gauss(0, vol / 2))
            low = min(o, c) - abs(rng.gauss(0, vol / 2))
            out.append(Candle(time=t, open=round(o, 2), high=round(h, 2), low=round(low, 2),
                              close=round(c, 2)))
            price = c
        t += timedelta(minutes=15)
    return out


def snapshot(sid="XAUUSD-20261104T1000Z", q=None, created=NOW) -> MarketSnapshot:
    m15 = bars(100)
    return MarketSnapshot(snapshot_id=sid, symbol="XAUUSD", created_at=created,
                          quote=q or quote(), m15=m15, h1=m15[::4], features={"atr14_m15": 4.0})


@pytest.fixture
def journal():
    return Journal(":memory:")
