"""Python replica backtest of H4TrendBot.cs: H4 Donchian breakout with EMA trend filter
and ATR chandelier trailing stop. Signals on H4 closes, exits simulated on M1 bars.

Rules (pre-registered before the first run):
- Trend: H4 EMA50 above EMA200 for longs (below for shorts).
- Entry: H4 close above the highest high of the previous 20 H4 bars (below the lowest
  low for shorts); market order at the next bar's open.
- Initial stop: 2 x ATR(14) from entry. No take profit.
- Trailing: after each H4 close, stop = max(stop, highest high since entry - 3 x ATR)
  (mirror for shorts). Stops are never loosened.
- One position at a time; 1% risk per trade.

Inputs (bid M1 bars, converted to broker "server" time = New York + 7h, so H4 bars
start at 00/04/08/12/16/20 server time like a NY-close cTrader broker):
- eurusd: HistData CSV(s) ("YYYYMMDD HHMMSS;O;H;L;C;V", EST without DST)
- xauusd: per-day CSVs (timestamp,datetime_utc,open,high,low,close,volume), UTC
Costs per instrument (see INSTRUMENTS): fixed spread (the data has no spread column),
commission per round turn, and a conservative swap charged per night held, both sides.

Usage: python h4_backtest.py --symbol eurusd <m1_2020.csv> <m1_2021.csv> ... [--sweep]
       python h4_backtest.py --symbol xauusd "<dir>/XAUUSD/1m/*/*/*.csv" --end 2024-12-31 [--sweep]
"""
import argparse
import itertools
import numpy as np
import pandas as pd

RISK_PCT, MAX_RISK_PCT, MAX_DD_PCT = 1.0, 2.0, 20.0

# pip = cTrader PipSize; pip value per unit is in USD; commission is USD per unit round turn.
INSTRUMENTS = {
    "eurusd": dict(pip=0.0001, pip_value=0.0001, min_units=1000, unit_step=1000,
                   spread_pips=0.3, swap_pips=0.5, commission_per_unit=7.0 / 100_000),
    # gold: 1 unit = 1 oz, 0.01 lot = 1 oz. Spread $0.30, swap $0.20/oz/night,
    # commission $7 per 100 oz round turn.
    "xauusd": dict(pip=0.01, pip_value=0.01, min_units=1, unit_step=1,
                   spread_pips=30, swap_pips=20, commission_per_unit=7.0 / 100),
}

DEFAULTS = dict(fast=50, slow=200, donchian=20, atr_n=14, sl_atr=2.0, trail_atr=3.0)


def load(paths, symbol):
    parts = []
    for p in paths:
        if symbol == "eurusd":
            d = pd.read_csv(p, sep=";", header=None, names=["ts", "open", "high", "low", "close", "v"])
            d.index = pd.to_datetime(d.ts, format="%Y%m%d %H%M%S") + pd.Timedelta(hours=7)
        else:
            d = pd.read_csv(p, usecols=["datetime_utc", "open", "high", "low", "close"])
            utc = pd.to_datetime(d.datetime_utc).dt.tz_localize("UTC")
            d.index = (utc.dt.tz_convert("America/New_York").dt.tz_localize(None)
                       + pd.Timedelta(hours=7)).to_numpy()
        parts.append(d[["open", "high", "low", "close"]])
    df = pd.concat(parts).sort_index()
    return df[~df.index.duplicated()]


def to_h4(m1):
    # index is broker server time (NY close = midnight), so plain 4h bins match cTrader H4
    return m1.resample("4h", label="left", closed="left").agg(
        dict(open="first", high="max", low="min", close="last")).dropna()


def indicators(h4, p):
    c = h4.close
    out = pd.DataFrame(index=h4.index)
    out["fast"] = c.ewm(span=p["fast"], adjust=False).mean()
    out["slow"] = c.ewm(span=p["slow"], adjust=False).mean()
    pc = c.shift()
    tr = pd.concat([h4.high - h4.low, (h4.high - pc).abs(), (h4.low - pc).abs()], axis=1).max(axis=1)
    out["atr"] = tr.rolling(p["atr_n"]).mean()
    out["dc_hi"] = h4.high.shift(1).rolling(p["donchian"]).max()
    out["dc_lo"] = h4.low.shift(1).rolling(p["donchian"]).min()
    return out


