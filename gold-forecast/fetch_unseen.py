"""Pull 5-minute XAUUSD bars for the period BEFORE the bot research started (2026-01-13 and earlier).
Rules were designed on 2026-01-14 -> 2026-11-09; this window plays no part in choosing them."""
import pandas as pd
from ctrader_data import CTraderData

ct = CTraderData()
sid = ct.symbol_id("XAUUSD")
end = pd.Timestamp("2026-01-14T00:00:00Z")
df = ct.bars(sid, "M_5", pd.Timestamp("2024-10-01T00:00:00Z"), end)
df.to_csv("data/XAUUSD_M_5_unseen.csv", index=False)
print(len(df), df.time_utc.min(), df.time_utc.max())
