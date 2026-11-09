"""Every variant again, with trades OPENED in the COVID years left out of the scoring.
The strategies still run through those years (indicators, open positions); only the
trades entered inside the window are dropped. Out-of-sample (2023-2026) is unaffected.

Windows: 2020-2021 (main) and Mar 2020 - Jun 2021 (the acute phase, sensitivity)."""
import csv
import pickle
import sys
import numpy as np
from core import Data, run, stats, fmt
import families as F

d = Data(sys.argv[1])
cx = F.Ctx(d)
I = d.idx_of_utc
IS_LO, OOS_LO = I("2016-09-01"), I("2023-01-01")
WIN = {"ex 2020-21": (I("2020-01-01"), I("2022-01-01")), "ex Mar20-Jun21": (I("2020-03-01"), I("2021-07-01"))}

V = {}
V["LB spec"] = lambda: F.london_breakout(cx)
V["LB spec +D1 EMA100"] = lambda: F.london_breakout(cx, trend="ema100")
V["LB spec long-only"] = lambda: F.london_breakout(cx, long_only=True)
for tp in (1.5, 2.5):
    for tr in (None, "ema100"):
        V[f"NY ORB tp{tp} trend={tr}"] = (lambda tp=tp, tr=tr: F.ny_orb(cx, tp_r=tp, trend=tr))
for n in (20, 55):
    for lo in (False, True):
        V[f"DC D1 n{n} donchian-exit {'long' if lo else 'both'}"] = (lambda n=n, lo=lo: F.donchian_d1(cx, n=n, exit_kind="donchian", long_only=lo))
for lo in (False, True):
    for n in (20, 30, 40, 55):
        for k in (2.5, 3.0, 4.0):
            V[f"DC D1 n{n} chand{k} {'long' if lo else 'both'}"] = (lambda n=n, k=k, lo=lo: F.donchian_d1(cx, n=n, k_trail=k, long_only=lo))
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
for n in (20, 55):
    V[f"D4 H4 n{n} trail3.0 long"] = (lambda n=n: [g for g in F.donchian_h4(cx, n=n, k_trail=3.0) if g["dir"] > 0])


def outside(t, w):
    return not (w[0] <= t.i0 < w[1])


print(f"{len(V)} variants (stage 1 + stage 2, the chandelier n20/n55 k3 ones counted once)\n")
print(f"{'variant':34s} {'IS 2016-22 all':>16s} {'IS ex 2020-21':>16s} {'IS ex Mar20-Jun21':>18s}   covid-window PF")
keep, rows = {}, []
for name, fn in V.items():
    tr = run(d, fn())
    is_ = [t for t in tr if IS_LO <= t.i0 < OOS_LO]
    a = stats(d, is_)
    b = stats(d, [t for t in is_ if outside(t, WIN["ex 2020-21"])])
    c = stats(d, [t for t in is_ if outside(t, WIN["ex Mar20-Jun21"])])
    cw = stats(d, [t for t in is_ if not outside(t, WIN["ex 2020-21"])])
    rows.append((name, a, b, c))
    keep[name] = tr
    print(f"{name:34s} {a['n']:4d} PF {a['pf']:5.2f}   {b['n']:4d} PF {b['pf']:5.2f}   {c['n']:4d} PF {c['pf']:5.2f}      {cw['n']:4d} PF {cw['pf']:5.2f}", flush=True)

print("\nBest in-sample PF ex 2020-21 (at least 20 trades):")
for name, a, b, c in sorted([r for r in rows if r[2]["n"] >= 20], key=lambda r: -r[2]["pf"])[:8]:
    print(f"  {name:34s} PF {b['pf']:5.2f} on {b['n']} trades")
pl = [r[2]["pf"] for r in rows if r[0].startswith("DC D1") and "chand4.0" not in r[0] and "donchian-exit" not in r[0]]
print(f"\nTrend plateau (n20-55, trail 2.5-3 ATR, 16 settings), in-sample ex 2020-21: min {min(pl):.2f}, median {np.median(pl):.2f}")

print("\n=== Finalist A (40-day breakout, 3 ATR trail, both sides) ===")
A = keep["DC D1 n40 chand3.0 both"]
for label, w in WIN.items():
    is_x = [t for t in A if IS_LO <= t.i0 < OOS_LO and outside(t, w)]
    oos = [t for t in A if t.i0 >= OOS_LO]
    print(f"{label:16s} IS  {fmt(stats(d, is_x))}")
    print(f"{'':16s} OOS {fmt(stats(d, oos))}   (unchanged: no COVID years in it)")
    print(f"{'':16s} ALL {fmt(stats(d, is_x + oos))}  ret={stats(d, is_x + oos)['ret']:+.0f}%")
C = keep["LB spec +D1 EMA100"]
w = WIN["ex 2020-21"]
print("\n=== Reference C (London breakout + D1 EMA100), ex 2020-21 ===")
print(f"IS  {fmt(stats(d, [t for t in C if IS_LO <= t.i0 < OOS_LO and outside(t, w)]))}")
print(f"OOS {fmt(stats(d, [t for t in C if t.i0 >= OOS_LO]))}")

# trade log for cbot-gate: finalist A without trades opened in 2020-2021
import pandas as pd
bal = 10000.0
with open("results/trades_trend_A_ex_covid.csv", "w", newline="") as f:
    wr = csv.writer(f)
    wr.writerow(["Closing Time", "Entry Time", "Direction", "R", "Net Profit", "Balance", "Exit"])
    for t in A:
        if t.i0 < IS_LO or not outside(t, w):
            continue
        pnl = bal * 0.005 * t.r
        bal += pnl
        ts = lambda i: pd.Timestamp(int(d.t[i]) * 60, unit="s").strftime("%Y-%m-%d %H:%M:%S")
        wr.writerow([ts(t.i1), ts(t.i0), "Buy" if t.dir > 0 else "Sell", f"{t.r:.3f}", f"{pnl:.2f}", f"{bal:.2f}", t.reason])
print(f"\ntrade log (A ex 2020-21) end balance {bal:.2f}")
