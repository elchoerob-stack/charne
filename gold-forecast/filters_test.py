"""PRE-REGISTERED regime-filter test for the breakout bot. Committed BEFORE it was run.

Hypothesis from the unseen-period FAIL: the breakout edge (PF 1.14 in 2026, 0.99 before) exists only in some regimes.
Exactly three filters, declared now, each known at the previous session's close (no look-ahead):
  F1 expansion : previous session's range >= its ATR (the market is already moving)
  F2 trend     : trade direction agrees with the sign of (previous close - 20-session EMA of closes)
  F3 not quiet : previous ATR is at or above the 25th percentile of the prior 120 sessions' ATRs
Applied to the existing breakout trade lists (no re-simulation): 2026 trades (design period) and the unseen
May 2025 - Jan 2026 trades.
A filter is ADOPTED only if ALL hold: PF >= 1.15 in BOTH periods separately; >= 100 trades pooled;
bootstrap P(PF<1) on pooled trades <= 3.3% (10% / 3 filters). Otherwise it is rejected - no variants, no re-cutting.
Looks counted so far on this data: 16 (design) + 2 (unseen) + 3 (these filters).
"""
import numpy as np
import pandas as pd

import analysis as A

h1, sess = A.session_table(A.load("H_1", pd.Timestamp("2026-11-09T22:00:00Z")))
c = pd.Series(sess.c.values)
ema20 = c.ewm(span=20, adjust=False).mean().values
rng = (sess.h - sess.l).values
atr = sess.atr.values
starts = sess.start.values


def features(entry_time, side):
    i = int(np.searchsorted(starts, np.datetime64(entry_time.tz_convert(None)), side="right")) - 1
    p = i - 1
    if p < 125:
        return None
    pct = np.mean(atr[p - 120:p] <= atr[p])
    return dict(F1=rng[p] >= atr[p], F2=(1 if side == "Buy" else -1) == np.sign(sess.c[p] - ema20[p]), F3=pct >= 0.25)


def load(path):
    tr = pd.read_csv(path, parse_dates=["entry_time", "exit_time"])
    f = [features(t, s) for t, s in zip(tr.entry_time, tr.side)]
    ok = [x is not None for x in f]
    tr = tr[ok].reset_index(drop=True)
    return pd.concat([tr, pd.DataFrame([x for x in f if x is not None])], axis=1)


def pf(s):
    w, l = s[s > 0].sum(), -s[s < 0].sum()
    return w / l if l > 0 else np.inf


def boot(s, n=3000, seed=42):
    rs = np.random.default_rng(seed)
    v = s.values
    return np.mean([pf(pd.Series(rs.choice(v, len(v)))) < 1 for _ in range(n)])


A_ = load("backtest/breakout_prior_z128_skipUS_trades.csv")
B_ = load("backtest/unseen_breakout_trades.csv")
P_ = pd.concat([A_, B_])
print(f"{'filter':10s} {'2026 n':>7s} {'PF':>6s} {'net':>8s} | {'unseen n':>8s} {'PF':>6s} {'net':>8s} | {'pooled n':>8s} {'PF':>6s} {'P(PF<1)':>8s}  verdict")
for name in ("none", "F1", "F2", "F3"):
    m = (lambda d: d) if name == "none" else (lambda d, k=name: d[d[k]])
    a, b, p = m(A_).net, m(B_).net, m(P_).net
    ok = len(a) and len(b) and pf(a) >= 1.15 and pf(b) >= 1.15 and len(p) >= 100 and boot(p) <= 0.033
    print(f"{name:10s} {len(a):7d} {pf(a):6.2f} {a.sum():8.1f} | {len(b):8d} {pf(b):6.2f} {b.sum():8.1f} | {len(p):8d} {pf(p):6.2f} {boot(p):8.1%}  "
          + ("n/a (baseline)" if name == "none" else ("ADOPT" if ok else "reject")))
