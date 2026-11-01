"""Randomised invariants: whatever the inputs, an approval never breaks a rule."""

import random

from app.models import Proposal
from app.risk_engine import POLICY, PeriodStats, evaluate, loss_figures
from tests.conftest import account, ctx, quote, spec


def test_approvals_never_break_a_rule():
    rng = random.Random(2026)
    approved = 0
    for _ in range(3000):
        bal = rng.choice([4000, 25_000, 100_000, 500_000]) * rng.uniform(0.9, 1.1)
        eq = bal + rng.uniform(-0.02, 0.01) * bal
        bid = rng.uniform(1800, 3500)
        spread = rng.uniform(0.1, 0.8)
        side = rng.choice(["BUY", "SELL"])
        stop_d, tgt_d = rng.uniform(0.2, 25), rng.uniform(0.2, 80)
        entry = bid + spread if side == "BUY" else bid
        sign = 1 if side == "BUY" else -1
        step = rng.choice([0.01, 0.1, 1.0])
        sp = spec(min_units=step * rng.choice([1, 1, 10]), step_units=step,
                  commission_type=rng.choice(["NONE", "USD_PER_LOT"]),
                  commission_rate=rng.uniform(0, 7))
        st = PeriodStats(realized_today=-rng.uniform(0, 0.02) * bal,
                         month_peak_balance=bal * rng.uniform(1.0, 1.07),
                         trades_opened_today=rng.randint(0, 3),
                         consecutive_losses=rng.randint(0, 3))
        st.realized_week = st.realized_today - rng.uniform(0, 0.01) * bal
        c = ctx(account=account(balance=bal, equity=eq), spec=sp,
                quote=quote(bid=round(bid, 2), ask=round(bid + spread, 2)),
                quote_to_account=rng.uniform(15, 20), stats=st)
        p = Proposal(snapshot_id="s", symbol="XAUUSD", side=side,
                     stop_loss=round(entry - sign * stop_d, 2),
                     take_profit=round(entry + sign * tgt_d, 2), rationale="")
        a = evaluate(p, c)
        if not a.allowed:
            continue
        approved += 1
        headroom = min(limit - loss for loss, limit in loss_figures(c).values())
        assert a.risk_amount <= POLICY.risk_per_trade * min(bal, eq) + 0.01
        assert a.risk_amount <= headroom + 0.01
        assert a.units >= sp.min_units and a.units <= sp.max_units
        assert abs(a.units / step - round(a.units / step)) < 1e-6   # whole broker steps
        assert a.reward_risk >= POLICY.min_reward_risk
        if side == "BUY":
            assert a.stop_loss < a.entry < a.take_profit
        else:
            assert a.take_profit < a.entry < a.stop_loss
        assert st.trades_opened_today < 3 and st.consecutive_losses < 3
    assert approved > 100  # the generator actually exercised approvals
