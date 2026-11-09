"""Gold (XAUUSD) multi-timeframe analysis + analog-pattern projection.

Everything here uses only bars that had fully closed by CUTOFF, so the forecast
cannot see the period it is forecasting.

Building blocks
  * indicators   EMA 20/50/200, ATR14 (Wilder), RSI14 (Wilder) -- identical
                 recursions to the Excel formulas in the data sheets
  * structure    fractal swing highs/lows, BOS / CHoCH, fair value gaps
  * levels       PDH/PDL/PDC, previous week, sessions, pivots, swings, FVGs
  * analog       nearest-neighbour "pattern" model on H1 sessions: find past
                 days whose set-up looks like today's, average what happened
                 the next day, scale to today's volatility
  * backtest     the same analog model walked forward over past sessions,
                 scored against a random-walk ("no change") baseline
"""
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).parent
SAST = pd.Timedelta(hours=2)          # South Africa Standard Time, no DST
TF = ["M_1", "M_5", "M_15", "M_30", "H_1", "H_4"]
TF_LABEL = {"M_1": "1m", "M_5": "5m", "M_15": "15m", "M_30": "30m", "H_1": "1h", "H_4": "4h", "D_1": "1D"}
TF_MIN = {"M_1": 1, "M_5": 5, "M_15": 15, "M_30": 30, "H_1": 60, "H_4": 240, "D_1": 1440}
SHEET_ROWS = {"M_1": 1500, "M_5": 2000, "M_15": 2000, "M_30": 2000, "H_1": 2000, "H_4": 1500, "D_1": 600}

P = dict(ema_fast=20, ema_mid=50, ema_slow=200, atr=14, rsi=14,
         swing_n=3,            # fractal: bars each side of a swing point
         fvg_min_atr=0.15,     # ignore FVGs smaller than this x ATR
         k_analogs=20,         # nearest neighbours in the pattern model
         path_bars=24,         # H1 bars of shape used to match
         profile_sessions=120, # sessions used for the volatility profile
         backtest_sessions=200)


# --------------------------------------------------------------------------- data
def load(period, cutoff):
    df = pd.read_csv(HERE / "data" / f"XAUUSD_{period}.csv", parse_dates=["time_utc"])
    # keep only bars that had CLOSED by the cutoff
    closes_at = df.time_utc + pd.Timedelta(minutes=TF_MIN[period])
    if period == "D_1":
        closes_at = df.time_utc + pd.Timedelta(hours=23)
    df = df[closes_at <= cutoff].reset_index(drop=True)
    df["time_sast"] = df.time_utc.dt.tz_localize(None) + SAST
    return df


# --------------------------------------------------------------------- indicators
def indicators(df):
    """Same recursions as the sheet formulas (seeded on the first row)."""
    out = df.copy()
    c = out.close
    for k in ("ema_fast", "ema_mid", "ema_slow"):
        out[k] = c.ewm(span=P[k], adjust=False).mean()
    prev = c.shift(1)
    tr = pd.concat([out.high - out.low, (out.high - prev).abs(), (out.low - prev).abs()], axis=1).max(axis=1)
    tr.iloc[0] = out.high.iloc[0] - out.low.iloc[0]
    out["tr"] = tr
    out["atr"] = tr.ewm(alpha=1 / P["atr"], adjust=False).mean()
    d = c.diff().fillna(0)
    ag = d.clip(lower=0).ewm(alpha=1 / P["rsi"], adjust=False).mean()
    al = (-d).clip(lower=0).ewm(alpha=1 / P["rsi"], adjust=False).mean()
    rsi = 100 - 100 / (1 + ag / al.replace(0, np.nan))
    rsi[(al == 0) & (ag > 0)] = 100
    rsi[(al == 0) & (ag == 0)] = 50
    out["rsi"] = rsi
    return out


# ---------------------------------------------------------------------- structure
def swing_points(df, n):
    h, l = df.high.values, df.low.values
    sh = np.zeros(len(df), bool)
    sl = np.zeros(len(df), bool)
    for i in range(n, len(df) - n):
        if h[i] > h[i - n:i].max() and h[i] >= h[i + 1:i + n + 1].max():
            sh[i] = True
        if l[i] < l[i - n:i].min() and l[i] <= l[i + 1:i + n + 1].min():
            sl[i] = True
    return sh, sl


