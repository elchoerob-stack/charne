"""Bar-by-bar Python replica of KeystoneTrendBot.cs for backtesting on M1 data.

Input: MT5 M1 export (tab-separated: <DATE> <TIME> <OPEN> <HIGH> <LOW> <CLOSE>
<TICKVOL> <VOL> <SPREAD>), bid prices, spread in points.

Fill model (deliberately conservative):
- Entries fill at the open of the bar after the signal bar (cTrader OnBar timing).
  Buys pay the ask (bid + that bar's spread).
- Buy exits trigger on bid, sell exits on ask, as in cTrader.
- If SL and TP are both inside one M1 bar, the SL is assumed to hit first.
- Break-even moves only take effect from the next bar.
- Commission is charged per round turn per 100k units.

Usage: python ktb_backtest.py <m1.csv> [--server-utc-offset 2] [--sweep]
"""
import argparse
import numpy as np
import pandas as pd

# ---- Hardcoded risk (mirrors the C# constants) ----
RISK_PCT, MAX_RISK_PCT = 1.0, 2.0
MAX_DAILY_LOSS_PCT, MAX_DD_PCT = 3.0, 20.0
MAX_SPREAD_SL_FRAC, MAX_TRADES_PER_DAY = 0.10, 8
BE_AT_R = 1.0

PIP = 0.0001
PIP_VALUE_PER_UNIT = 0.0001      # USD per pip per unit (USD account)
MIN_UNITS, UNIT_STEP = 1000, 1000


def ema(x, n):
    return pd.Series(x).ewm(span=n, adjust=False).mean().to_numpy()


def rsi(close, n=14):
    d = np.diff(close, prepend=close[0])
    up = pd.Series(np.clip(d, 0, None)).ewm(alpha=1 / n, adjust=False).mean()
    dn = pd.Series(np.clip(-d, 0, None)).ewm(alpha=1 / n, adjust=False).mean()
    return (100 - 100 / (1 + up / dn.replace(0, np.nan))).fillna(50).to_numpy()


def atr(h, l, c, n):
    pc = np.roll(c, 1); pc[0] = c[0]
    tr = np.maximum(h - l, np.maximum(abs(h - pc), abs(l - pc)))
    return pd.Series(tr).rolling(n).mean().to_numpy()


def load(path, utc_offset):
    df = pd.read_csv(path, sep="\t")
    df.columns = [c.strip("<>").lower() for c in df.columns]
    t = pd.to_datetime(df["date"] + " " + df["time"], format="%Y.%m.%d %H:%M:%S")
    df.index = t - pd.Timedelta(hours=utc_offset)
    df["spread"] = df["spread"] * 0.1 * PIP          # points -> price
    return df[["open", "high", "low", "close", "spread"]]


def run(df, trend_ema=200, pull_ema=50, atr_n=14, sl_mult=1.5, tp_mult=2.5,
        sess=(7, 17), balance0=10_000.0, commission_per_lot=7.0, min_units=MIN_UNITS):
    o, h, l, c, sp = (df[k].to_numpy() for k in ("open", "high", "low", "close", "spread"))
    times = df.index
    n = len(df)

    # Higher timeframe (H1). For the decision at bar j's open, use the last H1 bar that
    # CLOSED before the H1 bar containing j (cTrader Last(1)).
    h1 = df["close"].resample("1h").last().dropna()
    h1_close = h1.to_numpy()
    h1_tema, h1_pema = ema(h1_close, trend_ema), ema(h1_close, pull_ema)
    h1_idx = np.searchsorted(h1.index.to_numpy(), times.floor("1h").to_numpy(), side="left") - 1

    pema, r, a = ema(c, pull_ema), rsi(c, 14), atr(h, l, c, atr_n)

    bal = eq_peak = balance0
    day, day_start_bal, trades_today = None, balance0, 0
    pos = None
    trades, equity_curve = [], []
    skipped_minlot = 0

    for j in range(pull_ema + 2, n):
        i = j - 1
        d = times[j].date()
        if d != day:
            day, day_start_bal, trades_today = d, bal, 0

        # ---- manage open position on bar j ----
        if pos is not None:
            buy = pos["side"] == 1
            bid_l, bid_h = l[j], h[j]
            ask_l, ask_h = l[j] + sp[j], h[j] + sp[j]
            exit_px = None
            if buy:
                if bid_l <= pos["sl"]: exit_px = min(pos["sl"], o[j])
                elif bid_h >= pos["tp"]: exit_px = pos["tp"]
            else:
                if ask_h >= pos["sl"]: exit_px = max(pos["sl"], o[j] + sp[j])
                elif ask_l <= pos["tp"]: exit_px = pos["tp"]
            if exit_px is not None:
                pnl = (exit_px - pos["entry"]) * pos["side"] * pos["units"]
                pnl -= commission_per_lot * pos["units"] / 100_000
                bal += pnl
                trades.append(dict(entry_time=pos["t"], exit_time=times[j], side=pos["side"],
                                   pnl=pnl, r=pnl / pos["risk_money"]))
                pos = None
            else:
                fav = (bid_h - pos["entry"]) if buy else (pos["entry"] - ask_l)
                if fav >= pos["risk_dist"] * BE_AT_R:
                    be = pos["entry"] + pos["side"] * PIP
                    pos["sl"] = max(pos["sl"], be) if buy else min(pos["sl"], be)

        eq_peak = max(eq_peak, bal)
        equity_curve.append((times[j], bal))
        if (eq_peak - bal) / eq_peak * 100 >= MAX_DD_PCT:
            print(f"KILL SWITCH at {times[j]}")
            break

        # ---- signal on closed bar i, enter at open of bar j ----
        if pos is not None or trades_today >= MAX_TRADES_PER_DAY:
            continue
        if (bal - day_start_bal) / day_start_bal * 100 <= -MAX_DAILY_LOSS_PCT:
            continue
        if not (sess[0] <= times[j].hour < sess[1]):
            continue
        k = h1_idx[j]
        if k < trend_ema + 6:
            continue
        at = a[i]
        if not at > 0 or sp[j] > sl_mult * at * MAX_SPREAD_SL_FRAC:
            continue

        te, tep, hp, hc = h1_tema[k], h1_tema[k - 5], h1_pema[k], h1_close[k]
        up = hc > te and hp > te and te > tep
        dn = hc < te and hp < te and te < tep
        long_ = up and l[i] <= pema[i] + 0.25 * at and c[i] > pema[i] and c[i] > o[i] and 40 < r[i] < 70
        short = dn and h[i] >= pema[i] - 0.25 * at and c[i] < pema[i] and c[i] < o[i] and 30 < r[i] < 60
        if not (long_ or short):
            continue

        side = 1 if long_ else -1
        sl_dist, tp_dist = sl_mult * at, tp_mult * at
        sl_pips = sl_dist / PIP
        raw = bal * RISK_PCT / 100 / (sl_pips * PIP_VALUE_PER_UNIT)
        units = max(min_units, np.floor(raw / UNIT_STEP) * UNIT_STEP)
        risk_money = units * sl_pips * PIP_VALUE_PER_UNIT
        if risk_money / bal * 100 > MAX_RISK_PCT:
            skipped_minlot += 1
            continue
        entry = o[j] + sp[j] if side == 1 else o[j]
        pos = dict(side=side, entry=entry, units=units, t=times[j], risk_dist=sl_dist,
                   risk_money=risk_money, sl=entry - side * sl_dist, tp=entry + side * tp_dist)
        trades_today += 1

    return pd.DataFrame(trades), pd.DataFrame(equity_curve, columns=["t", "bal"]).set_index("t"), skipped_minlot


