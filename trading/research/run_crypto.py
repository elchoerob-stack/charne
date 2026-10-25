"""Round 2b: C1 (H4) and C3 (D1) trend rules, unchanged, on 8 Binance coins.

Stops are resolved on 5-minute bars (not M1) to keep memory reasonable; the
engine's stop-first rule keeps this conservative. UTC timestamps are used as-is
(crypto trades 24/7; there is no broker session to align to).

Usage: RESEARCH_CACHE=<dir> python run_crypto.py <path to Historical-Data/crypto>
"""
import glob
import os
import sys
import pandas as pd

import data
import engine
from strategies import C1H4Trend, C3Turtle

COINS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "LINKUSDT", "SOLUSDT", "DOGEUSDT"]
SPLIT = pd.Timestamp("2022-01-01")


def load_coin(root, coin):
    path = os.path.join(data.CACHE, f"{coin}_5m.pkl")
    if os.path.exists(path):
        return pd.read_pickle(path)
    files = sorted(glob.glob(f"{root}/{coin}/1m/*/*/*.csv"))
    df = pd.concat((pd.read_csv(f, usecols=["datetime_utc", "open", "high", "low", "close"]) for f in files),
                   ignore_index=True)
    df.index = pd.to_datetime(df.pop("datetime_utc")).to_numpy()
    df = df.sort_index()
    df = df[~df.index.duplicated()]
    m5 = data.resample(df, "5min")
    m5.to_pickle(path)
    return m5


def main(root, cost_mult=1.0, verbose=True):
    results = {}
    for name, cls, tf in (("C1_H4_trend", C1H4Trend, "4h"), ("C3_turtle_D1", C3Turtle, "1D")):
        per = []
        for coin in COINS:
            m5 = load_coin(root, coin)
            bars = data.resample(m5, tf)
            tr = engine.run(m5, bars, cls(), engine.CRYPTO, cost_mult=cost_mult)
            if tr.empty:
                continue
            tr = tr.assign(market=coin)
            per.append(tr)
            if verbose:
                print(f"  {name} {coin:9s} {m5.index[0].date()}..", engine.stats(tr))
        allt = pd.concat(per, ignore_index=True).sort_values("exit_time")
        results[name] = allt
        if verbose:
            print(f"  {name} ALL        ", engine.stats(allt))
            print(f"  {name} 2017-2021  ", engine.stats(allt[allt.entry_time < SPLIT]))
            print(f"  {name} 2022-2026  ", engine.stats(allt[allt.entry_time >= SPLIT]))
            prof = allt.groupby("market").r.sum()
            print(f"  {name} coins profitable: {(prof > 0).sum()}/{len(prof)}  by year:",
                  allt.groupby(allt.exit_time.dt.year).r.sum().round(1).to_dict(), "\n")
    return results


if __name__ == "__main__":
    cm = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
    print(f"=== CRYPTO (cost x{cm}) ===")
    main(sys.argv[1], cm)
