"""EURUSD research: the same method as gold, on Dukascopy M1 bid/ask, Sep 2016 - Nov 2026.

Pre-registered before running:
  - 23 variants, listed below. Discovery period Sep 2016 - Dec 2022 only.
  - Costs: real bid/ask spread + commission $7 per 100,000 round trip (0.7 pip);
    swap on overnight holds from the US-euro rate gap + 1%/yr markup.
  - Selection rule, applied automatically:
      high-frequency pick: among variants with >= 60 trades/yr and discovery PF >= 1.10,
        the two best by discovery PF excluding trades opened in 2020-2021;
      reference pick: the best by the same score among variants with >= 20 trades/yr,
        if not already picked.
  - Only the picks are then run once on Jan 2023 - Nov 2026.
Usage: python3 run_fx.py eurusd_m1_10y.csv
"""
import csv
import sys
import numpy as np
import pandas as pd
import core
from core import Data, run, stats, yearly, fmt
import families as F

PIP = 0.0001
ZAR_PER_USD = 18.0
ECB = {2016: -.4, 2017: -.4, 2018: -.4, 2019: -.45, 2020: -.5, 2021: -.5, 2022: .3,
       2023: 3.3, 2024: 3.6, 2025: 2.2, 2026: 2.0}       # rough ECB deposit rate, % per year


def eurusd_swap_pct(year, direction):
    gap = core.FF.get(year, 2.0) - ECB.get(year, 0.0)    # long EURUSD = hold EUR, borrow USD
    return max(0.0, (gap if direction > 0 else -gap) + 1.0)


core.COMMISSION = 0.00007
core.SWAP_FN = eurusd_swap_pct

d = Data(sys.argv[1])
cx = F.Ctx(d)
I = d.idx_of_utc
IS_LO, OOS_LO = I("2016-09-01"), I("2023-01-01")
C0, C1 = I("2020-01-01"), I("2022-01-01")

V = {}
for r_to in (480, 600):
    for tr in ("ema100", None):
        for ex in ("spec", "tp1.5"):
            V[f"Asian-range breakout to {r_to//60:02d}:00 trend={tr} {ex}"] = (lambda r_to=r_to, tr=tr, ex=ex: F.range_breakout_fx(cx, r_to, tr, ex))
for n in (20, 40, 55):
    V[f"Daily Donchian n{n} chand3"] = (lambda n=n: F.donchian_d1(cx, n=n, k_trail=3.0))
V["H1 Donchian n24 trail2"] = lambda: F.donchian_h1(cx, n=24, k_trail=2.0)
V["H1 Donchian n48 trail3"] = lambda: F.donchian_h1(cx, n=48, k_trail=3.0)
for th in (5, 10):
    V[f"RSI(2) daily <{th} both"] = (lambda th=th: F.connors_d1(cx, th=th, long_only=False))
for th in (5, 10):
    V[f"RSI(2) H4 <{th} both sma200"] = (lambda th=th: F.connors_h4(cx, th=th, long_only=False))
for band in (2.0, 2.5):
    V[f"Asian fade BB20 {band}sd"] = (lambda band=band: F.asian_fade(cx, band=band))
for tp in (1.5, 2.5):
    V[f"NY ORB ema100 tp{tp}"] = (lambda tp=tp: F.ny_orb(cx, tp_r=tp, trend="ema100"))
V["Intraday momentum thr0.5"] = lambda: F.intraday_momentum(cx, thr=0.5)
V["PDH/PDL ema100 tp2.5"] = lambda: F.pdhl_breakout(cx, tp_r=2.5)

print(f"EURUSD, {d.n:,} M1 bars. {len(V)} pre-registered variants.\n")
med_spread = np.median(d.ao - d.bo) / PIP
print(f"median spread {med_spread:.2f} pip; commission 0.7 pip round trip\n")
print(f"{'variant':44s} {'discovery 2016-22':>36s}   {'ex 2020-21':>15s}   {'stop':>6s}")
rows, keep = [], {}
for name, fn in V.items():
    tr = run(d, fn())
    keep[name] = tr
    is_ = [t for t in tr if IS_LO <= t.i0 < OOS_LO]
    a = stats(d, is_)
    b = stats(d, [t for t in is_ if not (C0 <= t.i0 < C1)])
    stop = np.median([t.R for t in is_]) / PIP if is_ else float("nan")
    rows.append((name, a, b, stop))
    print(f"{name:44s} n={a['n']:5d} PF {a['pf']:4.2f} /yr {a['tpy']:6.1f} DD {a['dd']:5.1f}%   n={b['n']:5d} PF {b['pf']:4.2f}   {stop:5.1f}p", flush=True)

hf = sorted([r for r in rows if r[1]["tpy"] >= 60 and r[1]["pf"] >= 1.10], key=lambda r: -r[2]["pf"])[:2]
ref = sorted([r for r in rows if r[1]["tpy"] >= 20 and r[2]["n"] > 0], key=lambda r: -r[2]["pf"])[:1]
picks = hf + [r for r in ref if r[0] not in [h[0] for h in hf]]
print(f"\n{len([r for r in rows if r[1]['tpy'] >= 60 and r[1]['pf'] >= 1.10])} variants meet >= 60 trades/yr and discovery PF >= 1.10.")
print("High-frequency picks:", ", ".join(p[0] for p in hf) or "none")
print("Reference pick (>= 20/yr):", ", ".join(p[0] for p in ref) or "none")

for name, a, b, stop in picks:
    tr = keep[name]
    oos = [t for t in tr if t.i0 >= OOS_LO]
    allx = [t for t in tr if t.i0 >= IS_LO and not (C0 <= t.i0 < C1)]
    so = stats(d, oos)
    print(f"\n=== {name} ===")
    print(f"discovery 2016-22     {fmt(a)}")
    print(f"discovery ex 2020-21  {fmt(b)}")
    print(f"OUT-OF-SAMPLE 2023-26 {fmt(so)}")
    print(f"10 yrs ex 2020-21     {fmt(stats(d, allx))}  ret={stats(d, allx)['ret']:+.0f}%")
    y = yearly(d, [t for t in tr if t.i0 >= IS_LO])
    print("by year (trades/PF): " + " ".join(f"{yy%100:02d}:{n}/{pf:.2f}" for yy, (n, pf) in y.items()))
    st = np.median([t.R for t in oos]) / PIP if oos else float("nan")
    for label, units in (("standard 0.01 lot (1,000 units)", 1000), ("cent/micro 0.01 lot (10 units)", 10)):
        loss = st * PIP * units * ZAR_PER_USD
        print(f"median stop {st:.1f} pips -> {label}: R{loss:,.2f} per stop; account for 0.5% risk R{loss/0.005:,.0f}, 1% R{loss/0.01:,.0f}")
    bal = 10000.0
    fn = "results/fx_trades_" + "".join(ch if ch.isalnum() else "_" for ch in name) + ".csv"
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
