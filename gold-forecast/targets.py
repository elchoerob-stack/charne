"""Pre-registered targets for the forecast day.

Everything is computed from the same frozen snapshot as the projection (bars
closed by the cutoff), then written to targets_<day>.json with a SHA-256
fingerprint of both files, so the targets cannot be quietly moved later.

  * level touch probabilities  P(the session trades through a level), from how
                               far gold travelled from the prior close over the
                               last 250 sessions (in daily-ATR units)
  * scenario plan              bull / bear triggers, targets and invalidation,
                               built from the key-level clusters
  * pass/fail tests T1-T8      each with a numeric threshold and the share of
                               the last 200 days on which it would have passed
"""
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd

import analysis as A

HERE = Path(__file__).parent
TRAIL = 250                                   # sessions behind each probability
GRID = [0.1, 0.2, 0.3, 0.5, 0.75, 1.0, 1.25, 1.5]
MODEL_VERSION = "analog-v1.0"


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def outcomes(h1, sess):
    """hi / lo / range of session d+1 measured from session d's close, in ATR(d) units."""
    hi = np.full(len(sess), np.nan)
    lo = np.full(len(sess), np.nan)
    for d in range(len(sess) - 1):
        _, hi[d], lo[d] = A.outcome(h1, sess, d)
    return hi, lo


def p_touch(dist, hi, lo):
    """dist in ATR units, + above the close / - below."""
    return float(np.mean(hi >= dist)) if dist >= 0 else float(np.mean(-lo >= -dist))


def calibration(h1, sess, last_i, hi, lo, bt_days=200):
    """Walk-forward check of the touch probabilities on a fixed distance grid."""
    rows = []
    for t in range(last_i - bt_days, last_i):
        th, tl = hi[t - TRAIL:t], lo[t - TRAIL:t]               # outcomes known at the end of t
        for x in GRID:
            for s in (1, -1):
                p = p_touch(s * x, th, tl)
                hit = hi[t] >= x if s > 0 else -lo[t] >= x
                rows.append(dict(t=t, x=s * x, p=p, hit=float(hit)))
    df = pd.DataFrame(rows)
    df["bin"] = np.minimum((df.p * 10).astype(int), 9)
    rel = df.groupby("bin").agg(n=("p", "size"), pred=("p", "mean"), actual=("hit", "mean")).reset_index()
    day_brier = df.assign(se=(df.p - df.hit) ** 2).groupby("t").se.mean()
    return df, rel, day_brier


def merged_levels(R, max_atr=1.5):
    """Key levels + daily pivots, merged when within $0.75, limited to +-1.5 ATR of the anchor."""
    d = R["day"]
    P = (d["pdh"] + d["pdl"] + d["pdc"]) / 3
    piv = {"Daily pivot P": P, "Daily pivot R1": 2 * P - d["pdl"], "Daily pivot S1": 2 * P - d["pdh"],
           "Daily pivot R2": P + d["pdh"] - d["pdl"], "Daily pivot S2": P - (d["pdh"] - d["pdl"])}
    L = [(x["level"], x["price"]) for x in R["levels"] if not x["level"].startswith("PDC")]
    L += list(piv.items())
    L.sort(key=lambda x: x[1])
    out = []
    for name, px in L:
        if abs(px - R["anchor"]) > max_atr * R["atr_now"] or abs(px - R["anchor"]) < 0.01:
            continue
        if out and abs(px - out[-1]["price"]) <= 0.75:
            out[-1]["names"].append(name)
            continue
        out.append(dict(price=round(float(px), 2), names=[name]))
    return out


def level_by(R, prefix):
    return next(x["price"] for x in R["levels"] if x["level"].startswith(prefix))


