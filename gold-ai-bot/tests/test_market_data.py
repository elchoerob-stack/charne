from datetime import timedelta

import pytest

from app.broker import PaperBroker
from app.main import resample_h1
from app.market_data import build_snapshot, validate_candles
from app.models import Quote
from tests.conftest import bars, spec


def last_close(bs):
    return bs[-1].time + timedelta(minutes=15)


def test_clean_series_passes():
    bs = bars(200)
    assert validate_candles(bs, "M15", last_close(bs) + timedelta(seconds=5), 40) == []


def test_weekend_gap_is_allowed_but_an_intraday_hole_is_not():
    bs = bars(600)  # spans a weekend
    now = last_close(bs) + timedelta(seconds=5)
    assert validate_candles(bs, "M15", now, 40) == []
    holed = bs[:300] + bs[320:]
    assert any("gap" in p for p in validate_candles(holed, "M15", now, 40))


def test_stale_and_unclosed_bars_are_rejected():
    bs = bars(200)
    assert any("stale" in p for p in validate_candles(bs, "M15", last_close(bs)
                                                      + timedelta(minutes=40), 40))
    assert any("not closed" in p for p in validate_candles(bs, "M15", last_close(bs)
                                                           - timedelta(minutes=5), 40))


def test_bad_ohlc_rejected():
    bs = bars(100)
    bs[50] = bs[50].model_copy(update={"high": bs[50].low - 1})
    assert any("OHLC" in p for p in validate_candles(bs, "M15", last_close(bs), 40))


@pytest.mark.asyncio
async def test_snapshot_id_is_tied_to_the_closed_bar_and_bad_quotes_block():
    bs = bars(600)
    now = last_close(bs) + timedelta(seconds=5)
    h1 = [c for c in resample_h1(bs) if c.time + timedelta(hours=1) <= now]
    b = PaperBroker(spec())
    c = bs[-1].close
    b.set_market(bs, h1, Quote(bid=c - 0.15, ask=c + 0.15, time=now))
    s, problems = await build_snapshot(b, "XAUUSD", now)
    assert problems == [] and s.snapshot_id == f"XAUUSD-{last_close(bs):%Y%m%dT%H%M}Z"
    b.set_market(bs, h1, Quote(bid=c + 200, ask=c + 200.3, time=now))
    s, problems = await build_snapshot(b, "XAUUSD", now)
    assert s is None and any("ATR" in p for p in problems)
