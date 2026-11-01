from datetime import timedelta

import pytest

from app.evidence import check
from app.market_data import features
from app.models import MarketSnapshot, Quote
from app.structure import swings
from tests.conftest import bars, decision


@pytest.fixture
def snap():
    m15 = bars(400, seed=5)[-96:]
    h1 = bars(480, seed=5)[::4][-120:]
    now = m15[-1].time + timedelta(minutes=15, seconds=5)
    c = m15[-1].close
    q = Quote(bid=c, ask=c + 0.3, time=now)
    return MarketSnapshot(snapshot_id="S", symbol="XAUUSD", created_at=now, quote=q, m15=m15,
                          h1=h1, features=features(m15, h1, q))


def intact_low(s):
    """A confirmed M15 swing low that price hasn't traded through since."""
    for sw in reversed(swings(s.m15)):
        if sw.kind == "low" and all(b.low > sw.price for b in s.m15[sw.index + 1:]):
            return sw
    pytest.skip("no intact swing low in this series")


def buy_from(s, sw, sl_gap=0.3, rr=2.5, **kw):
    entry = s.quote.ask
    sl = round(sw.price - sl_gap, 2)
    return decision(sid="S", sl=sl, tp=round(entry + rr * (entry - sl), 2),
                    anchor_time=sw.time, anchor_price=sw.price, **kw)


def test_genuine_swing_anchor_passes(snap):
    assert check(buy_from(snap, intact_low(snap)), snap) == []


def test_hold_needs_no_evidence(snap):
    assert check(decision("HOLD", sid="S"), snap) == []


def test_invented_bar_rejected(snap):
    d = buy_from(snap, intact_low(snap)).model_copy(update={"stop_anchor_time": "2020-01-01 00:00"})
    assert "not in the snapshot" in check(d, snap)[0]


def test_misquoted_price_rejected(snap):
    sw = intact_low(snap)
    d = buy_from(snap, sw).model_copy(update={"stop_anchor_price": sw.price - 2})
    assert any("anchor price" in p for p in check(d, snap))


def test_stop_must_be_beyond_and_close_to_the_anchor(snap):
    sw = intact_low(snap)
    above = buy_from(snap, sw).model_copy(update={"stop_loss": sw.price + 0.5})
    assert any("not beyond" in p for p in check(above, snap))
    far = buy_from(snap, sw, sl_gap=float(snap.features["atr14_m15"]) * 1.5)
    assert any("beyond the anchor" in p for p in check(far, snap))


def test_broken_level_rejected(snap):
    # the lowest low in the window, then claim a higher low that was traded through
    lows = sorted(range(len(snap.m15) - 5), key=lambda i: snap.m15[i].low)
    broken = next(i for i in lows[len(lows) // 2:]
                  if any(b.low < snap.m15[i].low for b in snap.m15[i + 1:]))
    b = snap.m15[broken]
    d = decision(sid="S", sl=b.low - 0.3, tp=snap.quote.ask + 20,
                 anchor_time=b.time.strftime("%Y-%m-%d %H:%M"), anchor_price=b.low)
    assert any("traded through" in p for p in check(d, snap))


def test_fantasy_target_rejected(snap):
    d = buy_from(snap, intact_low(snap), rr=200)
    assert any("H1 ATR" in p for p in check(d, snap))
