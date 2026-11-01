import dataclasses
import re
from datetime import timedelta
from pathlib import Path

import pytest

from app import config
from app.journal import Journal
from app.models import ClosedTrade
from app.risk_engine import (POLICY, PeriodStats, apply_trips, breaker_trips, compute_stats,
                             evaluate, max_stop_at_min_volume)
from tests.conftest import NOW, account, buy, ctx, position, quote, spec

APP = Path(__file__).resolve().parents[1] / "app"


# ---- the policy itself ------------------------------------------------------------
def test_policy_matches_the_agreed_limits():
    p = POLICY
    assert (p.symbol, p.risk_per_trade, p.daily_loss_limit, p.weekly_loss_limit,
            p.monthly_drawdown_limit, p.max_open_positions, p.min_reward_risk,
            p.max_consecutive_losses, p.max_trades_per_day) == \
        ("XAUUSD", 0.005, 0.015, 0.03, 0.06, 1, 2.0, 3, 3)


def test_policy_cannot_be_changed_at_runtime():
    with pytest.raises(dataclasses.FrozenInstanceError):
        POLICY.risk_per_trade = 0.05


def test_no_risk_setting_can_come_from_the_environment():
    risky = re.compile(r"risk|loss|drawdown|lot|volume|units|size|position|spread|"
                       r"leverage|limit|streak|reward|trades_per", re.I)
    leaks = [f for f in config.Settings.model_fields if risky.search(f)]
    assert leaks == [], f"risk-like settings found in config.py: {leaks}"


def test_ctrader_adapter_never_references_the_live_server():
    src = (APP / "ctrader_broker.py").read_text()
    assert "live.ctraderapi.com" not in src and "PROTOBUF_LIVE_HOST" not in src
    assert 'DEMO_HOST = "demo.ctraderapi.com"' in src


# ---- approval and sizing -----------------------------------------------------------
def test_approves_and_sizes_from_broker_spec_and_conversion():
    a = evaluate(buy(), ctx())
    assert a.allowed, a.reason
    # entry = ask 2650.30, stop 5.30 + 0.30 slippage = 5.60 USD/oz; R500 budget / 17.5 = $28.57
    assert a.entry == 2650.30
    assert a.units == 5  # floor(28.57 / 5.60) on a 1-oz step
    assert a.risk_amount == pytest.approx(5 * 5.60 * 17.5, abs=0.01)
    assert a.risk_amount <= 0.005 * 100_000
    assert a.reward_risk >= 2


def test_contract_size_comes_from_the_spec_not_an_assumption():
    a = evaluate(buy(), ctx(spec=spec(min_units=0.01, step_units=0.01)))
    assert a.allowed and a.units == pytest.approx(5.10)


def test_commission_is_included_in_the_risk():
    plain = evaluate(buy(), ctx(spec=spec(min_units=0.01, step_units=0.01)))
    costly = evaluate(buy(), ctx(spec=spec(min_units=0.01, step_units=0.01,
                                           commission_type="USD_PER_LOT", commission_rate=300)))
    assert costly.units < plain.units  # $3/oz per side -> +$6/oz round turn


def test_r4000_account_cannot_afford_the_broker_minimum_on_a_normal_stop():
    small = account(balance=4000.0)
    a = evaluate(buy(), ctx(account=small, stats=PeriodStats(month_peak_balance=4000.0)))
    assert not a.allowed and a.reason.startswith("min_volume")
    widest = max_stop_at_min_volume(spec(), 4000.0, 17.5, 2650.0)
    assert widest == pytest.approx(20 / 17.5 - 0.30, abs=1e-6)  # about $0.84/oz


@pytest.mark.parametrize("kw,stage", [
    (dict(demo_verified=False), "demo_account"),
    (dict(account=account(live=True)), "demo_account"),
    (dict(kill_switch=True), "kill_switch"),
    (dict(quote=quote(bid=2650.3, ask=2650.0)), "quote_valid"),
    (dict(quote=quote(t=NOW - timedelta(seconds=60))), "quote_fresh"),
    (dict(snapshot_created_at=NOW - timedelta(minutes=10)), "snapshot_fresh"),
    (dict(quote=quote(bid=2650.0, ask=2651.0)), "spread"),
    (dict(open_positions=[position()]), "open_positions"),
    (dict(pending_orders=1), "open_positions"),
    (dict(stats=PeriodStats(month_peak_balance=100_000, trades_opened_today=3)), "trades_today"),
    (dict(stats=PeriodStats(month_peak_balance=100_000, consecutive_losses=3)), "losing_streak"),
    (dict(quote_to_account=0.0), "conversion_rate"),
])
def test_each_gate_rejects(kw, stage):
    a = evaluate(buy(), ctx(**kw))
    assert not a.allowed and a.reason.startswith(stage), a.reason


def test_active_lock_blocks():
    from app.journal import Lock
    lk = Lock(1, "daily_loss", "x", NOW, NOW + timedelta(hours=5), False, None)
    a = evaluate(buy(), ctx(active_locks=[lk]))
    assert a.reason.startswith("circuit_breakers")


