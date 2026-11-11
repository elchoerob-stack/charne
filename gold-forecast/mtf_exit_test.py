"""PRE-REGISTERED: "read the 1, 5 and 15-minute charts and jump out early when direction shifts". Committed before running.

The owner's idea (11 Nov 2026): while a trade is open, watch the lower timeframes; when one of them shifts direction
against the trade, close it instead of waiting for the stop.

Definition (the project's own structure rule, analysis.structure, 3-bar fractal swings):
  a timeframe "shifts against" a BUY when one of its bars CLOSES below the most recent confirmed swing low
  (for a SELL: closes above the most recent confirmed swing high). A swing is confirmed 3 bars after it prints and each
  swing level counts once. The trade is closed at that bar's close. The hard stop and target stay in place, so an early
  exit can only end a trade sooner; it cannot make one trade's loss larger than its stop.
Entries are the bot's unchanged rules (B0: band z 1.2816, stop orders + market when already beyond, max 4 a session).
After an early exit the bot is flat and re-arms at the next hour like after any exit.

Variants (3 looks):
  X15  exit on a 15-minute shift against the trade
  X5   exit on a 5-minute shift against the trade
  X1   exit on a 1-minute shift against the trade
Data: X15 and X5 on 5-minute bars, 2016 - Sep 2024 (2,258 sessions) and May 2025 - Nov 2026 (385 sessions), reported
separately. X1 needs 1-minute bars: Jan 2023 - Sep 2024 and May 2025 - Nov 2026, with B0, X5 and X15 re-run on the same
1-minute bars as a cross-check of the 5-minute results (not extra looks). Oct 2024 - Apr 2025 stays untouched (reserve).
Cost $0.50 per oz per round trip; P&L normalised to a $60 ATR as in continuation_test.py.

Verdict per variant, fixed now:
  ADOPT as the bot's default exit if, on its long period (X15, X5: 2016 - Sep 2024; X1: Jan 2023 - Sep 2024 and May 2025 -
  Nov 2026 together) the normalised net per session is higher than B0's with a paired session-bootstrap
  P(improvement <= 0) <= 1.67% (5% / 3 looks), AND it is also higher than B0's in May 2025 - Nov 2026 taken alone.
  Otherwise it is NOT the default. If more than one qualifies: the one with the highest net per session.
  This is a comparison with B0, which loses: 'better than B0' is not an edge. An edge still needs the gate (PF >= 1.30 ...).
Whatever the verdict, the exit is built into the bot as a switch, because the owner asked for it and it cannot increase a
single trade's loss; a variant that is not adopted ships switched OFF and says so in the journal.
Also reported, descriptive: trades per session, win rate, PF, average win and loss, drawdown, share of trades closed by the
shift, and what a R300 account at 5 g with the 33% cap would have seen (60-session runs at today's volatility).

Prior, written before running: an earlier exit changes the SIZE of wins and losses, not the odds, and it frees the bot to
trade again next hour, so costs go up. Expected: fewer full stops, more trades, net per session about the same or a little
worse than B0. X1 is expected to be clearly worse (it exits within minutes).
"""
import copy
import json

import numpy as np
import pandas as pd

import bandfade_backtest as B
import contsim as C
import continuation_test as T
import small_account_test as S

COST, ATR_REF, Z = 0.50, 60.0, 1.2816


def sim(plans, bars, events, bar_minutes):
    out = C.outcomes(plans, bars, Z, "both", events=events, bar_minutes=bar_minutes)
    tr = C.trades(out, cost=COST)
    atr = np.array([o["atr"] for o in out])
    tr["norm"] = tr.net / atr[tr.sess.values] * ATR_REF
    per_sess = np.zeros(len(out))
    np.add.at(per_sess, tr.sess.values, tr.norm.values)
    return out, tr, per_sess


def small(out, cap_r=300, horizon=60):
    """R300 at 5 g with the 33% cap, 60-session runs, every move rescaled to today's volatility, gram-gold cost."""
    o2 = copy.deepcopy(out)
    for o in o2:
        k = ATR_REF / o["atr"]
        for r in o["hours"].values():
            r["d"] *= k
            if r["fill"]:
                r["gross"] *= k; r["mae"] *= k
    e = cap_r / S.USDZAR
    ends = np.array([S.walk(o2, s0, horizon, e, 5 * S.OZ_PER_GRAM, 0.70, 1 / 3)[0] / e for s0 in range(0, len(o2) - horizon + 1, 5)])
    return float((ends < 0.5).mean()), float(np.median(ends) * cap_r), float((ends > 1.5).mean())


def paired(a, b, n=4000, seed=42):
    """P(mean per-session improvement of a over b <= 0), sessions resampled together."""
    d = a - b
    rs = np.random.default_rng(seed)
    m = d[rs.integers(0, len(d), size=(n, len(d)))].mean(axis=1)
    return float((m <= 0).mean())


