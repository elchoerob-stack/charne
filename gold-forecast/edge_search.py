"""PRE-REGISTERED edge search: is there a rule on gold or a major currency pair with profit factor > 1.3 and many trades?
Committed BEFORE it was run. The script runs all three stages by itself; nothing is adjusted between them.

Why this is hard, in one line: PF 1.3 on 250 trades a year means an average trade worth about 10% of its own standard
deviation after costs - an annual Sharpe ratio near 1.6 on one liquid market. Most things that show it are overfit, so
the search is built to throw those away.

Data: 1h bars, Jun 2015 - 11 Nov 2026, cTrader (read-only): XAUUSD and 13 currency pairs. Trading day = 17:00 New York to
17:00 New York (hour 0 = 17:00-18:00 ET, the rollover hour: never traded). All hours below are New York hours unless
marked UTC, so London/New York daylight saving is handled.
Costs per round trip, in basis points of price = the spread sampled 12 Nov 2026 x 1.5 + commission ($35 per $1m per side):
see COST_BP. P&L of every trade is divided by the previous day's ATR(14), so every year weighs the same.

Stages (by trading day):
  DESIGN        2016-01-01 .. 2020-12-31   every rule below is run; a rule goes on only if PF >= 1.25, at least 100
                                           trades a year, and day-bootstrap P(PF < 1) <= 2.5%
  VALIDATION    2021-01-01 .. 2024-09-30   only design survivors, unchanged; goes on only if PF >= 1.20, at least 100
                                           trades a year, P(PF < 1) <= 10%
  CONFIRMATION  2024-10-01 .. 2026-11-11   only validation survivors; FOUND if PF >= 1.30, at least 100 trades,
                                           P(PF < 1) <= 10% and PF >= 1.10 at double cost
Validation and confirmation numbers are not computed for rules that failed the stage before, so those periods stay
unused for whatever was not selected. A FOUND rule still has to be re-run on 5-minute bars and through cbot-gate
before it becomes a bot.

Rule families (234 rule x market combinations; where a direction is 'fitted' it is taken from the design period only):
  W  session windows, one trade a day, direction fitted: ASIA hours 2-9, LONDON 10-14, NY-AM 15-18, NY-PM 19-23;
     for the four yen pairs also the Tokyo-fix windows 23:00-01:00 UTC and 01:00-03:00 UTC
  T  daily trend: trade the whole day (hour 1 open to the day's close) in the direction of yesterday's close against
     its 20- or 60-day average; long/short for all markets, and long-only for gold
  S  hourly shocks: a 1h candle body >= 1.5 or 2.5 x the average 1h range of the last 10 days; hold the next 1 or 4
     hours; continuation or reversal fitted
  A  Asian range at London: first 1h close outside the hours-1-9 range during hours 10-15; trade the breakout (stop at
     the range middle) or fade it (same stop distance the other way); exit at the hour-20 close
  P  previous day's high / low: 'sweep' = a 1h candle trades beyond it and closes back inside -> trade the reversal, stop
     beyond the candle, target 2 x the stop, else the day's close; 'hold' = a 1h close beyond it -> trade the break,
     stop 0.25 ATR back inside, exit at the day's close. One trade a day per rule.
  B  Bollinger fade: 1h close beyond the 24-hour average +- 2.0 or 2.5 standard deviations -> trade back to the average;
     stop the same distance further out; one position at a time; exit at the average or after 24 hours
Fills: entries at the next 1h open, stops inside the bar at the stop price (stop first when in doubt).

Prior, written before running: 234 tries at these thresholds should let a handful through the design stage by luck alone
(expected false passes: under 6), almost none through validation (under 1) and essentially none through all three.
I expect no rule to be FOUND. The windows in gold (Asia) and the Tokyo fix in yen are the ones with a published history.
"""
import json
import sys

import numpy as np
import pandas as pd

from bandfade_backtest import HERE

COST_BP = dict(XAUUSD=1.35, EURUSD=1.24, GBPUSD=1.38, USDJPY=0.99, AUDUSD=1.80, NZDUSD=3.13, USDCAD=1.44, USDCHF=1.60,
               EURJPY=1.21, GBPJPY=1.62, EURGBP=1.60, AUDNZD=2.04, EURCHF=2.16, AUDJPY=1.80)
YEN = ("USDJPY", "EURJPY", "GBPJPY", "AUDJPY")
STAGES = [("design", "2016-01-01", "2020-12-31"), ("validation", "2021-01-01", "2024-09-30"), ("confirmation", "2024-10-01", "2026-11-11")]


