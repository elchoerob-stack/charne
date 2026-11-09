import pickle, sys, csv
import numpy as np, pandas as pd
from core import Data
import families as F
d = Data(sys.argv[1]); cx = F.Ctx(d)
fin = pickle.load(open("finalists.pkl", "rb"))
def ts(i): return pd.Timestamp(int(d.t[i]) * 60, unit="s").strftime("%Y-%m-%d %H:%M:%S")
for key, fn in (("A DC D1 n40 chand3 both", "trend_A.csv"), ("C LB spec +D1 EMA100", "london_C.csv")):
    bal = 10000.0
    with open(fn, "w", newline="") as f:
        w = csv.writer(f); w.writerow(["Closing Time", "Entry Time", "Direction", "R", "Net Profit", "Balance", "Exit"])
        for (i0, i1, s, e, x, R, r, why) in fin[key]:
            if i0 < d.idx_of_utc("2016-09-01"): continue
            pnl = bal * 0.005 * r; bal += pnl
            w.writerow([ts(i1), ts(i0), "Buy" if s > 0 else "Sell", f"{r:.3f}", f"{pnl:.2f}", f"{bal:.2f}", why])
    print(fn, "end balance", round(bal, 2))
# account size needed for 1 oz minimum at 0.5% risk with a 2.5 x ATR(20) daily stop
D = cx.D; a = cx.d_atr20
for y in (2017, 2020, 2023, 2025, 2026):
    ks = [k for k in range(D.n) if d.year[D.first[k]] == y]
    stop = 2.5 * np.median(a[ks]); print(y, f"median D1 ATR20 ${np.median(a[ks]):.0f}  stop ${stop:.0f}/oz  min account at 0.5% risk ${stop/0.005:,.0f}")
# holding time
h = [(i1 - i0) / 1440 for (i0, i1, s, e, x, R, r, why) in fin["A DC D1 n40 chand3 both"]]
print("trend A holding days: median %.1f, max %.1f" % (np.median(h), max(h)))
