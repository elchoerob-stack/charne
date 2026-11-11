"""PRE-REGISTERED: "trade the continuation, not the first touch" - tested on 2016-2024 data that no test has used.
Committed BEFORE it was run. Nothing below may change after seeing the result.

Where the idea came from (exploratory, on the USED data May 2025 - Nov 2026, so it proves nothing by itself):
  the bot's trades split into two kinds with opposite results in BOTH used periods -
    first touch  (a stop order filled when price first crossed the band inside the hour)  PF 0.70 / 0.89
    continuation (price already beyond the band at the top of the hour -> market entry)   PF 1.47 / 1.40
  and entering only on continuation got better the further beyond the band price had to be (z 1.28 -> PF 1.18,
  z 1.6 -> 1.67, z 2.0 -> 1.45 pooled). About 30 slices of the used data were looked at to find this.

Fresh data: XAUUSD 5-minute bars 2016-01-01 -> 2024-09-30 and 1h bars from 2015-06 (fetched 11 Nov 2026 with
fetch_long.py, not analysed before this file was committed). 5-minute bars for Oct 2024 - Feb 2025 also exist and
no trading test has used them: they stay untouched as a reserve.

Rules under test. Everything not listed is exactly the bot's: prior-close anchor, walk-forward hourly sigma (120
sessions) x session ATR, hours 2..22 except hour 15 (US 08:30 ET), one position, max 4 trades a session, flat at the
close, 5-minute bars with fills against us, $0.50 per oz per round trip (the 2016-2023 spreads were no smaller than
today's, and stops were 3-4x smaller, so this cost weighs MORE in the old years than now).
  B0  bot v2.2 as it is: stop orders at the band (z 1.2816) + market when already beyond; stop = target = 1 band   [reference]
  F1  continuation only, z 1.6:    at the top of the hour, if price is beyond prior close +- 1.6 sigma, enter at market
                                   in that direction; stop = target = 1 band (1.6 sigma)                           [primary]
  F2  continuation only, z 1.2816 (the bot's current band); stop = target = 1 band
  F3  continuation only, z 2.0;    stop = target = 1 band
  S1  F1 with half the stop: stop = 0.5 band, target = 1 band (a smaller loss per trade, for small accounts)
Looks on the fresh data: 4 (F1, F2, F3, S1). B0 is the already-fixed rule; its result is the long-history verdict on it.

Because gold's price and ATR were 3-4x lower in 2016-2023, results are judged on ATR-normalised P&L: each trade's net $
(after the $0.50) divided by that session's ATR and multiplied by $60 (about today's ATR). That is the same as trading a
size that keeps the risk constant across years. Raw dollars are reported next to it.

Verdict per variant, fixed now:
  VALIDATED  = cbot-gate PASS (fixed thresholds; out-of-sample = fresh period, in-sample = used period, balance $1,000
               per oz, +$0.50 stress) AND profit in at least 6 of the 9 calendar years AND PF >= 1.00 with the raw
               cost doubled to $1.00.
  BETTER     = not validated, but fresh PF >= 1.10, session-bootstrap P(net <= 0) <= 1.25% (5% / 4 looks), profit in
               at least 6 of 9 years, PF >= 1.00 at double cost, and fresh PF above B0's.
  REJECTED   = anything else.
Bot default afterwards: the VALIDATED variant with the highest normalised net per session; if none, the BETTER one with
the highest (labelled 'not validated'); if none, the v2.2 rules stay. S1's stop is used only if S1 itself is
VALIDATED or BETTER.

Prior, written before running: the pattern came from slicing data that has been looked at more than 25 times; most
such patterns vanish on fresh data. Expected fresh PF for F1: 0.95 - 1.25. A gate PASS would be a surprise.
"""
import json
import subprocess
import sys

import numpy as np
import pandas as pd

import analysis as A
import bandfade_backtest as B
import contsim as C
import small_account_test as S