class Market:
    def __init__(self, sym):
        self.sym = sym
        df = pd.read_csv(HERE / "data" / "fx" / f"{sym}_H_1.csv.gz", parse_dates=["time_utc"]).sort_values("time_utc").reset_index(drop=True)
        et = df.time_utc.dt.tz_convert("America/New_York")
        df["hr"] = (et.dt.hour - 17) % 24
        df["utc_hr"] = df.time_utc.dt.hour
        df["day"] = (et + pd.Timedelta(hours=7)).dt.tz_localize(None).dt.normalize()
        g = df.groupby("day")
        d = g.agg(o=("open", "first"), h=("high", "max"), l=("low", "min"), c=("close", "last"), n=("close", "size"))
        d = d[d.n >= 16]
        pc = d.c.shift(1)
        tr = pd.concat([d.h - d.l, (d.h - pc).abs(), (d.l - pc).abs()], axis=1).max(axis=1)
        d["atr"] = tr.ewm(alpha=1 / 14, adjust=False).mean().shift(1)        # known before the day starts
        d["pc"], d["ph"], d["pl"] = pc, d.h.shift(1), d.l.shift(1)
        for n in (20, 60):
            d[f"sma{n}"] = d.c.rolling(n).mean().shift(1)
        d = d.iloc[80:]
        df = df[df.day.isin(d.index)].reset_index(drop=True)
        self.days = d
        self.day_no = {k: i for i, k in enumerate(d.index)}
        self.b = df
        self.di = df.day.map(self.day_no).values
        nd = len(d)
        self.O, self.H, self.L, self.C = (np.full((nd, 24), np.nan) for _ in range(4))
        for name, arr in (("open", self.O), ("high", self.H), ("low", self.L), ("close", self.C)):
            arr[self.di, df.hr.values] = df[name].values
        self.atr = d.atr.values
        self.cost = COST_BP[sym] * 1e-4                                       # fraction of price

    def trade(self, day_i, entry, exit_, side):
        """(day, gross in ATRs for a LONG-signed move x side, cost in ATRs)"""
        a = self.atr[day_i]
        return day_i, side * (exit_ - entry) / a, self.cost * entry / a


def windows(m):
    out = {}
    for name, a, b in (("ASIA", 2, 9), ("LONDON", 10, 14), ("NYAM", 15, 18), ("NYPM", 19, 23)):
        ok = ~np.isnan(m.O[:, a]) & ~np.isnan(m.C[:, b])
        idx = np.flatnonzero(ok)
        out[f"W-{name}"] = [m.trade(i, m.O[i, a], m.C[i, b], 1) for i in idx]
    if m.sym in YEN:
        o, c, uh, di = m.b.open.values, m.b.close.values, m.b.utc_hr.values, m.di
        for name, h0 in (("TOKYO-A", 23), ("TOKYO-B", 1)):
            i = np.flatnonzero((uh[:-1] == h0) & (uh[1:] == (h0 + 1) % 24) & (di[:-1] == di[1:]))
            out[f"W-{name}"] = [m.trade(di[k], o[k], c[k + 1], 1) for k in i]
    return out, True                       # direction fitted


def trend(m):
    out = {}
    d = m.days
    first = np.array([next((h for h in range(1, 24) if not np.isnan(m.O[i, h])), -1) for i in range(len(d))])
    for n in (20, 60):
        s = np.sign(d.pc.values - d[f"sma{n}"].values)
        ls, lo = [], []
        for i in range(len(d)):
            if first[i] < 0 or not s[i] or np.isnan(s[i]):
                continue
            t = m.trade(i, m.O[i, first[i]], d.c.values[i], s[i])
            ls.append(t)
            if s[i] > 0:
                lo.append(t)
        out[f"T-{n}d-longshort"] = ls
        if m.sym == "XAUUSD":
            out[f"T-{n}d-longonly"] = lo
    return out, False


def shocks(m):
    b = m.b
    o, h, l, c, hr, di = b.open.values, b.high.values, b.low.values, b.close.values, b.hr.values, m.di
    rng = pd.Series(h - l).rolling(240).mean().shift(1).values
    body = c - o
    out = {}
    for k in (1.5, 2.5):
        sig = np.flatnonzero((np.abs(body) >= k * rng) & (hr != 0))
        for n in (1, 4):
            tr = []
            for t in sig:
                if t + n >= len(c) or di[t + n] != di[t]:
                    continue
                tr.append(m.trade(di[t], o[t + 1], c[t + n], np.sign(body[t])))
            out[f"S-{k}x-hold{n}h"] = tr
    return out, True


