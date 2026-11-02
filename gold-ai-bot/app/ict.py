"""ICT / SMC mechanics, computed from closed bars only.

- New York time (DST-aware): killzones, the Asian range, the trading day
  (17:00 to 17:00 New York)
- H4 bars resampled from H1 on New York 17:00-aligned blocks
- H4 bias from market structure: the last close beyond a confirmed swing
  sets it. Dealing range and premium/discount follow from it.
- Liquidity pools: previous day high/low, Asian range high/low, and confirmed
  M15 and H1 swings. Each has the M15 index from which it was knowable.
- The sweep → market structure shift (displacement + FVG) → first return to
  the FVG sequence, run by strategy.ict_2022.

Nothing here looks ahead: tests/test_ict.py checks that every result at bar t
is identical with and without the bars after t.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from .models import Candle
from .structure import SWING_RIGHT, swings

NY = ZoneInfo("America/New_York")
M15 = timedelta(minutes=15)
DAY_ROLL_HOUR_NY = 17          # gold's trading day rolls at 17:00 New York
ASIA_NY = (20, 24)             # Asian range: 20:00-24:00 New York


def ny(t: datetime) -> datetime:
    return t.astimezone(NY)


def killzone(t: datetime, zones) -> str:
    """Name of the killzone containing time t (UTC), or ''."""
    local = ny(t)
    h = local.hour + local.minute / 60
    return next((name for name, start, end in zones if start <= h < end), "")


def trading_day(t: datetime):
    return (ny(t) - timedelta(hours=DAY_ROLL_HOUR_NY)).date()


# ---- H4 and bias -----------------------------------------------------------------
def resample_h4(h1: list[Candle], now: datetime) -> list[Candle]:
    """Complete H4 bars only, aligned to New York 17:00 (17, 21, 01, 05, 09, 13)."""
    groups: dict[tuple, list[Candle]] = {}
    for c in h1:
        local = ny(c.time) - timedelta(hours=DAY_ROLL_HOUR_NY)
        groups.setdefault((local.date(), local.hour // 4), []).append(c)
    out = []
    for (_d, _blk), bars in sorted(groups.items(), key=lambda kv: kv[1][0].time):
        start = bars[0].time - timedelta(hours=(ny(bars[0].time).hour - DAY_ROLL_HOUR_NY) % 4)
        if start + timedelta(hours=4) > now:
            continue  # still forming
        out.append(Candle(time=start, open=bars[0].open, high=max(b.high for b in bars),
                          low=min(b.low for b in bars), close=bars[-1].close))
    return out


@dataclass(frozen=True)
class Bias:
    direction: int            # +1 bullish, -1 bearish, 0 none
    range_low: float
    range_high: float

    @property
    def equilibrium(self) -> float:
        return (self.range_low + self.range_high) / 2


def htf_bias(h4: list[Candle], left: int = 2, right: int = 2) -> Bias:
    """Walk H4 bars; a close above the last confirmed swing high makes the bias
    bullish, a close below the last confirmed swing low bearish. The dealing
    range runs from the protected swing to the extreme reached since."""
    piv = swings(h4, left, right)
    direction, last_hi, last_lo = 0, None, None
    lo_idx = hi_idx = None
    for i, bar in enumerate(h4):
        for p in piv:
            if p.index + right == i - 1:  # confirmed by the bar before this one
                if p.kind == "high":
                    last_hi, hi_idx = p.price, p.index
                else:
                    last_lo, lo_idx = p.price, p.index
        if last_hi is not None and bar.close > last_hi:
            direction = 1
        elif last_lo is not None and bar.close < last_lo:
            direction = -1
    if direction == 1 and lo_idx is not None:
        return Bias(1, last_lo, max(b.high for b in h4[lo_idx:]))
    if direction == -1 and hi_idx is not None:
        return Bias(-1, min(b.low for b in h4[hi_idx:]), last_hi)
    return Bias(0, 0.0, 0.0)


# ---- liquidity -------------------------------------------------------------------------
@dataclass(frozen=True)
class Pool:
    side: Literal["high", "low"]
    price: float
    label: str
    from_idx: int             # first M15 index at which the level was known
    formed: datetime          # time after which a trade through it counts as taking it


def _first_idx(m15: list[Candle], t: datetime) -> int:
    return next((i for i, b in enumerate(m15) if b.time >= t), len(m15))


def liquidity_pools(m15: list[Candle], h1: list[Candle]) -> list[Pool]:
    pools: list[Pool] = []
    # Confirmed M15 swings (known once SWING_RIGHT later bars closed)
    for sw in swings(m15):
        k = sw.index + SWING_RIGHT + 1
        pools.append(Pool(sw.kind, sw.price, f"M15 swing {sw.kind} {sw.time}", k,
                          m15[sw.index].time + M15))
    # Confirmed H1 swings
    for sw in swings(h1):
        known = h1[sw.index + SWING_RIGHT].time + timedelta(hours=1)
        pools.append(Pool(sw.kind, sw.price, f"H1 swing {sw.kind} {sw.time}",
                          _first_idx(m15, known), h1[sw.index].time + timedelta(hours=1)))
    # Previous trading day high/low, from H1
    days: dict = {}
    for c in h1:
        days.setdefault(trading_day(c.time), []).append(c)
    for d, bars in days.items():
        nxt = datetime(d.year, d.month, d.day, DAY_ROLL_HOUR_NY, tzinfo=NY) + timedelta(days=1)
        if nxt > h1[-1].time + timedelta(hours=1):
            continue  # the current, unfinished day
        k = _first_idx(m15, nxt)
        pools.append(Pool("high", max(b.high for b in bars), f"PDH {d}", k, nxt))
        pools.append(Pool("low", min(b.low for b in bars), f"PDL {d}", k, nxt))
    # Asian range, from M15
    asia: dict = {}
    for i, c in enumerate(m15):
        local = ny(c.time)
        if ASIA_NY[0] <= local.hour < ASIA_NY[1]:
            asia.setdefault(local.date(), []).append(i)
    for d, idxs in asia.items():
        end = m15[idxs[-1]].time + M15
        if ny(end).hour != 0 or ny(end).minute != 0:
            continue  # incomplete session
        bars = [m15[i] for i in idxs]
        pools.append(Pool("high", max(b.high for b in bars), f"Asia high {d}", idxs[-1] + 1, end))
        pools.append(Pool("low", min(b.low for b in bars), f"Asia low {d}", idxs[-1] + 1, end))
    return pools


def pool_kind(label: str) -> str:
    """'PDH/PDL', 'Asia', 'M15 swing' or 'H1 swing'."""
    if label[:3] in ("PDH", "PDL"):
        return "PDH/PDL"
    if label.startswith("Asia"):
        return "Asia"
    return "M15 swing" if label.startswith("M15") else "H1 swing"


def untaken(p: Pool, m15: list[Candle], h1: list[Candle], until_idx: int) -> bool:
    """True if no bar between the pool forming and m15[until_idx] traded through it."""
    end_t = m15[until_idx].time if until_idx < len(m15) else m15[-1].time + M15
    low = p.side == "low"
    hour = timedelta(hours=1)
    for b in h1:
        if b.time >= p.formed and b.time + hour <= end_t and \
                (b.low <= p.price if low else b.high >= p.price):
            return False
    # from_idx - 4 covers the confirmation bars of an M15 swing; earlier bars
    # of H1-derived pools are covered by the H1 loop above.
    for b in m15[max(0, p.from_idx - 4):until_idx]:
        if b.time >= p.formed and (b.low <= p.price if low else b.high >= p.price):
            return False
    return True


def summary(m15: list[Candle], h1: list[Candle], zones) -> dict:
    """Context handed to the models with every snapshot."""
    now = m15[-1].time + M15
    b = htf_bias(resample_h4(h1, now))
    n = len(m15)
    live = [p for p in liquidity_pools(m15, h1)
            if p.from_idx < n and untaken(p, m15, h1, n) and not p.label.startswith("M15")]
    return {
        "htf_bias_h4": {1: "bullish", -1: "bearish", 0: "none"}[b.direction],
        "dealing_range_h4": [round(b.range_low, 2), round(b.range_high, 2)],
        "killzone_now": killzone(now, zones) or "none",
        "untaken_liquidity": [[p.label, p.price] for p in live][-10:],
    }
