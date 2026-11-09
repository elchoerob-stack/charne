"""Forward paper test: what GoldBandBreakoutBot v1 would have done on a frozen forecast day.

Rules are the cBot's (cbot/GoldBandBreakoutBot.cs) and were fixed before the day traded:
breakout, centre = prior close, 80% band (z 1.2816), US-data hour skipped, 0.01 lot.
Bands come only from the frozen snapshot (bars closed by the forecast cutoff).
"""
import numpy as np
import pandas as pd

import analysis as A
import bandfade_backtest as B

RULES = dict(centre="prior_close", z=1.2816, skip_data_hour=True, mode="breakout")


def plan_for(F):
    h1, sess = A.session_table(A.load("H_1", pd.Timestamp(F["cutoff_utc"])))
    li = len(sess) - 1
    sigma, _ = A.vol_profile(h1, sess, li)
    assert abs(sess.c[li] - F["anchor"]) < 0.005, "snapshot does not match the frozen anchor"
    return dict(day=pd.Timestamp(F["bars_utc"][0]), anchor=float(sess.c[li]), atr=float(sess.atr[li]),
                center=np.zeros(A.BARS_PER_SESSION), sigma=sigma, bars=[pd.Timestamp(b) for b in F["bars_utc"]])


def run(F, m5):
    plan = plan_for(F)
    tr = B.simulate([plan], m5, **RULES)
    levels = [(k, plan["anchor"] - RULES["z"] * plan["sigma"][k] * plan["atr"],
               plan["anchor"] + RULES["z"] * plan["sigma"][k] * plan["atr"]) for k in range(len(plan["bars"]))]
    return tr, levels
