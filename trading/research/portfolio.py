"""Mark-to-market portfolio equity from per-market trade lists.

Each trade risks `risk_pct` of the STARTING balance (no compounding), so the curve is
in percent of initial capital and drawdowns are not flattered by growth. Open trades
are marked at each day's close (unrealised losses count), costs are taken at exit.
"""
import numpy as np
import pandas as pd


def mtm_curve(trades, daily_close, risk_pct):
    """trades: DataFrame with market, side, entry, units, risk, entry_time, exit_time, pnl.
    daily_close: dict market -> Series of daily closes. Returns daily equity in % of start."""
    days = pd.date_range(min(t.entry_time.min() for t in [trades]).normalize(),
                         trades.exit_time.max().normalize(), freq="D")
    eq = pd.Series(0.0, index=days)
    for _, t in trades.iterrows():
        scale = risk_pct / t.risk                       # % of capital per USD of this trade
        dc = daily_close[t.market]
        open_days = days[(days >= t.entry_time.normalize()) & (days < t.exit_time.normalize())]
        if len(open_days):
            px = dc.reindex(open_days, method="ffill").to_numpy()
            unreal = (px - t.entry) * t.side * t.units * scale
            eq.loc[open_days] += unreal
        eq.loc[eq.index >= t.exit_time.normalize()] += t.pnl * scale
    return eq


def curve_stats(eq):
    peak = eq.cummax()
    dd = (peak - eq)
    yearly = eq.resample("YE").last().diff().fillna(eq.resample("YE").last().iloc[0])
    daily = eq.diff().dropna()
    sharpe = daily.mean() / daily.std() * np.sqrt(365) if daily.std() > 0 else np.nan
    return dict(total_pct=round(eq.iloc[-1], 1), max_dd_pct=round(dd.max(), 1),
                worst_year_pct=round(yearly.min(), 1), best_year_pct=round(yearly.max(), 1),
                sharpe_daily=round(sharpe, 2), years={y.year: round(v, 1) for y, v in yearly.items()})
