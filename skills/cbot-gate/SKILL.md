---
name: cbot-gate
description: Validation gate for cTrader cBots and MT5 Expert Advisors. Scores a backtest, optimiser result or walk-forward run to PASS, FAIL or INCONCLUSIVE against fixed thresholds (Profit Factor first, out-of-sample decay, walk-forward efficiency, bootstrap edge probability, Monte Carlo drawdown, outlier dependence, cost stress), and audits the C# source for risk inputs exposed as [Parameter]. Use this whenever Jacques shares backtest results, a trade history CSV, optimiser numbers, walk-forward folds or cBot/EA source code, or asks whether a bot (AdaptiveMTFBot, GoldScalpBot, any XAUUSD or forex bot) is ready, has an edge, passed, is overfit, or can go live or to demo. Also use it before any bot moves stage (backtest → demo → live), even if he only says "check this" or "how does this look".
---

# cBot Gate

Jacques runs his trading development like engineering: walk-forward
out-of-sample testing, Profit Factor ahead of net profit, and a clean FAIL
treated as a useful result. After PivotTargetBot lost money live because an
optimisable risk input was misconfigured, every risk value became a constant in
code. This skill makes that discipline mechanical, so every bot is judged by
the same rules and nobody has to argue with a result after the fact.

Two scripts do the work, and both use only the Python standard library:

- `scripts/gate.py` scores the trades and gives the verdict. Add `--source` to
  run the audit in the same pass.
- `scripts/audit_risk.py` checks the C# source on its own.

## 1. Get the inputs

Work with what he gives you. Ask only for what is missing, and only once:

| Need | Why | If missing |
|---|---|---|
| Trade list (one row per closed trade) | Monte Carlo, outlier and significance checks all need it | Fall back to `--summary` and say what that leaves out |
| Where out-of-sample starts | Without a split, decay can't be measured | Ask for the date the optimisation window ended |
| Starting balance | Drawdown as a percentage | Read from a Balance column if there is one |
| `.cs` source | Risk audit | Run the trade checks anyway, but say deployment can't be cleared until the audit runs |
| Spread + slippage per trade, in account currency | Cost stress | Leave it out. The check shows SKIP |

Any CSV works if it has a net-profit column and a closing-time column. The
loader recognises headers loosely, handles `;` delimiters, comma decimals,
`R 1 234,56`, and day-first dates (South African format) by default. It also
drops the entry and balance rows from MT5 deal exports. If a cTrader export
won't load, `references/exporting-trades.md` has a C# snippet that makes a
cBot write its own clean trade log from `OnStop`.

For a 1m or 15m scalper, ask whether the backtest ran on tick data. Bar data
flatters scalpers, and that changes how much a PASS is worth.

## 2. Run it

```bash
# one history, out-of-sample from the date optimisation stopped
python scripts/gate.py --trades history.csv --split 2025-01-01 --balance 10000 \
    --source GoldScalpBot.cs --name "GoldScalpBot 15m v4" --json result.json

# walk-forward: one --is/--oos pair per fold, in order
python scripts/gate.py --is f1_is.csv --oos f1_oos.csv --is f2_is.csv --oos f2_oos.csv ...

# out-of-sample run only, or headline numbers only
python scripts/gate.py --oos oos.csv --balance 10000
python scripts/gate.py --summary summary.json
```

`summary.json` looks like `{"is": {"trades": 420, "pf": 1.72, "net": 8200,
"days": 540}, "oos": {"trades": 160, "pf": 1.31, "net": 1900, "days": 180,
"max_dd_pct": 9.5}}`. Use `--profit-col`/`--time-col` when headers are
unusual, and `--monthfirst` for US-format dates. Exit codes: 0 PASS,
1 INCONCLUSIVE, 2 FAIL.

## 3. The thresholds

These are set at the top of `gate.py`:

| Check | Threshold | What it catches |
|---|---|---|
| OOS trades | ≥ 100 to pass, < 30 decides nothing | Too few trades to tell an edge from luck |
| OOS Profit Factor | > 1.00 break-even, ≥ 1.30 target | No edge, or one too thin to survive costs |
| PF retention, OOS ÷ IS | ≥ 0.70 | Overfitting: the optimiser found noise |
| Walk-forward efficiency | ≥ 0.50 | Same, measured as return per day |
| Walk-forward folds with PF > 1 | ≥ 60% | Edge that only showed up in one period |
| Bootstrap P(PF < 1) | ≤ 10% | Whether the edge is statistically there |
| OOS max drawdown | ≤ 20% of peak | Drawdown he couldn't sit through |
| Monte Carlo 95th percentile drawdown | ≤ 30% | The drawdown a different order of the same trades would give |
| PF without the best 5% of trades | ≥ 1.00 | An edge that rests on a handful of outliers |
| PF after cost stress | ≥ 1.10 | An edge that disappears with worse fills |

Do not loosen a threshold after seeing a result. A gate that bends to fit the
result protects nothing. It is the same principle as hardcoding risk: once a
test starts, the values that protect the account stay fixed. If Jacques wants
different thresholds, write a
`rules.json`, apply it to the *next* bot or the next untouched period, and let
the report list the change (it does this automatically).

## 4. Present the result

Open with the verdict and its reason in one line, then show the check table
from the report. Keep the rest of the report available, but don't recite it.

- **FAIL.** State it plainly and name the check that decided it. Don't
  suggest re-optimising on the out-of-sample window: once you tune on that
  data, it is in-sample and the test is gone. A new idea is a new variant,
  tested on a period it has not seen.
- **INCONCLUSIVE.** Say how many more OOS trades are needed. Using
  `trades_per_month` from the JSON, convert that into months of data.
- **PASS.** Say what it earns: a demo forward test with the same constants.
  It is not a go-live. Repeat the "does not cover" points that apply, above all
  tick data for scalpers and how many variants were tried.
- **Audit CRITICAL.** The bot is blocked whatever the statistics say. Give the
  exact code change for each finding, e.g.
  `[Parameter("Risk %", DefaultValue = 1.0)] public double RiskPercent {get;set;}`
  becomes `private const double RiskPercent = 0.5;`. REVIEW items (an
  optimisable stop distance, a missing stop at entry) get a short note each.

Finish with one row he can paste into his validation log:

`| 2026-11-01 | GoldScalpBot 15m | v4 | FAIL | OOS PF 1.12 | 214 trades | WFE 0.41 | variants tested: 6 |`

The variants count matters. If 20 versions were tried and one passed, that pass
is weaker than it looks, so ask for the count if he hasn't given it.

## Files

- `scripts/gate.py` — loading, metrics, Monte Carlo (seeded, so reruns match), verdict, report
- `scripts/audit_risk.py` — the C# risk-constant audit. It splits names into words, so
  `MinFvgSize` or `PlotColour` are not mistaken for position sizing
- `references/exporting-trades.md` — getting a clean trade list out of cTrader and MT5
