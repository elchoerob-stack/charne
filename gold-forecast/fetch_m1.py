"""Pull 1-minute XAUUSD bars for one calendar year (read-only), for the lower-timeframe exit test.
Fetching is not looking: nothing is analysed here."""
import sys

import pandas as pd

from ctrader_data import CTraderData

y = int(sys.argv[1])
ct = CTraderData()
sid = ct.symbol_id("XAUUSD")
end = pd.Timestamp(f"{y + 1}-01-01T00:00:00Z") if y < 2026 else pd.Timestamp("2026-11-09T22:00:00Z")
df = ct.bars(sid, "M_1", pd.Timestamp(f"{y}-01-01T00:00:00Z"), end)
df.to_csv(f"data/XAUUSD_M_1_{y}.csv.gz", index=False)
print(y, len(df), df.time_utc.min(), df.time_utc.max())