def stats(tr, eq, balance0):
    if tr.empty:
        return dict(trades=0)
    g, lo = tr.pnl[tr.pnl > 0].sum(), -tr.pnl[tr.pnl < 0].sum()
    dd = ((eq.bal.cummax() - eq.bal) / eq.bal.cummax()).max() * 100
    return dict(trades=len(tr), win_rate=round((tr.pnl > 0).mean() * 100, 1),
                pf=round(g / lo, 2) if lo else float("inf"), avg_r=round(tr.r.mean(), 3),
                net_pct=round((eq.bal.iloc[-1] / balance0 - 1) * 100, 1), max_dd_pct=round(dd, 1))


def period_stats(tr, start, end):
    t = tr[(tr.entry_time >= start) & (tr.entry_time < end)]
    if t.empty:
        return dict(trades=0)
    g, lo = t.pnl[t.pnl > 0].sum(), -t.pnl[t.pnl < 0].sum()
    return dict(trades=len(t), win_rate=round((t.pnl > 0).mean() * 100, 1),
                pf=round(g / lo, 2) if lo else float("inf"), avg_r=round(t.r.mean(), 3),
                sum_r=round(t.r.sum(), 1))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("csv")
    ap.add_argument("--server-utc-offset", type=float, default=2)
    ap.add_argument("--sweep", action="store_true")
    args = ap.parse_args()

    df = load(args.csv, args.server_utc_offset)
    print(f"Data: {df.index[0]} -> {df.index[-1]}, {len(df):,} M1 bars, "
          f"median spread {df.spread.median() / PIP:.2f} pips")

    tr, eq, _ = run(df)
    print("\nDEFAULTS, $10k, $7/lot commission:", stats(tr, eq, 10_000))
    mid = pd.Timestamp(df.index[0].year, 7, 1)
    print("  H1 (in-sample) :", period_stats(tr, df.index[0], mid))
    print("  H2 (out-sample):", period_stats(tr, mid, df.index[-1]))

    tr0, eq0, _ = run(df, commission_per_lot=0.0)
    print("\nSame, zero commission (cost sensitivity):", stats(tr0, eq0, 10_000))

    df_wide = df.copy(); df_wide["spread"] += 0.3 * PIP
    trw, eqw, _ = run(df_wide)
    print("Same, spread +0.3 pip (stress):         ", stats(trw, eqw, 10_000))

    _, _, skipped = run(df, balance0=5.4)
    print(f"\nR100 (~$5.40) standard account: {skipped} signals skipped by the min-lot risk guard")

    if args.sweep:
        print("\nRobustness grid (SL x TP), whole year:")
        for sl in (1.0, 1.5, 2.0, 3.0):
            for tp in (1.5, 2.5, 4.0):
                t, e, _ = run(df, sl_mult=sl, tp_mult=tp)
                print(f"  SL {sl} TP {tp}:", stats(t, e, 10_000))
        print("\nPullback EMA / higher-TF trend EMA variants:")
        for pe, te in ((20, 200), (50, 100), (50, 300), (80, 200)):
            t, e, _ = run(df, pull_ema=pe, trend_ema=te)
            print(f"  pull {pe} trend {te}:", stats(t, e, 10_000))
