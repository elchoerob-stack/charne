"""USDJPY Asian-range breakout at London: one flexible simulator on 1h bars (the bot will use the same bars and rules).
range = high/low of New York hours r0..r1 (hour 0 = 17:00-18:00 ET); signal = first 1h CLOSE outside the range during
hours s0..s1; entry at the next 1h open; stop at range middle (stop='mid'), the far side ('far') or a fraction of the
range back inside; exit at the close of hour x; optional target in multiples of the stop distance; optional filters."""
import numpy as np
import pandas as pd

import edge_search as E


def simulate(m, r0=1, r1=9, s0=10, s1=15, stop="mid", exit_h=20, target=None, min_rng=0.0, max_rng=9.9, sides=(1, -1),
             trend=None, cost_mult=1.0):
    d = m.days
    rows = []
    for i in range(len(d)):
        if np.isnan(m.H[i, r0:r1 + 1]).all() or np.isnan(m.atr[i]):
            continue
        ah, al = np.nanmax(m.H[i, r0:r1 + 1]), np.nanmin(m.L[i, r0:r1 + 1])
        rng = (ah - al) / m.atr[i]
        if not (min_rng <= rng <= max_rng):
            continue
        for hh in range(s0, s1 + 1):
            cl = m.C[i, hh]
            if np.isnan(cl) or (al <= cl <= ah):
                continue
            side = 1 if cl > ah else -1
            if hh + 1 > exit_h or np.isnan(m.O[i, hh + 1]) or side not in sides:
                break
            if trend is not None:
                t = np.sign(d.pc.values[i] - d[f"sma{trend}"].values[i])
                if t != side:
                    break
            e = m.O[i, hh + 1]
            sp = {"mid": (ah + al) / 2, "far": al if side == 1 else ah}.get(stop)
            if sp is None:
                sp = (ah - stop * (ah - al)) if side == 1 else (al + stop * (ah - al))
            dist = (e - sp) * side
            if dist <= 0:
                break
            tgt = e + side * target * dist if target else None
            x, why = None, "time"
            for q in range(hh + 1, exit_h + 1):
                if np.isnan(m.C[i, q]):
                    continue
                if (side == 1 and m.L[i, q] <= sp) or (side == -1 and m.H[i, q] >= sp):
                    x, why = sp, "stop"; break
                if tgt is not None and ((side == 1 and m.H[i, q] >= tgt) or (side == -1 and m.L[i, q] <= tgt)):
                    x, why = tgt, "target"; break
                x = m.C[i, q]
            if x is not None:
                a = m.atr[i]
                rows.append(dict(day=i, date=d.index[i], side=side, hour=hh, rng=rng, dist=dist / a, why=why,
                                 gross=side * (x - e) / a, cost=cost_mult * m.cost * e / a))
            break
    t = pd.DataFrame(rows)
    if len(t):
        t["net"] = t.gross - t.cost
    return t


def summary(t, years):
    if len(t) < 30:
        return dict(n=len(t), per_year=round(len(t) / years, 1), pf=float("nan"), p=1.0, win=float("nan"))
    s = E.stats(t.day.values, t.net.values, years)
    s["win"] = round(float((t.net > 0).mean()), 3)
    return s
