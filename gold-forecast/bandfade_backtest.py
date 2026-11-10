"""Backtest of the 'buy the band low, sell the band high' idea on 5-minute bars.

Rules (fixed before any result was seen):
  * Each hour of the session, while flat, place a BUY LIMIT at the band low and a
    SELL LIMIT at the band high for that hour; whichever fills first cancels the
    other. Unfilled orders expire at the end of the hour.
  * Take profit at the centre line of that hour. Stop loss the same distance
    beyond the entry (1:1). One position at a time. Everything flat at the
    session close. No entries in the first hour (rollover spread) or the last.
  * 0.01 lot = 1 oz, so P&L in $ = price move in $. Cost $0.50 per round trip
    (spread + commission); fills are the limit price on bid data, or the bar's
    open when the order was already through the market (it fills at once).
  * Intrabar ambiguity is resolved against us: on the fill bar only the stop can
    trigger; if a later bar spans both stop and target, the stop wins.

Mode: "fade" = buy limit at the band low / sell limit at the band high, target the
centre; "breakout" (the 'vice versa') = buy stop at the band high / sell stop at
the band low, target one more band-width, stop back at the centre (1:1 either way).

Variants (16, all reported): mode x centre = analog projection or plain prior close x
band = 50% (z 0.674) or 80% (z 1.2816); skip the US-data hour (bar 14) or not.
The first 60% of days is in-sample (pick the variant), the last 40% is
out-of-sample (judge it). Bands use only data before each day, walk-forward.
"""
import itertools
import json
from pathlib import Path

import numpy as np
import pandas as pd

import analysis as A

HERE = Path(__file__).parent
COST = 0.50
OZ_PER_001_LOT = 1.0
DATA_HOUR_BAR = 14            # 15:00-16:00 SAST in winter / 14:00-15:00 in summer = US 08:30 ET


def day_plans(cutoff="2026-11-09T22:00:00Z", m5_start=None):
    """Walk-forward bands for every session covered by the 5-minute data."""
    h1_all = A.load("H_1", pd.Timestamp(cutoff))
    h1, sess = A.session_table(h1_all)
    last = len(sess) - 1
    plans = []
    for t in range(150, last):                    # forecast session t+1 from the close of t
        if sess.start[t + 1] < m5_start:
            continue
        fc = A.analog_forecast(h1, sess, t, pool_end=t)
        sig, _ = A.vol_profile(h1, sess, t)
        nxt = h1[h1.session == sess.session[t + 1]]
        plans.append(dict(day=sess.start[t + 1], anchor=sess.c[t], atr=sess.atr[t], center=fc["center"],
                          sigma=sig, bars=list(nxt.time_utc)))
    return plans


def simulate(plans, m5, centre="analog", z=0.674, skip_data_hour=False, mode="fade"):
    trades = []
    open_pos = None
    m5 = m5.set_index("time_utc")
    for p in plans:
        a, atr = p["anchor"], p["atr"]
        pos = None
        nb = len(p["bars"])
        for k, b in enumerate(p["bars"]):
            hour = m5.loc[b:b + pd.Timedelta(minutes=55)]
            if hour.empty:
                continue
            c = a + (p["center"][min(k, 22)] * atr if centre == "analog" else 0.0)
            d = z * p["sigma"][min(k, 22)] * atr
            can_enter = pos is None and 0 < k < nb - 1 and not (skip_data_hour and k == DATA_HOUR_BAR)
            lo_lvl, hi_lvl = c - d, c + d
            for ts, bar in hour.iterrows():
                if pos is None and can_enter:
                    hit_lo, hit_hi = bar.low <= lo_lvl, bar.high >= hi_lvl
                    if hit_lo and hit_hi:
                        can_enter = False           # both in one 5m bar: ambiguous, skip the hour
                        continue
                    if hit_lo or hit_hi:
                        if mode == "fade":
                            # limit order: one already through the market fills at the market (the bar's open)
                            side = 1 if hit_lo else -1
                            entry = min(lo_lvl, bar.open) if hit_lo else max(hi_lvl, bar.open)
                            pos = dict(side=side, entry=entry, tp=c, sl=entry - side * d, t_in=ts, k=k)
                        else:
                            # stop order: buy the break of the band high, sell the break of the band low;
                            # a gap through the level fills at the (worse) open
                            side = 1 if hit_hi else -1
                            entry = max(hi_lvl, bar.open) if hit_hi else min(lo_lvl, bar.open)
                            pos = dict(side=side, entry=entry, tp=entry + side * d, sl=entry - side * d, t_in=ts, k=k)
                        can_enter = False
                        # on the fill bar only the stop may trigger (pessimistic)
                        if (side == 1 and bar.low <= pos["sl"]) or (side == -1 and bar.high >= pos["sl"]):
                            trades.append(_close(pos, pos["sl"], ts, "SL"))
                            pos = None
                        continue
                if pos is not None and ts > pos["t_in"]:
                    s = pos["side"]
                    sl_hit = bar.low <= pos["sl"] if s == 1 else bar.high >= pos["sl"]
                    tp_hit = bar.high >= pos["tp"] if s == 1 else bar.low <= pos["tp"]
                    if sl_hit:
                        trades.append(_close(pos, pos["sl"], ts, "SL")); pos = None
                    elif tp_hit:
                        trades.append(_close(pos, pos["tp"], ts, "TP")); pos = None
        if pos is not None:                         # flat at the session close
            last_bar = m5.loc[p["bars"][-1]:p["bars"][-1] + pd.Timedelta(minutes=55)]
            if not last_bar.empty:
                trades.append(_close(pos, last_bar.close.iloc[-1], last_bar.index[-1], "EOD"))
            else:
                open_pos = pos                      # session still running: report, do not close
    out = pd.DataFrame(trades)
    out.attrs["open"] = open_pos
    return out


