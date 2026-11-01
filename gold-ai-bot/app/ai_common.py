"""What both models are told, and how their answers are handled.

Both get the identical snapshot, neither sees the other's answer, and any
failure (timeout, refusal, malformed output, wrong snapshot id) becomes HOLD.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field

from .models import MarketSnapshot, TradeDecision
from .strategy import Candidate

SYSTEM_PROMPT = """You are one of two independent reviewers for a rules-based XAUUSD \
(spot gold) strategy running on a DEMO account. A deterministic pre-filter has flagged \
a possible setup on the bar that just closed. Your job is to decide whether it is a \
genuine, well-structured opportunity, and if so where the stop and target belong.

Rules:
- Answer only through the required structured output. Copy snapshot_id exactly.
- action is BUY, SELL or HOLD. HOLD is the right answer whenever you are unsure, the \
structure is messy, price is extended, or the stop would have to sit somewhere arbitrary.
- If action is BUY or SELL: stop_loss and take_profit are absolute prices. Put the stop \
beyond a real structural level, not at an arbitrary distance. The target must be at \
least 2x the stop distance from the current executable price (ask for BUY, bid for SELL).
- If action is HOLD: stop_loss = 0, take_profit = 0, setup_valid = false.
- You do not size positions or manage risk; a separate engine does that and may reject \
your proposal. Do not try to compensate for it.
- rationale: at most three sentences, naming the levels you used."""


def render_snapshot(s: MarketSnapshot, c: Candidate) -> str:
    def bars(cs, n):
        return [[b.time.strftime("%Y-%m-%d %H:%M"), b.open, b.high, b.low, b.close]
                for b in cs[-n:]]
    return json.dumps({
        "snapshot_id": s.snapshot_id,
        "symbol": s.symbol,
        "time_utc": s.created_at.strftime("%Y-%m-%d %H:%M:%S"),
        "quote": {"bid": s.quote.bid, "ask": s.quote.ask, "spread": round(s.quote.spread, 3)},
        "prefilter": {"side": c.side, "reason": c.reason},
        "features": s.features,
        "h1_bars_[time,o,h,l,c]": bars(s.h1, 48),
        "m15_bars_[time,o,h,l,c]": bars(s.m15, 64),
    }, separators=(",", ":"))


@dataclass
class DecisionResult:
    provider: str
    model: str
    decision: TradeDecision
    ok: bool
    error: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    latency_ms: int = 0
    raw: dict = field(default_factory=dict)


def hold(snapshot_id: str, why: str) -> TradeDecision:
    return TradeDecision(snapshot_id=snapshot_id, action="HOLD", symbol="XAUUSD",
                         stop_loss=0, take_profit=0, setup_valid=False, rationale=why[:300])


class Timer:
    def __enter__(self):
        self.t0 = time.monotonic()
        return self

    def __exit__(self, *a):
        self.ms = int((time.monotonic() - self.t0) * 1000)


def cost(tokens_in: int, tokens_out: int, per_m_in: float, per_m_out: float) -> float:
    return round(tokens_in / 1e6 * per_m_in + tokens_out / 1e6 * per_m_out, 6)


class RuleFollowerAgent:
    """Offline stand-in for both models (replays and tests). Takes the
    pre-filter's side, puts the stop 1.2 ATR away and the target at 2.5R."""

    def __init__(self, name: str = "rules", stop_atr: float = 1.2, rr: float = 2.5):
        self.provider, self.model = name, "offline"
        self.stop_atr, self.rr = stop_atr, rr

    async def decide(self, s: MarketSnapshot, c: Candidate) -> DecisionResult:
        a = float(s.features["atr14_m15"]) * self.stop_atr
        entry = s.quote.ask if c.side == "BUY" else s.quote.bid
        sign = 1 if c.side == "BUY" else -1
        d = TradeDecision(snapshot_id=s.snapshot_id, action=c.side, symbol="XAUUSD",
                          stop_loss=round(entry - sign * a, 2),
                          take_profit=round(entry + sign * a * self.rr, 2),
                          setup_valid=True, rationale=c.reason)
        return DecisionResult(self.provider, self.model, d, True)