def run(m1, symbol="eurusd", cost_mult=1.0, balance0=10_000.0, kill_switch=True, **p):
    p = {**DEFAULTS, **p}
    ins = INSTRUMENTS[symbol]
    PIP, PIP_VALUE_PER_UNIT = ins["pip"], ins["pip_value"]
    MIN_UNITS, UNIT_STEP = ins["min_units"], ins["unit_step"]
    spread_pips = ins["spread_pips"] * cost_mult
    swap_pips_per_night = ins["swap_pips"] * cost_mult
    commission_per_unit = ins["commission_per_unit"] * cost_mult
    h4 = to_h4(m1)
    ind = indicators(h4, p)
    sp = spread_pips * PIP

    # M1 arrays, and for each M1 bar the index of the H4 bar it belongs to
    mt = m1.index.to_numpy()
    mo, mh, ml = (m1[k].to_numpy() for k in ("open", "high", "low"))
    h4_start = h4.index.to_numpy()
    m_h4 = np.searchsorted(h4_start, mt, side="right") - 1
    first_m1_of_h4 = np.searchsorted(mt, h4_start, side="left")

    bal = peak = balance0
    pos, trades, curve = None, [], []
    killed = False
    warm = p["slow"] + p["donchian"]
    hh, hc = h4.high.to_numpy(), h4.close.to_numpy()
    hl = h4.low.to_numpy()
    f, s, a = ind.fast.to_numpy(), ind.slow.to_numpy(), ind.atr.to_numpy()
    dch, dcl = ind.dc_hi.to_numpy(), ind.dc_lo.to_numpy()

    for k in range(warm, len(h4) - 1):
        # 1) walk M1 bars of H4 bar k to check stops
        lo_i, hi_i = first_m1_of_h4[k], first_m1_of_h4[k + 1]
        if pos is not None:
            for m in range(lo_i, hi_i):
                buy = pos["side"] == 1
                hit = (ml[m] <= pos["sl"]) if buy else (mh[m] + sp >= pos["sl"])
                if hit:
                    px = min(pos["sl"], mo[m]) if buy else max(pos["sl"], mo[m] + sp)
                    nights = (mt[m] - pos["t"]) / np.timedelta64(1, "D")
                    pnl = (px - pos["entry"]) * pos["side"] * pos["units"]
                    pnl -= commission_per_unit * pos["units"]
                    pnl -= swap_pips_per_night * np.floor(nights) * PIP_VALUE_PER_UNIT * pos["units"]
                    bal += pnl
                    trades.append(dict(entry_time=pd.Timestamp(pos["t"]), side=pos["side"], pnl=pnl,
                                       r=pnl / pos["risk_money"], bars=k - pos["k"], nights=np.floor(nights)))
                    pos = None
                    break

        peak = max(peak, bal)
        curve.append(bal)
        if kill_switch and (peak - bal) / peak * 100 >= MAX_DD_PCT:
            killed = True
            break

        # 2) at H4 close k: trail the stop
        if pos is not None:
            if pos["side"] == 1:
                pos["ext"] = max(pos["ext"], hh[k])
                pos["sl"] = max(pos["sl"], pos["ext"] - p["trail_atr"] * a[k])
            else:
                pos["ext"] = min(pos["ext"], hl[k])
                pos["sl"] = min(pos["sl"], pos["ext"] + p["trail_atr"] * a[k] + sp)
            continue

        # 3) at H4 close k: entry signal, fill at the open of bar k+1
        side = 0
        if f[k] > s[k] and hc[k] > dch[k]:
            side = 1
        elif f[k] < s[k] and hc[k] < dcl[k]:
            side = -1
        if side == 0 or not a[k] > 0:
            continue
        m_next = first_m1_of_h4[k + 1]
        if m_next >= len(mo):
            break
        entry = mo[m_next] + (sp if side == 1 else 0)
        sl_dist = p["sl_atr"] * a[k]
        sl_pips = sl_dist / PIP
        raw = bal * RISK_PCT / 100 / (sl_pips * PIP_VALUE_PER_UNIT)
        units = max(MIN_UNITS, np.floor(raw / UNIT_STEP) * UNIT_STEP)
        risk_money = units * sl_pips * PIP_VALUE_PER_UNIT
        if risk_money / bal * 100 > MAX_RISK_PCT:
            continue
        pos = dict(side=side, entry=entry, units=units, t=mt[m_next], k=k + 1,
                   risk_money=risk_money, sl=entry - side * sl_dist,
                   ext=entry - (sp if side == 1 else 0))

    return pd.DataFrame(trades), np.array(curve), killed, h4


