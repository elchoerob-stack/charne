"""Stage 7: high-frequency scan across symbols (asked for: > 1,000 trades a year, PF 1.5-3).

Screening year: 2025 only (the user's choice). Anything that passes is then re-run, unchanged,
on other years in validate_hf.py. Fixed before running:
  - 12 intraday variants per symbol (below), signals on M5/M15, exits checked on M1,
    entries only 07:00-20:00 UTC, one position at a time.
  - Costs: the symbol's bid/ask spread profile (fetch_ctrader_bars.py) plus commission
    $35 per $1M per side (7e-5 x price round trip) on forex and metals; spread only otherwise.
  - Pass in 2025: >= 1,000 trades and 1.5 <= PF <= 3.0.
Usage: python3 scan_hf.py <symbol> <csv> <fx_or_metal 0/1> [from] [to] [nocost]
"""
import sys
import numpy as np
import pandas as pd
import core
from core import Data, Bars, Mgmt, run, stats, atr, ema, sma, rsi

SESSION = (7 * 60, 20 * 60)


def next_true_after(mask, idx):
    """For each idx, the first position > idx where mask is True (len(mask) if none)."""
    pos = np.flatnonzero(mask)
    j = np.searchsorted(pos, idx, side="right")
    return np.where(j < len(pos), pos[np.minimum(j, len(pos) - 1)], len(mask))


class Scan:
    def __init__(self, d):
        self.d = d
        self.umod = (d.t % 1440)
        self.M5, self.M15, self.H1 = Bars(d, 5), Bars(d, 15), Bars(d, 60)
        self.h1_ema50 = ema(self.H1.c, 50)
        self.h1_ema20 = ema(self.H1.c, 20)

    def h1_trend(self, B):
        """+1 / -1 / 0 per bar of B from the last COMPLETED H1 bar: close vs EMA50."""
        h = self.H1.of[B.first] - 1
        h = np.maximum(h, 0)
        c, e = self.H1.c[h], self.h1_ema50[h]
        return np.where(c > e, 1, np.where(c < e, -1, 0))

    def emit(self, B, ks, dirs, stop_dist, tp_dist, end_bar, tag, mg=None):
        d, out = self.d, []
        for k, s, sd, td, e in zip(ks, dirs, stop_dist, tp_dist, end_bar):
            i0 = B.last[k] + 1
            if i0 >= d.n or not (SESSION[0] <= self.umod[i0] < SESSION[1]) or not (sd > 0):
                continue
            if d.sday[i0] != d.sday[B.first[k]]:
                continue
            entry = d.ao[i0] if s > 0 else d.bo[i0]
            j = B.first[min(int(e), B.n - 1)]
            out.append(dict(i0=i0, entry=entry, dir=int(s), stop=entry - s * sd,
                            tp=None if td is None or not np.isfinite(td) else entry + s * td,
                            j_end=j, fill_bar_checked=False, tag=tag, mg=mg))
        return out

    # A: Bollinger fade on M5, target the middle band, 1 hour max
    def bb_fade(self, band):
        B = self.M5
        mid = sma(B.c, 20)
        sd = pd.Series(B.c).rolling(20).std(ddof=0).to_numpy()
        a = atr(B, 14)
        up, dn = B.c > mid + band * sd, B.c < mid - band * sd
        ks = np.flatnonzero(up | dn)
        dirs = np.where(up[ks], -1, 1)
        tp = np.abs(mid[ks] - B.c[ks])
        return self.emit(B, ks, dirs, 1.5 * a[ks], tp, ks + 13, "BB")

    # B: RSI(2) dip in the H1 trend, exit when RSI(2) recovers past 60/40 or after max_bars
    def rsi2_trend(self, B, th, max_bars):
        r = rsi(B.c, 2)
        a = atr(B, 14)
        tr = self.h1_trend(B)
        lg, sh = (r < th) & (tr > 0), (r > 100 - th) & (tr < 0)
        ks = np.flatnonzero(lg | sh)
        dirs = np.where(lg[ks], 1, -1)
        exit_l = next_true_after(r > 60, ks)
        exit_s = next_true_after(r < 40, ks)
        ex = np.where(dirs > 0, exit_l, exit_s) + 1
        end = np.minimum(ex, ks + 1 + max_bars)
        return self.emit(B, ks, dirs, 2.0 * a[ks], [None] * len(ks), end, "R2")

    # C: M15 channel breakout, ATR trail from 1R, 4 hours max
    def m15_breakout(self, n):
        B = self.M15
        a = atr(B, 14)
        hi = pd.Series(B.h).rolling(n).max().shift(1).to_numpy()
        lo = pd.Series(B.l).rolling(n).min().shift(1).to_numpy()
        lg, sh = B.c > hi, B.c < lo
        ks = np.flatnonzero(lg | sh)
        dirs = np.where(lg[ks], 1, -1)
        out = []
        for k, s in zip(ks, dirs):
            out += self.emit(B, [k], [s], [1.5 * a[k]], [None], [k + 17], "DC",
                             mg=Mgmt(trail_start_r=1.0, trail_k=1.5 * a[k]))
        return out

    # D: M5 momentum burst (range > 2 ATR, close in the outer quarter), TP 1.5 ATR, SL 1 ATR
    def burst(self, with_trend):
        B = self.M5
        a = atr(B, 14)
        prev_a = np.r_[a[0], a[:-1]]
        rng = B.h - B.l
        pos = (B.c - B.l) / np.where(rng > 0, rng, np.nan)
        big = rng > 2 * prev_a
        lg, sh = big & (pos > 0.75), big & (pos < 0.25)
        if with_trend:
            tr = self.h1_trend(B)
            lg, sh = lg & (tr > 0), sh & (tr < 0)
        ks = np.flatnonzero(lg | sh)
        dirs = np.where(lg[ks], 1, -1)
        return self.emit(B, ks, dirs, 1.0 * a[ks], 1.5 * a[ks], ks + 13, "MB")

    # E: M5 pullback to EMA20 in the H1 trend, SL 1.5 ATR, TP 2 ATR, 2 hours max
    def pullback(self):
        B = self.M5
        a = atr(B, 14)
        e20 = ema(B.c, 20)
        h = np.maximum(self.H1.of[B.first] - 1, 0)
        up = self.h1_ema20[h] > self.h1_ema50[h]
        dn = self.h1_ema20[h] < self.h1_ema50[h]
        lg = up & (B.l <= e20) & (B.c > e20) & (B.c > B.o)
        sh = dn & (B.h >= e20) & (B.c < e20) & (B.c < B.o)
        ks = np.flatnonzero(lg | sh)
        dirs = np.where(lg[ks], 1, -1)
        return self.emit(B, ks, dirs, 1.5 * a[ks], 2.0 * a[ks], ks + 25, "PB")

    def variants(self):
        return {
            "BB fade M5 2.0sd": lambda: self.bb_fade(2.0),
            "BB fade M5 2.5sd": lambda: self.bb_fade(2.5),
            "RSI2 M5 <10 H1 trend": lambda: self.rsi2_trend(self.M5, 10, 12),
            "RSI2 M5 <5 H1 trend": lambda: self.rsi2_trend(self.M5, 5, 12),
            "RSI2 M15 <10 H1 trend": lambda: self.rsi2_trend(self.M15, 10, 8),
            "RSI2 M15 <5 H1 trend": lambda: self.rsi2_trend(self.M15, 5, 8),
            "M15 breakout n10": lambda: self.m15_breakout(10),
            "M15 breakout n20": lambda: self.m15_breakout(20),
            "M5 burst": lambda: self.burst(False),
            "M5 burst H1 trend": lambda: self.burst(True),
            "M5 pullback EMA20": lambda: self.pullback(),
            "BB fade M5 3.0sd": lambda: self.bb_fade(3.0),
        }


