from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest

from app import ict, strategy
from app.ai_common import RuleFollowerAgent
from app.evidence import check
from app.models import Candle
from app.strategy import ICT, ict_2022
from tests.ict_fixture import NOW, mirror, series, snapshot

NO_HTF = replace(ICT, require_htf_bias=False, require_premium_discount=False)


def test_ict_is_the_live_setup_by_default():
    assert strategy.STRATEGY_MODES["ict_2022"] == "live"


def test_textbook_buy_is_detected_with_the_right_levels():
    c = ict_2022(snapshot(series()), NO_HTF)
    assert c is not None and c.side == "BUY" and c.strategy == "ict_2022"
    assert c.anchor.time == "2026-11-04 07:15" and c.anchor.price == 2639.0
    assert c.stop < 2639.0 and c.target == 2676.0
    assert "swept Asia low" in c.reason and "FVG 2647.0-2649.0" in c.reason
    assert "PDH" in c.reason  # tie on price goes to the more significant pool


def test_mirror_image_sell():
    c = ict_2022(snapshot(mirror(series())), NO_HTF)
    assert c is not None and c.side == "SELL" and c.anchor.price == 2661.0
    assert c.stop > 2661.0 and c.target == 2624.0 and "swept Asia high" in c.reason


def test_fires_on_the_entry_bar_only():
    bars = series()
    fired = [k for k in range(0, 80)
             if ict_2022(snapshot(bars, NOW - timedelta(minutes=15 * k)), NO_HTF)]
    assert fired == [0]


@pytest.mark.parametrize("change,why", [
    ({datetime(2026, 11, 4, 8, 15, tzinfo=timezone.utc): (2655, 2656, 2648.8, 2651)},
     "FVG already touched: not the first return"),
    ({datetime(2026, 11, 4, 7, 45, tzinfo=timezone.utc): (2650, 2655, 2645.5, 2653.6)},
     "MSS bar body 3.6 is below 1 ATR: no displacement"),
    ({datetime(2026, 11, 4, 7, 15, tzinfo=timezone.utc): (2646, 2647, 2642, 2644)},
     "low 2642 never took the 2641 Asian low: no sweep"),
    ({datetime(2026, 11, 4, 8, 30, tzinfo=timezone.utc): (2651, 2652, 2645, 2646)},
     "entry bar closed through the FVG"),
    ({datetime(2026, 11, 3, 10, 0, tzinfo=timezone.utc): (2648, 2660, 2647, 2649)},
     "no untaken liquidity 2R away: no target, no trade"),
])
def test_each_rule_can_veto(change, why):
    assert ict_2022(snapshot(series(change)), NO_HTF) is None, why


def test_killzone_is_new_york_time_and_dst_aware():
    zones = ICT.killzones_ny
    nov = datetime(2026, 11, 4, tzinfo=timezone.utc)   # EST, UTC-5
    jul = datetime(2026, 7, 8, tzinfo=timezone.utc)    # EDT, UTC-4
    assert ict.killzone(nov.replace(hour=7, minute=30), zones) == "London"
    assert ict.killzone(nov.replace(hour=6, minute=30), zones) == ""
    assert ict.killzone(jul.replace(hour=6, minute=30), zones) == "London"
    assert ict.killzone(nov.replace(hour=12, minute=30), zones) == "NY AM"
    assert ict.killzone(jul.replace(hour=11, minute=30), zones) == "NY AM"
    assert ict.killzone(nov.replace(hour=16, minute=0), zones) == ""


def test_outside_killzone_no_setup():
    s = snapshot(series())
    late = s.model_copy(update={"created_at": s.created_at.replace(hour=11)})  # 06:00 NY
    assert ict_2022(late, NO_HTF) is None


def h4_bars(closes):
    t0 = datetime(2026, 10, 26, 22, 0, tzinfo=timezone.utc)  # 17:00 New York
    return [Candle(time=t0 + timedelta(hours=4 * i), open=c - .5, high=c + 1, low=c - 1, close=c)
            for i, c in enumerate(closes)]


def test_h4_bias_from_structure():
    up = [10, 12, 15, 13, 11, 12, 14, 18, 16, 14, 15, 17, 21, 19]
    b = ict.htf_bias(h4_bars(up))
    assert b.direction == 1 and b.range_low < b.equilibrium < b.range_high
    down = [30 - x for x in up]
    assert ict.htf_bias(h4_bars(down)).direction == -1
    assert ict.htf_bias(h4_bars([10] * 14)).direction == 0


def test_bias_and_premium_discount_filters(monkeypatch):
    s = snapshot(series())  # entry about 2650.3
    for bias, expect in [(ict.Bias(-1, 2600, 2700), False),   # bearish H4: no BUY
                         (ict.Bias(1, 2600, 2690), False),    # 2650.3 above 2645 = premium
                         (ict.Bias(1, 2600, 2720), True),     # 2650.3 below 2660 = discount
                         (ict.Bias(0, 0, 0), False)]:
        monkeypatch.setattr(ict, "htf_bias", lambda _h4, b=bias: b)
        assert (ict_2022(s) is not None) == expect, bias


def test_h4_resample_is_new_york_aligned_and_complete_only():
    from tests.ict_fixture import resample_h1
    h1 = resample_h1(series())
    h4 = ict.resample_h4(h1, NOW)
    assert all(ict.ny(b.time).hour in (17, 21, 1, 5, 9, 13) for b in h4)
    assert h4[-1].time + timedelta(hours=4) <= NOW


@pytest.mark.asyncio
async def test_candidate_passes_the_evidence_check_and_risk_shape():
    s = snapshot(series())
    c = ict_2022(s, NO_HTF)
    r = await RuleFollowerAgent().decide(s, c)
    assert r.decision.action == "BUY" and check(r.decision, s) == []
    entry = s.quote.ask
    assert (c.target - entry) / (entry - c.stop) >= 2.0


def test_pools_only_known_after_they_form():
    bars = series()
    s = snapshot(bars)
    for p in ict.liquidity_pools(s.m15, s.h1):
        if p.from_idx < len(s.m15):
            assert s.m15[p.from_idx].time >= p.formed - timedelta(minutes=15), p
