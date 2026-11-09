"""Candidate strategy families. Each returns a list of signal dicts for core.run()."""
import numpy as np
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


def _range_breakout(cx, r_from, r_to, e_to, x_at, min_w, max_w, stop_cap, min_stop, tp_r, be_r, trend, tag, long_only=False):
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
        buf = 1e-4 * p
        bt = np.flatnonzero(d.ah[r1:e1] >= hi + buf)
        st = np.flatnonzero(d.bl[r1:e1] <= lo - buf)
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
        out.append(dict(i0=i0, entry=entry, dir=s, stop=stop, tp=entry + s * tp_r * dist, j_end=x1,
                        mg=Mgmt(be_r=be_r), tag=tag))
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
