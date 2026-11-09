"""Candidate strategy families. Each returns a list of signal dicts for core.run()."""
import numpy as np
import pandas as pd
from core import Bars, Mgmt, atr, ema, sma, rsi, rollmax_prev, rollmin_prev


class Ctx:
    def __init__(self, d):
        self.d = d
        self.D = Bars(d, 1440)
        self.H4 = Bars(d, 240)
        self.H1 = Bars(d, 60)
        D = self.D
        self.d_atr14 = atr(D, 14)
        self.d_atr20 = atr(D, 20)
        self.d_ema50 = ema(D.c, 50)
        self.d_ema100 = ema(D.c, 100)
        self.d_sma200 = sma(D.c, 200)
        self.d_sma5 = sma(D.c, 5)
        self.d_rsi2 = rsi(D.c, 2)
        self.d_dow = d.sdow[D.first]
        self.h1_atr14 = atr(self.H1, 14)
        self.h4_atr14 = atr(self.H4, 14)
        self.h4_rsi2 = rsi(self.H4.c, 2)
        self.h4_sma5 = sma(self.H4.c, 5)
        self._m15 = None

    @property
    def M15(self):
        if self._m15 is None:
            self._m15 = Bars(self.d, 15)
        return self._m15

    def at(self, k, minute):
        """First M1 index of server day k at or after server minute-of-day `minute`."""
        D, d = self.D, self.d
        f, l = D.first[k], D.last[k]
        return f + int(np.searchsorted(d.smod[f:l + 1], minute))

    def trend_ok(self, k, direction, kind):
        """Daily trend filter using the PREVIOUS completed day k-1."""
        if kind is None:
            return True
        if k < 1:
            return False
        c = self.D.c[k - 1]
        ref = {"ema50": self.d_ema50, "ema100": self.d_ema100, "sma200": self.d_sma200}[kind][k - 1]
        if np.isnan(ref):
            return False
        return c > ref if direction > 0 else c < ref


def _range_breakout(cx, r_from, r_to, e_to, x_at, min_w, max_w, stop_cap, min_stop, tp_r, be_r, trend, tag, long_only=False,
                    one_sided=False, trail_start_r=0.0, trail_r=0.0, atr_w_max=None):
    """one_sided: with a trend filter, only the with-trend stop order is placed (else OCO and the day is
    skipped when the first break is against the trend). tp_r None = no target. trail_r: trail distance
    in multiples of the initial risk, active from trail_start_r. atr_w_max: skip ranges wider than
    this many daily ATRs (prior day)."""
    d, D, out = cx.d, cx.D, []
    for k in range(1, D.n):
        if cx.d_dow[k] > 4:
            continue
        r0, r1 = cx.at(k, r_from), cx.at(k, r_to)
        e1, x1 = cx.at(k, e_to), cx.at(k, x_at)
        if r1 - r0 < (r_to - r_from) * 0.6 or e1 <= r1:
            continue
        hi, lo = d.bh[r0:r1].max(), d.bl[r0:r1].min()
        p = d.bc[r1 - 1]
        w = (hi - lo) / p
        if w < min_w or w > max_w:
            continue
        if atr_w_max is not None and (hi - lo) > atr_w_max * cx.d_atr14[k - 1]:
            continue
        buf = 1e-4 * p
        bt = np.flatnonzero(d.ah[r1:e1] >= hi + buf)
        st = np.flatnonzero(d.bl[r1:e1] <= lo - buf)
        if one_sided and trend is not None:
            if not cx.trend_ok(k, 1, trend):
                bt = bt[:0]
            if not cx.trend_ok(k, -1, trend):
                st = st[:0]
        ib = r1 + bt[0] if len(bt) else None
        is_ = r1 + st[0] if len(st) else None
        if ib is None and is_ is None:
            continue
        if ib is not None and is_ is not None and ib == is_:
            continue                                   # both sides in one minute: ambiguous, skip
        if is_ is None or (ib is not None and ib < is_):
            s, i0 = 1, ib
            entry = max(d.ao[i0], hi + buf)
            dist = min(entry - lo, stop_cap * entry)
        else:
            s, i0 = -1, is_
            entry = min(d.bo[i0], lo - buf)
            dist = min(hi - entry, stop_cap * entry)
        if long_only and s < 0:
            continue
        if not cx.trend_ok(k, s, trend):
            continue
        dist = max(dist, min_stop * entry)
        stop = entry - s * dist
        out.append(dict(i0=i0, entry=entry, dir=s, stop=stop, tp=None if tp_r is None else entry + s * tp_r * dist, j_end=x1,
                        mg=Mgmt(be_r=be_r, trail_start_r=trail_start_r, trail_k=trail_r * dist), tag=tag))
    return out


