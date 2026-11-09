# cBot gate: EURUSD RSI_2__H4__5_both_sma200 — **FAIL**

**Why:** OOS Profit Factor (target) 1.117 (needs ≥ 1.30); Walk-forward efficiency (per day) 0.499 (needs ≥ 0.50); Bootstrap P(PF < 1) 28.2% (needs ≤ 10%); PF without best 11 trades 0.887 (needs ≥ 1.00); PF after extra cost per trade 0.914 (needs ≥ 1.10)

**Deployment:** Not eligible. A FAIL is a result, not a setback: log it and move on.

## Checks

| Check | Result | Value | Needs |
|---|---|---|---|
| Out-of-sample trades | PASS | 217 | ≥ 100 |
| OOS Profit Factor (break-even) | PASS | 1.117 | > 1.00 |
| OOS Profit Factor (target) | FAIL | 1.117 | ≥ 1.30 |
| PF retention (OOS ÷ IS) | PASS | 0.869 | ≥ 0.70 |
| Walk-forward efficiency (per day) | FAIL | 0.499 | ≥ 0.50 |
| OOS max drawdown % of peak | PASS | 2.5% | ≤ 20% |
| Bootstrap P(PF < 1) | FAIL | 28.2% | ≤ 10% |
| Monte Carlo 95th pct drawdown | PASS | 3.9% | ≤ 30% |
| PF without best 11 trades | FAIL | 0.887 | ≥ 1.00 |
| PF after extra cost per trade | FAIL | 0.914 | ≥ 1.10 |

## Segments

| Metric | In-sample | Out-of-sample |
|---|---|---|
| Trades | 271 | 217 |
| Period | 2017-06-09 → 2022-11-25 | 2023-01-03 → 2026-11-04 |
| Net profit | 518.15 | 181.79 |
| Profit Factor | 1.28 | 1.12 |
| Win rate | 66.1% | 66.8% |
| Avg win / avg loss | 13.08 / -20.04 | 12.01 / -21.67 |
| Expectancy per trade | 1.91 | 0.84 |
| t-stat of mean trade | 1.54 | 0.59 |
| Max drawdown | 332.38 | 270.96 |
| Max drawdown % of peak | 3.2% | 2.5% |
| Recovery factor | 1.56 | 0.67 |
| Longest losing streak | 5 | 4 |
| Trades per month | 4.1 | 4.7 |

## Monte Carlo (out-of-sample, 3,000 runs, seed 42)

| Measure | Value |
|---|---|
| Drawdown, 95th / 99th percentile (trade order shuffled) | 421.41 / 495.22 (3.9% / 4.5%) |
| Profit Factor, 5th / 50th percentile (trades resampled) | 0.81 / 1.11 |
| Probability PF < 1 | 28.2% |
| Net profit, 5th percentile | -353.95 |

## Data

- fx_trades_RSI_2__H4__5_both_sma200.csv: profit from 'Net Profit'
- fx_trades_RSI_2__H4__5_both_sma200.csv: time from 'Closing Time', format %Y-%m-%d %H:%M:%S (day-first where ambiguous)
- Starting balance: 10,000.00
- Stress: 1.5 subtracted from every trade

## What this gate does not cover

- Fill realism: a backtest on m1 bars or interpolated ticks overstates scalper results. Prefer tick-data backtests for anything under 15m.
- Regime change: out-of-sample is still the past. The demo forward test is the next filter.
- Selection bias: if many variants were tried, the best one's OOS result is optimistic. Count the variants you tested and say so in the log.
