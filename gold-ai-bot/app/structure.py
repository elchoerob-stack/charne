"""Market structure from closed bars only: swing points, fair-value gaps,
liquidity sweeps, displacement.

No look-ahead. A swing at bar i is only reported once `right` later bars
have closed, which is exactly when a trader watching live could have known
it. tests/test_structure.py checks that every result for bar t is identical
whether or not later bars exist.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from .models import Candle

SWING_LEFT = 3
SWING_RIGHT = 2


@dataclass(frozen=True)
class Swing:
    kind: Literal["high", "low"]
    time: str          # "YYYY-MM-DD HH:MM" UTC, the format the models see
    price: float
    index: int

    def as_list(self) -> list:
        return [self.time, self.kind, self.price]


@dataclass(frozen=True)
class FVG:
    direction: Literal["bull", "bear"]
    time: str          # middle bar of the three
    top: float
    bottom: float


def tstr(c: Candle) -> str:
    return c.time.strftime("%Y-%m-%d %H:%M")


def swings(bars: list[Candle], left: int = SWING_LEFT, right: int = SWING_RIGHT) -> list[Swing]:
    out: list[Swing] = []
    for i in range(left, len(bars) - right):
        b = bars[i]
        before, after = bars[i - left:i], bars[i + 1:i + 1 + right]
        if b.high > max(x.high for x in before) and b.high >= max(x.high for x in after):
            out.append(Swing("high", tstr(b), b.high, i))
        if b.low < min(x.low for x in before) and b.low <= min(x.low for x in after):
            out.append(Swing("low", tstr(b), b.low, i))
    return out


def fair_value_gaps(bars: list[Candle], lookback: int = 40) -> list[FVG]:
    """Unfilled three-bar imbalances among the last `lookback` bars."""
    out: list[FVG] = []
    start = max(1, len(bars) - lookback)
    for i in range(start, len(bars) - 1):
        a, c = bars[i - 1], bars[i + 1]
        later = bars[i + 2:]
        if a.high < c.low:  # bullish gap
            if not any(x.low <= a.high for x in later):
                out.append(FVG("bull", tstr(bars[i]), c.low, a.high))
        elif a.low > c.high:  # bearish gap
            if not any(x.high >= a.low for x in later):
                out.append(FVG("bear", tstr(bars[i]), a.low, c.high))
    return out


def liquidity_sweep(bars: list[Candle], piv: list[Swing], max_age: int = 40
                    ) -> tuple[Literal["BUY", "SELL"], Swing] | None:
    """The last closed bar traded through a recent swing and closed back
    inside it: sell-side liquidity taken (BUY) or buy-side taken (SELL).
    Only swings not already taken out by an earlier bar count."""
    if len(bars) < 3:
        return None
    last_i = len(bars) - 1
    last = bars[-1]
    for s in reversed(piv):
        if last_i - s.index > max_age or s.index >= last_i:
            continue
        between = bars[s.index + 1:last_i]
        if s.kind == "low" and last.low < s.price < last.close \
                and all(x.low >= s.price for x in between):
            return "BUY", s
        if s.kind == "high" and last.high > s.price > last.close \
                and all(x.high <= s.price for x in between):
            return "SELL", s
    return None


def displacement(bar: Candle, atr: float, body_atr: float = 1.2) -> int:
    """+1 / -1 for a strong-bodied bar in that direction, else 0."""
    body = bar.close - bar.open
    if atr > 0 and abs(body) >= body_atr * atr:
        return 1 if body > 0 else -1
    return 0


def last_of(piv: list[Swing], kind: str) -> Swing | None:
    return next((s for s in reversed(piv) if s.kind == kind), None)


def last_intact(piv: list[Swing], bars: list[Candle], kind: str) -> Swing | None:
    """Most recent swing of `kind` that no later bar has traded through: the
    only kind of level a stop can honestly sit behind."""
    for sw in reversed(piv):
        if sw.kind != kind:
            continue
        later = bars[sw.index + 1:]
        if kind == "low" and all(b.low > sw.price for b in later):
            return sw
        if kind == "high" and all(b.high < sw.price for b in later):
            return sw
    return None