def structure(df, n):
    """Walk bar by bar; a swing is only known n bars after it prints.
    BOS = close through the last swing in the direction of the current trend,
    CHoCH = close through it against the trend (first change of character)."""
    sh, sl = swing_points(df, n)
    h, l, c = df.high.values, df.low.values, df.close.values
    last_h = last_l = None
    trend = 0
    events = []
    for j in range(len(df)):
        i = j - n
        if i >= n and sh[i]:
            last_h = [h[i], i, False]
        if i >= n and sl[i]:
            last_l = [l[i], i, False]
        if last_h and not last_h[2] and c[j] > last_h[0]:
            kind = "BOS" if trend >= 0 else "CHoCH"
            events.append(dict(bar=j, kind=f"{kind} up", level=last_h[0], swing_bar=last_h[1]))
            trend, last_h[2] = 1, True
        if last_l and not last_l[2] and c[j] < last_l[0]:
            kind = "BOS" if trend <= 0 else "CHoCH"
            events.append(dict(bar=j, kind=f"{kind} down", level=last_l[0], swing_bar=last_l[1]))
            trend, last_l[2] = -1, True
    return sh, sl, events, trend


def swing_sequence(df, sh, sl):
    """HH/HL vs LH/LL read from the last two swing highs and lows."""
    hi = df.high.values[sh][-2:]
    lo = df.low.values[sl][-2:]
    if len(hi) < 2 or len(lo) < 2:
        return "n/a"
    hh, hl = hi[1] > hi[0], lo[1] > lo[0]
    return {(True, True): "HH + HL (bullish)", (False, False): "LH + LL (bearish)",
            (True, False): "HH + LL (expanding)", (False, True): "LH + HL (contracting)"}[(hh, hl)]


def fair_value_gaps(df, min_size):
    h, l = df.high.values, df.low.values
    n = len(df)
    suf_min = np.minimum.accumulate(l[::-1])[::-1]   # min low from i..end
    suf_max = np.maximum.accumulate(h[::-1])[::-1]
    gaps = []
    for i in range(2, n):
        after_lo = suf_min[i + 1] if i + 1 < n else np.inf
        after_hi = suf_max[i + 1] if i + 1 < n else -np.inf
        if l[i] - h[i - 2] >= min_size:          # bullish gap
            bot, top = h[i - 2], l[i]
            state = "filled" if after_lo <= bot else ("partly mitigated" if after_lo < top else "open")
            gaps.append(dict(bar=i - 1, side="Bullish", bottom=bot, top=top, state=state))
        if l[i - 2] - h[i] >= min_size:          # bearish gap
            bot, top = h[i], l[i - 2]
            state = "filled" if after_hi >= top else ("partly mitigated" if after_hi > bot else "open")
            gaps.append(dict(bar=i - 1, side="Bearish", bottom=bot, top=top, state=state))
    return gaps


def analyse_tf(period, cutoff):
    raw = load(period, cutoff)
    df = indicators(raw.tail(SHEET_ROWS[period]).reset_index(drop=True))
    n = P["swing_n"] if period != "H_4" else 2
    sh, sl, events, trend = structure(df, n)
    atr = df.atr.iloc[-1]
    gaps = fair_value_gaps(df, P["fvg_min_atr"] * atr)
    last = df.iloc[-1]
    hi_i, lo_i = np.where(sh)[0], np.where(sl)[0]
    rng_hi = df.high.values[hi_i[-1]] if len(hi_i) else np.nan
    rng_lo = df.low.values[lo_i[-1]] if len(lo_i) else np.nan
    return dict(period=period, df=df, sh=sh, sl=sl, events=events, trend=trend, gaps=gaps,
                seq=swing_sequence(df, sh, sl), last=last,
                last_event=events[-1] if events else None,
                range_hi=rng_hi, range_lo=rng_lo)


