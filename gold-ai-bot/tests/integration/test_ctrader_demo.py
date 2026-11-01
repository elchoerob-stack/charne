"""Against the REAL cTrader demo server. Skipped unless you opt in:

    set GOLDBOT_DEMO_INTEGRATION=1           (Windows; export ... elsewhere)
    python -m pytest tests/integration -v

and, to also place and close one minimum-size demo order with a stop and target:

    set GOLDBOT_DEMO_ORDER_TEST=1

Uses the credentials in .env and the same demo-only adapter as the bot, so it
refuses a live account exactly as the bot does. This is the Week 1 / Week 4
evidence that the offline tests can't provide.
"""

import asyncio
import os
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

pytestmark = pytest.mark.skipif(os.environ.get("GOLDBOT_DEMO_INTEGRATION") != "1",
                                reason="set GOLDBOT_DEMO_INTEGRATION=1 to run against the demo")


@pytest_asyncio.fixture
async def broker():
    from app.config import load_settings
    from app.ctrader_broker import CTraderBroker
    b = CTraderBroker(load_settings())
    await b.connect()
    yield b
    await b.disconnect()


@pytest.mark.asyncio
async def test_identity_and_account(broker):
    acct = await broker.account()
    assert broker.demo_verified and not acct.is_live
    assert acct.balance > 0 and acct.currency and acct.leverage >= 1


@pytest.mark.asyncio
async def test_symbol_spec_is_sane(broker):
    s = await broker.symbol_spec("XAUUSD")
    assert s.digits in (2, 3) and s.quote_currency == "USD"
    assert 0 < s.min_units <= s.max_units and s.step_units > 0
    assert s.units_per_lot in (1, 10, 100), f"unusual lot size {s.units_per_lot}: check it"


@pytest.mark.asyncio
async def test_quote_candles_and_conversion(broker):
    from app.market_data import validate_candles
    q = await broker.quote("XAUUSD")
    assert q.ask > q.bid > 0
    now = datetime.now(timezone.utc)
    m15 = await broker.candles("XAUUSD", "M15", 96)
    assert all(c.time + timedelta(minutes=15) <= now for c in m15), "forming bar returned"
    if now.weekday() < 5 and 1 <= now.hour < 20:
        assert validate_candles(m15, "M15", now, 40) == []
    acct = await broker.account()
    rate = await broker.conversion_rate("USD", acct.currency)
    assert rate > 0


@pytest.mark.asyncio
@pytest.mark.skipif(os.environ.get("GOLDBOT_DEMO_ORDER_TEST") != "1",
                    reason="set GOLDBOT_DEMO_ORDER_TEST=1 to place one demo order")
async def test_min_order_round_trip_has_its_stop(broker):
    from app.models import OrderRequest
    spec = await broker.symbol_spec("XAUUSD")
    assert not await broker.open_positions(), "demo account must be flat for this test"
    q = await broker.quote("XAUUSD")
    label = f"gab-ITEST-{datetime.now(timezone.utc):%Y%m%dT%H%M%S}"
    res = await broker.place_market_order(OrderRequest(
        client_order_id=label, symbol="XAUUSD", side="BUY", units=spec.min_units,
        entry_reference=q.ask, stop_loss=round(q.ask - 10, 2), take_profit=round(q.ask + 20, 2)))
    assert res.status == "FILLED", res.reason
    try:
        (p,) = [x for x in await broker.open_positions() if x.label == label]
        assert p.units == spec.min_units
        assert p.stop_loss is not None and abs((p.entry_price - p.stop_loss) - 10) < 0.05
        assert p.take_profit is not None and abs((p.take_profit - p.entry_price) - 20) < 0.05
    finally:
        await broker.close_position(res.position_id)
    await asyncio.sleep(3)
    assert not [x for x in await broker.open_positions() if x.label == label]
    closed = [t for t in await broker.closed_trades(datetime.now(timezone.utc) - timedelta(hours=1))
              if t.position_id == res.position_id]
    assert closed and closed[0].commission <= 0