FRESH_START, FRESH_END = pd.Timestamp("2016-01-01T00:00:00Z"), pd.Timestamp("2024-09-30T23:59:00Z")
YEARS = list(range(2016, 2025))
ATR_REF = 60.0
COST = 0.50
VARIANTS = [("B0", dict(z=1.2816, mode="both")), ("F1", dict(z=1.6, mode="cont")), ("F2", dict(z=1.2816, mode="cont")),
            ("F3", dict(z=2.0, mode="cont")), ("S1", dict(z=1.6, mode="cont", sl_mult=0.5))]
GATE = B.HERE.parent / "skills" / "cbot-gate" / "scripts" / "gate.py"


def fresh_plans():
    h1_all = pd.read_csv(B.HERE / "data" / "XAUUSD_H_1_2015_2024.csv.gz", parse_dates=["time_utc"])
    h1, sess = A.session_table(h1_all)
    by_sess = {k: v for k, v in h1.groupby("session")}
    plans = []
    for t in range(150, len(sess) - 1):
        day = sess.start[t + 1]
        if day < FRESH_START or day > FRESH_END:
            continue
        sig, _ = A.vol_profile(h1, sess, t)              # sessions before t only
        plans.append(dict(day=day, anchor=sess.c[t], atr=sess.atr[t], sigma=sig, bars=list(by_sess[sess.session[t + 1]].time_utc)))
    return plans


def fresh_m5():
    return pd.concat([pd.read_csv(B.HERE / "data" / f"XAUUSD_M_5_{y}.csv.gz", parse_dates=["time_utc"]) for y in YEARS]) \
        .drop_duplicates("time_utc").sort_values("time_utc").reset_index(drop=True)


def run(plans, m5, kw, cost=COST):
    out = C.outcomes(plans, m5, **kw)
    tr = C.trades(out, cost=cost)
    atr = np.array([o["atr"] for o in out])
    tr["atr"] = atr[tr.sess.values]
    tr["norm"] = tr.net / tr.atr * ATR_REF
    return tr, len(out)


def save_for_gate(tr, path):
    g = pd.DataFrame({"Closing Time": tr.exit_time.dt.strftime("%Y-%m-%d %H:%M:%S"), "Net Profit": tr.norm.round(4)})
    g.to_csv(path, index=False)


def boot_norm(tr):
    x = tr.assign(net=tr.norm)
    return C.day_boot(x)[0]


