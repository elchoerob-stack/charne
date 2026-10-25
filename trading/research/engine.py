"""Small event-driven backtest engine: signals on higher-timeframe bar closes,
fills at the next bar open, stops/targets resolved on M1 bars.

Conservative fill model: buys pay the ask (bid + spread), shorts exit at the ask;
if a stop and a target are both inside one M1 bar the stop wins; gaps fill at the
M1 open. Swap is charged on both longs and shorts for every server-midnight
crossed (x3 for the Wednesday rollover).
"""
from dataclasses import dataclass
import numpy as np
import pandas as pd


@dataclass(frozen=True)
class Instrument:
    name: str
    spread: float          # price units (or fraction of price if pct)
    commission: float      # USD per unit, round turn (or fraction of price if pct)
    swap: float            # USD per unit per night, charged regardless of side (or fraction of price if pct)
    pct: bool = False


GOLD = Instrument("XAUUSD", spread=0.30, commission=0.07, swap=0.20)
WTI = Instrument("USOIL", spread=0.04, commission=0.0, swap=0.015)
# Crypto CFD: 0.08% spread, ~22%/yr financing on longs and shorts
CRYPTO = Instrument("CRYPTO", spread=0.0008, commission=0.0, swap=0.0006, pct=True)


def swap_nights(t_in, t_out):
    """Server-midnight rollovers between two timestamps; Wednesday counts triple."""
    d0, d1 = pd.Timestamp(t_in).normalize(), pd.Timestamp(t_out).normalize()
    if d1 <= d0:
        return 0
    days = pd.date_range(d0 + pd.Timedelta(days=1), d1, freq="D")
    days = days[days.dayofweek < 5]          # rollovers on server Mon..Fri midnights
    return int(len(days) + 2 * (days.dayofweek == 3).sum())  # Thu 00:00 = Wed rollover


class Strategy:
    """Override on_bar(k, ctx) -> optional command dict:
       {"enter": +1/-1, "stop_dist": d, "target": price|None}
       {"exit": True}
       {"stop": price}   (engine never loosens a stop)
    ctx gives position (dict or None) and indicator arrays prepared in prepare()."""
    warmup = 0

    def prepare(self, bars):
        pass

    def on_bar(self, k, pos):
        raise NotImplementedError


def run(m1, bars, strat, inst, risk_pct=1.0, balance0=100_000.0, cost_mult=1.0):
    strat.prepare(bars)
    mt = m1.index.to_numpy()
    mo, mh, ml = (m1[c].to_numpy() for c in ("open", "high", "low"))
    starts = np.searchsorted(mt, bars.index.to_numpy(), side="left")
    starts = np.append(starts, len(mt))
    def costs_at(price):
        f = price if inst.pct else 1.0
        return inst.spread * cost_mult * f, inst.commission * cost_mult * f, inst.swap * cost_mult * f

    bal = balance0
    pos = None
    trades = []

    def close(px, t):
        nonlocal bal, pos
        pnl = (px - pos["entry"]) * pos["side"] * pos["units"]
        pnl -= pos["com"] * pos["units"] + pos["swp"] * swap_nights(pos["t"], t) * pos["units"]
        bal += pnl
        trades.append(dict(entry_time=pd.Timestamp(pos["t"]), exit_time=pd.Timestamp(t),
                           side=pos["side"], pnl=pnl, r=pnl / pos["risk"], bal=bal))
        pos = None

    for k in range(strat.warmup, len(bars) - 1):
        a, b = starts[k], starts[k + 1]
        if pos is not None and b > a:
            buy, sp = pos["side"] == 1, pos["sp"]
            if buy:
                hit_sl = ml[a:b] <= pos["sl"]
                hit_tp = mh[a:b] >= pos["tp"] if pos["tp"] is not None else np.zeros(b - a, bool)
            else:
                hit_sl = mh[a:b] + sp >= pos["sl"]
                hit_tp = ml[a:b] + sp <= pos["tp"] if pos["tp"] is not None else np.zeros(b - a, bool)
            any_hit = hit_sl | hit_tp
            if any_hit.any():
                m = a + int(np.argmax(any_hit))
                if hit_sl[m - a]:
                    px = min(pos["sl"], mo[m]) if buy else max(pos["sl"], mo[m] + sp)
                else:
                    px = pos["tp"]
                close(px, mt[m])

        cmd = strat.on_bar(k, pos)
        nxt = starts[k + 1]
        if not cmd or nxt >= len(mt):
            continue
        if "exit" in cmd and pos is not None:
            close(mo[nxt] if pos["side"] == 1 else mo[nxt] + pos["sp"], mt[nxt])
        elif "stop" in cmd and pos is not None:
            s = cmd["stop"]
            pos["sl"] = max(pos["sl"], s) if pos["side"] == 1 else min(pos["sl"], s)
        elif "enter" in cmd and pos is None:
            side, d = cmd["enter"], cmd["stop_dist"]
            if not d > 0:
                continue
            sp, com, swp = costs_at(mo[nxt])
            entry = mo[nxt] + (sp if side == 1 else 0.0)
            risk = bal * risk_pct / 100
            units = risk / d
            pos = dict(side=side, entry=entry, units=units, t=mt[nxt], risk=risk, sp=sp, com=com, swp=swp,
                       sl=entry - side * d, tp=cmd.get("target"))

    return pd.DataFrame(trades)


def stats(tr):
    if tr is None or tr.empty:
        return dict(trades=0)
    g, l = tr.r[tr.r > 0].sum(), -tr.r[tr.r < 0].sum()
    cum = tr.r.cumsum()
    dd_r = (cum.cummax().clip(lower=0) - cum).max()
    yearly = tr.groupby(tr.exit_time.dt.year).r.sum()
    return dict(trades=len(tr), win=round((tr.r > 0).mean() * 100, 1),
                pf=round(g / l, 2) if l else float("inf"), avg_r=round(tr.r.mean(), 3),
                sum_r=round(tr.r.sum(), 1), max_dd_r=round(dd_r, 1),
                worst_year_r=round(yearly.min(), 1), best_year_r=round(yearly.max(), 1))