def asian(m):
    brk, fade = [], []
    for i in range(len(m.days)):
        if np.isnan(m.H[i, 1:10]).all():
            continue
        ah, al = np.nanmax(m.H[i, 1:10]), np.nanmin(m.L[i, 1:10])
        mid = (ah + al) / 2
        for hh in range(10, 16):
            cl = m.C[i, hh]
            if np.isnan(cl) or (al <= cl <= ah):
                continue
            side = 1 if cl > ah else -1
            if hh + 1 > 20 or np.isnan(m.O[i, hh + 1]):
                break
            e = m.O[i, hh + 1]
            dist = abs(e - mid)
            for s, bag in ((side, brk), (-side, fade)):
                stop = e - s * dist
                x = None
                for q in range(hh + 1, 21):
                    if np.isnan(m.C[i, q]):
                        continue
                    if (s == 1 and m.L[i, q] <= stop) or (s == -1 and m.H[i, q] >= stop):
                        x = stop; break
                    x = m.C[i, q]
                if x is not None and dist > 0:
                    bag.append(m.trade(i, e, x, s))
            break
    return {"A-breakout": brk, "A-fade": fade}, False


def prevday(m):
    sweep, hold = [], []
    d = m.days
    for i in range(len(d)):
        ph, pl, a = d.ph.values[i], d.pl.values[i], m.atr[i]
        if np.isnan(ph) or np.isnan(a):
            continue
        done_s = done_h = False
        for hh in range(1, 21):
            if np.isnan(m.C[i, hh]) or hh + 1 > 23 or np.isnan(m.O[i, hh + 1]):
                continue
            hi, lo, cl, e = m.H[i, hh], m.L[i, hh], m.C[i, hh], m.O[i, hh + 1]
            if not done_s:
                s = -1 if (hi > ph and cl < ph) else (1 if (lo < pl and cl > pl) else 0)
                if s:
                    stop = hi + 0.05 * a if s == -1 else lo - 0.05 * a
                    risk = abs(stop - e)
                    tgt = e + s * 2 * risk
                    x = None
                    for q in range(hh + 1, 24):
                        if np.isnan(m.C[i, q]):
                            continue
                        if (s == 1 and m.L[i, q] <= stop) or (s == -1 and m.H[i, q] >= stop):
                            x = stop; break
                        if (s == 1 and m.H[i, q] >= tgt) or (s == -1 and m.L[i, q] <= tgt):
                            x = tgt; break
                        x = m.C[i, q]
                    if x is not None and risk > 0:
                        sweep.append(m.trade(i, e, x, s))
                    done_s = True
            if not done_h:
                s = 1 if cl > ph else (-1 if cl < pl else 0)
                if s:
                    stop = ph - 0.25 * a if s == 1 else pl + 0.25 * a
                    x = None
                    if (s == 1 and e > stop) or (s == -1 and e < stop):
                        for q in range(hh + 1, 24):
                            if np.isnan(m.C[i, q]):
                                continue
                            if (s == 1 and m.L[i, q] <= stop) or (s == -1 and m.H[i, q] >= stop):
                                x = stop; break
                            x = m.C[i, q]
                    if x is not None:
                        hold.append(m.trade(i, e, x, s))
                    done_h = True
            if done_s and done_h:
                break
    return {"P-sweep": sweep, "P-hold": hold}, False


def bollinger(m):
    b = m.b
    o, h, l, c, hr, di = b.open.values, b.high.values, b.low.values, b.close.values, b.hr.values, m.di
    ma = pd.Series(c).rolling(24).mean().values
    sd = pd.Series(c).rolling(24).std(ddof=0).values
    out = {}
    for k in (2.0, 2.5):
        tr, t, N = [], 24, len(c)
        while t < N - 2:
            dev = c[t] - ma[t]
            if np.isnan(sd[t]) or sd[t] <= 0 or abs(dev) < k * sd[t] or hr[t] == 0:
                t += 1
                continue
            s = -1 if dev > 0 else 1
            e, dist = o[t + 1], k * sd[t]
            stop, x, q = e - s * dist, None, t + 1
            while q < min(N, t + 25):
                if (s == 1 and l[q] <= stop) or (s == -1 and h[q] >= stop):
                    x = stop; break
                if (s == 1 and c[q] >= ma[q]) or (s == -1 and c[q] <= ma[q]):
                    x = c[q]; break
                q += 1
            if x is None:
                q = min(N, t + 25) - 1
                x = c[q]
            tr.append(m.trade(di[t + 1], e, x, s))
            t = q + 1
        out[f"B-{k}sd"] = tr
    return out, False


FAMILIES = [windows, trend, shocks, asian, prevday, bollinger]


def pf(v):
    w, l = v[v > 0].sum(), -v[v < 0].sum()
    return float(w / l) if l > 0 else float("inf")


