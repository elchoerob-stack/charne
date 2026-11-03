# cBot gate: GoldGuard v3 refined defaults (203 variants tested) — **FAIL**

**Why:** OOS Profit Factor (target) 1.182 (needs ≥ 1.30); Bootstrap P(PF < 1) 13.5% (needs ≤ 10%); PF without best 12 trades 0.896 (needs ≥ 1.00)

**Deployment:** Not eligible. A FAIL is a result, not a setback: log it and move on.

## Checks

| Check | Result | Value | Needs |
|---|---|---|---|
| Out-of-sample trades | PASS | 221 | ≥ 100 |
| OOS Profit Factor (break-even) | PASS | 1.182 | > 1.00 |
| OOS Profit Factor (target) | FAIL | 1.182 | ≥ 1.30 |
| PF retention (OOS ÷ IS) | PASS | 0.965 | ≥ 0.70 |
| Walk-forward efficiency (per day) | PASS | 1.276 | ≥ 0.50 |
| OOS max drawdown % of peak | PASS | 7.4% | ≤ 20% |
| Bootstrap P(PF < 1) | FAIL | 13.5% | ≤ 10% |
| Monte Carlo 95th pct drawdown | PASS | 8.6% | ≤ 30% |
| PF without best 12 trades | FAIL | 0.896 | ≥ 1.00 |
| PF after extra cost per trade | PASS | 1.131 | ≥ 1.10 |

## Segments

| Metric | In-sample | Out-of-sample |
|---|---|---|
| Trades | 290 | 221 |
| Period | 2023-01-03 → 2025-06-13 | 2025-07-02 → 2026-10-26 |
| Net profit | 1,410.87 | 970.77 |
| Profit Factor | 1.22 | 1.18 |
| Win rate | 50.3% | 49.3% |
| Avg win / avg loss | 52.64 / -43.57 | 57.92 / -47.70 |
| Expectancy per trade | 4.87 | 4.39 |
| t-stat of mean trade | 1.48 | 1.06 |
| Max drawdown | 408.76 | 979.06 |
| Max drawdown % of peak | 3.8% | 7.4% |
| Recovery factor | 3.45 | 0.99 |
| Longest losing streak | 7 | 8 |
| Trades per month | 9.9 | 14.0 |

## Monte Carlo (out-of-sample, 3,000 runs, seed 42)

| Measure | Value |
|---|---|
| Drawdown, 95th / 99th percentile (trade order shuffled) | 1,059.54 / 1,294.36 (8.6% / 10.5%) |
| Profit Factor, 5th / 50th percentile (trades resampled) | 0.92 / 1.18 |
| Probability PF < 1 | 13.5% |
| Net profit, 5th percentile | -474.71 |

## Risk-constant audit

**GoldGuard_XAUUSD_v3.cs**: REVIEW  
47 parameters, 8 risk constants found in code.

| Severity | Line | Item | What and why |
|---|---|---|---|
| REVIEW | 109 | `RewardRisk` | Stop/exit distance is a [Parameter] ("Reward / Risk"). Fine to optimise as strategy logic, but cap it: add a const ceiling on loss per trade in account terms so a wide stop can never mean a bigger loss. |
| REVIEW | 130 | `HarmonicStopBuffer` | Stop/exit distance is a [Parameter] ("Harmonic Stop Buffer (x ATR)"). Fine to optimise as strategy logic, but cap it: add a const ceiling on loss per trade in account terms so a wide stop can never mean a bigger loss. |
| REVIEW | 136 | `HarmonicMinRr` | Stop/exit distance is a [Parameter] ("Harmonic Min Reward / Risk"). Fine to optimise as strategy logic, but cap it: add a const ceiling on loss per trade in account terms so a wide stop can never mean a bigger loss. |
| REVIEW | 145 | `AtrStopMult` | Stop/exit distance is a [Parameter] ("ATR Stop Multiple"). Fine to optimise as strategy logic, but cap it: add a const ceiling on loss per trade in account terms so a wide stop can never mean a bigger loss. |
| REVIEW | 148 | `SwingStopBuffer` | Stop/exit distance is a [Parameter] ("Swing Stop Buffer (x ATR)"). Fine to optimise as strategy logic, but cap it: add a const ceiling on loss per trade in account terms so a wide stop can never mean a bigger loss. |
| REVIEW | 151 | `MaxStopAtr` | Stop/exit distance is a [Parameter] ("Max Stop (x ATR)"). Fine to optimise as strategy logic, but cap it: add a const ceiling on loss per trade in account terms so a wide stop can never mean a bigger loss. |
| REVIEW | 181 | `TrailStartR` | Stop/exit distance is a [Parameter] ("Trail Starts at R"). Fine to optimise as strategy logic, but cap it: add a const ceiling on loss per trade in account terms so a wide stop can never mean a bigger loss. |
| REVIEW | 184 | `TrailAtrMult` | Stop/exit distance is a [Parameter] ("Trail ATR Multiple"). Fine to optimise as strategy logic, but cap it: add a const ceiling on loss per trade in account terms so a wide stop can never mean a bigger loss. |
| REVIEW | 196 | `RunnerTrailAtr` | Stop/exit distance is a [Parameter] ("Runner Trail (x ATR)"). Fine to optimise as strategy logic, but cap it: add a const ceiling on loss per trade in account terms so a wide stop can never mean a bigger loss. |

Hardcoded risk values: `RiskPerTradePct = 0.5`, `MaxOpenRiskPct = 1.0`, `MaxDailyLossPct = 2.0`, `MaxPeakDrawdownPct = 6.0`, `MaxOpenPositions = 2`, `MaxTradesPerDay = 6`, `MaxConsecutiveLosses = 3`, `MaxVolumeOverRisk = 1.01`

## Data

- trades_v3_refined_2023-01_2026-10.csv: profit from 'Net Profit'
- trades_v3_refined_2023-01_2026-10.csv: time from 'Closing Time', format %Y-%m-%d %H:%M:%S (day-first where ambiguous)
- Starting balance: 10,000.00
- Stress: 1.14 subtracted from every trade

## What this gate does not cover

- Fill realism: a backtest on m1 bars or interpolated ticks overstates scalper results. Prefer tick-data backtests for anything under 15m.
- Regime change: out-of-sample is still the past. The demo forward test is the next filter.
- Selection bias: if many variants were tried, the best one's OOS result is optimistic. Count the variants you tested and say so in the log.