if __name__ == "__main__":
    P_used, m5_used, n_unseen = S.load()
    P = fresh_plans()
    m5 = fresh_m5()
    nb = pd.Series([len(p["bars"]) for p in P])
    hrs = pd.Series([p["bars"][0].hour for p in P]).value_counts().to_dict()
    print(f"fresh sessions: {len(P)}  {P[0]['day']:%Y-%m-%d} -> {P[-1]['day']:%Y-%m-%d} | 1h bars per session {nb.value_counts().sort_index().to_dict()} "
          f"| session start hour UTC {hrs} | 5m bars {len(m5):,}")
    bt = B.HERE / "backtest"
    rows, logs = [], {}
    for name, kw in VARIANTS:
        tr, n_sess = run(P, m5, kw)
        tr2, _ = run(P, m5, kw, cost=2 * COST)
        tu, n_used = run(P_used, m5_used, kw)
        logs[name] = tr
        tr.to_csv(bt / f"cont_{name}_fresh_trades.csv", index=False)
        save_for_gate(tr, bt / f"_gate_{name}_oos.csv")
        save_for_gate(tu, bt / f"_gate_{name}_is.csv")
        gj = bt / f"cont_{name}_gate.json"
        subprocess.run([sys.executable, str(GATE), "--is", str(bt / f"_gate_{name}_is.csv"), "--oos", str(bt / f"_gate_{name}_oos.csv"),
                        "--balance", "1000", "--stress-cost", "0.5", "--name", f"{name} fresh 2016-2024 (ATR-normalised)", "--json", str(gj)],
                       capture_output=True, text=True)
        gate = json.load(open(gj))
        yr = tr.groupby(tr.day.dt.year).norm.sum().reindex(YEARS).fillna(0.0)
        yr_raw = tr.groupby(tr.day.dt.year).net.sum().reindex(YEARS).fillna(0.0)
        yr_n = tr.groupby(tr.day.dt.year).size().reindex(YEARS).fillna(0).astype(int)
        eq = tr.norm.cumsum()
        rows.append(dict(variant=name, trades=len(tr), per_session=round(len(tr) / n_sess, 2), win=round((tr.net > 0).mean(), 3),
                         pf_norm=round(C.pf(tr.norm), 3), pf_raw=round(C.pf(tr.net), 3), net_norm=round(tr.norm.sum(), 0),
                         net_raw=round(tr.net.sum(), 0), norm_per_session=round(tr.norm.sum() / n_sess, 2),
                         max_dd_norm=round((eq.cummax() - eq).max(), 0), p_net_le0=round(boot_norm(tr), 4),
                         pf_double_cost=round(C.pf(tr2.norm), 3), years_pos=int((yr > 0).sum()), gate=gate["verdict"],
                         used_pf=round(C.pf(tu.norm), 3), used_trades=len(tu)))
        print(f"\n=== {name} {kw} ===")
        print(f"fresh: {len(tr)} trades ({len(tr) / n_sess:.2f}/session), win {(tr.net > 0).mean():.0%}, PF {C.pf(tr.norm):.2f} normalised / {C.pf(tr.net):.2f} raw, "
              f"net {tr.norm.sum():+.0f} normalised / {tr.net.sum():+.0f} raw $, max DD {(eq.cummax() - eq).max():.0f}, "
              f"P(net<=0) {boot_norm(tr):.2%}, PF at double cost {C.pf(tr2.norm):.2f}")
        print("  year      " + "".join(f"{y:>8d}" for y in YEARS))
        print("  trades    " + "".join(f"{v:8d}" for v in yr_n))
        print("  net norm  " + "".join(f"{v:+8.0f}" for v in yr))
        print("  net raw $ " + "".join(f"{v:+8.0f}" for v in yr_raw))
        print(f"  used period (in-sample): {len(tu)} trades, PF {C.pf(tu.norm):.2f}")
        print(f"  gate: {gate['verdict']} - {gate['reason'][:400]}")
    R = pd.DataFrame(rows).set_index("variant")
    pd.set_option("display.width", 250)
    print("\n" + R.to_string())
    R.to_csv(bt / "continuation_summary.csv")

    b0 = R.loc["B0", "pf_norm"]
    verdicts = {}
    for name in ("F1", "F2", "F3", "S1"):
        r = R.loc[name]
        common = r.years_pos >= 6 and r.pf_double_cost >= 1.0
        if r.gate == "PASS" and common:
            v = "VALIDATED"
        elif common and r.pf_norm >= 1.10 and r.p_net_le0 <= 0.0125 and r.pf_norm > b0:
            v = "BETTER (not validated)"
        else:
            v = "REJECTED"
        verdicts[name] = v
        print(f"verdict {name}: {v}")
    for tier in ("VALIDATED", "BETTER (not validated)"):
        cand = [n for n in ("F1", "F2", "F3") if verdicts[n] == tier]
        if cand:
            best = max(cand, key=lambda n: R.loc[n, "norm_per_session"])
            print(f"bot default: {best} ({tier}); half stop (S1): {'yes' if verdicts['S1'] != 'REJECTED' and best == 'F1' else 'no'}")
            break
    else:
        print("bot default: v2.2 rules stay (no continuation variant qualified)")
    json.dump(dict(verdicts=verdicts, b0_pf=float(b0)), open(bt / "continuation_verdicts.json", "w"), indent=1)
