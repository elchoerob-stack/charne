"""Failed-breakout FADE of the Asian range at the London open: Python replica backtest.

Rules (pre-registered before the first run):
- Asian range: M1 bars 00:00-07:00 London time; range 0.15-0.60x daily ATR(14).
- From 07:00, a "break" means an M1 high above range high + 1 pip (or low below range low - 1 pip).
- Signal: after a break, the first M1 CLOSE back inside the range, within 07:00-11:00.
  Fade it at the next bar's open (short after an upside break, long after a downside break).
- SL: beyond the extreme of the failed excursion + 1 pip. TP: 1.5R. Break-even at 1R.
  Flat by 16:00. One trade per day.
Fill/cost model and hardcoded risk are identical to lbo_backtest.py.

Usage: python fade_backtest.py <m1.csv> [--sweep]
"""
import argparse
import itertools
import numpy as np
import pandas as pd

from lbo_backtest import (BE_AT_R, MAX_DAILY_LOSS_PCT, MAX_DD_PCT, MAX_RISK_PCT,
                          MAX_SPREAD_SL_FRAC, MIN_UNITS, PIP, PIP_VALUE_PER_UNIT, RISK_PCT,
                          UNIT_STEP, daily_atr, load, split, stats)

DEFAULTS = dict(asia_start=0, asia_end=7, entry_end=11, exit_hour=16,
                min_range_atr=0.15, max_range_atr=0.60, buffer_pips=1.0, tp="1.5")


