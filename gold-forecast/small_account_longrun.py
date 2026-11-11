"""Long-run odds for a small account on the bot's rules (v2.2 rules, unchanged), using the 2016-2024 sessions rescaled to
today's volatility: every price move is multiplied by $60 / that session's ATR, then today's costs are charged
($0.50 per oz on XAUUSD, $0.70 per oz-equivalent on gram gold). Same account walk as small_account_test.py.
Descriptive only: it selects nothing. Run after continuation_test.py (11 Nov 2026)."""
import numpy as np
import pandas as pd

import contsim as C
import continuation_test as T
import small_account_test as S

if __name__ == "__main__":
    P, m5 = T.fresh_plans(), T.fresh_m5()
    out = C.outcomes(P, m5, 1.2816, "both")
    tr = C.trades(out, cost=0.0)
    f = T.ATR_REF / np.array([o["atr"] for o in out])
    g = tr.gross * f[tr.sess.values]
    print(f"2016-2024, {len(tr)} trades: before costs win {(tr.gross > 0).mean():.1%}, PF {C.pf(tr.gross):.3f}; "
          f"at today's volatility: PF {C.pf(g - 0.50):.3f} after $0.50 (1 oz), {C.pf(g - 0.70):.3f} after $0.70 (gram gold); "
          f"average trade {np.mean(g - 0.70):+.2f} $/oz-equivalent")
    for o, k in zip(out, f):                       # rescale every outcome to today's volatility
        for r in o["hours"].values():
            r["d"] *= k
            if r["fill"]:
                r["gross"] *= k; r["mae"] *= k
    n = len(out)
    rows = []
    for cap_r in (300, 1000, 2000):
        e = cap_r / S.USDZAR
        for name, oz, cost, cap in (("1 oz, no cap", 1.0, 0.50, None), ("5 g, no cap", 5 * S.OZ_PER_GRAM, 0.70, None), ("5 g, cap 33%", 5 * S.OZ_PER_GRAM, 0.70, 1 / 3)):
            for horizon in (60, 250):
                ends, wiped, trs = [], 0, []
                for s0 in range(0, n - horizon + 1, 5):
                    eq, t_, w, _ = S.walk(out, s0, horizon, e, oz, cost, cap)
                    ends.append(eq / e); wiped += w; trs.append(t_)
                ends = np.array(ends)
                rows.append(dict(start=f"R{cap_r:,}", size=name, sessions=horizon, wiped=f"{wiped / len(ends):.0%}", below25=f"{(ends < .25).mean():.0%}",
                                 below50=f"{(ends < .5).mean():.0%}", above150=f"{(ends > 1.5).mean():.0%}", doubled=f"{(ends > 2).mean():.0%}",
                                 x10=f"{(ends > 10).mean():.1%}", median_end_R=round(float(np.median(ends)) * cap_r), trades=round(float(np.mean(trs)))))
    R = pd.DataFrame(rows)
    pd.set_option("display.width", 220)
    print(R.to_string(index=False))
    R.to_csv(S.B.HERE / "backtest" / "small_account_longrun.csv", index=False)
