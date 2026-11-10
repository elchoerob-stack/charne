"""Pressure test: could a tiny account (e.g. R200 at 1:10,000) carry GoldBandBreakoutBot at 0.01 lot?

Leverage only sets the margin a position ties up (notional / leverage); it does NOT change how much a
position can lose. 0.01 lot of gold = 1 oz, so every $1 move = $1. The question is whether the account
survives the bot's own stop distances, because a broker stops you out when equity falls to a fraction of margin.

Assumptions (stated, not tuned):
  * stop-out when equity / margin <= 50% (typical; brokers range 20-100%); margin call flag at 100%
  * worst case inside each minute (the minute's high for a short, low for a long), plus a spread allowance
  * cost per round trip $0.50 as in the backtests (already inside trade net P&L)
  * the bot has no equity-based guard in v1/v1.2 (its caps are $100 per trade / $150 per day), so it WOULD trade a tiny account
"""
import json

import numpy as np
import pandas as pd

import bandfade_backtest as B
import paper
from ctrader_data import CTraderData

USDZAR = 16.56
SPREAD = 0.30                    # $ per oz allowance on the adverse side
STOP_OUT = 0.50
MARGIN_CALL = 1.00
LEVERAGES = [10000, 1000, 500, 200]


# ------------------------------------------------------------------ today, minute by minute
def today_replay(capital_usd, lev, trades, m1):
    """trades: list of dict(side, entry, entry_time, exit_time, net, label). Returns the outcome."""
    bal = capital_usd
    log = dict(margin_call=None, stop_out=None, rejected=0, min_equity=bal, min_level=np.inf, closed=[])
    pend = sorted(trades, key=lambda t: t["entry_time"])
    pos = None
    dead = False
    for ts, bar in m1.iterrows():
        if dead:
            break
        if pos is None and pend and ts >= pend[0]["entry_time"]:
            t = pend.pop(0)
            margin = t["entry"] / lev
            if bal < margin * 1.0:                              # not enough free margin: broker rejects
                log["rejected"] += 1
                continue
            pos = t
        if pos is not None:
            adverse = (bar.high + SPREAD - pos["entry"]) if pos["side"] == "Sell" else (pos["entry"] - (bar.low - SPREAD))
            equity = bal - adverse
            margin = pos["entry"] / lev
            level = equity / margin
            log["min_equity"], log["min_level"] = min(log["min_equity"], equity), min(log["min_level"], level)
            if level <= MARGIN_CALL and log["margin_call"] is None:
                log["margin_call"] = (ts, equity)
            if level <= STOP_OUT:
                log["stop_out"] = (ts, pos["entry"] + (adverse if pos["side"] == "Sell" else -adverse), equity)
                bal = max(equity, 0.0)
                dead = True
                continue
            if pos["exit_time"] is not None and ts >= pos["exit_time"]:
                bal += pos["net"]
                log["closed"].append((pos["label"], pos["net"]))
                pos = None
    if not dead and pos is not None:                              # still open: mark to the last minute
        last = m1.iloc[-1]
        adverse = (last.high + SPREAD - pos["entry"]) if pos["side"] == "Sell" else (pos["entry"] - (last.low - SPREAD))
        bal -= adverse
    log["final"] = bal
    return log


def load_today_trades(F, m5):
    ptr, _ = paper.run(F, m5)
    out = []
    for i, t in enumerate(ptr.itertuples(), 1):
        out.append(dict(side=t.side, entry=t.entry, entry_time=t.entry_time, exit_time=t.exit_time, net=t.net, label=f"trade {i}"))
    op = ptr.attrs.get("open")
    if op is not None:
        out.append(dict(side="Buy" if op["side"] == 1 else "Sell", entry=op["entry"], entry_time=op["t_in"], exit_time=None, net=0.0, label="open"))
    return out


# ------------------------------------------------------------------ history: adverse excursion + survival
def with_mae(path, m5):
    tr = pd.read_csv(path, parse_dates=["entry_time", "exit_time"])
    t_idx = m5.index.values
    hi, lo = m5.high.values, m5.low.values
    mae = []
    for r in tr.itertuples():
        a = np.searchsorted(t_idx, np.datetime64(r.entry_time.tz_convert(None)), side="left")
        b = np.searchsorted(t_idx, np.datetime64(r.exit_time.tz_convert(None)), side="right")
        seg_hi, seg_lo = hi[a:b], lo[a:b]
        if len(seg_hi) == 0:
            mae.append(0.0)
        else:
            mae.append(max(seg_hi.max() - r.entry, 0.0) if r.side == "Sell" else max(r.entry - seg_lo.min(), 0.0))
    tr["mae"] = mae
    return tr[["entry_time", "side", "entry", "net", "mae"]]


