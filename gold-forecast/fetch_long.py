"""Pull long XAUUSD history that NO test in this project has used: 1h bars from 2015-06 and 5-minute bars from
2016-01-01 up to 2024-10-01 (the existing files start there). Read-only. Fetching is not looking: nothing is
analysed here, and the files must not be opened for analysis before a test on them is pre-registered and committed."""
import sys

import pandas as pd

from ctrader_data import CTraderData

ct = CTraderData()
sid = ct.symbol_id("XAUUSD")
what = sys.argv[1]
if what == "H1":
    df = ct.bars(sid, "H_1", pd.Timestamp("2015-06-01T00:00:00Z"), pd.Timestamp("2024-10-10T23:00:00Z"))
    df.to_csv("data/XAUUSD_H_1_2015_2024.csv.gz", index=False)
else:
    y = int(what)
    df = ct.bars(sid, "M_5", pd.Timestamp(f"{y}-01-01T00:00:00Z"), pd.Timestamp(f"{y + 1}-01-01T00:00:00Z") if y < 2024 else pd.Timestamp("2024-10-01T00:00:00Z"))
    df.to_csv(f"data/XAUUSD_M_5_{y}.csv.gz", index=False)
print(what, len(df), df.time_utc.min(), df.time_utc.max())