def run(df, balance0=10_000.0, commission_per_lot=7.0, kill_switch=True, **p):
    p = {**DEFAULTS, **p}
    o, h, l, c, sp = (df[k].to_numpy() for k in ("open", "high", "low", "close", "spread"))
    t = df.index
    hours = (t.hour + t.minute / 60).to_numpy()
    dates = t.normalize()
    datr = daily_atr(df).reindex(dates.unique())
    buf = p["buffer_pips"] * PIP

    bal = peak = balance0
    pos, trades, curve = None, [], []
    day = hi = lo = None
    up_ext = dn_ext = None
    traded, killed = False, False
    day_start_bal = balance0

    for j in range(1, len(df)):
        i = j - 1
        if dates[j] != day:
            day, hi, lo, traded, day_start_bal = dates[j], None, None, False, bal
            up_ext = dn_ext = None

        if pos is not None:
            buy = pos["side"] == 1
            exit_px = None
            if hours[j] >= p["exit_hour"] or dates[j] != pos["date"]:
                exit_px = o[j] if buy else o[j] + sp[j]
            elif buy:
                if l[j] <= pos["sl"]: exit_px = min(pos["sl"], o[j])
                elif h[j] >= pos["tp"]: exit_px = pos["tp"]
            else:
                if h[j] + sp[j] >= pos["sl"]: exit_px = max(pos["sl"], o[j] + sp[j])
                elif l[j] + sp[j] <= pos["tp"]: exit_px = pos["tp"]
            if exit_px is not None:
                pnl = (exit_px - pos["entry"]) * pos["side"] * pos["units"]
                pnl -= commission_per_lot * pos["units"] / 100_000
                bal += pnl
                trades.append(dict(entry_time=pos["t"], side=pos["side"], pnl=pnl,
                                   r=pnl / pos["risk_money"], sl_pips=pos["sl_pips"]))
                pos = None
            else:
                fav = (h[j] - pos["entry"]) if buy else (pos["entry"] - (l[j] + sp[j]))
                if fav >= pos["risk_dist"] * BE_AT_R:
                    be = pos["entry"] + pos["side"] * PIP
                    pos["sl"] = max(pos["sl"], be) if buy else min(pos["sl"], be)

        peak = max(peak, bal)
        curve.append(bal)
        if kill_switch and (peak - bal) / peak * 100 >= MAX_DD_PCT:
            killed = True
            break

        if dates[i] != day:
            continue
        if p["asia_start"] <= hours[i] < p["asia_end"]:
            hi = h[i] if hi is None else max(hi, h[i])
            lo = l[i] if lo is None else min(lo, l[i])
            continue
        if hi is None or hours[i] < p["asia_end"]:
            continue

        # track failed-break excursions (from London open until the window closes)
        if h[i] > hi + buf:
            up_ext = h[i] if up_ext is None else max(up_ext, h[i])
        if l[i] < lo - buf:
            dn_ext = l[i] if dn_ext is None else min(dn_ext, l[i])

        if pos is not None or traded or hours[i] >= p["entry_end"]:
            continue
        if (bal - day_start_bal) / day_start_bal * 100 <= -MAX_DAILY_LOSS_PCT:
            continue
        atr_d = datr.get(day, np.nan)
        rng = hi - lo
        if not (atr_d > 0) or not (p["min_range_atr"] * atr_d <= rng <= p["max_range_atr"] * atr_d):
            continue

        if up_ext is not None and c[i] < hi:
            side, sl = -1, up_ext + buf + sp[j]
        elif dn_ext is not None and c[i] > lo:
            side, sl = 1, dn_ext - buf
        else:
            continue
        traded = True
        entry = o[j] + sp[j] if side == 1 else o[j]
        sl_dist = (entry - sl) * side
        if sl_dist <= 0 or sp[j] > sl_dist * MAX_SPREAD_SL_FRAC:
            continue
        if p["tp"] == "opp":
            tp = hi if side == 1 else lo + sp[j]
        elif p["tp"] == "mid":
            tp = (hi + lo) / 2 + (0 if side == 1 else sp[j])
        else:
            tp = entry + side * float(p["tp"]) * sl_dist
        if (tp - entry) * side <= 0:
            continue
        sl_pips = sl_dist / PIP
        raw = bal * RISK_PCT / 100 / (sl_pips * PIP_VALUE_PER_UNIT)
        units = max(MIN_UNITS, np.floor(raw / UNIT_STEP) * UNIT_STEP)
        risk_money = units * sl_pips * PIP_VALUE_PER_UNIT
        if risk_money / bal * 100 > MAX_RISK_PCT:
            continue
        pos = dict(side=side, entry=entry, units=units, t=t[j], date=day, risk_dist=sl_dist,
                   risk_money=risk_money, sl_pips=sl_pips, sl=sl, tp=tp)

    return pd.DataFrame(trades), np.array(curve), killed


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("csv")
    ap.add_argument("--sweep", action="store_true")
    a = ap.parse_args()

    df = load(a.csv)
    cut = pd.Timestamp(df.index[0].year, 7, 1)

    tr, cv, killed = run(df)
    print("PRE-REGISTERED DEFAULTS, all risk rules on:", stats(tr, cv), "KILLED" if killed else "")
    ins, oos = split(tr, cut)
    print("  Jan-Jun:", ins)
    print("  Jul-Dec:", oos)

    d0 = df.copy(); d0["spread"] = 0
    tr00, _, _ = run(d0, commission_per_lot=0, kill_switch=False)
    dw = df.copy(); dw["spread"] += 0.3 * PIP
    trw, cvw, _ = run(dw, kill_switch=False)
    print("\nZero costs (raw edge):   ", stats(tr00))
    print("Spread +0.3 pip (stress):", stats(trw, cvw))

    if a.sweep:
        grid = dict(tp=("1.0", "1.5", "2.0", "3.0", "mid", "opp"),
                    max_range_atr=(0.4, 0.6, 0.8), entry_end=(10, 11, 13))
        rows = []
        for combo in itertools.product(*grid.values()):
            kw = dict(zip(grid, combo))
            t_, _, _ = run(df, kill_switch=False, **kw)
            ins, oos = split(t_, cut)
            rows.append({**kw, **{f"is_{k}": v for k, v in ins.items()},
                         **{f"oos_{k}": v for k, v in oos.items()}})
        res = pd.DataFrame(rows)
        res = res[res.is_trades >= 40].sort_values("is_pf", ascending=False)
        pd.set_option("display.width", 200)
        cols = list(grid) + ["is_trades", "is_pf", "is_avg_r", "oos_trades", "oos_pf", "oos_avg_r"]
        print("\nGrid ranked by IN-SAMPLE PF (Jan-Jun); OOS = Jul-Dec, never used for selection:")
        print(res[cols].head(12).to_string(index=False))
        print(f"\nShare of {len(res)} grid configs with OOS PF > 1.0: {(res.oos_pf > 1).mean():.0%}; "
              f"> 1.3: {(res.oos_pf > 1.3).mean():.0%}")
