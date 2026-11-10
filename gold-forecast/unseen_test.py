"""PRE-REGISTERED unseen-period test of GoldBandBreakoutBot v1 rules.

Committed BEFORE it was run. Nothing below may change after seeing the result.

Rules under test (exactly the bot's, nothing re-tuned):
    breakout | centre = prior close | z = 1.2816 | skip the US-data hour | 0.01 lot | $0.50 cost per trade
    fills and ambiguity resolved against us, as in bandfade_backtest.py
Period: sessions that START between the first session with 150 sessions of history behind it
        (about May 2025) and 2026-01-13. The rules were designed on 2026-01-14 -> 2026-11-09 data,
        so this period played no part in choosing them. Bands are walk-forward (past sessions only).
Data:   cTrader 5-minute bars (not ticks) - the same fill-realism caveat as before.
Gate:   cbot-gate with the fixed thresholds; the 2026 trades are the in-sample side.
One extra look is declared in advance: the fade counterpart (buy low / sell high) with the same
settings, because it is the original idea. Looks at this period: 2.

Prior belief (written before running): 2026 in-sample PF was only 1.04 and the out-of-sample 1.44
was picked from 16 variants. A PASS here would be a surprise; PF between 0.9 and 1.15 is the
expected outcome, and a FAIL is a useful result, not a reason to re-tune.
"""
import json
import sys

import pandas as pd

import analysis as A
import bandfade_backtest as B

END = pd.Timestamp("2026-01-13T23:59:00Z")
RULES = dict(centre="prior_close", z=1.2816, skip_data_hour=True)


def plans(m5_min, end):
    h1, sess = A.session_table(A.load("H_1", pd.Timestamp("2026-11-09T22:00:00Z")))
    out = []
    for t in range(150, len(sess) - 1):
        day = sess.start[t + 1]
        if day < m5_min or day > end:
            continue
        sig, _ = A.vol_profile(h1, sess, t)          # uses sessions before t only
        nxt = h1[h1.session == sess.session[t + 1]]
        out.append(dict(day=day, anchor=sess.c[t], atr=sess.atr[t], center=[0.0] * A.BARS_PER_SESSION,
                        sigma=sig, bars=list(nxt.time_utc)))
    return out


if __name__ == "__main__":
    m5 = pd.read_csv(B.HERE / "data" / "XAUUSD_M_5_unseen.csv", parse_dates=["time_utc"])
    P = plans(m5.time_utc.min() + pd.Timedelta(days=1), END)
    print(f"{len(P)} sessions {P[0]['day']:%Y-%m-%d} -> {P[-1]['day']:%Y-%m-%d}")
    out = B.HERE / "backtest"
    for mode in ("breakout", "fade"):
        tr = B.simulate(P, m5, mode=mode, **RULES)
        tr["Closing Time"] = tr.exit_time.dt.strftime("%Y-%m-%d %H:%M:%S")
        tr["Net Profit"] = tr.net
        tr.to_csv(out / f"unseen_{mode}_trades.csv", index=False)
        print(mode, B.stats(tr))
