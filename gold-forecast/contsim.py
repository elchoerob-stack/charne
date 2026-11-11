"""Fast simulator for the band rules with a choice of entry mode. Same fills as bandfade_backtest.simulate
(5-minute bars, stop first when ambiguous, flat at the session close, cost per round trip per oz).

mode "both"  = the bot up to v2.2: stop orders at the band during the hour, or market if already beyond at the hour open
mode "cont"  = continuation only: at the hour open, enter at market ONLY if price is already beyond the band
               (no stop orders, so no first-touch entries)
mode "fresh" = first-touch only: stop orders at the band; an hour that opens beyond the band is skipped
"""
import numpy as np
import pandas as pd

DATA_HOUR = 14


def outcomes(plans, m5, z=1.2816, mode="both", skip_data_hour=True, tp_mult=1.0, sl_mult=1.0):
    """tp_mult / sl_mult scale the target / stop distance in band widths (1.0 = the tested 1:1); tp_mult None = no target."""
    t = m5.time_utc.values.astype("datetime64[ns]")
    O, H, L, C = m5.open.values, m5.high.values, m5.low.values, m5.close.values
    out = []
    for p in plans:
        a, atr, nb = p["anchor"], p["atr"], len(p["bars"])
        idx, hour_of = [], []
        for k, b in enumerate(p["bars"]):
            b0 = np.datetime64(b.tz_convert(None), "ns")
            i0 = np.searchsorted(t, b0, "left")
            i1 = np.searchsorted(t, b0 + np.timedelta64(55, "m"), "right")
            idx.extend(range(i0, i1))
            hour_of.extend([k] * (i1 - i0))
        idx, hour_of = np.array(idx, dtype=int), np.array(hour_of, dtype=int)
        o, h, l, c = O[idx], H[idx], L[idx], C[idx]
        has_last = bool((hour_of == nb - 1).any())
        row = {}
        for k in range(1, nb - 1):
            if skip_data_hour and k == DATA_HOUR:
                continue
            d = z * p["sigma"][min(k, 22)] * atr
            hi, lo = a + d, a - d
            js = np.where(hour_of == k)[0]
            ent = None
            if len(js):
                j0 = js[0]
                opened_beyond = o[j0] >= hi or o[j0] <= lo
                if opened_beyond and mode in ("both", "cont"):
                    side = 1 if o[j0] >= hi else -1
                    ent = (j0, side, o[j0], True)
                elif not opened_beyond and mode in ("both", "fresh"):
                    for j in js:
                        hit_lo, hit_hi = l[j] <= lo, h[j] >= hi
                        if hit_lo and hit_hi:
                            break                                   # ambiguous 5m bar: no entry this hour
                        if hit_lo or hit_hi:
                            side = 1 if hit_hi else -1
                            ent = (j, side, hi if hit_hi else lo, False)
                            break
            if ent is None:
                row[k] = dict(d=d, fill=False)
                continue
            j, side, entry, at_open = ent
            sl = entry - side * d * sl_mult
            tp = entry + side * d * tp_mult if tp_mult is not None else side * np.inf
            ex = None
            if (side == 1 and l[j] <= sl) or (side == -1 and h[j] >= sl):
                ex = (j, sl, "SL")
            else:
                for q in range(j + 1, len(idx)):
                    sl_hit = l[q] <= sl if side == 1 else h[q] >= sl
                    tp_hit = h[q] >= tp if side == 1 else l[q] <= tp
                    if sl_hit:
                        ex = (q, sl, "SL"); break
                    if tp_hit:
                        ex = (q, tp, "TP"); break
            if ex is None:
                if not has_last:
                    row[k] = dict(d=d, fill=False)                  # session still open in the data: not counted
                    continue
                ex = (len(idx) - 1, c[-1], "EOD")
            q, px, why = ex
            mae = max(entry - l[j:q + 1].min(), 0.0) if side == 1 else max(h[j:q + 1].max() - entry, 0.0)
            row[k] = dict(d=d * sl_mult, fill=True, side=side, entry=entry, exit=px, gross=(px - entry) * side, why=why, mae=mae,
                          at_open=at_open, exit_hour=int(hour_of[q]), t_in=t[idx[j]], t_out=t[idx[q]])
        out.append(dict(day=p["day"], nb=nb, hours=row, anchor=a, atr=atr))
    return out


def trades(out, cost=0.50, max_trades=4):
    """The trade list of one account that takes every allowed signal (1 position at a time)."""
    rows = []
    for s, S in enumerate(out):
        k, today = 1, 0
        while k < S["nb"] - 1 and today < max_trades:
            r = S["hours"].get(k)
            if r is None or not r["fill"]:
                k += 1
                continue
            rows.append(dict(sess=s, day=S["day"], k=k, rank=today + 1, side=r["side"], entry=r["entry"], exit=r["exit"], d=r["d"],
                             gross=r["gross"], net=r["gross"] - cost, why=r["why"], at_open=r["at_open"], mae=r["mae"],
                             entry_time=pd.Timestamp(r["t_in"], tz="UTC"), exit_time=pd.Timestamp(r["t_out"], tz="UTC")))
            today += 1
            k = r["exit_hour"] + 1
    return pd.DataFrame(rows)


def pf(v):
    v = np.asarray(v, dtype=float)
    w, l = v[v > 0].sum(), -v[v < 0].sum()
    return w / l if l > 0 else np.inf


def day_boot(tr, n=4000, seed=42):
    """Bootstrap by SESSION (trades inside one day move together). Returns P(net <= 0) and P(PF < 1)."""
    rs = np.random.default_rng(seed)
    g = tr.groupby("sess").net
    wins = g.apply(lambda v: v[v > 0].sum()).values
    loss = g.apply(lambda v: -v[v < 0].sum()).values
    m = len(wins)
    pick = rs.integers(0, m, size=(n, m))
    W, Ls = wins[pick].sum(axis=1), loss[pick].sum(axis=1)
    return float((W - Ls <= 0).mean()), float((W < Ls).mean())
