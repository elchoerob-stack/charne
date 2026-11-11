"""PRE-REGISTERED sizing study: can a R300 account carry the bot? Committed before running.

Not a new strategy: entries, exits, z 1.2816 and the hours are exactly the tested breakout rules. The only things that
change are the SIZE of one trade, its cost, and which hours a small account is allowed to take. Strategy looks: +0.

Facts measured 11 Nov 2026 (read-only):
  * The broker lists gold in grams, XAUUSDgr ("Gold Grams vs US Dollar"): 1 lot = 1 g, minimum trade 5 g, step 1 g
    (broker's contract page). Its price is the ounce price / 31.1035 (20 days of hourly closes: ratio 31.104 - 31.111).
  * 5 g = 0.1608 oz, so a $1 move in gold = $0.16 (0.01 lot of XAUUSD = 1 oz = $1.00).
  * Costs: XAUUSD spread $0.12-0.16 + commission $35 per $1m per side (seen on the account's own deals: R2.29 per side
    on 1 oz) = about $0.44 per oz -> $0.50 kept. Gram gold spread $0.012-0.013 per g = $0.37-0.40 per oz-equivalent,
    plus the same commission = about $0.67 -> $0.70 per oz-equivalent used here.

Configs:
  A  XAUUSD 1 oz, cost $0.50/oz, no equity cap (bot v2.2 on a live account)
  B  gram gold 5 g, cost $0.70/oz-eq, no equity cap
  C  gram gold 5 g with a cap: an hour is skipped when its stop would risk more than CAP of current equity,
     CAP = 50%, 33%, 25%
Start capital R300, R1,000, R2,000, R5,000 (USDZAR 16.60). Every session is a start date; each run lasts the next
60 sessions (about 3 months). 5-minute bars, fills against us, flat at the close, max 4 trades a session, no orders
below R100 of equity (the bot's floor). A trade whose worst move (plus $0.30 spread) reaches the whole account is a
broker stop-out: the account is wiped.

Reported per config and capital: share of runs wiped; share ending below 25% / below 50% / above 150% / above 200% of
the start; median end balance; trades taken per run.

Decision rules, fixed now:
  1. Gram gold replaces the ounce contract for small accounts if R300's 'ends below 25% of the start' share is at least
     20 points lower with 5 g than with 1 oz.
  2. Cap: take the LOOSEST of (none, 50%, 33%, 25%) whose R300 'ends below 25%' share is within 10 points of the best
     of the four. A cap is a survival rule; its profit factor is reported but NOT used to choose it.
  3. Nothing else changes. No claim of edge follows from this study: the rules still failed the unseen-period test.
"""
import numpy as np
import pandas as pd

import bandfade_backtest as B
import unseen_test as U

USDZAR = 16.60
OZ_PER_GRAM = 1 / 31.1034768
Z = 1.2816
DATA_HOUR = 14
MAX_TRADES = 4
FLOOR_USD = 100 / USDZAR            # the bot places no orders below R100
STOPOUT_SPREAD = 0.30
HORIZON = 60


def load():
    m5d = pd.read_csv(B.HERE / "data" / "XAUUSD_M_5_hist.csv", parse_dates=["time_utc"])
    m5u = pd.read_csv(B.HERE / "data" / "XAUUSD_M_5_unseen.csv", parse_dates=["time_utc"])
    Pd = B.day_plans(m5_start=m5d.time_utc.min() + pd.Timedelta(days=1))
    Pu = U.plans(m5u.time_utc.min() + pd.Timedelta(days=1), U.END)
    m5 = pd.concat([m5u, m5d]).drop_duplicates("time_utc").sort_values("time_utc").reset_index(drop=True)
    return Pu + Pd, m5, len(Pu)


