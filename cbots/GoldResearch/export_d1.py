"""Daily bars (server clock, NY 17:00 close) and the harness's raw breakout signals, for the C# parity test."""
import sys, numpy as np, pandas as pd
from core import Data, rollmax_prev, rollmin_prev
import families as F
d = Data(sys.argv[1]); cx = F.Ctx(d); D = cx.D
n = 40
hi, lo = rollmax_prev(D.h, n), rollmin_prev(D.l, n)
sig = np.where(D.c > hi, 1, np.where(D.c < lo, -1, 0))
day = pd.to_datetime(D.key * 86400, unit="s").strftime("%Y-%m-%d")
with open(sys.argv[2], "w") as f:
    f.write("day,open,high,low,close,signal40\n")
    for k in range(D.n):
        f.write(f"{day[k]},{D.o[k]:.3f},{D.h[k]:.3f},{D.l[k]:.3f},{D.c[k]:.3f},{int(sig[k])}\n")
print(D.n, "days,", int((sig != 0).sum()), "raw signals")
