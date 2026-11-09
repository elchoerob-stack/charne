"""Pull XAUUSD bars for every timeframe from cTrader (read-only) into data/*.csv."""
import sys
from pathlib import Path

import pandas as pd

from ctrader_data import CTraderData

HERE = Path(__file__).parent
# How far back to pull per timeframe (calendar days).
LOOKBACK_DAYS = {"M_1": 4, "M_5": 12, "M_15": 35, "M_30": 70, "H_1": 760, "H_4": 400, "D_1": 800}


def main(end_utc=None):
    ct = CTraderData()
    sid = ct.symbol_id("XAUUSD")
    end = pd.Timestamp(end_utc, tz="UTC") if end_utc else pd.Timestamp.now(tz="UTC")
    (HERE / "data").mkdir(exist_ok=True)
    for period, days in LOOKBACK_DAYS.items():
        df = ct.bars(sid, period, end - pd.Timedelta(days=days), end)
        df.to_csv(HERE / "data" / f"XAUUSD_{period}.csv", index=False)
        print(f"{period:5s} {len(df):6d} bars  {df.time_utc.min()} -> {df.time_utc.max()}")
    print("spot", ct.spot(sid))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else None)
