"""Parity test: the C# PlanEngine (cbot/engine) must reproduce the Python model number for number.

Compares, for several past session closes: anchor, ATR, the 23-hour projected path and volatility profile, the 20 analog
days, projected high/low, analog 'up' share, range quantiles, the merged level ladder with touch odds, and both scenarios.
"""
import json
import subprocess
import sys

import numpy as np
import pandas as pd

import analysis as A
import targets as TG

ENGINE = "cbot/engine/parity/bin/Release/net8.0/Parity"


def session_closes(n_back):
    h1, sess = A.session_table(A.load("H_1", pd.Timestamp("2026-11-09T22:00:00Z")))
    return [str(sess.end.iloc[i] + pd.Timedelta(hours=1)) for i in n_back]


def reference(cut):
    cut = pd.Timestamp(cut)
    tfs = {p: A.analyse_tf(p, cut) for p in ("H_1", "H_4")}
    h1_all = A.load("H_1", cut)
    levels, day = A.key_levels(tfs, h1_all, None, cut)
    h1, sess = A.session_table(h1_all)
    li = len(sess) - 1
    fc = A.analog_forecast(h1, sess, li, pool_end=li)
    sig, _ = A.vol_profile(h1, sess, li)
    anc, atr = float(sess.c[li]), float(sess.atr[li])
    hi, lo = zip(*[A.outcome(h1, sess, d)[1:] for d in range(li - TG.TRAIL, li)])
    th, tl = np.array(hi), np.array(lo)
    R = dict(levels=levels, day=day, anchor=anc, atr_now=atr)
    lv = TG.merged_levels(R)
    bull, bear = TG.scenario_plan(R, th, tl)
    return dict(anchor=anc, atr=atr, p_up=fc["p_up"], proj_high=anc + fc["hi"] * atr, proj_low=anc + fc["lo"] * atr,
                center=fc["center"], sigma=sig, range_q=np.quantile((th - tl) * atr, [.1, .25, .5, .75, .9]),
                analogs=[f"{sess.start[p['d']]:%Y-%m-%d %H:%M}" for p in fc["picks"]],
                levels=[(L["price"], round(TG.p_touch((L["price"] - anc) / atr, th, tl), 3)) for L in lv],
                bull=bull, bear=bear)


def structure_parity():
    """The C# StructureWalk (lower-timeframe structure for the MTF line and the early exit) against contsim.structure_events
    on real 5-minute bars: identical breaks from a full walk, and from a late start after a 600-bar warm-up (the bot starts
    its walk 600 bars back, not at the beginning of history)."""
    import contsim as C
    path = "data/XAUUSD_M_5_hist.csv"
    m5 = pd.read_csv(path)
    up, dn = C.structure_events(m5.high.values, m5.low.values, m5.close.values, 3)
    ref_up, ref_dn = set(np.flatnonzero(up).tolist()), set(np.flatnonzero(dn).tolist())
    ok = True
    for start in (0, 20000, 41234):
        out = subprocess.run([ENGINE, "structure", path, str(start)], capture_output=True, text=True)
        if out.returncode != 0:
            sys.exit(out.stderr)
        c = json.loads(out.stdout)
        frm = start + (600 if start else 0)
        same = {i for i in c["up"] if i >= frm} == {i for i in ref_up if i >= frm} and {i for i in c["dn"] if i >= frm} == {i for i in ref_dn if i >= frm}
        ok &= same
        print(f"structure walk from bar {start}: {len(c['up'])} up / {len(c['dn'])} down breaks; identical to Python from bar {frm} on: {'PASS' if same else 'FAIL'}")
    return ok


if __name__ == "__main__":
    if not structure_parity():
        sys.exit("STRUCTURE PARITY FAIL")
    cuts = session_closes(list(range(-1, -241, -12)))     # 20 closes, last close back to ~11 months ago
    out = subprocess.run([ENGINE, "data"] + cuts, capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(out.stderr)
    cs = {c["cutoff"]: c for c in json.loads(out.stdout)}
    worst, ok_all = 0.0, True
    for cut in cuts:
        r, c = reference(cut), cs[cut]
        diffs = [abs(r[k] - c[k]) for k in ("anchor", "atr", "p_up", "proj_high", "proj_low")]
        diffs += list(np.abs(np.array(r["center"]) - c["center"])) + list(np.abs(np.array(r["sigma"]) - c["sigma"]))
        diffs += list(np.abs(np.array(r["range_q"]) - c["range_q"]))
        lv_ok = r["levels"] == [(l["price"], l["p_touch"]) for l in c["levels"]]
        an_ok = r["analogs"] == c["analogs"]
        sc_ok = all(r[s]["trigger"] == c[s]["trigger"] and r[s]["invalidation"] == c[s]["inval"]
                    and [(t["price"], t["p_touch"]) for t in r[s]["targets"]] == [(t["price"], t["p_touch"]) for t in c[s]["targets"]]
                    for s in ("bull", "bear"))
        md = max(diffs)
        worst = max(worst, md)
        ok = md < 1e-6 and lv_ok and an_ok and sc_ok
        ok_all &= ok
        print(f"{cut}: max numeric diff {md:.2e} | analogs {'=' if an_ok else 'DIFF'} | {len(c['levels'])} levels {'=' if lv_ok else 'DIFF'} "
              f"| scenarios {'=' if sc_ok else 'DIFF'} | C# {c['ms']} ms -> {'PASS' if ok else 'FAIL'}")
        if not lv_ok:
            print("   py:", r["levels"]); print("   c#:", [(l["price"], l["p_touch"]) for l in c["levels"]])
        if not sc_ok:
            print("   py bull/bear:", r["bull"]["trigger"], r["bear"]["trigger"], " c#:", c["bull"]["trigger"], c["bear"]["trigger"])
    print(f"\nPARITY {'PASS' if ok_all else 'FAIL'} on {len(cuts)} closes; worst numeric difference {worst:.2e}")
    sys.exit(0 if ok_all else 1)
