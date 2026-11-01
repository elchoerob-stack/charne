"""End to end through the paper broker with offline agents."""

from datetime import timedelta

import pytest

from app.ai_common import RuleFollowerAgent
from app.journal import Journal
from app.main import TradingBot, replay
from tests.conftest import bars, spec


class CountingAgent(RuleFollowerAgent):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.calls = 0

    async def decide(self, s, c):
        self.calls += 1
        return await super().decide(s, c)


class DisagreeingAgent(RuleFollowerAgent):
    async def decide(self, s, c):
        r = await super().decide(s, c)
        r.decision = r.decision.model_copy(update={"action": "HOLD", "stop_loss": 0,
                                                   "take_profit": 0, "setup_valid": False})
        return r


SERIES = bars(3000, drift=0.12, vol=1.6, seed=11)


@pytest.mark.asyncio
async def test_replay_trades_and_never_breaks_a_rule():
    j = Journal(":memory:")
    out = await replay(SERIES, spec(), balance=200_000, spread=0.30, quote_to_account=17.5,
                       journal=j)
    assert out["stages"].get("execution_filled", 0) > 0, out["stages"]
    m = out["metrics"]
    assert m["trades"] > 0
    # Rule audit over the whole run
    orders = j.db.execute("SELECT * FROM orders WHERE state='FILLED'").fetchall()
    per_day = {}
    for o in orders:
        per_day[o["ts"][:10]] = per_day.get(o["ts"][:10], 0) + 1
        assert o["risk_amount"] <= 0.005 * 200_000 * 1.02  # balance can grow a little
        rr = abs(o["take_profit"] - o["entry_reference"]) / abs(o["entry_reference"] - o["stop_loss"])
        assert rr >= 2.0
    assert max(per_day.values()) <= 3


@pytest.mark.asyncio
async def test_r4000_demo_is_blocked_by_minimum_volume():
    j = Journal(":memory:")
    out = await replay(SERIES, spec(), balance=4000, spread=0.30, quote_to_account=17.5,
                       journal=j)
    assert out["stages"].get("execution_filled", 0) == 0
    assert out["stages"].get("min_volume_precheck", 0) > 0
    assert out["metrics"]["ai_evaluations"] == 0  # no API spend on trades that can't happen


@pytest.mark.asyncio
async def test_disagreement_means_no_orders():
    j = Journal(":memory:")
    out = await replay(SERIES, spec(), balance=200_000, spread=0.30, quote_to_account=17.5,
                       journal=j, claude=DisagreeingAgent("claude-offline"))
    assert out["stages"].get("execution_filled", 0) == 0
    assert out["stages"].get("consensus", 0) > 0


@pytest.mark.asyncio
async def test_locked_bot_does_not_pay_for_ai_calls():
    from app.broker import PaperBroker
    from app.main import resample_h1
    from app.models import Quote
    j = Journal(":memory:")
    b = PaperBroker(spec(), balance=200_000)
    await b.connect()
    hist = SERIES[:900]
    now = hist[-1].time + timedelta(minutes=15, seconds=5)
    b.set_market(hist, [c for c in resample_h1(hist) if c.time + timedelta(hours=1) <= now],
                 Quote(bid=hist[-1].close - .15, ask=hist[-1].close + .15, time=now))
    j.add_lock("losing_streak", "test", requires_review=True, auto_release_at=None, now=now)
    g, c = CountingAgent("g"), CountingAgent("c")
    bot = TradingBot(b, j, g, c, clock=lambda: now)
    r = await bot.cycle()
    assert r.stage == "locked" and g.calls == c.calls == 0


@pytest.mark.asyncio
async def test_small_account_still_collects_shadow_evidence():
    j = Journal(":memory:")
    out = await replay(SERIES, spec(), balance=4000, spread=0.30, quote_to_account=17.5,
                       journal=j)
    assert out["stages"].get("execution_filled", 0) == 0
    base = [r for r in out["metrics"]["shadow"] if r["variant"] == "baseline"
            and r["ai_verdict"] == "all"]
    assert base and sum(r["n"] for r in base) > 5


@pytest.mark.asyncio
async def test_shadow_mode_setup_never_reaches_the_models_or_the_broker():
    j = Journal(":memory:")
    await replay(SERIES, spec(), balance=200_000, spread=0.30, quote_to_account=17.5, journal=j)
    shadow_only = j.db.execute("SELECT COUNT(*) FROM shadow_trades WHERE strategy="
                               "'liquidity_sweep'").fetchone()[0]
    asked = j.db.execute("SELECT COUNT(*) FROM shadow_trades WHERE strategy='liquidity_sweep'"
                         " AND ai_verdict != 'not_asked'").fetchone()[0]
    assert shadow_only > 0 and asked == 0


@pytest.mark.asyncio
async def test_ai_shadow_mode_on_untradeable_account_asks_but_never_trades():
    from app.broker import PaperBroker
    from app.main import resample_h1
    from app.models import Quote
    j = Journal(":memory:")
    b = PaperBroker(spec(), balance=4000)
    await b.connect()
    clock = {"now": None}
    g, c = CountingAgent("g"), CountingAgent("c")
    bot = TradingBot(b, j, g, c, clock=lambda: clock["now"], shadow_ai_when_untradeable=True)
    for i in range(480, 1500):
        hist = SERIES[: i + 1]
        now = hist[-1].time + timedelta(minutes=15, seconds=5)
        clock["now"] = now
        b.set_market(hist, [x for x in resample_h1(hist) if x.time + timedelta(hours=1) <= now],
                     Quote(bid=hist[-1].close - .15, ask=hist[-1].close + .15, time=now))
        await bot.cycle()
    assert g.calls > 0 and b.orders_received == []


@pytest.mark.asyncio
async def test_cycle_writes_health_and_detects_new_test_period(tmp_path):
    from app.broker import PaperBroker
    j = Journal(":memory:")
    b = PaperBroker(spec(), balance=200_000)
    hist = SERIES[:900]
    from app.main import resample_h1
    from app.models import Quote
    now = hist[-1].time + timedelta(minutes=15, seconds=5)
    b.set_market(hist, [c for c in resample_h1(hist) if c.time + timedelta(hours=1) <= now],
                 Quote(bid=hist[-1].close - .15, ask=hist[-1].close + .15, time=now))
    bot = TradingBot(b, j, RuleFollowerAgent(), RuleFollowerAgent(), config_fp="aaa",
                     health_path=tmp_path / "health.json", clock=lambda: now)
    await bot.startup()
    await bot.cycle()
    import json
    assert json.loads((tmp_path / "health.json").read_text())["config_fp"] == "aaa"
    bot2 = TradingBot(b, j, RuleFollowerAgent(), RuleFollowerAgent(), config_fp="bbb",
                      clock=lambda: now)
    await bot2.startup()
    kinds = [r["kind"] for r in j.db.execute("SELECT kind FROM events")]
    assert kinds.count("new_test_period") == 2 and j.get("config_fp") == "bbb"