def main():
    sym, path, fxm = sys.argv[1], sys.argv[2], sys.argv[3] == "1"
    lo = sys.argv[4] if len(sys.argv) > 4 else "2025-01-01"
    hi = sys.argv[5] if len(sys.argv) > 5 else "2026-01-01"
    core.COMMISSION = 0.0
    core.COMMISSION_FRAC = 7e-5 if fxm else 0.0
    core.SWAP_FN = lambda year, direction: 3.0
    d = Data(path)
    if len(sys.argv) > 6 and sys.argv[6] == "nocost":       # gross edge: no spread, no commission
        d.ao, d.ah, d.al, d.ac = d.bo, d.bh, d.bl, d.bc
        core.COMMISSION_FRAC = 0.0
        core.SWAP_FN = lambda year, direction: 0.0
    sc = Scan(d)
    a, b = d.idx_of_utc(lo), d.idx_of_utc(hi)
    for name, fn in sc.variants().items():
        tr = [t for t in run(d, fn()) if a <= t.i0 < b]
        s = stats(d, tr)
        flag = "PASS" if s["n"] >= 1000 and 1.5 <= s["pf"] <= 3.0 else ""
        print(f"{sym}\t{name}\t{s['n']}\t{s['pf']:.3f}\t{s['avg']:+.4f}\t{s['win']*100:.1f}\t{s['dd']:.1f}\t{flag}", flush=True)


if __name__ == "__main__":
    main()