# ------------------------------------------------------------------- key levels
def sessions_h1(h1):
    """Split H1 bars into trading sessions at the daily break (gap >= 2h)."""
    gap = h1.time_utc.diff() >= pd.Timedelta(hours=2)
    h1 = h1.assign(session=gap.cumsum())
    return h1


def key_levels(tfs, h1_all, d1, cutoff):
    h1 = sessions_h1(h1_all)
    last_sess = h1[h1.session == h1.session.max()]
    price = last_sess.close.iloc[-1]
    L = []

    def add(name, px, kind, tf=""):
        L.append(dict(level=name, price=float(px), kind=kind, tf=tf))

    pdh, pdl, pdc, pdo = last_sess.high.max(), last_sess.low.min(), last_sess.close.iloc[-1], last_sess.open.iloc[0]
    add("PDH - previous day high (Mon)", pdh, "Day")
    add("PDL - previous day low (Mon)", pdl, "Day")
    add("PDC - previous day close (Mon)", pdc, "Day")
    add("Mon open", pdo, "Day")
    # sessions of the last trading day (UTC windows)
    u = last_sess.time_utc
    hr = u.dt.hour
    for name, mask in [("Asia", (hr >= 23) | (hr < 7)), ("London", (hr >= 7) & (hr < 12)), ("New York", (hr >= 12) & (hr < 22))]:
        s = last_sess[mask.values]
        if len(s):
            add(f"{name} session high (Mon)", s.high.max(), "Session")
            add(f"{name} session low (Mon)", s.low.min(), "Session")
    # previous week from completed sessions
    sess = h1.groupby("session").agg(s=("time_utc", "first"), t=("time_utc", "last"), o=("open", "first"),
                                     h=("high", "max"), l=("low", "min"), c=("close", "last"))
    # a session belongs to the calendar day (SAST) it trades in: Sun 23:00 UTC open -> Monday
    sess["week"] = (sess.s + pd.Timedelta(hours=2)).dt.tz_localize(None).dt.to_period("W-SUN")
    this_week = sess.week.iloc[-1]
    pw = sess[sess.week == this_week - 1]
    if len(pw):
        add("PWH - previous week high", pw.h.max(), "Week")
        add("PWL - previous week low", pw.l.min(), "Week")
        add("PWC - previous week close", pw.c.iloc[-1], "Week")
    # unbroken swing highs above / lows below on H1 and H4
    for p in ("H_4", "H_1"):
        t = tfs[p]
        df = t["df"]
        hi, lo = df.high.values, df.low.values
        sufmax = np.maximum.accumulate(hi[::-1])[::-1]
        sufmin = np.minimum.accumulate(lo[::-1])[::-1]
        above = [(i, hi[i]) for i in np.where(t["sh"])[0] if hi[i] > price and (i + 1 >= len(df) or sufmax[i + 1] < hi[i])]
        below = [(i, lo[i]) for i in np.where(t["sl"])[0] if lo[i] < price and (i + 1 >= len(df) or sufmin[i + 1] > lo[i])]
        for i, px in sorted(above, key=lambda x: x[1])[:3]:
            add(f"{TF_LABEL[p]} swing high (untaken) {df.time_sast[i]:%d %b %H:%M}", px, "Swing", TF_LABEL[p])
        for i, px in sorted(below, key=lambda x: -x[1])[:3]:
            add(f"{TF_LABEL[p]} swing low (untaken) {df.time_sast[i]:%d %b %H:%M}", px, "Swing", TF_LABEL[p])
        # equilibrium of the current dealing range
        if not np.isnan(t["range_hi"]) and not np.isnan(t["range_lo"]):
            add(f"{TF_LABEL[p]} dealing-range 50% (equilibrium)", (t["range_hi"] + t["range_lo"]) / 2, "Range", TF_LABEL[p])
        # nearest open FVGs
        atr_d = d1_atr(sess)
        for g in [g for g in t["gaps"] if g["state"] != "filled" and abs((g["top"] + g["bottom"]) / 2 - price) < 2 * atr_d][-4:]:
            mid = (g["top"] + g["bottom"]) / 2
            add(f"{TF_LABEL[p]} {g['side'].lower()} FVG {g['bottom']:.2f}-{g['top']:.2f} ({g['state']}) {df.time_sast[g['bar']]:%d %b %H:%M}",
                mid, "FVG", TF_LABEL[p])
    for r in range(int(price // 50 - 2) * 50, int(price // 50 + 3) * 50 + 1, 50):
        add(f"Round number {r:,}", r, "Round")
    return L, dict(pdh=pdh, pdl=pdl, pdc=pdc, pdo=pdo, price=price)


def d1_atr(sess):
    prev = sess.c.shift(1)
    tr = pd.concat([sess.h - sess.l, (sess.h - prev).abs(), (sess.l - prev).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / 14, adjust=False).mean().iloc[-1]


# ------------------------------------------------------------- analog pattern model
BARS_PER_SESSION = 23


def session_table(h1_all):
    h1 = sessions_h1(h1_all).reset_index(drop=True)
    g = h1.groupby("session")
    sess = g.agg(start=("time_utc", "first"), end=("time_utc", "last"), o=("open", "first"),
                 h=("high", "max"), l=("low", "min"), c=("close", "last"), n=("close", "size"))
    sess["end_row"] = g.apply(lambda x: x.index[-1], include_groups=False)
    prev = sess.c.shift(1)
    tr = pd.concat([sess.h - sess.l, (sess.h - prev).abs(), (sess.l - prev).abs()], axis=1).max(axis=1)
    sess["atr"] = tr.ewm(alpha=1 / 14, adjust=False).mean()
    sess["ema20"] = sess.c.ewm(span=20, adjust=False).mean()
    sess = sess[sess.n >= 16].reset_index()     # drop stub/holiday sessions
    return h1, sess


def features(h1, sess, i):
    """Pattern fingerprint at the END of session i (all in ATR units)."""
    atr = sess.atr[i]
    end = sess.end_row[i]
    c = h1.close.values
    path = (c[end - P["path_bars"] + 1:end + 1] - c[end]) / atr          # last 24h shape
    rets = (sess.c.values[i - 4:i + 1] - sess.c.values[i - 5:i]) / atr    # last 5 day moves
    lo20, hi20 = sess.l.values[i - 19:i + 1].min(), sess.h.values[i - 19:i + 1].max()
    pos = (sess.c[i] - lo20) / (hi20 - lo20)                               # where in 20d range
    trend = (sess.c[i] - sess.ema20[i]) / atr                              # stretch from 20d EMA
    rng = (sess.h[i] - sess.l[i]) / atr                                    # today's range
    return path, rets, np.array([pos, trend, rng])


def outcome(h1, sess, i):
    """What session i+1 did, relative to session i's close, in session-i ATR units."""
    atr, c0 = sess.atr[i], sess.c[i]
    nxt = h1[h1.session == sess.session[i + 1]]
    path = (nxt.close.values - c0) / atr
    path = np.pad(path, (0, max(0, BARS_PER_SESSION - len(path))), mode="edge")[:BARS_PER_SESSION]
    return path, (nxt.high.max() - c0) / atr, (nxt.low.min() - c0) / atr


def analog_forecast(h1, sess, target_i, pool_end):
    """Forecast session target_i+1 from the K nearest past sessions d (d+1 <= pool_end)."""
    t_path, t_rets, t_misc = features(h1, sess, target_i)
    cands = list(range(25, pool_end))      # need 20d history; outcome d+1 <= pool_end
    F = [features(h1, sess, d) for d in cands]
    A = np.array([f[0] for f in F]); B = np.array([f[1] for f in F]); C = np.array([f[2] for f in F])

    def zdist(X, x):
        sd = X.std(axis=0) + 1e-9
        return (((X - x) / sd) ** 2).mean(axis=1)

    dist = np.sqrt(1.0 * zdist(A, t_path) + 1.0 * zdist(B, t_rets) + 1.0 * zdist(C, t_misc))
    order = np.argsort(dist)[:P["k_analogs"]]
    picks = []
    for o in order:
        d = cands[o]
        path, hi, lo = outcome(h1, sess, d)
        picks.append(dict(d=d, dist=dist[o], path=path, hi=hi, lo=lo))
    paths = np.array([p["path"] for p in picks])
    return dict(center=paths.mean(axis=0), median=np.median(paths, axis=0),
                p_up=(paths[:, -1] > 0).mean(), hi=np.median([p["hi"] for p in picks]),
                lo=np.median([p["lo"] for p in picks]), picks=picks)


def vol_profile(h1, sess, upto_i):
    """RMS of the cumulative move from the prior close at each bar of the next
    session, in ATR units, over the last N sessions before upto_i."""
    rows = []
    for d in range(max(25, upto_i - P["profile_sessions"]), upto_i):
        rows.append(outcome(h1, sess, d)[0])
    X = np.array(rows)
    return np.sqrt((X ** 2).mean(axis=0)), X


def backtest(h1, sess, last_i, z50=0.674, z80=1.2816):
    res = []
    for t in range(max(150, last_i - P["backtest_sessions"]), last_i):
        f = analog_forecast(h1, sess, t, pool_end=t)        # outcome of d+1<=t known at end of t
        sig, _ = vol_profile(h1, sess, t)
        act, hi, lo = outcome(h1, sess, t)
        c = f["center"]
        res.append(dict(date=sess.end[t + 1], atr=sess.atr[t],
                        fc_final=c[-1], act_final=act[-1],
                        dir_hit=np.sign(c[-1]) == np.sign(act[-1]),
                        mae=np.abs(act - c).mean(), mae_rw=np.abs(act).mean(),
                        cov50=(np.abs(act - c) <= z50 * sig).mean(),
                        cov80=(np.abs(act - c) <= z80 * sig).mean(),
                        p_up=f["p_up"], act_hi=hi, act_lo=lo, fc_hi=f["hi"], fc_lo=f["lo"]))
    return pd.DataFrame(res)


def run(cutoff):
    cutoff = pd.Timestamp(cutoff)
    tfs = {p: analyse_tf(p, cutoff) for p in TF}
    d1 = load("D_1", cutoff)
    h1_all = load("H_1", cutoff)
    levels, day = key_levels(tfs, h1_all, d1, cutoff)
    h1, sess = session_table(h1_all)
    last_i = len(sess) - 1
    # forecast for the session after the last complete one
    fc = analog_forecast(h1, sess, last_i, pool_end=last_i)
    sig, _ = vol_profile(h1, sess, last_i)
    bt = backtest(h1, sess, last_i)
    return dict(cutoff=cutoff, tfs=tfs, d1=indicators(d1.tail(SHEET_ROWS["D_1"]).reset_index(drop=True)),
                levels=levels, day=day, h1=h1, sess=sess, last_i=last_i, fc=fc, sigma=sig, bt=bt,
                atr_now=sess.atr[last_i], anchor=sess.c[last_i])


if __name__ == "__main__":
    import sys
    r = run(sys.argv[1] if len(sys.argv) > 1 else "2026-11-09T22:00:00Z")
    print("anchor", r["anchor"], "ATR(D)", round(r["atr_now"], 2), "sessions", len(r["sess"]))
    for p, t in r["tfs"].items():
        L = t["last"]
        print(f"{p:5s} close {L.close:.2f} ema20 {L.ema_fast:.2f} ema50 {L.ema_mid:.2f} ema200 {L.ema_slow:.2f} "
              f"rsi {L.rsi:.1f} atr {L.atr:.2f} seq {t['seq']} trend {t['trend']} last {t['last_event']}")
    fc = r["fc"]
    print("center path ($):", np.round(fc["center"] * r["atr_now"], 1))
    print("sigma ($):", np.round(r["sigma"] * r["atr_now"], 1))
    print("p_up", fc["p_up"], "hi", fc["hi"] * r["atr_now"], "lo", fc["lo"] * r["atr_now"])
    bt = r["bt"]
    print(bt[["dir_hit", "mae", "mae_rw", "cov50", "cov80"]].mean())
    print("base rate up:", (bt.act_final > 0).mean(), "n", len(bt))
