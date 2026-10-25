"""Reproduces every number in RESULTS.md for the crypto trend portfolio (C1 rules).

Usage: RESEARCH_CACHE=<dir> python crypto_validation.py <path to Historical-Data/crypto> [--grid]
"""
import itertools
import sys
import pandas as pd

import data
import engine
import portfolio
import strategies as S
from run_crypto import load_coin, SPLIT

MAIN = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "LINKUSDT", "SOLUSDT", "DOGEUSDT"]
FALLEN = ["AVAXUSDT", "DOTUSDT", "NEARUSDT"]   # survivorship test: -76% to -98% from 2021 peaks


class C1Param(S.C1H4Trend):
    """C1 with its five numbers exposed, for the neighbourhood check only."""
    def __init__(self, fast=50, slow=200, dc=20, sl_atr=2.0, trail=3.0):
        self.p = (fast, slow, dc, sl_atr, trail)

    def prepare(self, b):
        fast, slow, dc, _, _ = self.p
        self.warmup = slow + dc
        c = b.close
        self.f = c.ewm(span=fast, adjust=False).mean().to_numpy()
        self.s = c.ewm(span=slow, adjust=False).mean().to_numpy()
        self.a = S.atr(b, 14)
        self.dh = b.high.shift(1).rolling(dc).max().to_numpy()
        self.dl = b.low.shift(1).rolling(dc).min().to_numpy()
        self.h, self.l, self.c = b.high.to_numpy(), b.low.to_numpy(), c.to_numpy()

    def on_bar(self, k, pos):
        _, _, _, sl_atr, trail = self.p
        a = self.a[k]
        if not a > 0:
            return None
        if pos is not None:
            if pos["side"] == 1:
                pos["ext"] = max(pos.get("ext", self.h[k]), self.h[k])
                return {"stop": pos["ext"] - trail * a}
            pos["ext"] = min(pos.get("ext", self.l[k]), self.l[k])
            return {"stop": pos["ext"] + trail * a}
        if self.f[k] > self.s[k] and self.c[k] > self.dh[k]:
            return {"enter": 1, "stop_dist": sl_atr * a}
        if self.f[k] < self.s[k] and self.c[k] < self.dl[k]:
            return {"enter": -1, "stop_dist": sl_atr * a}
        return None


def run_coins(root, coins, strat=lambda: S.C1H4Trend(), cost_mult=1.0):
    out, daily = [], {}
    for c in coins:
        m5 = load_coin(root, c)
        daily[c] = m5.close.resample("1D").last().dropna()
        tr = engine.run(m5, data.resample(m5, "4h"), strat(), engine.CRYPTO, cost_mult=cost_mult)
        out.append(tr.assign(market=c))
    return pd.concat(out).sort_values("exit_time"), daily


if __name__ == "__main__":
    root = sys.argv[1]
    main, d_main = run_coins(root, MAIN)
    fallen, d_fallen = run_coins(root, FALLEN)
    allc, daily = pd.concat([main, fallen]).sort_values("exit_time"), {**d_main, **d_fallen}

    print("8 main coins      :", engine.stats(main))
    print("   2017-2021      :", engine.stats(main[main.entry_time < SPLIT]))
    print("   2022-2026      :", engine.stats(main[main.entry_time >= SPLIT]))
    print("   longs / shorts :", engine.stats(main[main.side == 1])["pf"], "/", engine.stats(main[main.side == -1])["pf"])
    for c in MAIN + FALLEN:
        t = allc[allc.market == c]
        print(f"   {c:9s}", engine.stats(t))
    print("3 fallen coins    :", engine.stats(fallen))
    print("11 coins          :", engine.stats(allc))
    for cm in (0, 2, 3):
        t, _ = run_coins(root, MAIN + FALLEN, cost_mult=cm)
        print(f"11 coins cost x{cm}  :", engine.stats(t), "| 2022+ PF", engine.stats(t[t.entry_time >= SPLIT])["pf"])
    for rp in (0.25, 0.2, 0.15):
        print(f"11-coin portfolio @ {rp}% risk:", portfolio.curve_stats(portfolio.mtm_curve(allc, daily, rp)))
    r = allc.r.sort_values(ascending=False)
    print("sum R:", round(r.sum(), 1), "| minus top 20 trades:", round(r.iloc[20:].sum(), 1),
          "| minus top 50:", round(r.iloc[50:].sum(), 1))

    if "--grid" in sys.argv:
        rows = []
        for dc, sla, tra, (f, sl) in itertools.product((10, 20, 40), (1.5, 2.0, 3.0), (2.0, 3.0, 4.0),
                                                        ((20, 100), (50, 200))):
            t, _ = run_coins(root, MAIN, strat=lambda: C1Param(f, sl, dc, sla, tra))
            rows.append(dict(dc=dc, sl_atr=sla, trail=tra, ema=f"{f}/{sl}", pf=engine.stats(t)["pf"],
                             pf_2022=engine.stats(t[t.entry_time >= SPLIT])["pf"]))
        g = pd.DataFrame(rows)
        print(g.sort_values("pf").to_string(index=False))
        print(f"{len(g)} configs: PF>1.2 {(g.pf > 1.2).mean():.0%}, median PF {g.pf.median()}, "
              f"median 2022+ PF {g.pf_2022.median()}")