def _close(pos, px, ts, why):
    gross = (px - pos["entry"]) * pos["side"] * OZ_PER_001_LOT
    return dict(entry_time=pos["t_in"], exit_time=ts, side="Buy" if pos["side"] == 1 else "Sell", entry=round(pos["entry"], 2),
                exit=round(px, 2), hour_bar=pos["k"], exit_reason=why, gross=round(gross, 2), net=round(gross - COST, 2))


def stats(tr):
    if tr.empty:
        return dict(trades=0)
    w, l = tr.net[tr.net > 0].sum(), -tr.net[tr.net < 0].sum()
    eq = tr.net.cumsum()
    return dict(trades=len(tr), win_rate=round((tr.net > 0).mean(), 3), pf=round(w / l, 3) if l else float("inf"),
                net=round(tr.net.sum(), 2), avg=round(tr.net.mean(), 2), max_dd=round((eq.cummax() - eq).max(), 2),
                tp=int((tr.exit_reason == "TP").sum()), sl=int((tr.exit_reason == "SL").sum()),
                eod=int((tr.exit_reason == "EOD").sum()))


if __name__ == "__main__":
    m5 = pd.read_csv(HERE / "data" / "XAUUSD_M_5_hist.csv", parse_dates=["time_utc"])
    plans = day_plans(m5_start=m5.time_utc.min() + pd.Timedelta(days=1))
    split = plans[int(len(plans) * 0.6)]["day"]
    print(f"{len(plans)} days {plans[0]['day']:%Y-%m-%d} -> {plans[-1]['day']:%Y-%m-%d}; out-of-sample from {split:%Y-%m-%d}")
    rows, all_trades = [], {}
    for mode, centre, z, skip in itertools.product(["fade", "breakout"], ["analog", "prior_close"], [0.674, 1.2816],
                                                   [False, True]):
        name = f"{mode}|{centre}|z{z}|{'skipUS' if skip else 'allhours'}"
        tr = simulate(plans, m5, centre, z, skip, mode)
        all_trades[name] = tr
        is_, oos = tr[tr.entry_time < split], tr[tr.entry_time >= split]
        rows.append(dict(variant=name, **{f"IS_{k}": v for k, v in stats(is_).items()},
                         **{f"OOS_{k}": v for k, v in stats(oos).items()}))
    res = pd.DataFrame(rows)
    pd.set_option("display.width", 250)
    print(res[["variant", "IS_trades", "IS_pf", "IS_net", "IS_win_rate", "OOS_trades", "OOS_pf", "OOS_net",
               "OOS_win_rate", "OOS_max_dd"]].to_string(index=False))
    best = res.sort_values("IS_pf", ascending=False).iloc[0]["variant"]
    print("chosen on in-sample PF:", best)
    out = HERE / "backtest"
    out.mkdir(exist_ok=True)
    res.to_csv(out / "bandfade_variants.csv", index=False)
    tb = all_trades[best].copy()
    tb["Closing Time"] = tb.exit_time.dt.strftime("%Y-%m-%d %H:%M:%S")
    tb["Net Profit"] = tb.net
    tb.to_csv(out / "bandfade_best_trades.csv", index=False)
    json.dump(dict(split=str(split), best=best, n_variants=len(rows), cost=COST), open(out / "bandfade_meta.json", "w"))