def row(name, period, tr, per, base_per=None, out=None):
    eq = tr.norm.cumsum()
    w, l = tr.norm[tr.norm > 0], tr.norm[tr.norm < 0]
    r = dict(variant=name, period=period, sessions=len(per), trades=len(tr), per_session=round(len(tr) / len(per), 2),
             win=round(float((tr.net > 0).mean()), 3), pf=round(C.pf(tr.norm), 3), net_per_session=round(float(per.mean()), 3),
             avg_win=round(float(w.mean()), 2), avg_loss=round(float(l.mean()), 2), max_dd=round(float((eq.cummax() - eq).max()), 0),
             closed_by_shift=round(float((tr.why == "X").mean()), 3), full_stops=round(float((tr.why == "SL").mean()), 3))
    if base_per is not None:
        r["improvement_per_session"] = round(float((per - base_per).mean()), 3)
        r["p_no_improvement"] = round(paired(per, base_per), 4)
    if out is not None and len(out) >= 120:
        b50, med, a150 = small(out)
        r.update(r300_below_half=round(b50, 3), r300_median_end=round(med), r300_above_150=round(a150, 3))
    return r


if __name__ == "__main__":
    rows, res = [], {}
    P_fresh, m5_fresh = T.fresh_plans(), T.fresh_m5()
    P_used, m5_used, _ = S.load()
    # ---- 5-minute grid: X15 and X5 against B0
    for period, plans, bars in (("2016 - Sep 2024", P_fresh, m5_fresh), ("May 2025 - Nov 2026", P_used, m5_used)):
        ev = {"B0": None, "X15": C.exit_events(bars, 15, 5), "X5": C.exit_events(bars, 5, 5)}
        base = None
        for name in ("B0", "X15", "X5"):
            out, tr, per = sim(plans, bars, ev[name], 5)
            res[(name, period)] = per
            rows.append(row(name, period, tr, per, None if name == "B0" else base, out))
            if name == "B0":
                base = per
            if period.startswith("2016"):
                tr.to_csv(B.HERE / "backtest" / f"mtf_{name}_fresh_trades.csv", index=False)
    # ---- 1-minute grid: X1, with B0 / X5 / X15 re-run on the same bars
    m1 = pd.concat([pd.read_csv(B.HERE / "data" / f"XAUUSD_M_1_{y}.csv.gz", parse_dates=["time_utc"]) for y in (2023, 2024, 2025, 2026)]) \
        .drop_duplicates("time_utc").sort_values("time_utc").reset_index(drop=True)
    ev1 = {"B0": None, "X15": C.exit_events(m1, 15, 1), "X5": C.exit_events(m1, 5, 1), "X1": C.exit_events(m1, 1, 1)}
    first_m1 = m1.time_utc.min() + pd.Timedelta(days=2)
    P_a = [p for p in P_fresh if p["day"] >= first_m1]
    for period, plans in (("Jan 2023 - Sep 2024 (1m bars)", P_a), ("May 2025 - Nov 2026 (1m bars)", P_used)):
        base = None
        for name in ("B0", "X15", "X5", "X1"):
            out, tr, per = sim(plans, m1, ev1[name], 1)
            res[(name, period)] = per
            rows.append(row(name, period, tr, per, None if name == "B0" else base, out))
            if name == "B0":
                base = per
    R = pd.DataFrame(rows)
    pd.set_option("display.width", 320); pd.set_option("display.max_columns", 40)
    print(R.to_string(index=False))
    R.to_csv(B.HERE / "backtest" / "mtf_exit_summary.csv", index=False)

    # ---- verdicts
    L5, RC = "2016 - Sep 2024", "May 2025 - Nov 2026"
    A1, B1 = "Jan 2023 - Sep 2024 (1m bars)", "May 2025 - Nov 2026 (1m bars)"
    verdict, score = {}, {}
    for name in ("X15", "X5"):
        long_gain = float((res[(name, L5)] - res[("B0", L5)]).mean())
        p = paired(res[(name, L5)], res[("B0", L5)])
        recent_gain = float((res[(name, RC)] - res[("B0", RC)]).mean())
        ok = long_gain > 0 and p <= 0.0167 and recent_gain > 0
        verdict[name], score[name] = ("ADOPT as default" if ok else "not the default"), float(res[(name, L5)].mean())
        print(f"{name}: long-period improvement {long_gain:+.3f}/session, P(no improvement) {p:.2%}; recent improvement {recent_gain:+.3f} -> {verdict[name]}")
    a, b = np.r_[res[("X1", A1)], res[("X1", B1)]], np.r_[res[("B0", A1)], res[("B0", B1)]]
    long_gain, p, recent_gain = float((a - b).mean()), paired(a, b), float((res[("X1", B1)] - res[("B0", B1)]).mean())
    verdict["X1"] = "ADOPT as default" if (long_gain > 0 and p <= 0.0167 and recent_gain > 0) else "not the default"
    score["X1"] = float(a.mean())
    print(f"X1: improvement over its period {long_gain:+.3f}/session, P(no improvement) {p:.2%}; recent improvement {recent_gain:+.3f} -> {verdict['X1']}")
    winners = [n for n, v in verdict.items() if v.startswith("ADOPT")]
    default = max(winners, key=lambda n: score[n]) if winners else "none (the exit ships switched OFF)"
    print("default exit:", default)
    json.dump(dict(verdict=verdict, default=default), open(B.HERE / "backtest" / "mtf_exit_verdicts.json", "w"), indent=1)
