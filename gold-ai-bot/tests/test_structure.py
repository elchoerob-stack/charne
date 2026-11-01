from datetime import timedelta

from app.market_data import features
from app.models import Candle, Quote
from app.structure import fair_value_gaps, liquidity_sweep, swings
from tests.conftest import bars


def c(t0, i, o, h, low, cl):
    return Candle(time=t0 + timedelta(minutes=15 * i), open=o, high=h, low=low, close=cl)


T0 = bars(1)[0].time


def test_swing_is_only_reported_once_confirmed():
    series = [c(T0, i, 10, 10 + (5 if i == 4 else i * 0.1), 9, 10) for i in range(6)]
    # high at index 4 needs two later bars; only one exists
    assert all(s.index != 4 for s in swings(series))
    series.append(c(T0, 6, 10, 10.2, 9, 10))
    assert any(s.index == 4 and s.kind == "high" for s in swings(series))


def test_no_look_ahead_anywhere():
    """Everything computed at bar t must be identical with or without the future."""
    full = bars(700, seed=3)
    for t in range(300, 700, 37):
        past = full[: t + 1]
        q = Quote(bid=past[-1].close, ask=past[-1].close + .3, time=past[-1].time)
        h1 = past[::4]
        assert swings(past) == [s for s in swings(full) if s.index <= t - 2]
        assert features(past, h1, q) == features(full[: t + 1], h1, q)
        assert liquidity_sweep(past, swings(past)) == liquidity_sweep(full[: t + 1],
                                                                      swings(full[: t + 1]))


def test_bullish_fvg_and_fill():
    s = [c(T0, 0, 10, 11, 9, 10.5), c(T0, 1, 10.5, 14, 10.4, 13.8),
         c(T0, 2, 13.8, 15, 12, 14.5), c(T0, 3, 14.5, 15, 13, 14)]
    (g,) = fair_value_gaps(s)
    assert (g.direction, g.bottom, g.top) == ("bull", 11, 12)
    s.append(c(T0, 4, 14, 14.2, 10.9, 11.5))  # trades back into 11 -> filled
    assert fair_value_gaps(s) == []


def test_sell_side_sweep():
    s = [c(T0, i, 20, 21, 19 - (1 if i == 3 else 0), 20) for i in range(8)]
    piv = swings(s)
    s.append(c(T0, 8, 20, 20.5, 17.5, 19.6))  # pierces the 18 low, closes back above
    side, swept = liquidity_sweep(s, piv)
    assert side == "BUY" and swept.price == 18
