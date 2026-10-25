"""Bar-by-bar Python replica of LondonBreakoutBot.cs for backtesting on M1 data.

Input: MT5 M1 export (tab-separated, bid prices, spread in points) whose server time
is "New York close" (UTC+2 winter / UTC+3 summer). Times are converted to London
local time, matching the cBot's TimeZones.GMTStandardTime.

Fill model (deliberately conservative):
- Breakout is confirmed on an M1 close; entry fills at the next bar's open (OnBar).
  Buys pay the ask.
- Buy exits trigger on bid, sell exits on ask.
- If SL and TP are both inside one M1 bar, the SL is assumed to hit first.
- Break-even moves only take effect from the next bar.
- Commission is charged per round turn per 100k units.

Usage: python lbo_backtest.py <m1.csv> [--sweep]
"""
import argparse
import itertools
import numpy as np
import pandas as pd

# ---- Hardcoded risk (mirrors the C# constants) ----
RISK_PCT, MAX_RISK_PCT = 1.0, 2.0
MAX_DAILY_LOSS_PCT, MAX_DD_PCT = 3.0, 20.0
MAX_SPREAD_SL_FRAC = 0.10
BE_AT_R = 1.0

PIP = 0.0001
PIP_VALUE_PER_UNIT = 0.0001
MIN_UNITS, UNIT_STEP = 1000, 1000

DEFAULTS = dict(asia_start=0, asia_end=7, entry_end=10, exit_hour=16,
                min_range_atr=0.15, max_range_atr=0.60, buffer_pips=1.0, tp_r=1.5,
                sl_mode="range")


def load(path):
    df = pd.read_csv(path, sep="\t")
    df.columns = [c.strip("<>").lower() for c in df.columns]
    server = pd.to_datetime(df["date"] + " " + df["time"], format="%Y.%m.%d %H:%M:%S")
    ny = (server - pd.Timedelta(hours=7)).dt.tz_localize("America/New_York", ambiguous="NaT",
                                                         nonexistent="NaT")
    df.index = ny.dt.tz_convert("Europe/London").dt.tz_localize(None)
    df = df[df.index.notna()]
    df = df[~df.index.duplicated()]
    df["spread"] = df["spread"] * 0.1 * PIP
    return df[["open", "high", "low", "close", "spread"]]


def daily_atr(df, n=14):
    d = df.resample("1D").agg(dict(high="max", low="min", close="last")).dropna()
    pc = d.close.shift()
    tr = pd.concat([d.high - d.low, (d.high - pc).abs(), (d.low - pc).abs()], axis=1).max(axis=1)
    # value usable ON each day = ATR as of the previous closed day (Last(1))
    return tr.rolling(n).mean().shift(1)


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
    day = None
    hi = lo = None
    traded = False
    day_start_bal = balance0
    killed = False

    for j in range(1, len(df)):
        i = j - 1
        if dates[j] != day:
            day, hi, lo, traded, day_start_bal = dates[j], None, None, False, bal

        # ---- manage open position on bar j ----
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

        # ---- build Asian range from closed bar i (same day) ----
        if dates[i] == day and p["asia_start"] <= hours[i] < p["asia_end"]:
            hi = h[i] if hi is None else max(hi, h[i])
            lo = l[i] if lo is None else min(lo, l[i])
            continue

        # ---- breakout entry: closed bar i inside entry window, enter at bar j open ----
        if pos is not None or traded or hi is None or dates[i] != day:
            continue
        if not (p["asia_end"] <= hours[i] < p["entry_end"]):
            continue
        if (bal - day_start_bal) / day_start_bal * 100 <= -MAX_DAILY_LOSS_PCT:
            continue
        atr_d = datr.get(day, np.nan)
        rng = hi - lo
        if not (atr_d > 0) or not (p["min_range_atr"] * atr_d <= rng <= p["max_range_atr"] * atr_d):
            continue

        side = 1 if c[i] > hi + buf else -1 if c[i] < lo - buf else 0
        if side == 0:
            continue
        traded = True  # one attempt per day, even if skipped by a gate below
        entry = o[j] + sp[j] if side == 1 else o[j]
        if p["sl_mode"] == "range":
            sl = lo - buf if side == 1 else hi + buf + sp[j]
        else:  # "mid": stop at the middle of the range
            mid = (hi + lo) / 2
            sl = mid if side == 1 else mid + sp[j]
        sl_dist = (entry - sl) * side
        if sl_dist <= 0 or sp[j] > sl_dist * MAX_SPREAD_SL_FRAC:
            continue
        sl_pips = sl_dist / PIP
        raw = bal * RISK_PCT / 100 / (sl_pips * PIP_VALUE_PER_UNIT)
        units = max(MIN_UNITS, np.floor(raw / UNIT_STEP) * UNIT_STEP)
        risk_money = units * sl_pips * PIP_VALUE_PER_UNIT
        if risk_money / bal * 100 > MAX_RISK_PCT:
            continue
        pos = dict(side=side, entry=entry, units=units, t=t[j], date=day, risk_dist=sl_dist,
                   risk_money=risk_money, sl_pips=sl_pips, sl=sl,
                   tp=entry + side * p["tp_r"] * sl_dist)

    tr = pd.DataFrame(trades)
    return tr, np.array(curve), killed


def stats(tr, curve=None):
    if tr.empty:
        return dict(trades=0)
    g, lo = tr.pnl[tr.pnl > 0].sum(), -tr.pnl[tr.pnl < 0].sum()
    out = dict(trades=len(tr), win=round((tr.pnl > 0).mean() * 100, 1),
               pf=round(g / lo, 2) if lo else float("inf"), avg_r=round(tr.r.mean(), 3),
               sum_r=round(tr.r.sum(), 1), med_sl_pips=round(tr.sl_pips.median(), 1))
    if curve is not None and len(curve):
        pk = np.maximum.accumulate(curve)
        out["max_dd_pct"] = round(((pk - curve) / pk).max() * 100, 1)
        out["net_pct"] = round((curve[-1] / curve[0] - 1) * 100, 1)
    return out


def split(tr, cut):
    return stats(tr[tr.entry_time < cut]), stats(tr[tr.entry_time >= cut])


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("csv")
    ap.add_argument("--sweep", action="store_true")
    a = ap.parse_args()

    df = load(a.csv)
    cut = pd.Timestamp(df.index[0].year, 7, 1)
    print(f"Data: {df.index[0]} -> {df.index[-1]} London time, {len(df):,} M1 bars")

    tr, cv, killed = run(df)
    print("\nPRE-REGISTERED DEFAULTS, all risk rules on:", stats(tr, cv), "KILLED" if killed else "")
    ins, oos = split(tr, cut)
    print("  Jan-Jun:", ins)
    print("  Jul-Dec:", oos)

    tr0, _, _ = run(df, commission_per_lot=0, kill_switch=False)
    d0 = df.copy(); d0["spread"] = 0
    tr00, _, _ = run(d0, commission_per_lot=0, kill_switch=False)
    dw = df.copy(); dw["spread"] += 0.3 * PIP
    trw, cvw, _ = run(dw, kill_switch=False)
    print("\nZero costs (raw edge):   ", stats(tr00))
    print("Spread +0.3 pip (stress):", stats(trw, cvw))

    if a.sweep:
        grid = dict(tp_r=(1.0, 1.5, 2.0, 3.0), sl_mode=("range", "mid"),
                    max_range_atr=(0.4, 0.6, 0.8), entry_end=(9, 10, 12))
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
