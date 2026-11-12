"""PRE-REGISTERED: fine-tune the USDJPY Asian-range breakout on 2016-2020, then judge it once on the unused years.
Committed before running; the script runs every stage by itself.

Understanding (design years only, usdjpy_lab.py): the base rule made PF 1.18. It loses when the Asian range is tiny
(range <= 0.3 ATR: PF 0.55 - the stop at the range middle sits inside the noise) and in the first London hour
(03:00-04:00 New York: PF 0.96). Buy/sell, weekday and year differences are treated as noise and NOT tuned.

Grid (32 settings, all mechanical): minimum Asian range 0 or 0.3 ATR; stop at the range middle or the far side;
first signal hour 10 or 11 (03:00 or 04:00 New York); exit at the close of hour 20 or 23; no target or a target of
2 x the stop distance. Costs 0.99 bp a round trip (spread x 1.5 + commission), 1h bars, stop first when in doubt.

Stages, same pass marks as edge_search.py:
  DESIGN 2016-2020: pick the setting with the highest PF among those with >= 100 trades a year and P(PF < 1) <= 2.5%;
                    it must have PF >= 1.25, otherwise the work stops here.
  VALIDATION 2021 - Sep 2024: that one setting, unchanged: PF >= 1.20, >= 100 trades a year, P(PF < 1) <= 10%.
  CONFIRMATION Oct 2024 - 11 Nov 2026: PF >= 1.30, >= 100 trades, P(PF < 1) <= 10%, PF >= 1.10 at double cost -> FOUND.
Whatever happens, the chosen setting's numbers for every stage it reached are reported as they are.
Prior: choosing the best of 32 flatters the design PF; I expect validation PF between 1.0 and 1.2 and a fail.
"""
import itertools
import json

import numpy as np
import pandas as pd

import edge_search as E
import usdjpy_lab as U

STAGE = {"design": ("2016-01-01", "2020-12-31"), "validation": ("2021-01-01", "2024-09-30"), "confirmation": ("2024-10-01", "2026-11-11")}


def cut(t, name):
    a, b = STAGE[name]
    return t[(t.date >= a) & (t.date <= b)], (pd.Timestamp(b) - pd.Timestamp(a)).days / 365.25


if __name__ == "__main__":
    m = E.Market("USDJPY")
    rows = []
    for min_rng, stop, s0, exit_h, target in itertools.product((0.0, 0.3), ("mid", "far"), (10, 11), (20, 23), (None, 2)):
        kw = dict(min_rng=min_rng, stop=stop, s0=s0, exit_h=exit_h, target=target)
        t, y = cut(U.simulate(m, **kw), "design")
        rows.append(dict(**kw, **U.summary(t, y)))
    G = pd.DataFrame(rows)
    pd.set_option("display.width", 200)
    print("DESIGN grid, best 12 by PF:\n", G.sort_values("pf", ascending=False).head(12).to_string(index=False))
    ok = G[(G.per_year >= 100) & (G.p <= 0.025)].sort_values("pf", ascending=False)
    out = dict(design_ok=len(ok))
    if not len(ok) or ok.iloc[0].pf < 1.25:
        print("\nNo setting reaches PF 1.25 with 100+ trades a year and P <= 2.5% on the design years. Stopped.")
    else:
        b = ok.iloc[0]
        kw = dict(min_rng=float(b.min_rng), stop=b.stop, s0=int(b.s0), exit_h=int(b.exit_h), target=None if pd.isna(b.target) else float(b.target))
        print("\nchosen:", kw, "| design PF", b.pf, "trades/yr", b.per_year, "P", b.p)
        full = U.simulate(m, **kw)
        full.to_csv(E.HERE / "backtest" / "usdjpy_london_trades.csv", index=False)
        v, y = cut(full, "validation")
        sv = U.summary(v, y)
        vok = sv["pf"] >= 1.20 and sv["per_year"] >= 100 and sv["p"] <= 0.10
        print("VALIDATION 2021 - Sep 2024:", sv, "->", "PASS" if vok else "FAIL")
        out.update(chosen=kw, design=dict(pf=float(b.pf), per_year=float(b.per_year), p=float(b.p)), validation=sv, validation_pass=bool(vok))
        if vok:
            c, y = cut(full, "confirmation")
            sc = U.summary(c, y)
            c2, _ = cut(U.simulate(m, cost_mult=2.0, **kw), "confirmation")
            pf2 = E.pf(c2.net.values)
            found = sc["pf"] >= 1.30 and sc["n"] >= 100 and sc["p"] <= 0.10 and pf2 >= 1.10
            print("CONFIRMATION Oct 2024 - Nov 2026:", sc, "| PF at double cost", round(pf2, 3), "->", "FOUND" if found else "NOT FOUND")
            print("by year:", full.groupby(full.date.dt.year).net.agg(n="size", pf=E.pf).round(2).T.to_string())
            out.update(confirmation=sc, pf_double_cost=pf2, found=bool(found))
    json.dump(out, open(E.HERE / "backtest" / "usdjpy_london_result.json", "w"), indent=1, default=str)
