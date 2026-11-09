"""Stage 8: tune ONE currency pair on 2025, then test on years it never saw.

The user's method: fit the best "high PF, many trades" setup on 2025, then check it on untouched
data. Fixed before running:
  - Symbol: EURUSD (broker M1 data, Sep 2016 - Nov 2026, measured spread + 0.7 pip commission).
  - Three templates, N random settings each (seeded), scored on 2025 only:
      RB  session range breakout (range window, entry window, range filter, stop cap, target,
          break-even, daily trend filter)
      MR  RSI(2) mean reversion on M15 / H1 / H4 (threshold, exit level, max hold, ATR stop,
          trend filter, session)
      CB  channel breakout on M15 / H1 with an ATR trail (length, stop, trail, trend, session)
  - Score on 2025 = total R (profit in units of risk) among settings with PF >= 1.2 and
    >= 100 trades; the frontier of PF against trade count is printed too.
  - The top 5 by that score are then run ONCE on Jan-Nov 2026 and on 2016-2024.
Usage: python3 tune_fx.py eurusd_m1_10y.csv [n_per_template=200]
"""
import random
import sys
import numpy as np
import pandas as pd
import core
from core import Data, Bars, Mgmt, run, stats, atr, ema, sma, rsi
import families as F

PIP = 1e-4
ECB = {2016: -.4, 2017: -.4, 2018: -.4, 2019: -.45, 2020: -.5, 2021: -.5, 2022: .3,
       2023: 3.3, 2024: 3.6, 2025: 2.2, 2026: 2.0}


def eurusd_swap_pct(year, direction):
    gap = core.FF.get(year, 2.0) - ECB.get(year, 0.0)
    return max(0.0, (gap if direction > 0 else -gap) + 1.0)


def next_true_after(mask, idx):
    pos = np.flatnonzero(mask)
    j = np.searchsorted(pos, idx, side="right")
    return np.where(j < len(pos), pos[np.minimum(j, len(pos) - 1)], len(mask))


class T:
    def __init__(self, d):
        self.d = d
        self.cx = F.Ctx(d)
        self.umod = d.t % 1440
        self.tf = {15: Bars(d, 15), 60: self.cx.H1, 240: self.cx.H4}
        self.ind = {}

    def daily_side(self, B, kind):
        """+1/-1/0 per bar of B from the previous completed broker day."""
        if kind is None:
            return np.ones(B.n, dtype=int) * 2           # 2 = both sides allowed
        D, cx = self.cx.D, self.cx
        kd = D.of[B.first] - 1
        kd = np.maximum(kd, 0)
        ref = {"ema50": cx.d_ema50, "ema100": cx.d_ema100, "sma200": cx.d_sma200}[kind][kd]
        c = D.c[kd]
        return np.where(np.isnan(ref), 0, np.where(c > ref, 1, np.where(c < ref, -1, 0)))

    def emit(self, B, ks, dirs, sd, td, end, sess, mg_k=None, trail_start=None, tag=""):
        d, out = self.d, []
        for i in range(len(ks)):
            k = ks[i]
            i0 = B.last[k] + 1
            if i0 >= d.n or not (sess[0] <= self.umod[i0] < sess[1]) or not (sd[i] > 0):
                continue
            s = int(dirs[i])
            entry = d.ao[i0] if s > 0 else d.bo[i0]
            mg = Mgmt(trail_start_r=trail_start, trail_k=mg_k[i]) if mg_k is not None else None
            out.append(dict(i0=i0, entry=entry, dir=s, stop=entry - s * sd[i],
                            tp=None if td is None else entry + s * td[i],
                            j_end=B.first[min(int(end[i]), B.n - 1)], fill_bar_checked=False, tag=tag, mg=mg))
        return out

    # ---------------------------------------------------------------- templates
    def RB(self, p):
        e = dict(tp_r=p["tp"], be_r=p["be"])
        return F._range_breakout(self.cx, p["r_from"], p["r_to"], p["e_to"], p["e_to"], p["min_w"], p["max_w"],
                                 p["cap"], 0.0, e["tp_r"], e["be_r"], p["trend"], "RB")

    def MR(self, p):
        B = self.tf[p["tf"]]
        r = rsi(B.c, 2)
        a = atr(B, 14)
        side = self.daily_side(B, p["trend"])
        lg = (r < p["th"]) & ((side == 1) | (side == 2))
        sh = (r > 100 - p["th"]) & ((side == -1) | (side == 2))
        ks = np.flatnonzero(lg | sh)
        dirs = np.where(lg[ks], 1, -1)
        ex = np.where(dirs > 0, next_true_after(r > p["exit"], ks), next_true_after(r < 100 - p["exit"], ks)) + 1
        end = np.minimum(ex, ks + 1 + p["hold"])
        return self.emit(B, ks, dirs, p["stop"] * a[ks], None, end, p["sess"], tag="MR")

    def CB(self, p):
        B = self.tf[p["tf"]]
        a = atr(B, 14)
        hi = pd.Series(B.h).rolling(p["n"]).max().shift(1).to_numpy()
        lo = pd.Series(B.l).rolling(p["n"]).min().shift(1).to_numpy()
        side = self.daily_side(B, p["trend"])
        lg = (B.c > hi) & ((side == 1) | (side == 2))
        sh = (B.c < lo) & ((side == -1) | (side == 2))
        ks = np.flatnonzero(lg | sh)
        dirs = np.where(lg[ks], 1, -1)
        return self.emit(B, ks, dirs, p["stop"] * a[ks], None, ks + 1 + p["hold"], p["sess"],
                         mg_k=p["trail"] * a[ks], trail_start=p["trail_from"], tag="CB")


