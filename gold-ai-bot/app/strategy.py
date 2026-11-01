"""Deterministic pre-filter: decides whether a bar is worth asking the models
about at all. It saves API spend and keeps the models judging a defined setup
rather than free-styling on every bar.

This is a deliberately plain placeholder (H1 trend + M15 break of the prior
20-bar range). Swap in your own ICT/SMC rules here; nothing else changes.
"""

from __future__ import annotations

from dataclasses import dataclass

from .models import MarketSnapshot, Side

SESSION_UTC = (7, 20)        # London open to late New York
FRIDAY_CUTOFF_UTC = 18       # no new trades into the weekend
MAX_SPREAD_TO_ATR = 0.25


@dataclass(frozen=True)
class Candidate:
    side: Side
    reason: str


def find_candidate(s: MarketSnapshot) -> Candidate | None:
    t = s.created_at
    if t.weekday() >= 5 or not (SESSION_UTC[0] <= t.hour < SESSION_UTC[1]):
        return None
    if t.weekday() == 4 and t.hour >= FRIDAY_CUTOFF_UTC:
        return None
    f = s.features
    atr_m15 = float(f["atr14_m15"])
    if atr_m15 <= 0 or float(f["spread"]) > MAX_SPREAD_TO_ATR * atr_m15:
        return None
    up = f["h1_close"] > f["ema50_h1"] and float(f["ema50_h1_slope_5"]) > 0
    down = f["h1_close"] < f["ema50_h1"] and float(f["ema50_h1_slope_5"]) < 0
    close = float(f["m15_close"])
    if up and close > float(f["m15_prior20_high"]):
        return Candidate("BUY", "H1 above rising EMA50; M15 closed above prior 20-bar high")
    if down and close < float(f["m15_prior20_low"]):
        return Candidate("SELL", "H1 below falling EMA50; M15 closed below prior 20-bar low")
    return None
