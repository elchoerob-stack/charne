"""R1000 compounded through the 11-coin crypto trend backtest at different risk levels.

Shows that leverage only sets margin; risk per trade sets the outcome. Daily
mark-to-market returns from the non-compounded curve are compounded on current
equity (an approximation: real position sizes are fixed at entry).

Usage: RESEARCH_CACHE=<dir> python leverage_example.py   (needs crypto_validation outputs cached)
"""
import pandas as pd

import data
import portfolio

trades = pd.read_pickle(f"{data.CACHE}/c1_crypto11_trades.pkl")
daily_close = pd.read_pickle(f"{data.CACHE}/crypto_daily.pkl")
base = portfolio.mtm_curve(trades, daily_close, 1.0)
daily = base.diff().fillna(base.iloc[0]) / 100           # daily return at 1% risk per trade
years = (base.index[-1] - base.index[0]).days / 365.25

notional_per_risk = trades.units * trades.entry / trades.risk
open_notional = pd.Series(0.0, index=base.index)
for (_, t), npr in zip(trades.iterrows(), notional_per_risk):
    m = (base.index >= t.entry_time.normalize()) & (base.index < t.exit_time.normalize())
    open_notional[m] += npr

rows = []
for risk in (0.15, 0.25, 0.5, 1.0, 2.0, 3.0, 5.0):
    eq = peak = 1000.0
    mdd, stopped = 0.0, None
    for t, x in (daily * risk).items():
        eq = max(eq * (1 + x), 0.0)
        peak = max(peak, eq)
        mdd = max(mdd, 1 - eq / peak if peak else 1)
        if stopped is None and 1 - eq / peak >= 0.20:
            stopped = f"{t.date()} at R{eq:,.0f}"
        if eq == 0:
            break
    rows.append(dict(risk_per_trade=f"{risk}%", final=f"R{eq:,.0f}",
                     cagr=f"{((eq / 1000) ** (1 / years) - 1) * 100:.1f}%" if eq > 0 else "bust",
                     max_drawdown=f"{mdd * 100:.1f}%", kill_switch_20pct=stopped or "never",
                     peak_leverage_used=f"{(open_notional * risk / 100).max():.1f}:1"))
print(f"{base.index[0].date()} -> {base.index[-1].date()} ({years:.1f} years)")
print(pd.DataFrame(rows).to_string(index=False))
