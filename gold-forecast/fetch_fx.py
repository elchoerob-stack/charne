"""Pull 1h bars (2015-06 -> 2026-11-12) for gold and the currency pairs of the edge search. Read-only.
Usage: python3 fetch_fx.py SYMBOL [PERIOD] [START]. Fetching is not looking: nothing is analysed here."""
import json
import sys

import pandas as pd

from ctrader_data import CTraderData

sym = sys.argv[1]
period = sys.argv[2] if len(sys.argv) > 2 else "H_1"
start = sys.argv[3] if len(sys.argv) > 3 else "2015-06-01T00:00:00Z"
ids = json.load(open("data/fx_symbols.json"))
ct = CTraderData()
df = ct.bars(ids[sym][0], period, pd.Timestamp(start), pd.Timestamp("2026-11-12T00:00:00Z"))
df.to_csv(f"data/fx/{sym}_{period}.csv.gz", index=False)
print(sym, period, len(df), df.time_utc.min(), df.time_utc.max())