def stats(day, net, years, n_boot=2000, seed=7):
    if len(net) < 30:
        return dict(n=len(net), per_year=len(net) / years, pf=float("nan"), p=1.0)
    u, inv = np.unique(day, return_inverse=True)
    W, Ls = np.zeros(len(u)), np.zeros(len(u))
    np.add.at(W, inv, np.where(net > 0, net, 0.0))
    np.add.at(Ls, inv, np.where(net < 0, -net, 0.0))
    rs = np.random.default_rng(seed)
    pick = rs.integers(0, len(u), size=(n_boot, len(u)))
    p = float((W[pick].sum(axis=1) < Ls[pick].sum(axis=1)).mean())
    return dict(n=len(net), per_year=round(len(net) / years, 1), pf=round(pf(net), 3), p=round(p, 4), avg=round(float(net.mean()), 4))


if __name__ == "__main__":
    rows, kept = [], {}
    for sym in COST_BP:
        m = Market(sym)
        dates = m.days.index.values
        masks = {name: (dates >= np.datetime64(a)) & (dates <= np.datetime64(b)) for name, a, b in STAGES}
        yrs = {name: (pd.Timestamp(b) - pd.Timestamp(a)).days / 365.25 for name, a, b in STAGES}
        for fam in FAMILIES:
            res, fitted = fam(m)
            for rule, tr in res.items():
                if not tr:
                    continue
                day = np.array([t[0] for t in tr]); g = np.array([t[1] for t in tr]); cst = np.array([t[2] for t in tr])
                dm = masks["design"][day]
                side = 1.0
                if fitted and g[dm].sum() < 0:
                    side = -1.0
                net = side * g - cst
                s = stats(day[dm], net[dm], yrs["design"])
                ok = s["pf"] >= 1.25 and s["per_year"] >= 100 and s["p"] <= 0.025
                rows.append(dict(market=sym, rule=rule, side={1.0: "as written", -1.0: "reversed"}[side] if fitted else "fixed",
                                 d_n=s["n"], d_per_year=s["per_year"], d_pf=s["pf"], d_p=s["p"], design_pass=ok))
                if ok:
                    kept[(sym, rule)] = (day, side * g, cst, masks, yrs)
    R = pd.DataFrame(rows)
    pd.set_option("display.width", 220); pd.set_option("display.max_rows", 400)
    print(f"DESIGN 2016-2020: {len(R)} rule x market combinations, {int(R.design_pass.sum())} passed")
    print("best 25 by design PF among those with >= 100 trades a year:")
    print(R[R.d_per_year >= 100].sort_values("d_pf", ascending=False).head(25).to_string(index=False))
    print("\nby family (median design PF, share with PF > 1):")
    R["family"] = R.rule.str[0]
    print(R.groupby("family").d_pf.agg(["count", "median", lambda v: round(float((v > 1).mean()), 2)]).to_string())
    R.to_csv(HERE / "backtest" / "edge_search_design.csv", index=False)

    final = []
    for (sym, rule), (day, g, cst, masks, yrs) in kept.items():
        net = g - cst
        vm = masks["validation"][day]
        v = stats(day[vm], net[vm], yrs["validation"])
        vok = v["pf"] >= 1.20 and v["per_year"] >= 100 and v["p"] <= 0.10
        rec = dict(market=sym, rule=rule, v_n=v["n"], v_pf=v["pf"], v_p=v["p"], validation_pass=vok)
        if vok:
            cm = masks["confirmation"][day]
            c = stats(day[cm], net[cm], yrs["confirmation"])
            c2 = pf((g - 2 * cst)[cm])
            found = c["pf"] >= 1.30 and c["n"] >= 100 and c["p"] <= 0.10 and c2 >= 1.10
            rec.update(c_n=c["n"], c_pf=c["pf"], c_p=c["p"], c_pf_double_cost=round(c2, 3), FOUND=found)
        final.append(rec)
    F = pd.DataFrame(final)
    print("\nVALIDATION 2021 - Sep 2024 (design survivors only), CONFIRMATION Oct 2024 - Nov 2026 (validation survivors only):")
    print(F.to_string(index=False) if len(F) else "nothing passed the design stage")
    F.to_csv(HERE / "backtest" / "edge_search_stages.csv", index=False)
    found = F[F.get("FOUND", False) == True] if len(F) and "FOUND" in F else F.iloc[0:0]
    print(f"\nFOUND: {len(found)}")
    json.dump(dict(combinations=len(R), design_pass=int(R.design_pass.sum()), validation_pass=int(F.validation_pass.sum()) if len(F) else 0,
                   found=found[["market", "rule"]].values.tolist() if len(found) else []), open(HERE / "backtest" / "edge_search_result.json", "w"), indent=1)
