"""PRE-REGISTERED: should the bot trade its own scenario plan? Committed BEFORE it was run.

Plan per day = scenario plan levels-v2 (targets.scenario_plan), built only from bars closed by the prior close
(H1 + H4 history, H4 from data/XAUUSD_H_4_long.csv so early days have 4h levels too).
Rules (fixed now):
  * from hour 2 to hour 22 of the session, at each 1h CLOSE, while flat:
      close > bull trigger (not yet used today) -> BUY at the next 5-minute open
      close < bear trigger (not yet used today) -> SELL at the next 5-minute open
  * stop = the prior close (the plan's invalidation, as a hard stop); target = T1 (variant A) or T2 (variant B)
  * skip if the entry has already gapped through the target; each scenario at most once a day; one position at a time;
    flat at the session close; $0.50 cost per trade; 0.01 lot = 1 oz; 5-minute bars, stop wins if a bar touches both.
Periods: design 2026-01-14 -> 2026-11-08 (5m hist) and unseen 2025-03-01 -> 2026-01-13 (5m unseen); neither period
was used to write the scenario rules (they were written on 9-10 Nov 2026 charts).
ADOPT a variant only if: PF >= 1.15 in BOTH periods, >= 100 trades pooled, pooled bootstrap P(PF<1) <= 5% (10% / 2 looks).
Looks so far: 23 -> 25.
"""
import sys

import numpy as np
import pandas as pd

import analysis as A
import targets as TG

H4_LONG = A.HERE / "data" / "XAUUSD_H_4_long.csv"
_load = A.load


def _load_long(period, cutoff):
    if period != "H_4":
        return _load(period, cutoff)
    df = pd.read_csv(H4_LONG, parse_dates=["time_utc"])
    df = df[df.time_utc + pd.Timedelta(hours=4) <= cutoff].reset_index(drop=True)
    df["time_sast"] = df.time_utc.dt.tz_localize(None) + A.SAST
    return df


A.load = _load_long
COST = 0.50
PERIODS = {"design": ("2026-01-14", "2026-11-08", "data/XAUUSD_M_5_hist.csv"),
           "unseen": ("2025-03-01", "2026-01-13", "data/XAUUSD_M_5_unseen.csv")}


def plans_for(start, end):
    h1, sess = A.session_table(A.load("H_1", pd.Timestamp("2026-11-10T22:00:00Z")))
    out = []
    for t in range(30, len(sess) - 1):
        day = sess.start[t + 1]
        if not (pd.Timestamp(start, tz="UTC") <= day <= pd.Timestamp(end, tz="UTC") + pd.Timedelta(hours=23)):
            continue
        cut = sess.end[t] + pd.Timedelta(hours=1)
        tfs = {p: A.analyse_tf(p, cut) for p in ("H_1", "H_4")}
        h1_all = A.load("H_1", cut)
        levels, dd = A.key_levels(tfs, h1_all, None, cut)
        _, sc = A.session_table(h1_all)
        li = len(sc) - 1
        R = dict(levels=levels, day=dd, anchor=float(sc.c[li]), atr_now=float(sc.atr[li]))
        bull, bear = TG.scenario_plan(R, np.zeros(1), np.zeros(1))
        nxt = h1[h1.session == sess.session[t + 1]]
        out.append(dict(day=day, anchor=R["anchor"], bull=bull, bear=bear,
                        bars=list(nxt.time_utc), closes=list(nxt.close)))
    return out


def simulate(plans, m5, tp_key):
    m5 = m5.set_index("time_utc")
    trades = []
    for p in plans:
        used = {"bull": False, "bear": False}
        resume = None
        nb = len(p["bars"])
        day_end = p["bars"][-1] + pd.Timedelta(hours=1)
        for k in range(1, min(nb, 22)):
            close_t = p["bars"][k] + pd.Timedelta(hours=1)
            if resume is not None and close_t <= resume:
                continue
            c = p["closes"][k]
            side = None
            if not used["bull"] and c > p["bull"]["trigger"]:
                side, sc = 1, p["bull"]
            elif not used["bear"] and c < p["bear"]["trigger"]:
                side, sc = -1, p["bear"]
            if side is None:
                continue
            used["bull" if side == 1 else "bear"] = True
            path = m5.loc[close_t:day_end - pd.Timedelta(minutes=5)]
            if path.empty:
                continue
            entry = path.open.iloc[0]
            tp = sc["targets"][0 if tp_key == "T1" else 1]["price"]
            sl = p["anchor"]
            if side * (tp - entry) <= 0 or side * (entry - sl) <= 0:
                continue                                   # already through the target (or the stop)
            exit_px, exit_t, why = None, None, None
            for ts, bar in path.iterrows():
                hit_sl = bar.low <= sl if side == 1 else bar.high >= sl
                hit_tp = bar.high >= tp if side == 1 else bar.low <= tp
                if hit_sl:
                    exit_px = min(sl, bar.open) if side == 1 else max(sl, bar.open)
                    exit_t, why = ts, "SL"
                    break
                if hit_tp:
                    exit_px, exit_t, why = tp, ts, "TP"
                    break
            if exit_px is None:
                exit_px, exit_t, why = path.close.iloc[-1], path.index[-1], "EOD"
            gross = (exit_px - entry) * side
            trades.append(dict(entry_time=close_t, side="Buy" if side == 1 else "Sell", entry=round(entry, 2),
                               exit_time=exit_t, exit=round(exit_px, 2), exit_reason=why, gross=round(gross, 2),
                               net=round(gross - COST, 2)))
            resume = exit_t
    return pd.DataFrame(trades)


def pf(s):
    w, l = s[s > 0].sum(), -s[s < 0].sum()
    return w / l if l > 0 else np.inf


def boot(s, n=3000, seed=42):
    rs = np.random.default_rng(seed)
    v = np.asarray(s)
    return float(np.mean([pf(pd.Series(rs.choice(v, len(v)))) < 1 for _ in range(n)]))


if __name__ == "__main__":
    res = {}
    for name, (s, e, path) in PERIODS.items():
        P = plans_for(s, e)
        m5 = pd.read_csv(path, parse_dates=["time_utc"])
        for v in ("T1", "T2"):
            tr = simulate(P, m5, v)
            res[(v, name)] = tr
            tr.assign(**{"Closing Time": tr.exit_time.astype(str), "Net Profit": tr.net}).to_csv(
                f"backtest/scenario_{v}_{name}_trades.csv", index=False)
            print(f"{v} {name:7s} {len(P):3d} days | {len(tr):3d} trades | win {(tr.net > 0).mean():.0%} | PF {pf(tr.net):.2f} "
                  f"| net ${tr.net.sum():8.2f} | ${tr.net.sum() / len(P):+.2f}/day | exits {tr.exit_reason.value_counts().to_dict()}")
    for v in ("T1", "T2"):
        pooled = pd.concat([res[(v, "design")].net, res[(v, "unseen")].net])
        p_ = boot(pooled)
        ok = pf(res[(v, "design")].net) >= 1.15 and pf(res[(v, "unseen")].net) >= 1.15 and len(pooled) >= 100 and p_ <= 0.05
        print(f"{v}: pooled {len(pooled)} trades, PF {pf(pooled):.2f}, P(PF<1) {p_:.1%} -> {'ADOPT' if ok else 'reject'}")
