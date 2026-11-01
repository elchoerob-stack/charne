#!/usr/bin/env python3
"""Self-test for the cbot-gate skill scripts. Run: python3 skills/tests/test_cbot_gate.py"""

import csv
import json
import random
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parent / "cbot-gate" / "scripts"
GATE = SCRIPTS / "gate.py"
AUDIT = SCRIPTS / "audit_risk.py"
FIX = HERE / "fixtures"
TMP = Path(tempfile.mkdtemp(prefix="cbot-gate-test-"))


def synth(n, win_rate, payoff, risk=50.0, seed=1, start=datetime(2023, 1, 2, 9)):
    rng = random.Random(seed)
    out, t = [], start
    for _ in range(n):
        t += timedelta(hours=rng.randint(3, 30))
        win = rng.random() < win_rate
        pnl = risk * payoff * rng.uniform(0.7, 1.3) if win else -risk * rng.uniform(0.85, 1.05)
        out.append((t, round(pnl, 2)))
    return out


def write_ctrader(path, trades, balance=10000.0, semicolon=False):
    """cTrader-style history: dd/mm/yyyy times, Net column, Balance after trade."""
    d = ";" if semicolon else ","
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, delimiter=d)
        w.writerow(["ID", "Symbol", "Direction", "Closing Time", "Net €" if semicolon else "Net $",
                    "Balance"])
        bal = balance
        for i, (t, p) in enumerate(trades, 1):
            bal += p
            def num(x):
                s = f"{x:.2f}"
                return s.replace(".", ",") if semicolon else s
            w.writerow([i, "XAUUSD", "Buy" if i % 2 else "Sell",
                        t.strftime("%d/%m/%Y %H:%M:%S.000"), num(p), num(bal)])


def write_mt5(path, trades, balance=10000.0):
    """MT5 deals export: balance row, an 'in' row and an 'out' row per trade."""
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Time", "Deal", "Symbol", "Type", "Direction", "Volume", "Price",
                    "Commission", "Swap", "Profit", "Balance"])
        bal = balance
        w.writerow(["2023.01.01 00:00:00", 1, "", "balance", "", "", "", 0, 0,
                    f"{balance:.2f}", f"{balance:.2f}"])
        for i, (t, p) in enumerate(trades, 1):
            w.writerow([(t - timedelta(hours=1)).strftime("%Y.%m.%d %H:%M:%S"), 2 * i, "XAUUSD",
                        "buy", "in", 0.1, 1900, 0, 0, "0.00", f"{bal:.2f}"])
            bal += p
            w.writerow([t.strftime("%Y.%m.%d %H:%M:%S"), 2 * i + 1, "XAUUSD", "sell", "out",
                        0.1, 1901, 0, 0, f"{p:.2f}", f"{bal:.2f}"])


