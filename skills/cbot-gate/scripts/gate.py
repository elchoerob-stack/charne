#!/usr/bin/env python3
"""
cBot validation gate: scores a backtest the same way every time and returns
PASS, FAIL or INCONCLUSIVE, with the reasons.

Inputs (pick one):
  --trades all.csv --split 2025-01-01      one history, out-of-sample from a date
  --trades all.csv --oos-fraction 0.3      one history, last 30% of trades OOS
  --is is.csv --oos oos.csv                separate in-sample / out-of-sample runs
  --is f1_is.csv --oos f1_oos.csv --is f2_is.csv --oos f2_oos.csv ...
                                           walk-forward folds, paired in order
  --oos oos.csv                            out-of-sample only (no decay checks)
  --summary summary.json                   headline numbers only (no Monte Carlo)

Common options:
  --balance 10000        starting balance (else read from a Balance column)
  --source MyBot.cs      run the risk-constant audit too
  --stress-cost 1.5      extra cost per trade in account currency (slippage/spread)
  --name "GoldScalp 1m"  label for the report
  --json out.json        machine-readable result
  --rules rules.json     override thresholds (the report lists every change)

Any CSV with one row per closed trade works: a net-profit column and,
ideally, a closing-time column. Headers are matched loosely (Net $, Net Profit,
Profit, PnL / Closing Time, Close Time, Time). MT5 deal exports are handled:
entry rows and balance rows are dropped. Standard library only.
"""

import argparse
import csv
import io
import json
import math
import random
import re
import statistics
import sys
from datetime import datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# Thresholds. Fixed on purpose: a gate that is tuned after seeing the result is
# not a gate. Change them before a run, never after, and the report will say so.
# ---------------------------------------------------------------------------
RULES = {
    "floor_trades": 30,            # below this nothing can be concluded
    "min_oos_trades": 100,         # below this a pass cannot be called
    "oos_pf_min": 1.30,            # Profit Factor out of sample
    "pf_retention_min": 0.70,      # OOS PF / IS PF
    "wfe_min": 0.50,               # walk-forward efficiency
    "folds_profitable_min": 0.60,  # share of walk-forward folds with PF > 1
    "mc_p_pf_below_1_max": 0.10,   # bootstrap probability the edge is not there
    "oos_max_dd_pct_max": 20.0,    # worst historical drawdown, % of peak equity
    "mc_dd95_pct_max": 30.0,       # 95th percentile Monte Carlo drawdown
    "pf_ex_top_min": 1.00,         # PF with the best 5% of trades removed
    "top_trade_share": 0.05,
    "stress_pf_min": 1.10,         # PF after --stress-cost per trade
    "mc_runs": 3000,
    "mc_seed": 42,
}
HARD_FAILS = {"oos_pf_above_1", "oos_max_dd", "mc_dd95"}  # decisive even on few trades

PROFIT_HEADERS = ["net profit", "netprofit", "net", "net pnl", "net p l", "pnl", "p l",
                  "pl", "profit", "profit loss", "result", "gross profit", "gross"]
TIME_HEADERS = ["closing time", "close time", "closetime", "exit time", "closed",
                "time closed", "closing date", "close date", "exit date", "time",
                "date", "opening time", "open time", "entry time"]
