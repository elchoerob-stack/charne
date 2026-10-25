"""Shared data loading for the strategy research.

Source format (parshant65-lang/* GitHub archives): one CSV per day,
columns timestamp,datetime_utc,open,high,low,close,volume (UTC, 1-minute bars).

All loaders return M1 bars indexed by broker *server time* = New York time + 7h
(NY close = midnight), the convention of most cTrader/MT5 brokers. That makes
D1 bars run 17:00-17:00 New York and H4 bars start at 00/04/08/12/16/20 server.
"""
import glob
import os
import pandas as pd

CACHE = os.environ.get("RESEARCH_CACHE", ".")


def load_daily_csvs(pattern):
    files = sorted(glob.glob(pattern))
    df = pd.concat((pd.read_csv(f, usecols=["datetime_utc", "open", "high", "low", "close"])
                    for f in files), ignore_index=True)
    utc = pd.to_datetime(df.pop("datetime_utc")).dt.tz_localize("UTC")
    server = utc.dt.tz_convert("America/New_York").dt.tz_localize(None) + pd.Timedelta(hours=7)
    df.index = server.to_numpy()
    df = df.sort_index()
    return df[~df.index.duplicated()]


def cached(name, pattern):
    path = os.path.join(CACHE, f"{name}_m1_server.pkl")
    if os.path.exists(path):
        return pd.read_pickle(path)
    df = load_daily_csvs(pattern)
    df.to_pickle(path)
    return df


def resample(m1, rule):
    return m1.resample(rule, label="left", closed="left").agg(
        dict(open="first", high="max", low="min", close="last")).dropna()


def quality_report(m1, min_bars_per_month=15000):
    n = m1.close.resample("ME").size()
    thin = n[n < min_bars_per_month]
    gaps = m1.index.to_series().diff()
    big = gaps[gaps > pd.Timedelta(days=4)]
    return dict(start=m1.index[0], end=m1.index[-1], bars=len(m1),
                thin_months={str(k)[:7]: int(v) for k, v in thin.items()},
                gaps_over_4d=[(str(t - g), str(t)) for t, g in big.items()])