def build_targets(R, forecast_json):
    h1, sess, li = R["h1"], R["sess"], R["last_i"]
    atr, anc = float(R["atr_now"]), float(R["anchor"])
    hi, lo = outcomes(h1, sess)
    th, tl = hi[li - TRAIL:li], lo[li - TRAIL:li]               # trailing 250 sessions, all known

    # --- level touch probabilities
    levels = []
    for L in merged_levels(R):
        dist = (L["price"] - anc) / atr
        levels.append(dict(price=L["price"], label=" / ".join(L["names"]), dist=round(L["price"] - anc, 2),
                           dist_atr=round(dist, 3), side="above" if dist > 0 else "below",
                           p_touch=round(p_touch(dist, th, tl), 3)))
    levels.sort(key=lambda x: -x["price"])

    # --- daily range distribution
    rng = (th - tl) * atr
    q = {k: float(np.quantile(rng, v)) for k, v in (("q10", .1), ("q25", .25), ("q50", .5), ("q75", .75), ("q90", .9))}

    # --- scenario plan (from the resistance / support clusters around the anchor)
    bear_fvg = [g for g in R["tfs"]["H_4"]["gaps"] if g["side"] == "Bearish" and g["state"] != "filled"
                and anc < g["top"] < anc + 0.5 * atr]
    bull_fvg = [g for g in R["tfs"]["H_1"]["gaps"] if g["side"] == "Bullish" and g["state"] != "filled"
                and anc - 0.5 * atr < g["top"] < anc]
    res_top = round(max([g["top"] for g in bear_fvg] + [level_by(R, "PDH")]), 2)
    near = max(bull_fvg, key=lambda g: g["top"]) if bull_fvg else None       # nearest support gap below
    sup_top = round(min(([near["top"]] if near else []) + [level_by(R, "Asia session high")]), 2)
    sup_mid = round((near["top"] + near["bottom"]) / 2, 2) if near else round(sup_top - 10, 2)
    d = R["day"]
    P = (d["pdh"] + d["pdl"] + d["pdc"]) / 3
    r1 = round(2 * P - d["pdl"], 2)
    swings_above = sorted(x["price"] for x in R["levels"] if x["level"].startswith("4h swing high") and x["price"] > res_top)
    swings_below = sorted((x["price"] for x in R["levels"] if x["level"].startswith("1h swing low") and x["price"] < sup_mid),
                          reverse=True)

    def tgt(name, px):
        return dict(name=name, price=round(float(px), 2), p_touch=round(p_touch((px - anc) / atr, th, tl), 3))

    scenarios = [
        dict(key="bull", name="Bull - break and hold above the resistance cluster",
             why=f"Every intraday timeframe is bullish (weighted +5.7). Acceptance above {res_top:.2f} (top of the 4h bearish FVG, "
                 "above PDH and PWH) would mean Monday's sweep of the previous-week high was continuation, not a trap.",
             trigger=dict(rule="1h candle CLOSES above", price=float(res_top)),
             targets=[tgt("T1 daily pivot R1", r1), tgt("T2 4h swing high", swings_above[0]),
                      tgt("T3 4h swing high / 4,200", swings_above[1] if len(swings_above) > 1 else 4200)],
             invalidation=dict(rule="after trigger, 1h close back below PWH", price=round(float(level_by(R, "PWH")), 2))),
        dict(key="bear", name="Bear - PWH sweep fails, price rotates back down",
             why=f"Monday swept PWH {level_by(R, 'PWH'):.2f} by $1.65 and closed back below it, into the daily EMA50 "
                 "(~4,154) with the daily trend still down. Losing the 1h FVG top would confirm a buy-side liquidity grab.",
             trigger=dict(rule="1h candle CLOSES below", price=float(sup_top)),
             targets=[tgt("T1 1h bullish FVG midpoint", sup_mid), tgt("T2 daily pivot P", P),
                      tgt("T3 NY low / 1h swing low", swings_below[0] if swings_below else 4100)],
             invalidation=dict(rule="after trigger, 1h close back above PDH", price=round(float(d["pdh"]), 2))),
    ]
    neutral = dict(name="Neutral - no trigger by the London close (17:00 SAST)",
                   rule=f"Price rotates between {sup_top:.2f} and {res_top:.2f}; the CPI print at 15:30 is the likely catalyst.")

    # --- pass/fail tests with historical pass rates on the same backtest days
    F = json.loads(Path(forecast_json).read_text())
    bt = R["bt"].copy()
    _, rel, day_brier = calibration(h1, sess, li, hi, lo)
    t_idx = range(li - len(bt), li)
    bt["t5"] = (bt.act_hi - bt.fc_hi).abs() <= 0.25
    bt["t6"] = (bt.act_lo - bt.fc_lo).abs() <= 0.25
    qs = [np.quantile(hi[t - TRAIL:t] - lo[t - TRAIL:t], [.1, .9]) for t in t_idx]
    bt["t8"] = [(q_[0] <= hi[t] - lo[t] <= q_[1]) for q_, t in zip(qs, t_idx)]
    bt["t7"] = [day_brier[t] < 0.25 for t in t_idx]
    bt["t1"], bt["t2"] = bt.mae < bt.mae_rw, bt.cov50.between(0.25, 0.75)
    bt["t3"], bt["t4"] = bt.cov80 >= 0.6, bt.dir_hit.astype(bool)
    passes = bt[[f"t{i}" for i in range(1, 9)]].sum(axis=1)
    proj_close = anc + F["projected_move"][-1]
    tests = [
        dict(id="T1", name="Path beats a random walk", rule="mean |error| / random-walk |error| < 1.00", lo=None, hi=1.0),
        dict(id="T2", name="50% band is calibrated", rule="25% to 75% of hourly closes inside the 50% band", lo=.25, hi=.75),
        dict(id="T3", name="80% band holds", rule="at least 60% of hourly closes inside the 80% band", lo=.6, hi=None),
        dict(id="T4", name="Day direction", rule=f"session closes {'above' if proj_close > anc else 'below'} the anchor {anc:,.2f}",
             lo=anc if proj_close > anc else None, hi=None if proj_close > anc else anc),
        dict(id="T5", name="Projected high", rule=f"session high within +-0.25 ATR (${0.25 * atr:.2f}) of {F['proj_high']:,.2f}",
             lo=round(F["proj_high"] - .25 * atr, 2), hi=round(F["proj_high"] + .25 * atr, 2)),
        dict(id="T6", name="Projected low", rule=f"session low within +-0.25 ATR (${0.25 * atr:.2f}) of {F['proj_low']:,.2f}",
             lo=round(F["proj_low"] - .25 * atr, 2), hi=round(F["proj_low"] + .25 * atr, 2)),
        dict(id="T7", name="Level touch probabilities beat a coin flip", rule="Brier score of the level table < 0.25", lo=None, hi=.25),
        dict(id="T8", name="Day range inside the 80% range band",
             rule=f"session high - low between ${q['q10']:.0f} and ${q['q90']:.0f}", lo=round(q["q10"], 2), hi=round(q["q90"], 2)),
    ]
    for i, t in enumerate(tests, 1):
        t["hist_pass"] = round(float(bt[f"t{i}"].mean()), 3)
    out = dict(model_version=MODEL_VERSION, created_utc=str(pd.Timestamp.now(tz="UTC").floor("s")),
               cutoff_utc=str(R["cutoff"]), anchor=anc, atr=atr, trail_sessions=TRAIL,
               levels=levels, range_quantiles=q, scenarios=scenarios, neutral=neutral, tests=tests,
               overall_rule="Par is 5 of 8 (the 200-day average). 6+ = better than a typical day, 5 = par, 4 or fewer = below par",
               hist_overall=round(float((passes >= 5).mean()), 3),
               hist_mean_passes=round(float(passes.mean()), 2),
               hist_pass_counts={str(k): round(float((passes == k).mean()), 3) for k in range(9)},
               calibration=rel.round(3).to_dict(orient="records"),
               calibration_brier=round(float(day_brier.mean()), 4),
               forecast_sha256=sha(forecast_json))
    return out


if __name__ == "__main__":
    import sys
    cutoff = sys.argv[1] if len(sys.argv) > 1 else "2026-11-09T22:00:00Z"
    R = A.run(cutoff)
    fj = HERE / "forecast_2026-11-10.json"
    T = build_targets(R, fj)
    p = HERE / "targets_2026-11-10.json"
    p.write_text(json.dumps(T, indent=1))
    print("targets sha256", sha(p))
    for L in T["levels"]:
        print(f"{L['price']:9.2f} {L['dist']:+8.2f} p={L['p_touch']:.2f}  {L['label'][:90]}")
    print(json.dumps(T["range_quantiles"]))
    for s in T["scenarios"]:
        print(s["name"], s["trigger"], [(x["name"], x["price"], x["p_touch"]) for x in s["targets"]], s["invalidation"])
    for t in T["tests"]:
        print(t["id"], t["name"], "|", t["rule"], "| hist", t["hist_pass"])
    print("hist >=5/8:", T["hist_overall"], "mean passes", T["hist_mean_passes"], "calib brier", T["calibration_brier"])
    print("pass-count distribution", T["hist_pass_counts"])
    print(pd.DataFrame(T["calibration"]).to_string())
