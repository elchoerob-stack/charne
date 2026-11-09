"""The research harness's London-breakout trades (D1 EMA100 filter, published exits), for the
GoldBreakout cBot's replay test: broker day, direction, entry, stop, target."""
import sys
import pandas as pd
from core import Data
import families as F
d = Data(sys.argv[1]); cx = F.Ctx(d)
sig = F.london_breakout(cx, trend="ema100")
with open(sys.argv[2], "w") as f:
    f.write("broker_day,dir,entry,stop,target\n")
    for g in sig:
        day = pd.Timestamp(int(d.sday[g["i0"]]) * 86400, unit="s").strftime("%Y-%m-%d")
        f.write(f"{day},{g['dir']},{g['entry']:.5f},{g['stop']:.5f},{g['tp']:.5f}\n")
print(len(sig), "trades")
