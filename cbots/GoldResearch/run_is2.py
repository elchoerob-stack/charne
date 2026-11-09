"""Stage 2: neighbourhood check of the trend family, DISCOVERY period only (Sep 2016 - Dec 2022).
A real edge should show a plateau, not one lucky setting."""
import pickle
import sys
from core import Data, run, stats, yearly, fmt
import families as F

d = Data(sys.argv[1])
cx = F.Ctx(d)
IS_LO, IS_HI = d.idx_of_utc("2016-09-01"), d.idx_of_utc("2023-01-01")

V = {}
for lo in (False, True):
    for n in (20, 30, 40, 55):
        for k in (2.5, 3.0, 4.0):
            V[f"DC D1 n{n} chand{k} {'long' if lo else 'both'}"] = (lambda n=n, k=k, lo=lo: F.donchian_d1(cx, n=n, k_trail=k, long_only=lo))
for n in (20, 55):
    V[f"D4 H4 n{n} trail3.0 long"] = (lambda n=n: [g for g in F.donchian_h4(cx, n=n, k_trail=3.0) if g["dir"] > 0])

print(f"{len(V)} stage-2 variants (discovery period only)\n")
res = {}
for name, fn in V.items():
    tr = [t for t in run(d, fn()) if IS_LO <= t.i0 < IS_HI]
    s, y = stats(d, tr), yearly(d, tr)
    res[name] = (s, y)
    ys = " ".join(f"{yy%100:02d}:{pf:5.2f}" for yy, (nn, pf) in y.items())
    print(f"{name:28s} {fmt(s)}  | {ys}", flush=True)
pickle.dump(res, open("is2_results.pkl", "wb"))
