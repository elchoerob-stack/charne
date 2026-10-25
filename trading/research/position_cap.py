"""Portfolio-level cap on open positions for the 11-coin crypto trend portfolio.

Trades come from the uncapped run (crypto_validation.py cache). A trade is taken only if
fewer than `cap` positions are open at its entry time (first come, first served), which
approximates the cBot's cap. Equity is marked to market daily and compounded.

Usage: RESEARCH_CACHE=<dir> python position_cap.py
"""
import pandas as pd

import data
import portfolio


def apply_cap(trades, cap):
    keep, open_exits = [], []
    for i, t in trades.iterrows():
        open_exits = [e for e in open_exits if e > t.entry_time]
        if len(open_exits) < cap:
            keep.append(i)
            open_exits.append(t.exit_time)
    return trades.loc[keep]


def compounded(curve_at_1pct, risk, start=None):
    d = curve_at_1pct.diff().fillna(curve_at_1pct.iloc[0]) / 100 * risk
    if start:
        d = d[d.index >= start]
    eq = (1 + d).cumprod()
    years = (d.index[-1] - d.index[0]).days / 365.25
    yearly = eq.resample("YE").last()
    yearly = yearly / yearly.shift(1).fillna(1) - 1
    return eq.iloc[-1] ** (1 / years) - 1, (1 - eq / eq.cummax()).max(), yearly, eq.iloc[-1]


if __name__ == "__main__":
    trades = pd.read_pickle(f"{data.CACHE}/c1_crypto11_trades.pkl").sort_values("entry_time").reset_index(drop=True)
    daily = pd.read_pickle(f"{data.CACHE}/crypto_daily.pkl")
    rows = []
    for cap in (11, 6, 5, 4, 3):
        tr = trades if cap == 11 else apply_cap(trades, cap)
        c1 = portfolio.mtm_curve(tr, daily, 1.0)
        for risk in (0.15, 0.25, 0.35, 0.4, 0.45, 0.6):
            g, dd, yearly, mult = compounded(c1, risk)
            g2, dd2, _, _ = compounded(c1, risk, "2022-01-01")
            rows.append(dict(max_open=cap, trades=len(tr), risk=risk, cagr=f"{g:.1%}", max_dd=f"{dd:.1%}",
                             worst_year=f"{yearly.min():.1%}", cagr_2022on=f"{g2:.1%}",
                             R1000_to=f"R{1000 * mult:,.0f}", calmar=round(g / dd, 2)))
    print(pd.DataFrame(rows).to_string(index=False))
