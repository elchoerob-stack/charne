"""Market snapshot: fetch, validate, describe. Bad data means no trade."""

from __future__ import annotations

from datetime import datetime, timedelta

from .broker import Broker
from .models import TIMEFRAME_MINUTES, Candle, MarketSnapshot, Quote
from . import ict
from .strategy import ICT
from .structure import fair_value_gaps, swings

M15_BARS = 96   # one day
H1_BARS = 120   # five days
MAX_INTRADAY_GAP = timedelta(hours=2)  # gold has a daily maintenance break of about an hour


def ema(values: list[float], period: int) -> list[float]:
    if not values:
        return []
    k = 2 / (period + 1)
    out = [values[0]]
    for v in values[1:]:
        out.append(v * k + out[-1] * (1 - k))
    return out


def atr(candles: list[Candle], period: int = 14) -> float:
    if len(candles) < period + 1:
        return 0.0
    trs = [max(c.high - c.low, abs(c.high - p.close), abs(c.low - p.close))
           for p, c in zip(candles, candles[1:])]
    a = sum(trs[:period]) / period
    for tr in trs[period:]:
        a = (a * (period - 1) + tr) / period  # Wilder
    return a


def _crosses_weekend(a: datetime, b: datetime) -> bool:
    d = a
    while d <= b:
        if d.weekday() == 5:  # a Saturday in between
            return True
        d += timedelta(days=1)
    return False


def validate_candles(bars: list[Candle], timeframe: str, now: datetime,
                     min_count: int) -> list[str]:
    step = timedelta(minutes=TIMEFRAME_MINUTES[timeframe])
    problems: list[str] = []
    if len(bars) < min_count:
        return [f"{timeframe}: {len(bars)} bars, need {min_count}"]
    for i, c in enumerate(bars):
        if min(c.open, c.high, c.low, c.close) <= 0:
            problems.append(f"{timeframe}: non-positive price at {c.time}")
        if c.high < max(c.open, c.close) or c.low > min(c.open, c.close) or c.high < c.low:
            problems.append(f"{timeframe}: inconsistent OHLC at {c.time}")
        if i:
            gap = c.time - bars[i - 1].time
            if gap <= timedelta(0):
                problems.append(f"{timeframe}: bars out of order or duplicated at {c.time}")
            elif gap > MAX_INTRADAY_GAP and not _crosses_weekend(bars[i - 1].time, c.time):
                problems.append(f"{timeframe}: {gap} gap before {c.time}")
    last_close = bars[-1].time + step
    if last_close > now:
        problems.append(f"{timeframe}: last bar {bars[-1].time} has not closed yet")
    elif now - last_close > step:
        problems.append(f"{timeframe}: stale, last bar closed {now - last_close} ago")
    return problems[:5]


def validate_quote(q: Quote, now: datetime, last_close: float, atr_m15: float,
                   max_age_s: float = 15.0) -> list[str]:
    problems = []
    if q.bid <= 0 or q.ask <= q.bid:
        problems.append(f"quote invalid: bid {q.bid} ask {q.ask}")
    age = (now - q.time).total_seconds()
    if age > max_age_s:
        problems.append(f"quote {age:.0f}s old")
    if atr_m15 > 0 and abs(q.mid - last_close) > 3 * atr_m15:
        problems.append(f"quote {q.mid:.2f} is more than 3 ATR from last close {last_close:.2f}")
    return problems


def features(m15: list[Candle], h1: list[Candle], q: Quote) -> dict:
    closes_h1 = [c.close for c in h1]
    e50 = ema(closes_h1, 50)
    recent = m15[-21:-1]
    return {
        "atr14_m15": round(atr(m15, 14), 3),
        "atr14_h1": round(atr(h1, 14), 3),
        "ema50_h1": round(e50[-1], 3),
        "ema50_h1_slope_5": round(e50[-1] - e50[-6], 3) if len(e50) > 6 else 0.0,
        "h1_close": h1[-1].close,
        "m15_close": m15[-1].close,
        "m15_prior20_high": max(c.high for c in recent),
        "m15_prior20_low": min(c.low for c in recent),
        "spread": round(q.spread, 3),
        # Confirmed swings [time, kind, price]: the only valid stop anchors.
        "swings_m15": [x.as_list() for x in swings(m15)[-10:]],
        "swings_h1": [x.as_list() for x in swings(h1)[-8:]],
        "open_fvgs_m15": [[g.time, g.direction, g.bottom, g.top]
                          for g in fair_value_gaps(m15)[-4:]],
        # H4 bias, dealing range, killzone, untaken PDH/PDL/Asia/H1 swing levels
        "ict": ict.summary(m15, h1, ICT.killzones_ny),
        "bid": q.bid,
        "ask": q.ask,
    }


async def build_snapshot(broker: Broker, symbol: str, now: datetime
                         ) -> tuple[MarketSnapshot | None, list[str]]:
    m15 = await broker.candles(symbol, "M15", M15_BARS)
    h1 = await broker.candles(symbol, "H1", H1_BARS)
    problems = validate_candles(m15, "M15", now, 40) + validate_candles(h1, "H1", now, 60)
    if problems:
        return None, problems
    q = await broker.quote(symbol)
    feats = features(m15, h1, q)
    problems = validate_quote(q, now, m15[-1].close, float(feats["atr14_m15"]))
    if problems:
        return None, problems
    closed_at = m15[-1].time + timedelta(minutes=15)
    sid = f"{symbol}-{closed_at:%Y%m%dT%H%M}Z"
    return MarketSnapshot(snapshot_id=sid, symbol=symbol, created_at=now, quote=q,
                          m15=m15, h1=h1, features=feats), []