def outcomes(plans, m5):
    """For every session and hour: what the tested rules do if orders are armed at that hour while flat.
    Same logic as bandfade_backtest.simulate (breakout, centre = prior close), one row per (session, hour)."""
    t = m5.time_utc.values.astype("datetime64[ns]")
    O, H, L, C = m5.open.values, m5.high.values, m5.low.values, m5.close.values
    out = []
    for p in plans:
        a, atr, nb = p["anchor"], p["atr"], len(p["bars"])
        idx, hour_of = [], []
        for k, b in enumerate(p["bars"]):
            b0 = np.datetime64(b.tz_convert(None), "ns")
            i0 = np.searchsorted(t, b0, "left")
            i1 = np.searchsorted(t, b0 + np.timedelta64(55, "m"), "right")
            idx.extend(range(i0, i1))
            hour_of.extend([k] * (i1 - i0))
        idx, hour_of = np.array(idx, dtype=int), np.array(hour_of, dtype=int)
        o, h, l, c = O[idx], H[idx], L[idx], C[idx]
        has_last = bool((hour_of == nb - 1).any())
        row = {}
        for k in range(1, nb - 1):
            if k == DATA_HOUR:
                continue
            d = Z * p["sigma"][min(k, 22)] * atr
            hi, lo = a + d, a - d
            js = np.where(hour_of == k)[0]
            ent = None
            for j in js:
                hit_lo, hit_hi = l[j] <= lo, h[j] >= hi
                if hit_lo and hit_hi:
                    break                                   # ambiguous 5m bar: no entry this hour
                if hit_lo or hit_hi:
                    side = 1 if hit_hi else -1
                    ent = (j, side, max(hi, o[j]) if hit_hi else min(lo, o[j]))
                    break
            if ent is None:
                row[k] = dict(d=d, fill=False)
                continue
            j, side, entry = ent
            sl, tp = entry - side * d, entry + side * d
            ex = None
            if (side == 1 and l[j] <= sl) or (side == -1 and h[j] >= sl):
                ex = (j, sl, "SL")
            else:
                for q in range(j + 1, len(idx)):
                    sl_hit = l[q] <= sl if side == 1 else h[q] >= sl
                    tp_hit = h[q] >= tp if side == 1 else l[q] <= tp
                    if sl_hit:
                        ex = (q, sl, "SL"); break
                    if tp_hit:
                        ex = (q, tp, "TP"); break
            if ex is None:
                if not has_last:
                    row[k] = dict(d=d, fill=False)          # session still open in the data: not counted
                    continue
                ex = (len(idx) - 1, c[-1], "EOD")
            q, px, why = ex
            mae = max(entry - l[j:q + 1].min(), 0.0) if side == 1 else max(h[j:q + 1].max() - entry, 0.0)
            row[k] = dict(d=d, fill=True, side=side, entry=entry, gross=(px - entry) * side, why=why, mae=mae,
                          exit_hour=int(hour_of[q]), t_in=t[idx[j]])
        out.append(dict(day=p["day"], nb=nb, hours=row))
    return out


def walk(out, s0, n_sess, equity, oz, cost, cap):
    """One account through n_sess sessions. Returns (end equity, trades, wiped, pnl list per oz)."""
    trades, per_oz = 0, []
    for s in range(s0, s0 + n_sess):
        S = out[s]
        k, today = 1, 0
        while k < S["nb"] - 1 and today < MAX_TRADES:
            r = S["hours"].get(k)
            if r is None or equity < FLOOR_USD:
                k += 1
                continue
            if cap is not None and r["d"] * oz > cap * equity:
                k += 1                                      # the stop is too large for this account: hour skipped
                continue
            if not r["fill"]:
                k += 1
                continue
            if (r["mae"] + STOPOUT_SPREAD) * oz >= equity:  # broker stop-out before the bot's own stop
                return 0.0, trades + 1, True, per_oz
            equity += oz * (r["gross"] - cost)
            per_oz.append(r["gross"] - cost)
            trades += 1
            today += 1
            k = r["exit_hour"] + 1
    return equity, trades, False, per_oz


def pf(v):
    v = np.asarray(v)
    w, l = v[v > 0].sum(), -v[v < 0].sum()
    return w / l if l > 0 else np.inf