SESS = {"all": (0, 1440), "eu+us": (7 * 60, 20 * 60), "eu": (7 * 60, 12 * 60), "us": (12 * 60, 20 * 60), "asia": (0, 7 * 60)}


def sample(rng, kind):
    if kind == "RB":
        return dict(kind="RB", r_from=rng.choice([0, 60, 120, 180]), r_to=rng.choice([360, 420, 480, 540, 600]),
                    e_to=rng.choice([900, 1080, 1260]), min_w=rng.choice([0.0005, 0.001, 0.0015]),
                    max_w=rng.choice([0.004, 0.006, 0.01]), cap=rng.choice([0.002, 0.003, 0.004]),
                    tp=rng.choice([1.0, 1.5, 2.0, 2.5, 3.0]), be=rng.choice([0.0, 1.0, 1.5]),
                    trend=rng.choice([None, "ema50", "ema100", "sma200"]))
    if kind == "MR":
        return dict(kind="MR", tf=rng.choice([15, 60, 240]), th=rng.choice([3, 5, 10, 15]), exit=rng.choice([50, 60, 70]),
                    hold=rng.choice([4, 8, 16, 32]), stop=rng.choice([1.5, 2.0, 3.0, 4.0]),
                    trend=rng.choice([None, "ema100", "sma200"]), sess=SESS[rng.choice(list(SESS))])
    return dict(kind="CB", tf=rng.choice([15, 60]), n=rng.choice([10, 20, 40]), stop=rng.choice([1.0, 1.5, 2.0]),
                trail=rng.choice([1.0, 1.5, 2.0, 3.0]), trail_from=rng.choice([0.0, 1.0]), hold=rng.choice([16, 48, 96]),
                trend=rng.choice([None, "ema100"]), sess=SESS[rng.choice(["eu+us", "eu", "us"])])


def label(p):
    q = {k: (v if not isinstance(v, tuple) else f"{v[0]//60:02d}-{v[1]//60:02d}h") for k, v in p.items()}
    return " ".join(f"{k}={v}" for k, v in q.items())


def main():
    path = sys.argv[1]
    n_per = int(sys.argv[2]) if len(sys.argv) > 2 else 200
    core.COMMISSION = 0.00007
    core.COMMISSION_FRAC = 0.0
    core.SWAP_FN = eurusd_swap_pct
    d = Data(path)
    t = T(d)
    I = d.idx_of_utc
    W25 = (I("2025-01-01"), I("2026-01-01"))
    W26 = (I("2026-01-01"), d.n)
    WOLD = (I("2016-09-01"), I("2025-01-01"))
    rng = random.Random(2025)
    cfgs = [sample(rng, k) for k in ("RB", "MR", "CB") for _ in range(n_per)]
    seen, uniq = set(), []
    for p in cfgs:
        key = label(p)
        if key not in seen:
            seen.add(key)
            uniq.append(p)
    print(f"{len(uniq)} distinct settings, tuned on 2025 only\n", flush=True)
    rows = []
    for i, p in enumerate(uniq):
        sig = getattr(t, p["kind"])(p)
        sig25 = [g for g in sig if W25[0] <= g["i0"] < W25[1]]
        tr = run(d, sig25)
        s = stats(d, tr)
        tot = s["avg"] * s["n"] if s["n"] else 0.0
        rows.append((p, s, tot, sig))
        if (i + 1) % 100 == 0:
            print(f"  {i+1}/{len(uniq)} done", flush=True)

    print("\n2025 frontier: best PF at each minimum trade count")
    for m in (100, 250, 500, 1000, 2000):
        c = [r for r in rows if r[1]["n"] >= m]
        if c:
            b = max(c, key=lambda r: r[1]["pf"])
            print(f"  >= {m:4d} trades: PF {b[1]['pf']:.2f} ({b[1]['n']} trades, {b[2]:+.1f}R)  {label(b[0])}")
        else:
            print(f"  >= {m:4d} trades: none")

    ok = [r for r in rows if r[1]["n"] >= 100 and r[1]["pf"] >= 1.2]
    top = sorted(ok, key=lambda r: -r[2])[:5]
    print(f"\n{len(ok)} settings reach PF >= 1.2 with >= 100 trades in 2025. Top 5 by total R, then tested ONCE on unseen years:\n")
    for rank, (p, s, tot, sig) in enumerate(top, 1):
        print(f"#{rank} {label(p)}")
        print(f"   2025 (tuned)      n={s['n']:5d} PF={s['pf']:.2f} avgR={s['avg']:+.3f} total={tot:+.1f}R win={s['win']*100:.0f}%")
        for name, w in (("2026 Jan-Nov", W26), ("2016-2024", WOLD)):
            tr = run(d, [g for g in sig if w[0] <= g["i0"] < w[1]])
            so = stats(d, tr)
            print(f"   {name:17s} n={so['n']:5d} PF={so['pf']:.2f} avgR={so['avg']:+.3f} total={so['avg']*so['n']:+.1f}R  ({so['tpy']:.0f}/yr)")
        yrs = {}
        trall = run(d, [g for g in sig if g["i0"] >= WOLD[0]])
        for tt in trall:
            yrs.setdefault(int(d.year[tt.i0]), []).append(tt.r)
        print("   by year PF: " + " ".join(f"{y%100:02d}:{(sum(x for x in v if x>0)/max(1e-9,-sum(x for x in v if x<0))):.2f}" for y, v in sorted(yrs.items())))
        print()


if __name__ == "__main__":
    main()
