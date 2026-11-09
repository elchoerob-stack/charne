# cBot gate: London breakout + D1 EMA100 (reference C) — **FAIL**

**Why:** OOS Profit Factor (target) 1.232 (needs ≥ 1.30); PF without best 22 trades 0.941 (needs ≥ 1.00)

**Deployment:** Not eligible. A FAIL is a result, not a setback: log it and move on.

## Checks

| Check | Result | Value | Needs |
|---|---|---|---|
| Out-of-sample trades | PASS | 435 | ≥ 100 |
| OOS Profit Factor (break-even) | PASS | 1.232 | > 1.00 |
| OOS Profit Factor (target) | FAIL | 1.232 | ≥ 1.30 |
| PF retention (OOS ÷ IS) | PASS | 1.112 | ≥ 0.70 |
| Walk-forward efficiency (per day) | PASS | 3.316 | ≥ 0.50 |
| OOS max drawdown % of peak | PASS | 7.6% | ≤ 20% |
| Bootstrap P(PF < 1) | PASS | 3.0% | ≤ 10% |
| Monte Carlo 95th pct drawdown | PASS | 12.0% | ≤ 30% |
| PF without best 22 trades | FAIL | 0.941 | ≥ 1.00 |
| PF after extra cost per trade | PASS | 1.175 | ≥ 1.10 |

## Segments

| Metric | In-sample | Out-of-sample |
|---|---|---|
| Trades | 526 | 435 |
| Period | 2016-09-08 → 2022-12-27 | 2023-01-03 → 2026-10-28 |
| Net profit | 1,457.51 | 2,927.07 |
| Profit Factor | 1.11 | 1.23 |
| Win rate | 42.2% | 43.0% |
| Avg win / avg loss | 67.07 / -44.19 | 83.04 / -50.81 |
| Expectancy per trade | 2.77 | 6.73 |
| t-stat of mean trade | 0.99 | 1.82 |
| Max drawdown | 864.83 | 949.98 |
| Max drawdown % of peak | 7.5% | 7.6% |
| Recovery factor | 1.69 | 3.08 |
| Longest losing streak | 11 | 14 |
| Trades per month | 7.0 | 9.5 |

## Monte Carlo (out-of-sample, 3,000 runs, seed 42)

| Measure | Value |
|---|---|
| Drawdown, 95th / 99th percentile (trade order shuffled) | 1,557.25 / 1,889.71 (12.0% / 14.4%) |
| Profit Factor, 5th / 50th percentile (trades resampled) | 1.03 / 1.23 |
| Probability PF < 1 | 3.0% |
| Net profit, 5th percentile | 400.43 |

## Data

- trades_london_C_2016-09_2026-10.csv: profit from 'Net Profit'
- trades_london_C_2016-09_2026-10.csv: time from 'Closing Time', format %Y-%m-%d %H:%M:%S (day-first where ambiguous)
- Starting balance: 10,000.00
- Stress: 1.5 subtracted from every trade

## What this gate does not cover

- Fill realism: a backtest on m1 bars or interpolated ticks overstates scalper results. Prefer tick-data backtests for anything under 15m.
- Regime change: out-of-sample is still the past. The demo forward test is the next filter.
- Selection bias: if many variants were tried, the best one's OOS result is optimistic. Count the variants you tested and say so in the log.