SKIP_TYPES = {"balance", "credit", "deposit", "withdrawal", "correction", "bonus"}


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------
def norm(h: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", (h or "").lower())).strip()


def parse_number(v):
    """Handles R 1 234,56 / $1,234.56 / (12.50) / −3.2 / 1.234,56."""
    if v is None:
        return None
    s = str(v).strip().replace("−", "-").replace("\xa0", " ")
    if not s or s in ("-", "—"):
        return None
    neg = s.startswith("(") and s.endswith(")")
    s = re.sub(r"[^0-9,.\-]", "", s.strip("()"))
    if not s or s in ("-", ".", ","):
        return None
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        s = s.replace(",", "") if re.fullmatch(r"-?\d{1,3}(,\d{3})+", s) else s.replace(",", ".")
    try:
        x = float(s)
    except ValueError:
        return None
    return -abs(x) if neg else x


DAYFIRST = ["%d/%m/%Y %H:%M:%S.%f", "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y",
            "%d.%m.%Y %H:%M:%S.%f", "%d.%m.%Y %H:%M:%S", "%d.%m.%Y %H:%M", "%d.%m.%Y",
            "%d-%m-%Y %H:%M:%S", "%d-%m-%Y %H:%M", "%d-%m-%Y"]
MONTHFIRST = [f.replace("%d/%m", "%m/%d").replace("%d.%m", "%m.%d").replace("%d-%m", "%m-%d")
              for f in DAYFIRST]
UNAMBIGUOUS = ["%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d",
               "%Y.%m.%d %H:%M:%S", "%Y.%m.%d %H:%M", "%Y.%m.%d", "%Y/%m/%d %H:%M:%S",
               "%Y/%m/%d %H:%M", "%Y/%m/%d", "%d %b %Y %H:%M:%S.%f", "%d %b %Y %H:%M:%S",
               "%d %b %Y %H:%M", "%d %b %Y", "%b %d %Y %H:%M:%S", "%d/%m/%Y %I:%M:%S %p",
               "%m/%d/%Y %I:%M:%S %p"]


def _clean_time(s: str) -> str:
    s = s.strip().replace("T", " ").replace(",", "")
    s = re.sub(r"\s*(UTC|GMT|Z)$", "", s)
    s = re.sub(r"[+-]\d{2}:?\d{2}$", "", s)
    s = re.sub(r"(\.\d{6})\d+", r"\1", s)
    return s.strip()


def parse_times(values, monthfirst=False):
    """Parse a whole column with one consistent format family."""
    cleaned = [_clean_time(v) if v else "" for v in values]
    families = [UNAMBIGUOUS + (MONTHFIRST if monthfirst else DAYFIRST),
                UNAMBIGUOUS + (DAYFIRST if monthfirst else MONTHFIRST)]
    for fam_i, fam in enumerate(families):
        out, cache, ok = [], None, True
        for s in cleaned:
            if not s:
                out.append(None)
                continue
            d = None
            for fmt in ([cache] if cache else []) + fam:
                try:
                    d = datetime.strptime(s, fmt)
                    cache = fmt
                    break
                except ValueError:
                    continue
            if d is None:
                ok = False
                break
            out.append(d)
        if ok:
            order = "month-first" if (monthfirst != (fam_i == 1)) else "day-first"
            return out, f"{cache} ({order} where ambiguous)" if cache else None
    return None, "unparsed"


def read_text(path: Path) -> str:
    raw = path.read_bytes()
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return raw.decode("utf-16")
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1", errors="replace")


def load_trades(path, profit_col=None, time_col=None, monthfirst=False):
    path = Path(path)
    text = read_text(path)
    sample = text[:20000]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    rows = list(csv.reader(io.StringIO(text), dialect))
    rows = [r for r in rows if any(c.strip() for c in r)]
    if not rows:
        raise SystemExit(f"{path}: empty file")

    # Header row: the first row that names a profit-like column.
    hdr_i = next((i for i, r in enumerate(rows[:30])
                  if any(norm(c) in PROFIT_HEADERS for c in r)), 0)
    header = [norm(c) for c in rows[hdr_i]]
    body = rows[hdr_i + 1:]

    def pick(wanted, override):
        if override:
            key = norm(override)
            if key not in header:
                raise SystemExit(f"{path}: column '{override}' not found in {rows[hdr_i]}")
            return header.index(key)
        for w in wanted:
            if w in header:
                return header.index(w)
        return None

    p_i = pick(PROFIT_HEADERS, profit_col)
    if p_i is None:
        raise SystemExit(f"{path}: no profit column found. Headers: {rows[hdr_i]}. "
                         "Pass --profit-col.")
    t_i = pick(TIME_HEADERS, time_col)
    notes = [f"{path.name}: profit from '{rows[hdr_i][p_i]}'"]
    gross = header[p_i] in ("gross profit", "gross")
    extra = [header.index(c) for c in ("commission", "commissions", "swap", "fee", "fees")
             if c in header] if gross else []
    if extra:
        notes.append("net = gross + " + " + ".join(rows[hdr_i][i] for i in extra)
                     + " (signed as exported)")
    dir_i = next((header.index(c) for c in ("direction", "entry") if c in header), None)
    type_i = header.index("type") if "type" in header else None
    bal_i = next((header.index(c) for c in ("balance", "balance usd", "balance zar")
                  if c in header), None)

    profits, times_raw, balances, skipped = [], [], [], 0
    for r in body:
        r = r + [""] * (len(header) - len(r))
        if type_i is not None and norm(r[type_i]) in SKIP_TYPES:
            skipped += 1
            continue
        if dir_i is not None and norm(r[dir_i]) == "in":
            skipped += 1
            continue
        p = parse_number(r[p_i])
        if p is None:
            skipped += 1
            continue
        for i in extra:
            p += parse_number(r[i]) or 0.0
        profits.append(p)
        times_raw.append(r[t_i] if t_i is not None else "")
        balances.append(parse_number(r[bal_i]) if bal_i is not None else None)
    if skipped:
        notes.append(f"{path.name}: {skipped} non-trade or blank rows skipped")

    times = None
    if t_i is not None:
        times, fmt = parse_times(times_raw, monthfirst)
        if times is None:
            notes.append(f"{path.name}: could not parse '{rows[hdr_i][t_i]}'; using file order")
        else:
            notes.append(f"{path.name}: time from '{rows[hdr_i][t_i]}', format {fmt}")
            order = sorted(range(len(profits)), key=lambda k: (times[k] is None, times[k]))
            profits = [profits[k] for k in order]
            balances = [balances[k] for k in order]
            times = [times[k] for k in order]
    start_bal = None
    if balances and balances[0] is not None:
        start_bal = balances[0] - profits[0]
    return {"profits": profits, "times": times, "start_balance": start_bal, "notes": notes}


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------
def profit_factor(p):
    gw = sum(x for x in p if x > 0)
    gl = -sum(x for x in p if x < 0)
    if gl == 0:
        return math.inf if gw > 0 else 0.0
    return gw / gl


def drawdown(p, start):
    """Max drawdown in money and as % of the running peak (if a balance is known)."""
    eq = start or 0.0
    peak, dd_abs, dd_pct = eq, 0.0, 0.0
    for x in p:
        eq += x
        if eq > peak:
            peak = eq
        d = peak - eq
        if d > dd_abs:
            dd_abs = d
        if start and peak > 0:
            dd_pct = max(dd_pct, d / peak * 100)
    return dd_abs, (dd_pct if start else None)


def metrics(p, times, start):
    n = len(p)
    if n == 0:
        return {"trades": 0}
    wins = [x for x in p if x > 0]
    losses = [x for x in p if x < 0]
    net = sum(p)
    dd_abs, dd_pct = drawdown(p, start)
    sd = statistics.stdev(p) if n > 1 else 0.0
    streak = worst = 0
    for x in p:
        streak = streak + 1 if x < 0 else 0
        worst = max(worst, streak)
    k = max(1, math.ceil(n * RULES["top_trade_share"]))
    ex_top = sorted(p)[:-k] if n > k else []
    m = {
        "trades": n,
        "net": net,
        "pf": profit_factor(p),
        "win_rate": len(wins) / n * 100,
        "avg_win": statistics.mean(wins) if wins else 0.0,
        "avg_loss": statistics.mean(losses) if losses else 0.0,
        "payoff": (statistics.mean(wins) / -statistics.mean(losses)) if wins and losses else None,
        "expectancy": net / n,
        "t_stat": (net / n) / (sd / math.sqrt(n)) if sd > 0 else None,
        "max_dd": dd_abs,
        "max_dd_pct": dd_pct,
        "recovery": net / dd_abs if dd_abs > 0 else None,
        "max_losing_streak": worst,
        "pf_ex_top": profit_factor(ex_top) if ex_top else None,
        "top_removed": k,
    }
    if times and times[0] and times[-1]:
        days = max((times[-1] - times[0]).total_seconds() / 86400, 1.0)
        m.update({"first": times[0].date().isoformat(), "last": times[-1].date().isoformat(),
                  "days": days, "net_per_day": net / days, "trades_per_month": n / days * 30.44})
    return m


def monte_carlo(p, start, runs, seed):
    rng = random.Random(seed)
    n = len(p)
    dd_abs, dd_pct, pfs, nets = [], [], [], []
    shuffled = list(p)
    for _ in range(runs):
        rng.shuffle(shuffled)
        a, b = drawdown(shuffled, start)
        dd_abs.append(a)
        if b is not None:
            dd_pct.append(b)
        sample = [p[rng.randrange(n)] for _ in range(n)]
        pfs.append(profit_factor(sample))
        nets.append(sum(sample))

    def pct(xs, q):
        xs = sorted(xs)
        return xs[min(len(xs) - 1, int(q * len(xs)))]
    finite = [x for x in pfs if math.isfinite(x)] or [0.0]
    return {
        "runs": runs, "seed": seed,
        "dd95": pct(dd_abs, 0.95), "dd99": pct(dd_abs, 0.99),
        "dd95_pct": pct(dd_pct, 0.95) if dd_pct else None,
        "dd99_pct": pct(dd_pct, 0.99) if dd_pct else None,
        "p_pf_below_1": sum(1 for x in pfs if x < 1) / runs,
        "pf_p05": pct(finite, 0.05), "pf_p50": pct(finite, 0.50),
        "net_p05": pct(nets, 0.05),
    }


# ---------------------------------------------------------------------------
# Gate
# ---------------------------------------------------------------------------
def check(checks, key, label, value, threshold, passed, fmt="{:.2f}"):
    show = (lambda v: "—" if v is None else ("∞" if isinstance(v, float) and math.isinf(v)
                                              else fmt.format(v + 0.0)))
    checks.append({"key": key, "label": label, "value": value, "shown": show(value),
                   "threshold": threshold,
                   "result": "SKIP" if passed is None else ("PASS" if passed else "FAIL")})


def run_gate(is_m, oos_m, folds, mc, stress_pf, audit, rules_changed):
    R, checks = RULES, []
    n = oos_m.get("trades", 0)
    pf = oos_m.get("pf")
    check(checks, "oos_trades", "Out-of-sample trades", n, f"≥ {R['min_oos_trades']}",
          n >= R["min_oos_trades"], "{:.0f}")
    check(checks, "oos_pf_above_1", "OOS Profit Factor (break-even)", pf, "> 1.00",
          None if pf is None else pf > 1.0, "{:.3f}")
    check(checks, "oos_pf", "OOS Profit Factor (target)", pf, f"≥ {R['oos_pf_min']:.2f}",
          None if pf is None else pf >= R["oos_pf_min"], "{:.3f}")
    if is_m and is_m.get("pf") and pf is not None:
        ret = (pf / is_m["pf"]) if math.isfinite(is_m["pf"]) else None
        check(checks, "pf_retention", "PF retention (OOS ÷ IS)", ret,
              f"≥ {R['pf_retention_min']:.2f}", None if ret is None else ret >= R["pf_retention_min"],
              "{:.3f}")
        if "net_per_day" in is_m and "net_per_day" in oos_m and is_m["net_per_day"] > 0:
            wfe, basis = oos_m["net_per_day"] / is_m["net_per_day"], "per day"
        elif is_m.get("expectancy", 0) > 0:
            wfe, basis = oos_m["expectancy"] / is_m["expectancy"], "per trade"
        else:
            wfe, basis = None, ""
        check(checks, "wfe", f"Walk-forward efficiency ({basis or 'n/a'})", wfe,
              f"≥ {R['wfe_min']:.2f}", None if wfe is None else wfe >= R["wfe_min"], "{:.3f}")
    else:
        check(checks, "pf_retention", "PF retention (OOS ÷ IS)", None, "needs in-sample", None)
    if folds and len(folds) > 1:
        share = sum(1 for f in folds if f["oos"].get("pf", 0) > 1) / len(folds)
        check(checks, "folds", "Walk-forward folds profitable", share * 100,
              f"≥ {R['folds_profitable_min'] * 100:.0f}%",
              share >= R["folds_profitable_min"], "{:.0f}%")
    dd = oos_m.get("max_dd_pct")
    check(checks, "oos_max_dd", "OOS max drawdown % of peak", dd,
          f"≤ {R['oos_max_dd_pct_max']:.0f}%", None if dd is None else dd <= R["oos_max_dd_pct_max"],
          "{:.1f}%")
    if mc:
        check(checks, "mc_edge", "Bootstrap P(PF < 1)", mc["p_pf_below_1"] * 100,
              f"≤ {R['mc_p_pf_below_1_max'] * 100:.0f}%",
              mc["p_pf_below_1"] <= R["mc_p_pf_below_1_max"], "{:.1f}%")
        d95 = mc.get("dd95_pct")
        check(checks, "mc_dd95", "Monte Carlo 95th pct drawdown", d95,
              f"≤ {R['mc_dd95_pct_max']:.0f}%", None if d95 is None else d95 <= R["mc_dd95_pct_max"],
              "{:.1f}%")
    else:
        check(checks, "mc_edge", "Bootstrap P(PF < 1)", None, "needs a trade list", None)
    ex = oos_m.get("pf_ex_top")
    check(checks, "fragility", f"PF without best {oos_m.get('top_removed', '5%')} trades", ex,
          f"≥ {R['pf_ex_top_min']:.2f}", None if ex is None else ex >= R["pf_ex_top_min"], "{:.3f}")
    check(checks, "stress", "PF after extra cost per trade", stress_pf,
          f"≥ {R['stress_pf_min']:.2f}", None if stress_pf is None else stress_pf >= R["stress_pf_min"],
          "{:.3f}")

    failed = [c for c in checks if c["result"] == "FAIL" and c["key"] != "oos_trades"]
    if n < R["floor_trades"]:
        verdict = "INCONCLUSIVE"
        reason = (f"Only {n} out-of-sample trades; under {R['floor_trades']} nothing can be "
                  "concluded either way. Extend the out-of-sample period.")
    elif failed and (n >= R["min_oos_trades"] or any(c["key"] in HARD_FAILS for c in failed)):
        verdict = "FAIL"
        keys = {c["key"] for c in failed}
        shown = [c for c in failed if not (c["key"] == "oos_pf" and "oos_pf_above_1" in keys)]
        reason = "; ".join(f"{c['label']} {c['shown']} (needs {c['threshold']})" for c in shown)
    elif n < R["min_oos_trades"]:
        verdict = "INCONCLUSIVE"
        reason = (f"{n} out-of-sample trades is under {R['min_oos_trades']}. "
                  + ("Soft checks failing: " + "; ".join(c["label"] for c in failed) + ". "
                     if failed else "Nothing decisive failed. ")
                  + "More out-of-sample data needed before a pass can be called.")
    else:
        verdict = "PASS"
        skipped = [c["label"] for c in checks if c["result"] == "SKIP"]
        reason = "Every check that could be run passed." + (
            f" Not run: {', '.join(skipped)}." if skipped else "")

    if audit and audit["status"] == "CRITICAL":
        deploy = "BLOCKED: risk audit found exposed risk inputs. Fix them, then re-run."
    elif verdict == "PASS":
        deploy = "Eligible for the next stage: forward test on demo, same constants, no re-tuning."
    else:
        deploy = "Not eligible. A FAIL is a result, not a setback: log it and move on." \
            if verdict == "FAIL" else "Not eligible yet."
    return {"verdict": verdict, "reason": reason, "deployment": deploy, "checks": checks,
            "rules_changed": rules_changed}


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
def fmt(v, f="{:,.2f}"):
    if v is None:
        return "—"
    if isinstance(v, float) and math.isinf(v):
        return "∞"
    return f.format(v) if isinstance(v, (int, float)) else str(v)


ROWS = [("Trades", "trades", "{:,.0f}"), ("Period", None, None),
        ("Net profit", "net", "{:,.2f}"), ("Profit Factor", "pf", "{:.2f}"),
        ("Win rate", "win_rate", "{:.1f}%"), ("Avg win / avg loss", None, None),
        ("Expectancy per trade", "expectancy", "{:,.2f}"),
        ("t-stat of mean trade", "t_stat", "{:.2f}"),
        ("Max drawdown", "max_dd", "{:,.2f}"), ("Max drawdown % of peak", "max_dd_pct", "{:.1f}%"),
        ("Recovery factor", "recovery", "{:.2f}"),
        ("Longest losing streak", "max_losing_streak", "{:.0f}"),
        ("Trades per month", "trades_per_month", "{:.1f}")]


def seg_cell(m, key, f, label):
    if not m:
        return "—"
    if label == "Period":
        return f"{m['first']} → {m['last']}" if "first" in m else "—"
    if label.startswith("Avg win"):
        return f"{fmt(m.get('avg_win'))} / {fmt(m.get('avg_loss'))}"
    return fmt(m.get(key), f)


def report(name, gate, is_m, oos_m, folds, mc, audit_md, notes, stress_cost, balance):
    v = gate["verdict"]
    out = [f"# cBot gate: {name} — **{v}**", "", f"**Why:** {gate['reason']}", "",
           f"**Deployment:** {gate['deployment']}", ""]
    if gate["rules_changed"]:
        out += ["> Thresholds changed from the defaults for this run: "
                + ", ".join(f"`{k}` {a} → {b}" for k, a, b in gate["rules_changed"]), ""]
    out += ["## Checks", "", "| Check | Result | Value | Needs |", "|---|---|---|---|"]
    for c in gate["checks"]:
        out.append(f"| {c['label']} | {c['result']} | {c['shown']} | {c['threshold']} |")
    out += ["", "## Segments", "", "| Metric | In-sample | Out-of-sample |", "|---|---|---|"]
    for label, key, f in ROWS:
        out.append(f"| {label} | {seg_cell(is_m, key, f, label)} | {seg_cell(oos_m, key, f, label)} |")
    if folds and len(folds) > 1:
        out += ["", "## Walk-forward folds", "", "| Fold | IS PF | OOS PF | OOS trades | OOS net |",
                "|---|---|---|---|---|"]
        for i, fo in enumerate(folds, 1):
            out.append(f"| {i} | {fmt(fo['is'].get('pf'), '{:.2f}')} | "
                       f"{fmt(fo['oos'].get('pf'), '{:.2f}')} | {fo['oos'].get('trades', 0)} | "
                       f"{fmt(fo['oos'].get('net'))} |")
    if mc:
        out += ["", f"## Monte Carlo (out-of-sample, {mc['runs']:,} runs, seed {mc['seed']})", "",
                "| Measure | Value |", "|---|---|",
                f"| Drawdown, 95th / 99th percentile (trade order shuffled) | "
                f"{fmt(mc['dd95'])} / {fmt(mc['dd99'])}"
                + (f" ({mc['dd95_pct']:.1f}% / {mc['dd99_pct']:.1f}%)" if mc['dd95_pct'] is not None else "")
                + " |",
                f"| Profit Factor, 5th / 50th percentile (trades resampled) | "
                f"{fmt(mc['pf_p05'], '{:.2f}')} / {fmt(mc['pf_p50'], '{:.2f}')} |",
                f"| Probability PF < 1 | {mc['p_pf_below_1'] * 100:.1f}% |",
                f"| Net profit, 5th percentile | {fmt(mc['net_p05'])} |"]
    if audit_md:
        out += ["", audit_md.replace("## Risk-constant audit", "## Risk-constant audit").rstrip()]
    out += ["", "## Data", ""]
    out += [f"- {n}" for n in notes]
    out.append(f"- Starting balance: {fmt(balance) if balance else 'unknown (drawdown % checks skipped)'}")
    if stress_cost:
        out.append(f"- Stress: {stress_cost} subtracted from every trade")
    out += ["", "## What this gate does not cover", "",
            "- Fill realism: a backtest on m1 bars or interpolated ticks overstates scalper "
            "results. Prefer tick-data backtests for anything under 15m.",
            "- Regime change: out-of-sample is still the past. The demo forward test is the next filter.",
            "- Selection bias: if many variants were tried, the best one's OOS result is "
            "optimistic. Count the variants you tested and say so in the log."]
    return "\n".join(out)


def load_summary(path):
    d = json.loads(Path(path).read_text())

    def seg(s):
        if not s:
            return None
        m = {"trades": int(s.get("trades", 0)), "pf": s.get("pf"), "net": s.get("net"),
             "max_dd_pct": s.get("max_dd_pct"), "win_rate": s.get("win_rate"),
             "expectancy": (s["net"] / s["trades"]) if s.get("net") is not None and s.get("trades") else None}
        if s.get("days") and s.get("net") is not None:
            m["net_per_day"] = s["net"] / s["days"]
        return m
    return seg(d.get("is")), seg(d.get("oos"))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--trades")
    ap.add_argument("--split", help="OOS starts at this date (YYYY-MM-DD)")
    ap.add_argument("--oos-fraction", type=float)
    ap.add_argument("--is", dest="is_files", action="append", default=[])
    ap.add_argument("--oos", dest="oos_files", action="append", default=[])
    ap.add_argument("--summary")
    ap.add_argument("--balance", type=float)
    ap.add_argument("--source", action="append", default=[])
    ap.add_argument("--stress-cost", type=float)
    ap.add_argument("--name", default="cBot")
    ap.add_argument("--profit-col")
    ap.add_argument("--time-col")
    ap.add_argument("--monthfirst", action="store_true", help="read 03/04 as 4 March")
    ap.add_argument("--rules")
    ap.add_argument("--json")
    a = ap.parse_args()

    changed = []
    if a.rules:
        for k, v in json.loads(Path(a.rules).read_text()).items():
            if k in RULES and RULES[k] != v:
                changed.append((k, RULES[k], v))
                RULES[k] = v

    notes, folds, mc, stress_pf = [], [], None, None
    balance = a.balance
    if a.summary:
        is_m, oos_m = load_summary(a.summary)
        notes.append(f"{Path(a.summary).name}: headline numbers only, Monte Carlo not possible. "
                     "Export the trade list to unlock the full gate.")
    else:
        def ld(p):
            t = load_trades(p, a.profit_col, a.time_col, a.monthfirst)
            notes.extend(t["notes"])
            return t
        if a.trades:
            t = ld(a.trades)
            balance = balance or t["start_balance"]
            p, tm = t["profits"], t["times"]
            if a.split:
                if not tm:
                    sys.exit("--split needs a time column; use --oos-fraction instead")
                cut = datetime.fromisoformat(a.split)
                k = next((i for i, d in enumerate(tm) if d and d >= cut), len(p))
            elif a.oos_fraction:
                k = int(round(len(p) * (1 - a.oos_fraction)))
            else:
                k = 0
                notes.append("No split given: the whole history is scored as out-of-sample. "
                             "Decay checks need --split or --is/--oos.")
            is_p, oos_p = p[:k], p[k:]
            is_t, oos_t = (tm[:k], tm[k:]) if tm else (None, None)
            is_bal = balance
            oos_bal = (balance + sum(is_p)) if balance else None
            is_m = metrics(is_p, is_t, is_bal) if is_p else None
            oos_m = metrics(oos_p, oos_t, oos_bal)
        elif a.oos_files:
            if a.is_files and len(a.is_files) != len(a.oos_files):
                sys.exit("give one --is per --oos (folds are paired in order)")
            is_all, oos_all = [], []
            for i, of in enumerate(a.oos_files):
                o = ld(of)
                balance = balance or o["start_balance"]
                fi = ld(a.is_files[i]) if a.is_files else None
                folds.append({"is": metrics(fi["profits"], fi["times"], balance) if fi else {},
                              "oos": metrics(o["profits"], o["times"], balance)})
                oos_all += o["profits"]
                if fi:
                    is_all += fi["profits"]
            oos_m = metrics(oos_all, None, balance)
            is_m = metrics(is_all, None, balance) if is_all else None
            # rate-based WFE across folds: total net over total days per segment
            def days(ms, seg):
                return sum(f[seg].get("days", 0) for f in ms)
            if folds and all("days" in f["oos"] for f in folds) and is_m and \
                    all("days" in f["is"] for f in folds):
                oos_m["net_per_day"] = oos_m["net"] / max(days(folds, "oos"), 1)
                is_m["net_per_day"] = is_m["net"] / max(days(folds, "is"), 1)
            spans = [(f["oos"].get("first"), f["oos"].get("last")) for f in folds]
            if all(a_ and b_ for a_, b_ in spans):
                oos_m["first"], oos_m["last"] = min(x for x, _ in spans), max(y for _, y in spans)
                oos_days = days(folds, "oos")
                oos_m["trades_per_month"] = oos_m["trades"] / max(oos_days, 1) * 30.44
            if len(folds) > 1:
                notes.append(f"{len(folds)} walk-forward folds; OOS figures are the folds joined in order.")
        else:
            sys.exit("give --trades, --oos (with optional --is), or --summary")
        oos_p_all = oos_p if a.trades else oos_all
        if oos_m.get("trades", 0) >= 2:
            mc = monte_carlo(oos_p_all, oos_bal if a.trades else balance,
                             RULES["mc_runs"], RULES["mc_seed"])
        if a.stress_cost:
            stress_pf = profit_factor([x - a.stress_cost for x in oos_p_all])

    audit, audit_md = None, ""
    if a.source:
        sys.path.insert(0, str(Path(__file__).parent))
        import audit_risk
        files = audit_risk.collect(a.source)
        results = [audit_risk.audit_source(f) for f in files]
        audit_md = audit_risk.to_markdown(results)
        worst = max(results, key=lambda r: {"CLEAN": 0, "REVIEW": 1, "CRITICAL": 2}[r["status"]])
        audit = {"status": worst["status"], "results": results}

    gate = run_gate(is_m, oos_m, folds, mc, stress_pf, audit, changed)
    print(report(a.name, gate, is_m, oos_m, folds, mc, audit_md, notes, a.stress_cost, balance))
    if a.json:
        def clean(o):
            if isinstance(o, float) and not math.isfinite(o):
                return "inf"
            if isinstance(o, dict):
                return {k: clean(v) for k, v in o.items()}
            if isinstance(o, list):
                return [clean(v) for v in o]
            return o
        Path(a.json).write_text(json.dumps(clean({
            "name": a.name, **gate, "in_sample": is_m, "out_of_sample": oos_m,
            "folds": folds, "monte_carlo": mc, "audit": audit, "notes": notes,
            "balance": balance}), indent=2, default=str))
    sys.exit({"PASS": 0, "INCONCLUSIVE": 1, "FAIL": 2}[gate["verdict"]])


if __name__ == "__main__":
    main()
