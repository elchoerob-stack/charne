"""Deterministic setup detection. Decides which bars are worth asking the
models about, and proposes mechanical baseline levels for each setup.

Each setup is a separate module with a mode:
  live   - candidates go to the models, and can become demo orders
  shadow - candidates are only recorded as shadow trades (shadow.py), so the
           module proves itself on live data before it may trade
  off    - ignored

A module moves from shadow to live only after its shadow record passes
cbot-gate (`python -m app.main export-shadow ...`). Changing a mode changes
the test-period fingerprint (fingerprint.py), so old results don't carry
over to the new configuration.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from .models import MarketSnapshot, Side
from .structure import Swing, displacement, last_intact, liquidity_sweep, swings

Mode = Literal["live", "shadow", "off"]
STRATEGY_MODES: dict[str, Mode] = {
    "trend_breakout": "live",
    "liquidity_sweep": "shadow",
}
SESSION_UTC = (7, 20)        # London open to late New York
FRIDAY_CUTOFF_UTC = 18       # no new trades into the weekend
MAX_SPREAD_TO_ATR = 0.25
BASELINE_RR = 2.5            # mechanical target for shadow/baseline trades
STOP_BUFFER_ATR = 0.1        # stop sits this far beyond the anchor
MAX_STOP_ATR = 3.0           # an anchor further than this is not a usable stop


@dataclass(frozen=True)
class Candidate:
    side: Side
    reason: str
    strategy: str = "manual"
    stop: float = 0.0          # mechanical baseline levels
    target: float = 0.0
    anchor: Swing | None = field(default=None, compare=False)
    mode: Mode = "live"


def window_open(s: MarketSnapshot) -> bool:
    t = s.created_at
    if t.weekday() >= 5 or not (SESSION_UTC[0] <= t.hour < SESSION_UTC[1]):
        return False
    return not (t.weekday() == 4 and t.hour >= FRIDAY_CUTOFF_UTC)


def _levels(s: MarketSnapshot, side: Side, anchor_price: float) -> tuple[float, float] | None:
    atr = float(s.features["atr14_m15"])
    entry = s.quote.ask if side == "BUY" else s.quote.bid
    sign = 1 if side == "BUY" else -1
    stop = round(anchor_price - sign * STOP_BUFFER_ATR * atr, 2)
    dist = (entry - stop) * sign
    if dist <= 0 or dist > MAX_STOP_ATR * atr:
        return None
    return stop, round(entry + sign * BASELINE_RR * dist, 2)


def trend_breakout(s: MarketSnapshot) -> Candidate | None:
    """H1 trend (close vs rising/falling EMA50) + M15 close beyond the prior
    20-bar range. Stop beyond the last intact opposite M15 swing."""
    f = s.features
    up = f["h1_close"] > f["ema50_h1"] and float(f["ema50_h1_slope_5"]) > 0
    down = f["h1_close"] < f["ema50_h1"] and float(f["ema50_h1_slope_5"]) < 0
    close = float(f["m15_close"])
    if up and close > float(f["m15_prior20_high"]):
        side, kind = "BUY", "low"
    elif down and close < float(f["m15_prior20_low"]):
        side, kind = "SELL", "high"
    else:
        return None
    anchor = last_intact(swings(s.m15), s.m15, kind)
    lv = _levels(s, side, anchor.price) if anchor else None
    if lv is None:
        return None
    return Candidate(side, f"H1 trend + M15 range break; stop beyond swing {kind} "
                           f"{anchor.price} ({anchor.time})", "trend_breakout", *lv, anchor)


def liquidity_sweep_setup(s: MarketSnapshot) -> Candidate | None:
    """The last M15 bar ran a recent swing and closed back inside, with the
    H1 trend not against it. Stop beyond the sweep bar's extreme."""
    hit = liquidity_sweep(s.m15, swings(s.m15))
    if hit is None:
        return None
    side, swept = hit
    f = s.features
    if (side == "BUY" and f["h1_close"] < f["ema50_h1"]) or \
            (side == "SELL" and f["h1_close"] > f["ema50_h1"]):
        return None
    bar = s.m15[-1]
    extreme = bar.low if side == "BUY" else bar.high
    lv = _levels(s, side, extreme)
    if lv is None:
        return None
    disp = displacement(bar, float(f["atr14_m15"]), 0.6)
    anchor = Swing("low" if side == "BUY" else "high", bar.time.strftime("%Y-%m-%d %H:%M"),
                   extreme, len(s.m15) - 1)
    return Candidate(side, f"swept {swept.kind} {swept.price} ({swept.time}) and closed back"
                           f"{' with displacement' if disp else ''}", "liquidity_sweep", *lv,
                     anchor)


SETUPS = {"trend_breakout": trend_breakout, "liquidity_sweep": liquidity_sweep_setup}


def find_candidates(s: MarketSnapshot) -> list[Candidate]:
    if not window_open(s):
        return []
    atr = float(s.features["atr14_m15"])
    if atr <= 0 or float(s.features["spread"]) > MAX_SPREAD_TO_ATR * atr:
        return []
    out = []
    for name, fn in SETUPS.items():
        mode = STRATEGY_MODES.get(name, "off")
        if mode == "off":
            continue
        c = fn(s)
        if c is not None:
            out.append(Candidate(c.side, c.reason, c.strategy, c.stop, c.target, c.anchor, mode))
    return out


def find_candidate(s: MarketSnapshot) -> Candidate | None:
    """The first live candidate, if any."""
    return next((c for c in find_candidates(s) if c.mode == "live"), None)
