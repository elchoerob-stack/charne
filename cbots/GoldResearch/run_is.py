"""Stage 1: every pre-registered variant on the DISCOVERY period only (Sep 2016 - Dec 2022)."""
import pickle
import sys
import time
from core import Data, run, stats, yearly, fmt
import families as F

DATA = sys.argv[1]
d = Data(DATA)
cx = F.Ctx(d)
IS_LO, IS_HI = d.idx_of_utc("2016-09-01"), d.idx_of_utc("2023-01-01")

V = {}
V["LB spec"] = lambda: F.london_breakout(cx)
V["LB spec +D1 EMA100"] = lambda: F.london_breakout(cx, trend="ema100")
V["LB spec long-only"] = lambda: F.london_breakout(cx, long_only=True)
for tp in (1.5, 2.5):
    for tr in (None, "ema100"):
        V[f"NY ORB tp{tp} trend={tr}"] = (lambda tp=tp, tr=tr: F.ny_orb(cx, tp_r=tp, trend=tr))
for n in (20, 55):
    for ex in ("chandelier", "donchian"):
        for lo in (False, True):
            V[f"DC D1 n{n} {ex} {'long' if lo else 'both'}"] = (lambda n=n, ex=ex, lo=lo: F.donchian_d1(cx, n=n, exit_kind=ex, long_only=lo))
for th in (5, 10):
    for lo in (True, False):
        V[f"CR D1 rsi2<{th} {'long' if lo else 'both'}"] = (lambda th=th, lo=lo: F.connors_d1(cx, th=th, long_only=lo))
for th in (5, 10):
    for lo in (False, True):
        V[f"CR H4 rsi2<{th} {'long' if lo else 'both'}"] = (lambda th=th, lo=lo: F.connors_h4(cx, th=th, long_only=lo))
for ex in (480, 600):
    for tr in (None, "ema50"):
        V[f"AS drift exit{ex//60:02d}h trend={tr}"] = (lambda ex=ex, tr=tr: F.asian_drift(cx, exit_min=ex, trend=tr))
for thr in (0.25, 0.5):
    V[f"IM momentum thr{thr}"] = (lambda thr=thr: F.intraday_momentum(cx, thr=thr))
for n in (20, 55):
    for k in (3.0, 4.5):
        V[f"D4 H4 n{n} trail{k}"] = (lambda n=n, k=k: F.donchian_h4(cx, n=n, k_trail=k))

print(f"{len(V)} pre-registered variants, discovery period 2016-09 .. 2022-12\n")
res = {}
for name, fn in V.items():
    t0 = time.time()
    tr = [t for t in run(d, fn()) if IS_LO <= t.i0 < IS_HI]
    s = stats(d, tr)
    y = yearly(d, tr)
    res[name] = (s, y, tr)
    ys = " ".join(f"{yy%100:02d}:{pf:4.2f}" for yy, (nn, pf) in y.items())
    print(f"{name:34s} {fmt(s)}  | {ys}  ({time.time()-t0:.0f}s)", flush=True)

pickle.dump({k: (v[0], v[1], [(t.i0, t.i1, t.dir, t.r, t.reason) for t in v[2]]) for k, v in res.items()},
            open("is_results.pkl", "wb"))
