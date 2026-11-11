"""PRE-REGISTERED: is the bot missing opportunities by waiting for the 80% box to break? Committed before running.

Part A (descriptive, not a strategy test): on days the current bot (z 1.2816) did NOT trade, how big was the day
(range and close-to-close move, $ and ATR) compared with the days it did trade?

Part B (2 new looks): the same breakout rules with a tighter box, z = 0.674 (50% band) and z = 1.0, on BOTH the 2026
design period and the unseen May 2025 - Jan 2026 period, 5-minute bars, $0.50 cost, fills against us, 0.01 lot.
A tighter box is ADOPTED only if, in BOTH periods separately: PF >= 1.15 AND net $ per day > the current z 1.2816 bot;
and pooled bootstrap P(PF < 1) <= 5% (10% / 2 looks). Otherwise the current box stays. Looks so far: 21 -> 23.
"""
import numpy as np
import pandas as pd

import analysis as A
import bandfade_backtest as B
import unseen_test as U

RULES = dict(centre="prior_close", skip_data_hour=True, mode="breakout")


def pf(s):
    w, l = s[s > 0].sum(), -s[s < 0].sum()
    return w / l if l > 0 else np.inf


def boot(s, n=3000, seed=42):
    rs = np.random.default_rng(seed)
    v = np.asarray(s)
    return float(np.mean([pf(pd.Series(rs.choice(v, len(v)))) < 1 for _ in range(n)]))


def periods():
    m5d = pd.read_csv(B.HERE / "data" / "XAUUSD_M_5_hist.csv", parse_dates=["time_utc"])
    m5u = pd.read_csv(B.HERE / "data" / "XAUUSD_M_5_unseen.csv", parse_dates=["time_utc"])
    Pd = B.day_plans(m5_start=m5d.time_utc.min() + pd.Timedelta(days=1))
    Pu = U.plans(m5u.time_utc.min() + pd.Timedelta(days=1), U.END)
    return [("2026 design", Pd, m5d), ("unseen May25-Jan26", Pu, m5u)]


if __name__ == "__main__":
    P = periods()
    print("A. Days the current bot sat out vs days it traded")
    for name, plans, m5 in P:
        tr = B.simulate(plans, m5, z=1.2816, **RULES)
        m = m5.set_index("time_utc")
        rows = []
        for p in plans:
            s, e = p["bars"][0], p["bars"][-1] + pd.Timedelta(hours=1)
            day = m.loc[s:e - pd.Timedelta(minutes=5)]
            if day.empty:
                continue
            traded = ((tr.entry_time >= s) & (tr.entry_time < e)).any() if len(tr) else False
            rows.append(dict(traded=traded, rng=day.high.max() - day.low.min(), move=abs(day.close.iloc[-1] - p["anchor"]), atr=p["atr"]))
        d = pd.DataFrame(rows)
        for t, g in d.groupby("traded"):
            print(f"  {name:20s} {'traded' if t else 'NO trade':9s} {len(g):3d} days | range ${g.rng.mean():5.1f} ({(g.rng / g.atr).mean():.2f} ATR) "
                  f"| close-to-close ${g.move.mean():5.1f} ({(g.move / g.atr).mean():.2f} ATR)")

    print("\nB. Tighter box vs the current one (0.01 lot, net of $0.50 per trade)")
    res = {}
    for z in (1.2816, 1.0, 0.674):
        pooled = []
        for name, plans, m5 in P:
            tr = B.simulate(plans, m5, z=z, **RULES)
            res[(z, name)] = dict(n=len(tr), pf=pf(tr.net), net=tr.net.sum(), per_day=tr.net.sum() / len(plans),
                                  dd=(tr.net.cumsum().cummax() - tr.net.cumsum()).max())
            pooled.append(tr.net)
            r = res[(z, name)]
            print(f"  z {z:6.4f} {name:20s} {r['n']:4d} trades | PF {r['pf']:.2f} | net ${r['net']:8.2f} | ${r['per_day']:+.2f}/day | max DD ${r['dd']:.0f}")
        res[(z, "pooled_p")] = boot(pd.concat(pooled))
        print(f"  z {z:6.4f} pooled P(PF<1) = {res[(z, 'pooled_p')]:.1%}")
    for z in (1.0, 0.674):
        ok = all(res[(z, n)]["pf"] >= 1.15 and res[(z, n)]["per_day"] > res[(1.2816, n)]["per_day"] for n, _, _ in P) \
            and res[(z, "pooled_p")] <= 0.05
        print(f"  verdict z {z}: {'ADOPT' if ok else 'reject - the current box stays'}")
