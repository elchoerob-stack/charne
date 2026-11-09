"""Stage 3: OUT-OF-SAMPLE (Jan 2023 - Oct 2026), run once.
Finalists fixed before this run (see run_is2.py output):
  A  DC D1 n40 chand3.0 both   (centre of the profitable plateau, both directions)
  B  DC D1 n40 chand3.0 long   (same, long only)
  C  LB spec + D1 EMA100        (higher-frequency reference)
The rest of the stage-2 plateau is printed only to show whether the plateau survives."""
import sys
import numpy as np
import core
from core import Data, run, stats, yearly, fmt
import families as F

d = Data(sys.argv[1])
cx = F.Ctx(d)
IS_LO, OOS_LO, END = d.idx_of_utc("2016-09-01"), d.idx_of_utc("2023-01-01"), d.n


def show(name, tr):
    s_is = stats(d, [t for t in tr if IS_LO <= t.i0 < OOS_LO])
    s_oos = stats(d, [t for t in tr if t.i0 >= OOS_LO])
    s_all = stats(d, [t for t in tr if t.i0 >= IS_LO])
    print(f"{name:28s} IS  {fmt(s_is)}")
    print(f"{'':28s} OOS {fmt(s_oos)}")
    print(f"{'':28s} ALL {fmt(s_all)}  ret={s_all['ret']:+.0f}%")
    y = yearly(d, [t for t in tr if t.i0 >= IS_LO])
    print(f"{'':28s} " + " ".join(f"{yy%100:02d}:{n}/{pf:.2f}" for yy, (n, pf) in y.items()))
    return s_oos


fin = {
    "A DC D1 n40 chand3 both": lambda: F.donchian_d1(cx, n=40, k_trail=3.0),
    "B DC D1 n40 chand3 long": lambda: F.donchian_d1(cx, n=40, k_trail=3.0, long_only=True),
    "C LB spec +D1 EMA100": lambda: F.london_breakout(cx, trend="ema100"),
}
print("=== Finalists ===")
keep = {}
for k, fn in fin.items():
    keep[k] = run(d, fn())
    show(k, keep[k])
    print()

print("=== Cost stress on A and B: swap markup 4%/yr (from 2%), commission x2 ===")
core.SWAP_MARKUP, core.COMMISSION = 4.0, 0.14
for k in ("A DC D1 n40 chand3 both", "B DC D1 n40 chand3 long"):
    show(k + " [stress]", run(d, fin[k]()))
core.SWAP_MARKUP, core.COMMISSION = 2.0, 0.07
print()

print("=== Whole stage-2 plateau, OOS only (selection already fixed above) ===")
rows = []
for lo in (False, True):
    for n in (20, 30, 40, 55):
        for kk in (2.5, 3.0, 4.0):
            tr = run(d, F.donchian_d1(cx, n=n, k_trail=kk, long_only=lo))
            s = stats(d, [t for t in tr if t.i0 >= OOS_LO])
            rows.append(s["pf"])
            print(f"DC D1 n{n} chand{kk} {'long' if lo else 'both':4s} OOS {fmt(s)}")
print(f"\nplateau OOS PF: median {np.median(rows):.2f}, min {min(rows):.2f}, share >= 1.8: {np.mean(np.array(rows) >= 1.8)*100:.0f}%")

import pickle
pickle.dump({k: [(t.i0, t.i1, t.dir, t.entry, t.exit, t.R, t.r, t.reason) for t in v] for k, v in keep.items()},
            open("finalists.pkl", "wb"))
