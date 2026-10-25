"""Run the pre-registered candidates on the DEVELOPMENT or HOLDOUT period.

Usage: RESEARCH_CACHE=<dir with *_m1_server.pkl> python run_research.py dev|holdout
Indicators warm up on data before the period start, but only trades entered inside
the period are counted.
"""
import sys
import pandas as pd

import data
import engine
from strategies import CANDIDATES

PERIODS = {
    "dev":     {"gold": ("2015-01-01", "2025-01-01"), "wti": ("2015-01-01", "2026-11-01")},
    "holdout": {"gold": ("2004-07-01", "2015-01-01"), "wti": ("2005-01-01", "2015-01-01")},
}
INST = {"gold": engine.GOLD, "wti": engine.WTI}
WARMUP_DAYS = 400


def load(name):
    return pd.read_pickle(f"{data.CACHE}/{'xauusd' if name == 'gold' else 'wti'}_m1_server.pkl")


def run_period(period, cost_mult=1.0, names=None, verbose=True):
    m1s = {n: load(n) for n in ("gold", "wti")}
    out = {}
    for cname, (cls, tf, markets) in CANDIDATES.items():
        if names and cname not in names:
            continue
        per_market = []
        for mk in markets:
            start, end = (pd.Timestamp(x) for x in PERIODS[period][mk])
            m1 = m1s[mk]
            m1 = m1[(m1.index >= start - pd.Timedelta(days=WARMUP_DAYS)) & (m1.index < end)]
            bars = data.resample(m1, tf)
            tr = engine.run(m1, bars, cls(), INST[mk], cost_mult=cost_mult)
            tr = tr[tr.entry_time >= start].assign(market=mk) if not tr.empty else tr
            per_market.append(tr)
            if verbose:
                print(f"  {cname:14s} {mk:5s}", engine.stats(tr))
        allt = pd.concat(per_market, ignore_index=True).sort_values("exit_time")
        out[cname] = allt
        if verbose:
            print(f"  {cname:14s} ALL  ", engine.stats(allt), "\n")
    return out


if __name__ == "__main__":
    period = sys.argv[1]
    cm = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
    print(f"=== {period.upper()} (cost x{cm}) ===")
    run_period(period, cost_mult=cm)
