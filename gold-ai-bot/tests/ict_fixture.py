"""A hand-built, textbook ICT BUY on XAUUSD M15 (and its mirror-image SELL).

Wednesday 4 Nov 2026 (New York on EST, UTC-5):
  Nov 3 10:00 UTC  spike high 2676            -> PDH for the trading day of Nov 2
  01:00-05:00 UTC  Asian range, low 2641 at 03:00
  06:15            swing high 2653
  07:15            sweep: low 2639 takes the Asian low, closes back at 2642
  07:30 / 07:45    displacement: 07:45 closes 2654.5 above the swing high (MSS)
  08:00            low 2649 leaves an FVG 2647-2649 above the 07:30 high
  08:15            holds above the FVG
  08:30            first return into the FVG (low 2648.5), closes 2650
Decision at 08:45:05 UTC = 03:45 New York, London killzone.
"""

import math
from datetime import datetime, timedelta, timezone

from app.main import resample_h1
from app.market_data import features
from app.models import Candle, MarketSnapshot, Quote

T_END = datetime(2026, 11, 4, 8, 30, tzinfo=timezone.utc)  # open time of the entry bar
NOW = T_END + timedelta(minutes=15, seconds=5)

SCRIPT = {  # UTC time -> (o, h, l, c)
    datetime(2026, 11, 3, 10, 0, tzinfo=timezone.utc): (2648, 2676, 2647, 2649),
    datetime(2026, 11, 4, 3, 0, tzinfo=timezone.utc): (2646, 2647, 2641, 2645),
    datetime(2026, 11, 4, 6, 15, tzinfo=timezone.utc): (2649, 2653, 2648, 2650),
    datetime(2026, 11, 4, 7, 15, tzinfo=timezone.utc): (2646, 2647, 2639, 2642),
    datetime(2026, 11, 4, 7, 30, tzinfo=timezone.utc): (2642, 2647, 2641.5, 2646),
    datetime(2026, 11, 4, 7, 45, tzinfo=timezone.utc): (2646, 2655, 2645.5, 2654.5),
    datetime(2026, 11, 4, 8, 0, tzinfo=timezone.utc): (2654.5, 2657, 2649, 2655),
    datetime(2026, 11, 4, 8, 15, tzinfo=timezone.utc): (2655, 2656, 2650, 2651),
    datetime(2026, 11, 4, 8, 30, tzinfo=timezone.utc): (2651, 2652, 2648.5, 2650),
}


def base(i: int) -> tuple:
    o = 2648 + 2 * math.sin(i / 3)
    c = 2648 + 2 * math.sin((i + 1) / 3)
    return (round(o, 2), round(max(o, c) + 1.5, 2), round(min(o, c) - 1.5, 2), round(c, 2))


def series(overrides: dict | None = None) -> list[Candle]:
    script = {**SCRIPT, **(overrides or {})}
    t, out, i = datetime(2026, 10, 26, 0, 0, tzinfo=timezone.utc), [], 0
    while t <= T_END:
        if t.weekday() < 5:
            o, h, lo, c = script.get(t, base(i))
            out.append(Candle(time=t, open=o, high=h, low=lo, close=c))
            i += 1
        t += timedelta(minutes=15)
    return out


def mirror(bars: list[Candle], pivot: float = 2650.0) -> list[Candle]:
    return [Candle(time=b.time, open=2 * pivot - b.open, high=2 * pivot - b.low,
                   low=2 * pivot - b.high, close=2 * pivot - b.close) for b in bars]


def snapshot(bars: list[Candle], now: datetime = NOW, sell: bool = False) -> MarketSnapshot:
    m15 = [b for b in bars if b.time + timedelta(minutes=15) <= now][-96:]
    h1 = [c for c in resample_h1([b for b in bars if b.time + timedelta(minutes=15) <= now])
          if c.time + timedelta(hours=1) <= now][-120:]
    c = m15[-1].close
    q = Quote(bid=round(c, 2), ask=round(c + 0.3, 2), time=now)
    return MarketSnapshot(snapshot_id=f"XAUUSD-{now:%Y%m%dT%H%M}Z", symbol="XAUUSD",
                          created_at=now, quote=q, m15=m15, h1=h1, features=features(m15, h1, q))
