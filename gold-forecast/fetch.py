"""Pull XAUUSD bars for every timeframe from cTrader (read-only) into data/*.csv."""
import sys
from pathlib import Path

import pandas as pd

from ctrader_data import CTraderData

HERE = Path(__file__).parent
# How far back to pull per timeframe (calendar days). Short timeframes only need recent bars.
LOOKBACK_DAYS = {"M_1": 4, "M_5": 12, "M_15": 35, "M_30": 70, "H_4": 400}
# Timeframes whose FULL history feeds the model get a fixed start, so snapshots only grow at the recent end and
# every frozen forecast can be rebuilt exactly (a rolling window silently changed the analog pool on 10 Nov 2026).
FIXED_START = {"H_1": "2024-10-10T23:00:00Z", "D_1": "2024-09-01T21:00:00Z"}


def main(end_utc=None):
    ct = CTraderData()
    sid = ct.symbol_id("XAUUSD")
    end = pd.Timestamp(end_utc, tz="UTC") if end_utc else pd.Timestamp.now(tz="UTC")
    (HERE / "data").mkdir(exist_ok=True)
    plan = {p: end - pd.Timedelta(days=d) for p, d in LOOKBACK_DAYS.items()}
    plan.update({p: pd.Timestamp(s) for p, s in FIXED_START.items()})
    for period in ["M_1", "M_5", "M_15", "M_30", "H_1", "H_4", "D_1"]:
        df = ct.bars(sid, period, plan[period], end)
        df.to_csv(HERE / "data" / f"XAUUSD_{period}.csv", index=False)
        print(f"{period:5s} {len(df):6d} bars  {df.time_utc.min()} -> {df.time_utc.max()}")
    print("spot", ct.spot(sid))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else None)
