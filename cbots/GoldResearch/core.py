"""
Research harness for gold (XAUUSD) strategy families on M1 bid/ask data.

Fill model (same spirit as the C# backtester):
  - buys fill at ASK, sells at BID; exits the other side
  - market entries at the open of the next M1 bar after the signal bar closes
  - stop orders fill at max(open, level) for buys (gap-through fills at the open)
  - stops / targets checked on each M1 high/low; stop wins a same-minute tie
  - break-even / trail / runner update on M1 closes (cTrader is per tick)
  - commission $0.07/oz round trip; swap charged per server-day rollover
Server time = New York time + 7h (the usual 17:00-NY rollover broker clock).
"""
import os
import numpy as np
import pandas as pd

COMMISSION = 0.07          # $ per oz round trip
FF = {2016: .4, 2017: 1.0, 2018: 1.8, 2019: 2.2, 2020: .4, 2021: .1, 2022: 1.7,
      2023: 5.0, 2024: 5.1, 2025: 4.2, 2026: 3.6}   # rough fed funds, % per year
SWAP_MARKUP = 2.0          # broker markup, % per year


class Data:
    def __init__(self, csv_path):
        cache = csv_path + ".npz"
        if os.path.exists(cache):
            z = np.load(cache)
            self.t, self.b, self.a = z["t"], z["b"], z["a"]
        else:
            df = pd.read_csv(csv_path, header=None,
                             names=["t", "bo", "bh", "bl", "bc", "ao", "ah", "al", "ac", "src"])
            self.t = df["t"].to_numpy(np.int64)
            self.b = df[["bo", "bh", "bl", "bc"]].to_numpy(np.float64)
            self.a = df[["ao", "ah", "al", "ac"]].to_numpy(np.float64)
            np.savez(cache, t=self.t, b=self.b, a=self.a)
        utc = pd.to_datetime(self.t * 60, unit="s", utc=True)
        ny = utc.tz_convert("America/New_York").tz_localize(None)
        self.sv = (ny.as_unit("s").asi8 // 60) + 7 * 60         # server-clock minutes
        self.sday = self.sv // 1440
        self.smod = self.sv % 1440
        self.sdow = ((self.sday + 3) % 7)                        # 0=Mon .. 6=Sun (epoch day 0 = Thu)
        self.year = utc.year.to_numpy()
        self.bo, self.bh, self.bl, self.bc = self.b.T
        self.ao, self.ah, self.al, self.ac = self.a.T
        self.n = len(self.t)

    def idx_of_utc(self, ts):
        m = int(pd.Timestamp(ts, tz="UTC").timestamp()) // 60
        return int(np.searchsorted(self.t, m))


class Bars:
    """OHLC bid bars on the server clock. first/last = M1 index range."""
    def __init__(self, d: Data, minutes):
        key = d.sday if minutes == 1440 else d.sv // minutes
        starts = np.flatnonzero(np.r_[True, key[1:] != key[:-1]])
        self.first = starts
        self.last = np.r_[starts[1:] - 1, d.n - 1]
        self.o = d.bo[starts]
        self.h = np.maximum.reduceat(d.bh, starts)
        self.l = np.minimum.reduceat(d.bl, starts)
        self.c = d.bc[self.last]
        self.key = key[starts]
        self.n = len(starts)
        # map M1 index -> bar index containing it
        self.of = np.repeat(np.arange(self.n), self.last - self.first + 1)


# ---------- indicators (numpy / pandas, no look-ahead: value at i uses bars <= i) ----------
def ema(x, n):
    return pd.Series(x).ewm(span=n, adjust=False).mean().to_numpy()


def sma(x, n):
    return pd.Series(x).rolling(n).mean().to_numpy()


def atr(br: Bars, n):
    pc = np.r_[br.c[0], br.c[:-1]]
    tr = np.maximum(br.h - br.l, np.maximum(abs(br.h - pc), abs(br.l - pc)))
    return pd.Series(tr).ewm(alpha=1 / n, adjust=False).mean().to_numpy()


def rsi(x, n):
    d = np.diff(x, prepend=x[0])
    up = pd.Series(np.maximum(d, 0)).ewm(alpha=1 / n, adjust=False).mean()
    dn = pd.Series(np.maximum(-d, 0)).ewm(alpha=1 / n, adjust=False).mean()
    return (100 - 100 / (1 + up / dn.replace(0, np.nan))).fillna(50).to_numpy()


def rollmax_prev(x, n):   # max of the n bars BEFORE i
    return pd.Series(x).rolling(n).max().shift(1).to_numpy()


def rollmin_prev(x, n):
    return pd.Series(x).rolling(n).min().shift(1).to_numpy()


# ---------- trade simulation ----------
class Mgmt:
    def __init__(self, be_r=0.0, be_lock=0.0, trail_start_r=0.0, trail_k=0.0,
                 runner_target=0.0, runner_lock=0.8, runner_k=0.0):
        self.be_r, self.be_lock = be_r, be_lock
        self.trail_start_r, self.trail_k = trail_start_r, trail_k     # trail_k in PRICE units
        self.runner_target, self.runner_lock, self.runner_k = runner_target, runner_lock, runner_k


def sim_trade(d: Data, i0, entry, direction, stop, tp, j_end, mg: Mgmt = None, fill_bar_checked=True):
    """Simulate one trade. Entry fills during M1 bar i0 at `entry`.
    Exits are checked from bar i0+1 (bar i0 too if fill_bar_checked and its range crosses the stop).
    j_end: exit at the OPEN of bar j_end if still open. Returns (exit_idx, exit_price, reason)."""
    j_end = min(j_end, d.n - 1)
    s = direction
    if s > 0:
        L, H, O, C = d.bl, d.bh, d.bo, d.bc
        e, st, tg = entry, stop, tp
    else:   # mirror: sells close at the ask; negate so the buy logic applies
        L, H, O, C = -d.ah, -d.al, -d.ao, -d.ac
        e, st, tg = -entry, -stop, (None if tp is None else -tp)
    R = e - st
    if fill_bar_checked and L[i0] <= st:          # whipsawed inside the fill minute
        return i0, s * st, "stop"
    if j_end <= i0 + 1:
        return j_end, s * O[j_end], "time"
    w = slice(i0 + 1, j_end)
    Lw, Hw, Ow = L[w], H[w], O[w]
    stop_arr = np.full(Lw.shape, st)
    if mg is not None and (mg.be_r or mg.trail_k or mg.runner_target):
        runC = np.maximum.accumulate(C[i0:j_end - 1])    # info available at start of each bar in w
        if mg.be_r:
            stop_arr = np.where(runC >= e + mg.be_r * R, np.maximum(stop_arr, e + mg.be_lock * R), stop_arr)
        if mg.trail_k:
            stop_arr = np.where(runC >= e + mg.trail_start_r * R, np.maximum(stop_arr, runC - mg.trail_k), stop_arr)
        if mg.runner_target:
            tgt = mg.runner_target
            stop_arr = np.where(runC >= e + tgt, np.maximum(stop_arr, np.maximum(e + mg.runner_lock * tgt, runC - mg.runner_k)), stop_arr)
    hs = Lw <= stop_arr
    ks = int(np.argmax(hs)) if hs.any() else None
    kt = None
    if tg is not None:
        ht = Hw >= tg
        kt = int(np.argmax(ht)) if ht.any() else None
    if ks is not None and (kt is None or ks <= kt):
        px = min(Ow[ks], stop_arr[ks])
        return i0 + 1 + ks, s * px, "stop"
    if kt is not None:
        px = max(Ow[kt], tg)
        return i0 + 1 + kt, s * px, "target"
    return j_end, s * O[j_end], "time"


# Instrument hooks. Defaults are gold; run_fx.py switches them for EURUSD.
SWAP_FN = None      # f(year, direction) -> % of price per year charged on overnight holds


def gold_swap_pct(year, direction):
    ff = FF.get(year, 2.0)
    return (ff + SWAP_MARKUP) if direction > 0 else max(0.0, SWAP_MARKUP - ff)


def swap_cost(d: Data, i0, i1, direction, price):
    nights = int(d.sday[i1] - d.sday[i0])
    if nights <= 0:
        return 0.0
    rate = (SWAP_FN or gold_swap_pct)(int(d.year[i0]), direction)
    return nights * price * rate / 100 / 360


class Trade:
    __slots__ = ("i0", "i1", "dir", "entry", "exit", "R", "r", "reason", "tag")


def run(d: Data, signals, mg=None, tag=""):
    """signals: iterable of dicts sorted by i0 with keys i0, entry, dir, stop, tp, j_end, (mg).
    One position at a time. Returns list of Trade."""
    out, free = [], -1
    for g in signals:
        if g["i0"] <= free:
            continue
        i1, px, why = sim_trade(d, g["i0"], g["entry"], g["dir"], g["stop"], g.get("tp"), g["j_end"], g.get("mg", mg),
                                g.get("fill_bar_checked", True))
        t = Trade()
        t.i0, t.i1, t.dir, t.entry, t.exit, t.reason, t.tag = g["i0"], i1, g["dir"], g["entry"], px, why, g.get("tag", tag)
        risk = abs(g["entry"] - g["stop"])
        pnl = (px - g["entry"]) * g["dir"] - COMMISSION - swap_cost(d, g["i0"], i1, g["dir"], g["entry"])
        t.R, t.r = risk, pnl / risk
        out.append(t)
        free = i1
    return out


# ---------- statistics ----------
def stats(d: Data, trades, lo=None, hi=None, risk=0.005):
    ts = [t for t in trades if (lo is None or t.i0 >= lo) and (hi is None or t.i0 < hi)]
    r = np.array([t.r for t in ts])
    if len(r) == 0:
        return dict(n=0, pf=float("nan"), avg=float("nan"), win=float("nan"), dd=float("nan"), tpy=0, ret=0)
    gp, gl = r[r > 0].sum(), -r[r < 0].sum()
    eq = np.cumprod(1 + risk * r)
    dd = 1 - eq / np.maximum.accumulate(np.r_[1.0, eq])[1:]
    years = (d.t[ts[-1].i0] - d.t[ts[0].i0]) / 525960 if len(ts) > 1 else 1
    return dict(n=len(r), pf=gp / gl if gl > 0 else float("inf"), avg=r.mean(), win=(r > 0).mean(),
                dd=dd.max() * 100, tpy=len(r) / max(years, 0.25), ret=(eq[-1] - 1) * 100)


def yearly(d: Data, trades):
    out = {}
    for y in sorted(set(int(d.year[t.i0]) for t in trades)):
        r = np.array([t.r for t in trades if d.year[t.i0] == y])
        gl = -r[r < 0].sum()
        out[y] = (len(r), r[r > 0].sum() / gl if gl > 0 else float("inf"))
    return out


def fmt(s):
    return f"n={s['n']:4d} PF={s['pf']:5.2f} avgR={s['avg']:+.3f} win={s['win']*100:4.1f}% DD={s['dd']:5.1f}% /yr={s['tpy']:5.1f}"
