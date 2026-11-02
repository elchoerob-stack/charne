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
- If action is BUY or SELL: stop_loss and take_profit are absolute prices. The stop must \
sit just beyond a real structural level: the low (BUY) or high (SELL) of one specific bar \
in the data: one of the confirmed swings listed in features, or the extreme of the bar \
that swept liquidity. Name that bar in \
stop_anchor_time and copy its price into stop_anchor_price exactly. Your claim is checked \
against the data; an anchor that doesn't match, was already broken, or sits more than one \
ATR from the stop gets the proposal rejected. The target must be at least 2x the stop \
distance from the current executable price (ask for BUY, bid for SELL), at a level price \
can plausibly reach (an opposing swing or an unfilled gap).
- If action is HOLD: stop_loss = 0, take_profit = 0, stop_anchor_time = "", \
stop_anchor_price = 0, setup_valid = false.
- The setup is an ICT model (prefilter.reason gives the sweep, market structure shift, \
FVG and liquidity target). features.ict gives the H4 bias, dealing range, killzone and \
untaken liquidity. Judge whether the sequence is clean and the draw on liquidity is \
credible; HOLD if the sweep is minor, the displacement weak, or opposing liquidity sits \
just ahead of entry.
- Use only the data provided. Do not assume news, prices or levels that are not in it.
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
        "prefilter": {"setup": c.strategy, "side": c.side, "reason": c.reason},
        "features": s.features,
        "h1_bars_[time,o,h,l,c]": bars(s.h1, 48),
        "m15_bars_[time,o,h,l,c]": bars(s.m15, 96),
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
                         stop_loss=0, take_profit=0, stop_anchor_time="",
                         stop_anchor_price=0, setup_valid=False, rationale=why[:300])


class Timer:
    def __enter__(self):
        self.t0 = time.monotonic()
        return self

    def __exit__(self, *a):
        self.ms = int((time.monotonic() - self.t0) * 1000)


def cost(tokens_in: int, tokens_out: int, per_m_in: float, per_m_out: float) -> float:
    return round(tokens_in / 1e6 * per_m_in + tokens_out / 1e6 * per_m_out, 6)


class RuleFollowerAgent:
    """Offline stand-in for both models (replays and tests): agrees with the
    pre-filter and uses its mechanical stop, anchor and target."""

    def __init__(self, name: str = "rules"):
        self.provider, self.model = name, "offline"

    async def decide(self, s: MarketSnapshot, c: Candidate) -> DecisionResult:
        if c.anchor is None or not c.stop:
            return DecisionResult(self.provider, self.model, hold(s.snapshot_id, "no levels"), True)
        d = TradeDecision(snapshot_id=s.snapshot_id, action=c.side, symbol="XAUUSD",
                          stop_loss=c.stop, take_profit=c.target,
                          stop_anchor_time=c.anchor.time, stop_anchor_price=c.anchor.price,
                          setup_valid=True, rationale=c.reason)
        return DecisionResult(self.provider, self.model, d, True)


async def preflight(agent) -> str:
    """One real call on a fixed synthetic snapshot. Returns '' if the model
    is reachable and returns a schema-valid decision for the right snapshot,
    else the reason. `run` refuses to start unless both pass, so a wrong or
    retired model ID fails at start-up, not silently as HOLD forever."""
    import random
    from datetime import datetime, timedelta, timezone

    from .market_data import features
    from .models import Candle, Quote

    rng, price, t = random.Random(1), 2600.0, datetime(2026, 1, 5, tzinfo=timezone.utc)
    m15 = []
    while len(m15) < 480:
        if t.weekday() < 5:
            c = price + 0.1 + rng.gauss(0, 1.5)
            m15.append(Candle(time=t, open=round(price, 2), high=round(max(price, c) + .5, 2),
                              low=round(min(price, c) - .5, 2), close=round(c, 2)))
            price = c
        t += timedelta(minutes=15)
    h1 = [Candle(time=m15[i].time, open=m15[i].open, high=max(x.high for x in m15[i:i + 4]),
                 low=min(x.low for x in m15[i:i + 4]), close=m15[i + 3].close)
          for i in range(0, len(m15) - 3, 4)]
    now = m15[-1].time + timedelta(minutes=15)
    q = Quote(bid=round(m15[-1].close, 2), ask=round(m15[-1].close + 0.3, 2), time=now)
    sid = "PREFLIGHT-" + now.strftime("%Y%m%dT%H%M") + "Z"
    snap = MarketSnapshot(snapshot_id=sid, symbol="XAUUSD", created_at=now, quote=q,
                          m15=m15[-96:], h1=h1[-120:], features=features(m15[-96:], h1[-120:], q))
    r = await agent.decide(snap, Candidate("BUY", "preflight connectivity check", "preflight"))
    if not r.ok:
        return f"{r.provider} {r.model}: {r.error or 'invalid output'}"
    if r.decision.snapshot_id != sid:
        return f"{r.provider} {r.model}: echoed snapshot {r.decision.snapshot_id!r}, expected {sid!r}"
    return ""
