"""What can be tested of the cTrader adapter without a server: the demo-only
refusals and the unit conversions, using the SDK's real protobuf classes."""

import pytest

pytest.importorskip("ctrader_open_api")

from ctrader_open_api.messages import OpenApiMessages_pb2 as M  # noqa: E402
from ctrader_open_api.messages.OpenApiCommonMessages_pb2 import ProtoMessage  # noqa: E402
from ctrader_open_api.messages import OpenApiModelMessages_pb2 as MM  # noqa: E402

from app.config import Settings  # noqa: E402
from app.ctrader_broker import CTraderBroker  # noqa: E402
from app.models import LiveAccountRefused, OrderRequest  # noqa: E402


def broker(**kw):
    s = Settings(ctrader_account_id=123, ctrader_demo_allowlist=[123], **kw)
    b = CTraderBroker(s)
    b._assets = {1: "USD", 2: "XAU", 3: "ZAR"}
    return b


@pytest.mark.asyncio
async def test_account_not_on_allowlist_is_refused_before_connecting():
    b = CTraderBroker(Settings(ctrader_account_id=999, ctrader_demo_allowlist=[123]))
    with pytest.raises(LiveAccountRefused):
        await b.connect()
    assert b._client is None  # never opened a connection


@pytest.mark.asyncio
async def test_no_order_without_verification():
    b = broker()
    with pytest.raises(Exception, match="not verified"):
        await b.place_market_order(OrderRequest(
            client_order_id="gab-x", symbol="XAUUSD", side="BUY", units=1,
            entry_reference=2650, stop_loss=2645, take_profit=2660))


def test_account_reports_live_until_proven_demo():
    assert broker()._is_live is True


def test_symbol_spec_conversion_from_cents():
    b = broker()
    light = MM.ProtoOALightSymbol(symbolId=41, symbolName="XAUUSD", baseAssetId=2,
                                  quoteAssetId=1)
    full = MM.ProtoOASymbol(symbolId=41, digits=2, pipPosition=1, lotSize=10_000,
                            minVolume=100, maxVolume=5_000_000, stepVolume=100,
                            commissionType=2, preciseTradingCommissionRate=350_000_000,
                            slDistance=50, distanceSetIn=1)
    spec = b._to_spec(light, full)
    assert (spec.units_per_lot, spec.min_units, spec.step_units, spec.max_units) == \
        (100, 1, 1, 50_000)
    assert spec.quote_currency == "USD"
    assert spec.commission_type == "USD_PER_LOT" and spec.commission_rate == 3.5
    assert spec.min_stop_distance == pytest.approx(0.50)


def test_spot_events_keep_the_side_that_did_not_change():
    b = broker()

    def spot(**kw):
        ev = M.ProtoOASpotEvent(ctidTraderAccountId=123, symbolId=41, **kw)
        return ProtoMessage(payloadType=ev.payloadType, payload=ev.SerializeToString())

    b._on_message(None, spot(bid=265_000_000, ask=265_030_000))
    b._on_message(None, spot(ask=265_040_000))
    bid, ask, _ = b._spots[41]
    assert (bid, ask) == (2650.0, 2650.4)