def stats(tr, curve=None):
    if tr.empty:
        return dict(trades=0)
    g, lo = tr.pnl[tr.pnl > 0].sum(), -tr.pnl[tr.pnl < 0].sum()
    out = dict(trades=len(tr), win=round((tr.pnl > 0).mean() * 100, 1),
               pf=round(g / lo, 2) if lo else float("inf"), avg_r=round(tr.r.mean(), 3),
               sum_r=round(tr.r.sum(), 1), best_r=round(tr.r.max(), 1),
               avg_bars=round(tr.bars.mean(), 1))
    if curve is not None and len(curve):
        pk = np.maximum.accumulate(curve)
        out["max_dd_pct"] = round(((pk - curve) / pk).max() * 100, 1)
        out["net_pct"] = round((curve[-1] / curve[0] - 1) * 100, 1)
    return out


if __name__ == "__main__":
    import glob
    ap = argparse.ArgumentParser()
    ap.add_argument("csv", nargs="+", help="files or glob patterns")
    ap.add_argument("--symbol", default="eurusd", choices=sorted(INSTRUMENTS))
    ap.add_argument("--end", help="drop data after this date (e.g. incomplete months)")
    ap.add_argument("--split-year", type=int, help="first out-of-sample year (default: middle)")
    ap.add_argument("--sweep", action="store_true")
    a = ap.parse_args()

    files = sorted(f for pat in a.csv for f in glob.glob(pat))
    m1 = load(files, a.symbol)
    if a.end:
        m1 = m1[m1.index < pd.Timestamp(a.end) + pd.Timedelta(days=1)]
    sym = dict(symbol=a.symbol)
    tr, cv, killed, h4 = run(m1, **sym)
    years = sorted(tr.entry_time.dt.year.unique())
    split = a.split_year or years[len(years) // 2]
    print(f"{a.symbol}: {m1.index[0]} -> {m1.index[-1]} server time, {len(m1):,} M1 bars, "
          f"{len(h4):,} H4 bars. In-sample < {split} <= out-of-sample")
    print("\nPRE-REGISTERED DEFAULTS:", stats(tr, cv), "KILLED" if killed else "")
    print("  in-sample    :", stats(tr[tr.entry_time.dt.year < split]))
    print("  out-of-sample:", stats(tr[tr.entry_time.dt.year >= split]))
    for y in years:
        print(f"  {y}:", stats(tr[tr.entry_time.dt.year == y]))

    t0, _, _, _ = run(m1, cost_mult=0, kill_switch=False, **sym)
    tw, cw, _, _ = run(m1, cost_mult=2, kill_switch=False, **sym)
    print("\nZero costs (raw edge):", stats(t0))
    print("Double all costs:     ", stats(tw, cw))

    if a.sweep:
        grid = dict(donchian=(10, 20, 40, 55), sl_atr=(1.5, 2.0, 3.0), trail_atr=(2.0, 3.0, 4.0),
                    slow=(100, 200))
        rows = []
        for combo in itertools.product(*grid.values()):
            kw = dict(zip(grid, combo))
            t_, _, _, _ = run(m1, kill_switch=False, **sym, **kw)
            s0 = stats(t_[t_.entry_time.dt.year < split]) if not t_.empty else {}
            s1 = stats(t_[t_.entry_time.dt.year >= split]) if not t_.empty else {}
            rows.append({**kw, "is_trades": s0.get("trades", 0), "is_pf": s0.get("pf", np.nan),
                         "oos_trades": s1.get("trades", 0), "oos_pf": s1.get("pf", np.nan),
                         "oos_sum_r": s1.get("sum_r", np.nan)})
        res = pd.DataFrame(rows).sort_values("is_pf", ascending=False)
        pd.set_option("display.width", 200)
        print("\nGrid ranked by IN-SAMPLE PF; out-of-sample never used for selection:")
        print(res.head(12).to_string(index=False))
        print(f"\n{len(res)} configs. OOS PF > 1.0: {(res.oos_pf > 1).mean():.0%}; "
              f"> 1.3: {(res.oos_pf > 1.3).mean():.0%}; median OOS PF {res.oos_pf.median():.2f}; "
              f"median in-sample PF {res.is_pf.median():.2f}")
