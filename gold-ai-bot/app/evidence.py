"""Check what a model claims against the snapshot it was given.

A model must say which bar its stop protects (stop_anchor_time/price). The
claim is rejected unless that bar is really in the snapshot at that price,
it is a genuine local extreme that price has not traded through since, the
stop sits just beyond it, and the target is a plausible distance away. This
catches invented levels, misread prices and stops at arbitrary distances.
"""

from __future__ import annotations

from .models import Candle, MarketSnapshot, TradeDecision
from .structure import tstr

PRICE_TOLERANCE = 0.051          # rounding slack on a two-decimal price
LOCAL_EXTREME_BARS = 3           # anchor must be the extreme of the bars just before it
MAX_STOP_BEYOND_ANCHOR_ATR = 1.0
MAX_TARGET_H1_ATR = 8.0


def _find(s: MarketSnapshot, t: str) -> tuple[str, list[Candle], int] | None:
    for tf, series in (("M15", s.m15), ("H1", s.h1)):
        for i, b in enumerate(series):
            if tstr(b) == t:
                return tf, series, i
    return None


def check(d: TradeDecision, s: MarketSnapshot) -> list[str]:
    if d.action == "HOLD":
        return []
    found = _find(s, d.stop_anchor_time.strip())
    if found is None:
        return [f"anchor bar {d.stop_anchor_time!r} is not in the snapshot"]
    tf, series, i = found
    bar, buy = series[i], d.action == "BUY"
    actual = bar.low if buy else bar.high
    problems = []
    if abs(actual - d.stop_anchor_price) > PRICE_TOLERANCE:
        problems.append(f"anchor price {d.stop_anchor_price} but the {tf} bar at "
                        f"{d.stop_anchor_time} has {'low' if buy else 'high'} {actual}")
    before, after = series[max(0, i - LOCAL_EXTREME_BARS):i], series[i + 1:]
    if buy:
        extreme = all(x.low >= actual for x in before)
        intact = all(x.low > actual for x in after)
        beyond = d.stop_loss < actual
    else:
        extreme = all(x.high <= actual for x in before)
        intact = all(x.high < actual for x in after)
        beyond = d.stop_loss > actual
    if not extreme:
        problems.append(f"anchor {actual} at {d.stop_anchor_time} is not a local "
                        f"{'low' if buy else 'high'}")
    if not intact:
        problems.append(f"anchor {actual} has already been traded through")
    atr = float(s.features["atr14_m15" if tf == "M15" else "atr14_h1"])
    gap = abs(actual - d.stop_loss)
    if not beyond:
        problems.append(f"stop {d.stop_loss} is not beyond the anchor {actual}")
    elif atr > 0 and gap > MAX_STOP_BEYOND_ANCHOR_ATR * atr:
        problems.append(f"stop is {gap:.2f} beyond the anchor (max {atr:.2f}, 1 {tf} ATR)")
    entry = s.quote.ask if buy else s.quote.bid
    atr_h1 = float(s.features["atr14_h1"])
    if atr_h1 > 0 and abs(d.take_profit - entry) > MAX_TARGET_H1_ATR * atr_h1:
        problems.append(f"target {abs(d.take_profit - entry):.2f} away exceeds "
                        f"{MAX_TARGET_H1_ATR:g} H1 ATR")
    return problems