def london_breakout(cx, trend=None, long_only=False):
    """Published spec (mql5 blog 777540): Asian range 03:00-08:00 server, OCO stops at 08:00,
    stop opposite side capped 0.6%, TP 2.5R, BE at 1.5R, flat 21:00, range 0.30-1.60%."""
    return _range_breakout(cx, 180, 480, 1260, 1260, 0.003, 0.016, 0.006, 0.0, 2.5, 1.5, trend, "LB", long_only)


def ny_orb(cx, tp_r=2.5, trend=None):
    """08:30-09:00 New York range (15:30-16:00 server), entries until 12:00 NY, flat 15:30 NY."""
    return _range_breakout(cx, 930, 960, 1140, 1350, 0.0, 0.02, 0.006, 0.0015, tp_r, 1.0, trend, "NY")


def donchian_d1(cx, n=20, exit_kind="chandelier", long_only=False, k_stop=2.5, k_trail=3.0, max_days=120):
    d, D, out = cx.d, cx.D, []
    hi, lo = rollmax_prev(D.h, n), rollmin_prev(D.l, n)
    m = max(n // 2, 5)
    xlo, xhi = rollmin_prev(D.l, m), rollmax_prev(D.h, m)
    for k in range(n + 1, D.n - 1):
        a = cx.d_atr20[k]
        for s in (1, -1):
            if long_only and s < 0:
                continue
            if not (D.c[k] > hi[k] if s > 0 else D.c[k] < lo[k]):
                continue
            i0 = D.first[k + 1]
            entry = d.ao[i0] if s > 0 else d.bo[i0]
            stop = entry - s * k_stop * a
            kend = min(k + 1 + max_days, D.n - 1)
            if exit_kind == "chandelier":
                mg, j_end = Mgmt(trail_start_r=0.0, trail_k=k_trail * a), D.first[kend]
            else:
                mg, j_end = None, D.first[kend]
                for q in range(k + 1, kend):
                    if (D.c[q] < xlo[q]) if s > 0 else (D.c[q] > xhi[q]):
                        j_end = D.first[min(q + 1, D.n - 1)]
                        break
            out.append(dict(i0=i0, entry=entry, dir=s, stop=stop, tp=None, j_end=j_end, mg=mg, fill_bar_checked=False, tag="DC"))
    out.sort(key=lambda g: g["i0"])
    return out


def connors_d1(cx, th=10, long_only=True, max_days=10, k_stop=3.0):
    d, D, out = cx.d, cx.D, []
    for k in range(201, D.n - 1):
        for s in (1, -1):
            if long_only and s < 0:
                continue
            if s > 0 and not (D.c[k] > cx.d_sma200[k] and cx.d_rsi2[k] < th):
                continue
            if s < 0 and not (D.c[k] < cx.d_sma200[k] and cx.d_rsi2[k] > 100 - th):
                continue
            i0 = D.first[k + 1]
            entry = d.ao[i0] if s > 0 else d.bo[i0]
            kend = min(k + 1 + max_days, D.n - 1)
            j_end = D.first[kend]
            for q in range(k + 1, kend):
                if (D.c[q] > cx.d_sma5[q]) if s > 0 else (D.c[q] < cx.d_sma5[q]):
                    j_end = D.first[min(q + 1, D.n - 1)]
                    break
            out.append(dict(i0=i0, entry=entry, dir=s, stop=entry - s * k_stop * cx.d_atr20[k], tp=None,
                            j_end=j_end, fill_bar_checked=False, tag="CR"))
    out.sort(key=lambda g: g["i0"])
    return out


def connors_h4(cx, th=10, max_bars=30, k_stop=3.0, trend="sma200", long_only=False):
    d, H, D, out = cx.d, cx.H4, cx.D, []
    for k in range(10, H.n - 1):
        kd = D.of[H.first[k]]
        for s in (1, -1):
            if long_only and s < 0:
                continue
            r = cx.h4_rsi2[k]
            if not ((r < th) if s > 0 else (r > 100 - th)):
                continue
            if not cx.trend_ok(kd, s, trend):
                continue
            i0 = H.last[k] + 1
            if i0 >= d.n:
                continue
            entry = d.ao[i0] if s > 0 else d.bo[i0]
            kend = min(k + 1 + max_bars, H.n - 1)
            j_end = H.first[kend]
            for q in range(k + 1, kend):
                if (H.c[q] > cx.h4_sma5[q]) if s > 0 else (H.c[q] < cx.h4_sma5[q]):
                    j_end = H.first[min(q + 1, H.n - 1)]
                    break
            out.append(dict(i0=i0, entry=entry, dir=s, stop=entry - s * k_stop * cx.h4_atr14[k], tp=None,
                            j_end=j_end, fill_bar_checked=False, tag="C4"))
    out.sort(key=lambda g: g["i0"])
    return out


def asian_drift(cx, exit_min=480, trend=None, k_stop=2.0):
    d, D, out = cx.d, cx.D, []
    for k in range(1, D.n):
        if cx.d_dow[k] > 4 or not cx.trend_ok(k, 1, trend):
            continue
        i0, j = cx.at(k, 65), cx.at(k, exit_min)
        if j - i0 < 60:
            continue
        a = cx.h1_atr14[max(cx.H1.of[i0] - 1, 0)]
        entry = d.ao[i0]
        out.append(dict(i0=i0, entry=entry, dir=1, stop=entry - k_stop * a, tp=None, j_end=j, fill_bar_checked=False, tag="AS"))
    return out


def intraday_momentum(cx, thr=0.5, k_stop=0.5):
    d, D, out = cx.d, cx.D, []
    for k in range(1, D.n):
        if cx.d_dow[k] > 4:
            continue
        a0, a1, x = cx.at(k, 600), cx.at(k, 990), cx.at(k, 1380)
        if a1 - a0 < 300 or x - a1 < 200:
            continue
        r1 = d.bc[a1 - 1] - d.bo[a0]
        a = cx.d_atr14[k - 1]
        if abs(r1) < thr * a:
            continue
        s = 1 if r1 > 0 else -1
        entry = d.ao[a1] if s > 0 else d.bo[a1]
        out.append(dict(i0=a1, entry=entry, dir=s, stop=entry - s * k_stop * a, tp=None, j_end=x, fill_bar_checked=False, tag="IM"))
    return out


def donchian_h4(cx, n=20, k_trail=3.0, k_stop=2.0, trend="ema50", max_bars=180):
    d, H, D, out = cx.d, cx.H4, cx.D, []
    hi, lo = rollmax_prev(H.h, n), rollmin_prev(H.l, n)
    for k in range(n + 1, H.n - 1):
        kd = D.of[H.first[k]]
        for s in (1, -1):
            if not (H.c[k] > hi[k] if s > 0 else H.c[k] < lo[k]):
                continue
            if not cx.trend_ok(kd, s, trend):
                continue
            i0 = H.last[k] + 1
            entry = d.ao[i0] if s > 0 else d.bo[i0]
            a = cx.h4_atr14[k]
            out.append(dict(i0=i0, entry=entry, dir=s, stop=entry - s * k_stop * a, tp=None,
                            j_end=H.first[min(k + 1 + max_bars, H.n - 1)],
                            mg=Mgmt(trail_start_r=0.0, trail_k=k_trail * a), fill_bar_checked=False, tag="D4"))
    return out


# ------------------------------------------------------------------ stage 5 (high-frequency round)
LB_EXITS = {"spec": dict(tp_r=2.5, be_r=1.5), "tp1.5": dict(tp_r=1.5, be_r=1.0),
            "runner": dict(tp_r=None, be_r=1.0, trail_start_r=1.0, trail_r=1.0)}


def london_breakout_v(cx, trend="ema100", exit="spec", one_sided=False, atr_w_max=None):
    """Published London breakout with a daily trend filter, plus one change at a time."""
    e = LB_EXITS[exit]
    return _range_breakout(cx, 180, 480, 1260, 1260, 0.003, 0.016, 0.006, 0.0, e["tp_r"], e["be_r"], trend, "LB",
                           one_sided=one_sided, trail_start_r=e.get("trail_start_r", 0.0), trail_r=e.get("trail_r", 0.0),
                           atr_w_max=atr_w_max)


def pdhl_breakout(cx, trend="ema100", tp_r=2.0, stop_atr=0.5):
    """Break of the previous day's high (buy) or low (sell), with-trend only, 08:00-21:00 server,
    stop stop_atr x prior-day ATR(14), break-even at 1R, flat 23:00 server."""
    d, D, out = cx.d, cx.D, []
    for k in range(2, D.n):
        if cx.d_dow[k] > 4:
            continue
        e0, e1, x1 = cx.at(k, 480), cx.at(k, 1260), cx.at(k, 1380)
        if e1 - e0 < 300:
            continue
        a = cx.d_atr14[k - 1]
        hi, lo = D.h[k - 1], D.l[k - 1]
        cands = []
        if cx.trend_ok(k, 1, trend):
            b = np.flatnonzero(d.ah[e0:e1] >= hi)
            if len(b) and d.ao[e0] < hi:          # must break during the window, not gap above it
                cands.append((e0 + b[0], 1))
        if cx.trend_ok(k, -1, trend):
            b = np.flatnonzero(d.bl[e0:e1] <= lo)
            if len(b) and d.bo[e0] > lo:
                cands.append((e0 + b[0], -1))
        if not cands:
            continue
        i0, s = min(cands)
        entry = max(d.ao[i0], hi) if s > 0 else min(d.bo[i0], lo)
        dist = stop_atr * a
        out.append(dict(i0=i0, entry=entry, dir=s, stop=entry - s * dist, tp=entry + s * tp_r * dist, j_end=x1,
                        mg=Mgmt(be_r=1.0), tag="PD"))
    return out


def donchian_h1(cx, n=24, k_trail=2.0, k_stop=2.0, trend="ema100", max_bars=48):
    """H1 close beyond the n-bar channel, with the daily trend. Stop k_stop x ATR(H1), chandelier
    k_trail x ATR(H1). Closed after max_bars hours and always flat by Friday 21:00 server."""
    d, H, D, out = cx.d, cx.H1, cx.D, []
    hi, lo = rollmax_prev(H.h, n), rollmin_prev(H.l, n)
    fri = np.flatnonzero((d.sdow == 4) & (d.smod >= 1260))
    fri = fri[np.r_[True, np.diff(fri) > 1]]          # first minute of each Friday cut-off
    for k in range(n + 1, H.n - 1):
        kd = D.of[H.first[k]]
        for s in (1, -1):
            if not (H.c[k] > hi[k] if s > 0 else H.c[k] < lo[k]):
                continue
            if not cx.trend_ok(kd, s, trend):
                continue
            i0 = H.last[k] + 1
            if d.sdow[i0] == 4 and d.smod[i0] >= 1200:  # no new entries late on Friday
                continue
            j = np.searchsorted(fri, i0, side="right")
            cut = fri[j] if j < len(fri) else d.n - 1
            entry = d.ao[i0] if s > 0 else d.bo[i0]
            a = cx.h1_atr14[k]
            out.append(dict(i0=i0, entry=entry, dir=s, stop=entry - s * k_stop * a, tp=None,
                            j_end=min(H.first[min(k + 1 + max_bars, H.n - 1)], cut),
                            mg=Mgmt(trail_start_r=0.0, trail_k=k_trail * a), fill_bar_checked=False, tag="H1"))
    return out


# ------------------------------------------------------------------ forex additions (run_fx.py)
def range_breakout_fx(cx, r_to=480, trend="ema100", exit="spec", min_w=0.001, max_w=0.006, stop_cap=0.004):
    """The gold London breakout, re-scaled for a currency pair: Asian range 03:00-r_to broker
    clock, range filter 0.10-0.60% of price, stop capped at 0.40%. Flat 21:00."""
    e = LB_EXITS[exit]
    return _range_breakout(cx, 180, r_to, 1260, 1260, min_w, max_w, stop_cap, 0.0, e["tp_r"], e["be_r"], trend, "FB",
                           trail_start_r=e.get("trail_start_r", 0.0), trail_r=e.get("trail_r", 0.0))


def asian_fade(cx, band=2.0, n=20, w_from=60, w_to=480, x_at=540, k_stop=1.5):
    """Asian-session mean reversion ("night scalper"): an M15 close beyond the n-bar Bollinger
    band (band std) between w_from and w_to broker clock is faded at the next open. Target = the
    band's middle at the signal, stop = k_stop x ATR(M15, 14), closed at x_at."""
    d, M, D, out = cx.d, cx.M15, cx.D, []
    mid = sma(M.c, n)
    sd = pd.Series(M.c).rolling(n).std(ddof=0).to_numpy()
    a = atr(M, 14)
    for b in range(n + 14, M.n - 1):
        m0 = d.smod[M.first[b]]
        if not (w_from <= m0 < w_to) or d.sdow[M.first[b]] > 4:
            continue
        up, dn = mid[b] + band * sd[b], mid[b] - band * sd[b]
        if M.c[b] > up:
            s = -1
        elif M.c[b] < dn:
            s = 1
        else:
            continue
        i0 = M.last[b] + 1
        if i0 >= d.n or d.sday[i0] != d.sday[M.first[b]]:
            continue
        entry = d.ao[i0] if s > 0 else d.bo[i0]
        tp = mid[b]
        if (tp - entry) * s <= 0:
            continue
        kd = D.of[i0]
        j = cx.at(kd, x_at)
        out.append(dict(i0=i0, entry=entry, dir=s, stop=entry - s * k_stop * a[b], tp=tp, j_end=j,
                        fill_bar_checked=False, tag="AF"))
    return out
