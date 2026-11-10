"""Diagnostics on the pre-Tuesday snapshot: where does the projection model go wrong, and what is predictable?

A. does the daily trend (EMA stack of session closes) predict the next session's direction?
B. does the move so far today carry on for the rest of today (intraday momentum)?
C. does the 80% band coverage collapse on trend days?
Everything uses only information available at the time; no tuning, just measurement.
"""
import numpy as np
import pandas as pd
import analysis as A

CUT = "2026-11-09T22:00:00Z"            # frozen Monday close: Tuesday's data is not used
h1, sess = A.session_table(A.load("H_1", pd.Timestamp(CUT)))
c = sess.c.values
n = len(sess)


def se(p, m):
    return np.sqrt(p * (1 - p) / m)


# ---------------------------------------------------------------- A. daily trend -> next session
ema = lambda s, k: s.ewm(span=k, adjust=False).mean()
cs = pd.Series(c)
e20, e50, e200 = ema(cs, 20), ema(cs, 50), ema(cs, 200)
slope = e50 - e50.shift(10)
score = (np.sign(cs - e20) + np.sign(cs - e50) + np.sign(cs - e200)
         + np.where((e20 > e50) & (e50 > e200), 1, np.where((e20 < e50) & (e50 < e200), -1, 0)) + np.sign(slope))
nxt = cs.shift(-1) - cs
atr = sess.atr
rows = []
for t in range(200, n - 1):
    rows.append((t, score[t], nxt[t] / atr[t]))
A_df = pd.DataFrame(rows, columns=["t", "score", "ret_atr"])
print(f"A. Daily trend score vs NEXT session move   ({len(A_df)} sessions, {sess.start[200]:%b %Y} - {sess.start[n-2]:%b %Y})")
for name, mask in (("bullish (score >= 3)", A_df.score >= 3), ("bearish (score <= -3)", A_df.score <= -3),
                   ("mixed", A_df.score.abs() < 3)):
    s = A_df[mask]
    up = (s.ret_atr > 0).mean()
    print(f"   {name:22s} n={len(s):3d}  next day up {up:5.1%} (+-{2 * se(up, max(len(s), 1)):.1%})  mean move {s.ret_atr.mean():+.3f} ATR")
dirs = A_df[A_df.score.abs() >= 3]
hit = (np.sign(dirs.score) == np.sign(dirs.ret_atr)).mean()
print(f"   direction hit rate when trend is clear: {hit:.1%} on {len(dirs)} sessions (95% band +-{2 * se(hit, len(dirs)):.1%})")
d1 = pd.Series(c).diff()
mom = A_df.assign(prev=[np.sign(d1[t]) for t in A_df.t])
print(f"   yesterday's direction repeats: {(np.sign(mom.prev) == np.sign(mom.ret_atr)).mean():.1%}")

# ---------------------------------------------------------------- B. intraday momentum
print("\nB. Does the move so far today continue?  (remaining move vs move since the prior close)")
recs = []
for i in range(1, n):
    cl = h1[h1.session == sess.session[i]].close.values
    prev, a = c[i - 1], atr[i - 1]
    if len(cl) < 16 or a <= 0:
        continue
    for k in (2, 5, 8, 11):
        recs.append(dict(i=i, k=k, m=(cl[k] - prev) / a, R=(cl[-1] - cl[k]) / a))
B = pd.DataFrame(recs)
for k, hrs in ((2, 3), (5, 6), (8, 9), (11, 12)):
    s = B[B.k == k]
    beta = np.polyfit(s.m, s.R, 1)[0]
    r = np.corrcoef(s.m, s.R)[0, 1]
    big = s[s.m.abs() > 0.5]
    hit = (np.sign(big.m) == np.sign(big.R)).mean() if len(big) else np.nan
    print(f"   after {hrs:2d}h: corr {r:+.3f}  beta {beta:+.3f}  | big moves (>0.5 ATR) n={len(big):3d}: continues {hit:5.1%} (+-{2 * se(hit, max(len(big), 1)):.1%})")

# ---------------------------------------------------------------- C. band coverage by day type
bt = pd.read_csv("backtest/_bt_cov.csv") if False else None
R = A.run(CUT)
bt = R["bt"].copy()
bt["move"] = bt.act_final.abs()
bt["bucket"] = pd.cut(bt.move, [0, 0.5, 1.0, 5], labels=["calm  (<0.5 ATR)", "normal (0.5-1)", "trend (>1 ATR)"])
print("\nC. 80% band coverage by size of the day's move (last 200 sessions, walk-forward)")
g = bt.groupby("bucket", observed=True).agg(days=("cov80", "size"), cov80=("cov80", "mean"), cov50=("cov50", "mean"))
print(g.round(3).to_string())
print(f"   today so far: -118 / 85 = {118 / 84.94:.2f} ATR -> a 'trend' day; share of such days: {(bt.move > 1).mean():.1%}")
bt.to_csv("backtest/_diag_bt.csv", index=False)
