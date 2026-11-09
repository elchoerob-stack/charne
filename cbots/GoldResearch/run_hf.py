"""Stage 5: high-frequency round (asked for: many trades, PF 1.2-1.8).

Pre-registered before running:
  - 26 variants, listed below. Discovery period Sep 2016 - Dec 2022 only.
  - Selection rule, applied automatically: among variants with >= 60 trades a year in
    discovery and discovery PF (all years) >= 1.10, take the two with the highest
    discovery PF EXCLUDING trades opened in 2020-2021 (the user's COVID exclusion).
  - Those two, and only those, are then run once on Jan 2023 - Oct 2026.
"""
import csv
import sys
import pandas as pd
from core import Data, run, stats, yearly, fmt
import families as F

d = Data(sys.argv[1])
cx = F.Ctx(d)
I = d.idx_of_utc
IS_LO, OOS_LO = I("2016-09-01"), I("2023-01-01")
C0, C1 = I("2020-01-01"), I("2022-01-01")

V = {}
for tr in ("ema50", "ema100", "sma200"):
    for ex in ("spec", "tp1.5", "runner"):
        for one in (False, True):
            V[f"LB {tr} {ex} {'one-sided' if one else 'oco'}"] = (lambda tr=tr, ex=ex, one=one: F.london_breakout_v(cx, tr, ex, one))
for one in (False, True):
    V[f"LB ema100 spec {'one-sided' if one else 'oco'} compressed<0.6ATR"] = (lambda one=one: F.london_breakout_v(cx, "ema100", "spec", one, atr_w_max=0.6))
for tp in (1.5, 2.5):
    V[f"PDH/PDL ema100 tp{tp}"] = (lambda tp=tp: F.pdhl_breakout(cx, tp_r=tp))
for n in (24, 48):
    for k in (2.0, 3.0):
        V[f"H1 Donchian n{n} trail{k}"] = (lambda n=n, k=k: F.donchian_h1(cx, n=n, k_trail=k))

print(f"{len(V)} pre-registered variants. Running total for this project's gold research: 59 + {len(V)} = {59 + len(V)}\n")
print(f"{'variant':44s} {'discovery 2016-22':>34s}   {'ex 2020-21':>17s}")
rows, keep = [], {}
for name, fn in V.items():
    tr = run(d, fn())
    keep[name] = tr
    is_ = [t for t in tr if IS_LO <= t.i0 < OOS_LO]
    a = stats(d, is_)
    b = stats(d, [t for t in is_ if not (C0 <= t.i0 < C1)])
    rows.append((name, a, b))
    print(f"{name:44s} n={a['n']:4d} PF {a['pf']:4.2f} /yr {a['tpy']:5.1f} DD {a['dd']:4.1f}%   n={b['n']:4d} PF {b['pf']:4.2f}", flush=True)

ok = [r for r in rows if r[1]["tpy"] >= 60 and r[1]["pf"] >= 1.10]
pick = sorted(ok, key=lambda r: -r[2]["pf"])[:2]
print(f"\n{len(ok)} variants meet >= 60 trades/yr and discovery PF >= 1.10.")
print("Selected for the out-of-sample run:", ", ".join(p[0] for p in pick))

for name, a, b in pick:
    tr = keep[name]
    oos = [t for t in tr if t.i0 >= OOS_LO]
    allx = [t for t in tr if t.i0 >= IS_LO and not (C0 <= t.i0 < C1)]
    print(f"\n=== {name} ===")
    print(f"discovery 2016-22     {fmt(a)}")
    print(f"discovery ex 2020-21  {fmt(b)}")
    print(f"OUT-OF-SAMPLE 2023-26 {fmt(stats(d, oos))}")
    print(f"10 yrs ex 2020-21     {fmt(stats(d, allx))}  ret={stats(d, allx)['ret']:+.0f}%")
    y = yearly(d, [t for t in tr if t.i0 >= IS_LO])
    print("by year (trades/PF): " + " ".join(f"{yy%100:02d}:{n}/{pf:.2f}" for yy, (n, pf) in y.items()))
    longs = stats(d, [t for t in oos if t.dir > 0]); shorts = stats(d, [t for t in oos if t.dir < 0])
    print(f"OOS longs  {fmt(longs)}\nOOS shorts {fmt(shorts)}")
    bal = 10000.0
    fn = "results/trades_" + name.replace(" ", "_").replace("/", "").replace("<", "lt") + ".csv"
    with open(fn, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["Closing Time", "Entry Time", "Direction", "R", "Net Profit", "Balance", "Exit"])
        for t in tr:
            if t.i0 < IS_LO:
                continue
            pnl = bal * 0.005 * t.r
            bal += pnl
            ts = lambda i: pd.Timestamp(int(d.t[i]) * 60, unit="s").strftime("%Y-%m-%d %H:%M:%S")
            w.writerow([ts(t.i1), ts(t.i0), "Buy" if t.dir > 0 else "Sell", f"{t.r:.3f}", f"{pnl:.2f}", f"{bal:.2f}", t.reason])
    print("trade log:", fn)