if __name__ == "__main__":
    plans, m5, n_unseen = load()
    out = outcomes(plans, m5)
    n = len(out)
    print(f"{n} sessions {out[0]['day']:%Y-%m-%d} -> {out[-1]['day']:%Y-%m-%d} ({n_unseen} unseen + {n - n_unseen} design)")

    # check: 1 oz, no cap, huge account reproduces the published trade counts / PF
    for name, a, b in (("unseen", 0, n_unseen), ("2026 design", n_unseen, n)):
        _, tr, _, v = walk(out, a, b - a, 1e9, 1.0, 0.50, None)
        _, _, _, vg = walk(out, a, b - a, 1e9, 1.0, 0.70, None)
        print(f"  check {name:12s}: {tr} trades, PF {pf(v):.2f}, net ${np.sum(v):+.0f} per oz at $0.50 | at $0.70 (gram cost): PF {pf(vg):.2f}, net ${np.sum(vg):+.0f}")

    # stop size by hour, and what it means for R300 at 5 g
    rows = []
    for S in out[-60:]:
        for k, r in S["hours"].items():
            rows.append((k, r["d"]))
    dd = pd.DataFrame(rows, columns=["k", "d"]).groupby("k").d.median()
    e0 = 300 / USDZAR
    print("\nStop size by hour (median of the last 60 sessions) and its share of a R300 account (${:.2f}):".format(e0))
    print("  hour   stop $/oz   1 oz      5 g")
    for k in (1, 3, 5, 7, 9, 11, 13, 16, 19, 21):
        if k in dd.index:
            print(f"  {k:4d}   {dd[k]:8.2f}   {dd[k] / e0:6.0%}   {dd[k] * 5 * OZ_PER_GRAM / e0:6.0%}")

    configs = [("A 1 oz, no cap", 1.0, 0.50, None), ("B 5 g, no cap", 5 * OZ_PER_GRAM, 0.70, None),
               ("C 5 g, cap 50%", 5 * OZ_PER_GRAM, 0.70, 0.50), ("C 5 g, cap 33%", 5 * OZ_PER_GRAM, 0.70, 1 / 3),
               ("C 5 g, cap 25%", 5 * OZ_PER_GRAM, 0.70, 0.25)]
    starts = range(0, n - HORIZON + 1)
    res = []
    for cap_r in (300, 1000, 2000, 5000):
        e = cap_r / USDZAR
        for name, oz, cost, cap in configs:
            ends, trs, wiped, allv = [], [], 0, []
            for s0 in starts:
                eq, tr, w, v = walk(out, s0, HORIZON, e, oz, cost, cap)
                ends.append(eq / e); trs.append(tr); wiped += w
            ends = np.array(ends)
            _, _, _, vall = walk(out, 0, n, 1e9, oz, cost, None)
            res.append(dict(start=f"R{cap_r:,}", config=name, wiped=wiped / len(ends), below25=(ends < 0.25).mean(),
                            below50=(ends < 0.5).mean(), above150=(ends > 1.5).mean(), above200=(ends > 2.0).mean(),
                            median_end_R=round(float(np.median(ends)) * cap_r), trades=round(float(np.mean(trs)), 1)))
    R = pd.DataFrame(res)
    pd.set_option("display.width", 220)
    show = R.copy()
    for c in ("wiped", "below25", "below50", "above150", "above200"):
        show[c] = (show[c] * 100).round(0).astype(int).astype(str) + "%"
    print(f"\n{len(starts)} start dates x {HORIZON} sessions each:")
    print(show.to_string(index=False))
    R.to_csv(B.HERE / "backtest" / "small_account.csv", index=False)

    # PF of the capped configs over the whole history for a R300 start (information only)
    print("\nWhole history from the first session, R300 start (information, not a selection criterion):")
    for name, oz, cost, cap in configs:
        eq, tr, w, v = walk(out, 0, n, 300 / USDZAR, oz, cost, cap)
        print(f"  {name:16s}: {tr:3d} trades, {'WIPED' if w else f'ends R{eq * USDZAR:,.0f}'}, PF of trades taken {pf(v):.2f}")

    r300 = R[R.start == "R300"].set_index("config")
    a, b = r300.loc["A 1 oz, no cap", "below25"], r300.loc["B 5 g, no cap", "below25"]
    print(f"\nRule 1: R300 ends below 25% of the start: 1 oz {a:.0%}, 5 g {b:.0%} -> {'GRAM GOLD adopted for small accounts' if a - b >= 0.20 else 'no change'}")
    order = ["B 5 g, no cap", "C 5 g, cap 50%", "C 5 g, cap 33%", "C 5 g, cap 25%"]
    best = min(r300.loc[o, "below25"] for o in order)
    pick = next(o for o in order if r300.loc[o, "below25"] - best <= 0.10)
    print(f"Rule 2: loosest cap within 10 points of the best ({best:.0%}): {pick}")