def survive(trades, capital, lev, horizon):
    """Share of start dates whose account is stopped out within `horizon` trades; plus median trades to ruin."""
    n = len(trades)
    ruined, to_ruin = 0, []
    starts = range(0, n - horizon + 1)
    for s in starts:
        bal = capital
        for k in range(horizon):
            t = trades.iloc[s + k]
            margin = t.entry / lev
            if bal < margin or bal - (t.mae + SPREAD) <= STOP_OUT * margin:
                ruined += 1
                to_ruin.append(k + 1)
                break
            bal += t.net
    return ruined / max(len(starts), 1), (int(np.median(to_ruin)) if to_ruin else None)


if __name__ == "__main__":
    F = json.load(open("forecast_2026-11-10.json"))
    ct = CTraderData()
    sid = ct.symbol_id("XAUUSD")
    start = pd.Timestamp(F["bars_utc"][0]); now = pd.Timestamp.now(tz="UTC")
    m5n = ct.bars(sid, "M_5", start, now.floor("5min")); m5n = m5n[m5n.time_utc + pd.Timedelta(minutes=5) <= now]
    m1 = ct.bars(sid, "M_1", start, now.floor("min")).set_index("time_utc")
    trades = load_today_trades(F, m5n)
    print("today's bot trades (paper, USD):", [(t["label"], t["side"], t["entry"], round(t["net"], 2)) for t in trades])

    print(f"\n=== TODAY: R200 = ${200 / USDZAR:.2f} at USDZAR {USDZAR} ===")
    rows = []
    for cap_r in (200, 1000, 5000, 20000):
        cap = cap_r / USDZAR
        for lev in LEVERAGES:
            L = today_replay(cap, lev, trades, m1)
            so = L["stop_out"]
            rows.append(dict(capital_R=cap_r, leverage=f"1:{lev:,}", margin_R=round(4140 / lev * USDZAR, 0),
                             rejected=L["rejected"], min_equity_R=round(L["min_equity"] * USDZAR),
                             stop_out=(f"{(so[0].tz_convert(None) + pd.Timedelta(hours=2)):%H:%M} SAST @ {so[1]:.2f}" if so else "no"),
                             trades_closed=len(L["closed"]), final_R=round(L["final"] * USDZAR)))
    print(pd.DataFrame(rows).to_string(index=False))
    pd.DataFrame(rows).to_csv("backtest/pressure_today.csv", index=False)

    print("\n=== HISTORY: 458 trades, 5-minute bars, worst adverse move inside each trade ===")
    m5h = pd.concat([pd.read_csv("data/XAUUSD_M_5_unseen.csv", parse_dates=["time_utc"]),
                     pd.read_csv("data/XAUUSD_M_5_hist.csv", parse_dates=["time_utc"])]).drop_duplicates("time_utc").set_index("time_utc").sort_index()
    allt = pd.concat([with_mae("backtest/unseen_breakout_trades.csv", m5h), with_mae("backtest/breakout_prior_z128_skipUS_trades.csv", m5h)])
    allt = allt.sort_values("entry_time").reset_index(drop=True)
    q = allt.mae.quantile([.5, .75, .9, .95, 1.0])
    print(f"worst adverse move before a trade ended ($/oz): median {q[.5]:.1f}, 75% {q[.75]:.1f}, 90% {q[.9]:.1f}, 95% {q[.95]:.1f}, max {q[1.0]:.1f}")
    print(f"wins avg ${allt.net[allt.net > 0].mean():.1f}, losses avg ${allt.net[allt.net < 0].mean():.1f}; worst drawdown (trade closes only): "
          f"${(allt.net.cumsum().cummax() - allt.net.cumsum()).max():.0f}")
    res = []
    caps = [(200, "R200"), (1000, "R1,000"), (5000, "R5,000"), (10000, "R10,000"), (20000, "R20,000"), (1158 * 1.115 * USDZAR, "EUR 1,158 (yours)")]
    for cap_r, name in caps:
        cap = cap_r / USDZAR
        for lev in ([10000, 1000, 500] if cap_r <= 200 else [1000]):
            r20, m20 = survive(allt, cap, lev, 20)
            r60, m60 = survive(allt, cap, lev, 60)
            res.append(dict(account=name, usd=round(cap, 1), leverage=f"1:{lev:,}", wiped_in_20_trades=f"{r20:.0%}",
                            wiped_in_60_trades=f"{r60:.0%}", median_trades_to_wipe=m60))
    print(pd.DataFrame(res).to_string(index=False))
    pd.DataFrame(res).to_csv("backtest/pressure_history.csv", index=False)