@pytest.mark.parametrize("sl,tp,stage", [
    (2655.0, 2670.0, "stop_target_placement"),   # stop above a BUY entry
    (2640.0, 2648.0, "stop_target_placement"),   # target below entry
    (2649.8, 2660.0, "min_stop_distance"),       # 0.5 stop < 3 spreads (0.90)
    (2645.0, 2660.0, "reward_risk"),             # 9.7 / 5.3 = 1.83
])
def test_stop_and_target_validation(sl, tp, stage):
    a = evaluate(buy(sl=sl, tp=tp), ctx())
    assert not a.allowed and a.reason.startswith(stage), a.reason


def test_sell_uses_bid_and_mirrored_placement():
    from app.models import Proposal
    p = Proposal(snapshot_id="s", symbol="XAUUSD", side="SELL", stop_loss=2655.0,
                 take_profit=2639.0, rationale="")
    a = evaluate(p, ctx())
    assert a.allowed and a.entry == 2650.00


def test_size_shrinks_to_fit_daily_headroom():
    # 1.2% lost today: only 0.3% (R300) left before the 1.5% daily limit
    st = PeriodStats(realized_today=-1200, realized_week=-1200, realized_month=-1200,
                     month_peak_balance=100_000)
    a = evaluate(buy(), ctx(account=account(balance=98_800), stats=st))
    assert a.allowed and a.risk_amount <= 300 + 1e-6
    full = evaluate(buy(), ctx())
    assert a.units < full.units


def test_floating_loss_counts_and_profit_does_not_offset():
    st = PeriodStats(realized_today=-1000, month_peak_balance=100_000)
    nearly = ctx(stats=st, open_positions=[position(unreal=-480)])
    assert breaker_trips(nearly) == []  # 1000 + 480 < 1500
    losing = ctx(stats=PeriodStats(realized_today=-1000, month_peak_balance=100_000),
                 open_positions=[position(unreal=-520)])
    assert [t.kind for t in breaker_trips(losing)] == ["daily_loss"]  # 1000 + 520 >= 1500
    winning = ctx(stats=PeriodStats(realized_today=-1000, month_peak_balance=100_000),
                  open_positions=[position(unreal=+5000)])
    assert breaker_trips(winning) == []


def test_margin_check():
    tiny_leverage = account(balance=100_000)
    tiny_leverage = tiny_leverage.model_copy(update={"leverage": 1.0})
    a = evaluate(buy(), ctx(account=tiny_leverage))
    assert not a.allowed and a.reason.startswith("margin")


# ---- circuit breakers ------------------------------------------------------------------
def trade(pid, net, when):
    return ClosedTrade(position_id=pid, symbol="XAUUSD", side="BUY", units=1, entry_price=1,
                       exit_price=1, open_time=when, close_time=when, gross=net, commission=0,
                       swap=0)


def test_daily_breaker_trips_and_resets_next_day(journal):
    journal.add_trade(trade("a", -900, NOW - timedelta(hours=2)))
    journal.add_trade(trade("b", -700, NOW - timedelta(hours=1)))
    c = ctx(account=account(balance=98_400),
            stats=compute_stats(journal, NOW, 98_400))
    trips = apply_trips(journal, c)
    assert "daily_loss" in [t.kind for t in trips]
    assert not evaluate(buy(), c).allowed
    tomorrow = NOW + timedelta(days=1)
    assert all(lk.kind != "daily_loss" for lk in journal.active_locks(tomorrow))


def test_streak_needs_review_and_review_resets_the_count(journal):
    for i in range(3):
        journal.add_trade(trade(str(i), -100, NOW - timedelta(hours=3 - i)))
    c = ctx(stats=compute_stats(journal, NOW, 99_700))
    assert [t.kind for t in apply_trips(journal, c)] == ["losing_streak"]
    lock = journal.active_locks(NOW)[0]
    later = NOW + timedelta(days=2)
    assert journal.active_locks(later), "review-only lock must not expire by itself"
    assert "required" in journal.release_lock(lock.id, "", later)
    assert "released" in journal.release_lock(lock.id, "reviewed: news spike", later)
    assert compute_stats(journal, later, 99_700).consecutive_losses == 0


def test_monthly_lock_cannot_be_reviewed_away_before_month_end(journal):
    journal.add_trade(trade("m", -6100, NOW - timedelta(days=1)))
    c = ctx(account=account(balance=93_900), stats=compute_stats(journal, NOW, 93_900))
    kinds = [t.kind for t in apply_trips(journal, c)]
    assert "monthly_drawdown" in kinds
    lk = next(x for x in journal.active_locks(NOW) if x.kind == "monthly_drawdown")
    assert "cannot be released" in journal.release_lock(lk.id, "ok", NOW + timedelta(days=3))
    first_of_next = NOW.replace(month=12, day=1, hour=0, minute=1)
    assert journal.active_locks(first_of_next), "still needs review in the new month"
    assert "released" in journal.release_lock(lk.id, "reviewed", first_of_next)


def test_locks_survive_a_restart(tmp_path):
    db = tmp_path / "j.sqlite3"
    j = Journal(db)
    j.add_lock("losing_streak", "3 losses", requires_review=True, auto_release_at=None, now=NOW)
    del j
    assert [lk.kind for lk in Journal(db).active_locks(NOW + timedelta(days=30))] == \
        ["losing_streak"]
