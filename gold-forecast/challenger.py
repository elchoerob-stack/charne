"""What happens the day AFTER a big move, and should the bands widen? (data before Tuesday only)

Champion v1 = the frozen model. Challenger v2-regime = same centre line, but if the day just finished moved more
than 1 ATR, the band width is multiplied by k = (average next-day range after big days) / (average next-day range),
with k estimated ONLY from sessions before the forecast day (walk-forward). Scored with the interval score for the
80% band (width + penalty when the price lands outside; lower is better), plus coverage.
"""
import numpy as np
import pandas as pd

import analysis as A
import targets as TG

h1, sess = A.session_table(A.load("H_1", pd.Timestamp("2026-11-09T22:00:00Z")))
last = len(sess) - 1
hi, lo = TG.outcomes(h1, sess)                     # next session's high/low from close d, in ATR(d) units
rng_next = hi - lo
move = np.r_[np.nan, (sess.c.values[1:] - sess.c.values[:-1]) / sess.atr.values[:-1]]   # day d's own move
Z, ALPHA = 1.2816, 0.2

# ---- 1. conditional facts after big days (all history before Tuesday)
d_all = np.arange(25, last)
big_dn = d_all[move[d_all] < -1]
big_up = d_all[move[d_all] > 1]
calm = d_all[np.abs(move[d_all]) <= 1]
nxt = lambda d: (sess.c.values[d + 1] - sess.c.values[d]) / sess.atr.values[d]
print("The day AFTER ...            n   next day up   mean move   mean range   range > 1.5 ATR")
for name, ds in (("a big DOWN day (< -1 ATR)", big_dn), ("a big UP day (> +1 ATR)", big_up), ("a normal day", calm)):
    mv = np.array([nxt(d) for d in ds]); rg = rng_next[ds]
    up = (mv > 0).mean()
    print(f"{name:27s} {len(ds):4d}   {up:5.0%} +-{2*np.sqrt(up*(1-up)/len(ds)):.0%}   {mv.mean():+.2f} ATR   {rg.mean():.2f} ATR    {(rg > 1.5).mean():5.0%}")

# ---- 2. walk-forward champion vs challenger on the last 200 sessions
rows = []
for t in range(last - 200, last):
    f = A.analog_forecast(h1, sess, t, pool_end=t)
    sig, _ = A.vol_profile(h1, sess, t)
    act, _, _ = A.outcome(h1, sess, t)
    prior = np.arange(25, t - 1)                          # ratio from sessions whose next day is already known
    bigp = prior[np.abs(move[prior]) > 1]
    k = rng_next[bigp].mean() / rng_next[prior].mean() if len(bigp) >= 5 else 1.0
    big_today = abs(move[t]) > 1
    for name, s in (("v1", sig), ("v2", sig * (k if big_today else 1.0))):
        L, U = f["center"] - Z * s, f["center"] + Z * s
        score = (U - L) + (2 / ALPHA) * np.clip(L - act, 0, None) + (2 / ALPHA) * np.clip(act - U, 0, None)
        rows.append(dict(t=t, model=name, big=big_today, k=k, cov80=np.mean((act >= L) & (act <= U)),
                         iscore=score.mean(), width=(U - L).mean()))
R = pd.DataFrame(rows)
print(f"\nWalk-forward, last 200 sessions; days after a >1 ATR move: {R[R.model=='v1'].big.sum()}; "
      f"k now = {R.k.iloc[-1]:.2f}")
for grp, m in (("all days", R.t >= 0), ("after a big day", R.big)):
    g = R[m].groupby("model").agg(cov80=("cov80", "mean"), interval_score=("iscore", "mean"), width=("width", "mean"))
    print(f"  {grp}:\n" + g.round(3).to_string())
R.to_csv("backtest/challenger_walkforward.csv", index=False)