def run(script, *args):
    r = subprocess.run([sys.executable, str(script), *map(str, args)],
                       capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


FAILS = []


def expect(name, cond, out=""):
    print(("ok   " if cond else "FAIL ") + name)
    if not cond:
        FAILS.append(name)
        print(out[:3000])


# 1. A real edge, one history split by date -> PASS
edge = synth(700, 0.48, 1.7, seed=7)
p = TMP / "edge.csv"
write_ctrader(p, edge)
split = edge[int(len(edge) * 0.7)][0].date().isoformat()
code, out = run(GATE, "--trades", p, "--split", split, "--name", "Edge", "--json", TMP / "edge.json")
expect("edge passes", code == 0 and "**PASS**" in out, out)
j = json.loads((TMP / "edge.json").read_text())
expect("balance read from Balance column", abs(j["balance"] - 10000) < 0.01, out)
expect("json has monte carlo", j["monte_carlo"]["runs"] == 3000, out)

# 2. Same file with semicolons and comma decimals -> same verdict, same trade count
p2 = TMP / "edge_eu.csv"
write_ctrader(p2, edge, semicolon=True)
code2, out2 = run(GATE, "--trades", p2, "--split", split, "--json", TMP / "edge_eu.json")
j2 = json.loads((TMP / "edge_eu.json").read_text())
expect("comma-decimal file parses identically",
       code2 == 0 and j2["out_of_sample"]["trades"] == j["out_of_sample"]["trades"]
       and abs(j2["out_of_sample"]["net"] - j["out_of_sample"]["net"]) < 0.01, out2)

# 3. Edge in sample, none out of sample -> FAIL
decay = synth(400, 0.52, 1.6, seed=3) + synth(250, 0.38, 1.5, seed=4,
                                              start=datetime(2025, 1, 1))
p3 = TMP / "decay.csv"
write_ctrader(p3, decay)
code, out = run(GATE, "--trades", p3, "--split", "2025-01-01", "--name", "Decay")
expect("decaying bot fails", code == 2 and "**FAIL**" in out, out)
expect("fail names PF retention", "PF retention" in out.split("**Why:**")[1].split("\n")[0], out)

# 4. Too few OOS trades -> INCONCLUSIVE, not PASS
few = synth(300, 0.5, 1.8, seed=5) + synth(60, 0.5, 1.8, seed=6, start=datetime(2025, 1, 1))
p4 = TMP / "few.csv"
write_ctrader(p4, few)
code, out = run(GATE, "--trades", p4, "--split", "2025-01-01")
expect("few OOS trades is inconclusive", code == 1 and "**INCONCLUSIVE**" in out, out)

# 5. MT5 deals export, separate IS / OOS files
p5i, p5o = TMP / "mt5_is.csv", TMP / "mt5_oos.csv"
write_mt5(p5i, synth(400, 0.48, 1.7, seed=8))
write_mt5(p5o, synth(200, 0.48, 1.7, seed=9, start=datetime(2025, 1, 1)))
code, out = run(GATE, "--is", p5i, "--oos", p5o, "--json", TMP / "mt5.json")
j5 = json.loads((TMP / "mt5.json").read_text())
expect("MT5 entry and balance rows dropped", j5["out_of_sample"]["trades"] == 200, out)

# 6. Walk-forward folds
args = []
for k in range(4):
    fi, fo = TMP / f"f{k}_is.csv", TMP / f"f{k}_oos.csv"
    write_ctrader(fi, synth(200, 0.48, 1.7, seed=20 + k, start=datetime(2023, 1 + 3 * k, 1)))
    write_ctrader(fo, synth(60, 0.48, 1.7, seed=40 + k, start=datetime(2023, 3 + 3 * k, 1)))
    args += ["--is", fi, "--oos", fo]
code, out = run(GATE, *args, "--name", "WF")
expect("walk-forward folds table shown", "## Walk-forward folds" in out and "| 4 |" in out, out)
expect("walk-forward pooled OOS has 240 trades", "| Trades |" in out and "240" in out, out)

# 7. Risk audit blocks deployment even when statistics pass
code, out = run(GATE, "--trades", p, "--split", split, "--source", FIX / "BadBot.cs")
expect("bad bot blocked", "BLOCKED" in out and "RiskPercent" in out, out)
code, out = run(GATE, "--trades", p, "--split", split, "--source", FIX / "GoodBot.cs")
expect("good bot eligible", "Eligible for the next stage" in out, out)

# 8. Stress cost large enough to kill the edge
code, out = run(GATE, "--trades", p, "--split", split, "--stress-cost", 30)
expect("stress cost fails the gate", code == 2 and "extra cost" in out, out)

# 9. Threshold overrides are reported
rules = TMP / "rules.json"
rules.write_text(json.dumps({"oos_pf_min": 1.1}))
code, out = run(GATE, "--trades", p3, "--split", "2025-01-01", "--rules", rules)
expect("changed thresholds are disclosed", "Thresholds changed" in out and "oos_pf_min" in out, out)

# 10. Summary-only mode
s = TMP / "summary.json"
s.write_text(json.dumps({"is": {"trades": 420, "pf": 1.72, "net": 8200, "days": 540},
                         "oos": {"trades": 160, "pf": 1.05, "net": 600, "days": 180,
                                 "max_dd_pct": 9.5}}))
code, out = run(GATE, "--summary", s)
expect("summary mode fails on PF", code == 2 and "Monte Carlo not possible" in out, out)

# 11. Audit alone
code, out = run(AUDIT, FIX / "BadBot.cs")
expect("audit flags RiskPercent, MaxOpenTrades, martingale",
       code == 2 and all(x in out for x in ("RiskPercent", "MaxOpenTrades", "`volume`")), out)
expect("audit ignores FVG size, plot colour and commented code",
       "MinFvgSize" not in out and "PlotColour" not in out and "Lot Size" not in out, out)
code, out = run(AUDIT, FIX / "GoodBot.cs")
expect("good bot audit clean", code == 0 and "CLEAN" in out, out)

# 12. Format written by the C# OnStop logger in references/exporting-trades.md
p12 = TMP / "csharp_log.csv"
with open(p12, "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["Closing Time", "Entry Time", "Symbol", "Direction", "Volume", "Pips", "Gross",
                "Commissions", "Swap", "Net Profit", "Balance"])
    bal = 5000.0
    for t, pnl in synth(150, 0.48, 1.7, seed=12):
        bal += pnl
        w.writerow([t.strftime("%Y-%m-%d %H:%M:%S"), (t - timedelta(hours=2)).strftime("%Y-%m-%d %H:%M:%S"),
                    "XAUUSD", "Buy", 100, 12.5, pnl + 3, -3, 0, pnl, round(bal, 2)])
code, out = run(GATE, "--trades", p12, "--json", TMP / "cs.json")
j12 = json.loads((TMP / "cs.json").read_text())
expect("C# log loads: Net Profit chosen over Gross, balance 5000",
       j12["out_of_sample"]["trades"] == 150 and abs(j12["balance"] - 5000) < 0.01
       and "profit from 'Net Profit'" in out, out)

# 13. Real-world patterns found auditing the Trade Desk repo
code, out = run(AUDIT, FIX / "BadBot.cs")
expect("breaker-reset switch is critical, with one-shot advice",
       "ResetEquityFloorHalt" in out and "one-shot" in out and "UseNewsFilter" not in out, out)
code, out = run(AUDIT, FIX / "split")
expect("risk constants in another file count for the project",
       code == 0 and "No const/readonly" not in out, out)
expect("stop attached after fill with close-on-failure is INFO, not REVIEW",
       "| INFO |" in out and "| REVIEW |" not in out, out)
expect("equity floor, loss-streak halt found; reward:risk not called sizing",
       "EQUITY_FLOOR" in out and "CONSECUTIVE_LOSS_HALT" in out, out)
code, out = run(AUDIT, FIX / "split" / "Hands.cs")
expect("hands file alone still asks where the risk constants are",
       "No const/readonly" in out, out)

print(f"\n{'all passed' if not FAILS else str(len(FAILS)) + ' failed'}  (files in {TMP})")
sys.exit(1 if FAILS else 0)
