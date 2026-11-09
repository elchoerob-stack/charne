# cBot gate: EURUSD Asian_range_breakout_to_10_00_trend_ema100_spec — **FAIL**

**Why:** OOS Profit Factor (break-even) 0.881 (needs > 1.00); Walk-forward efficiency (per day) -0.990 (needs ≥ 0.50); Bootstrap P(PF < 1) 86.7% (needs ≤ 10%); PF without best 23 trades 0.620 (needs ≥ 1.00); PF after extra cost per trade 0.831 (needs ≥ 1.10)

**Deployment:** Not eligible. A FAIL is a result, not a setback: log it and move on.

## Checks

| Check | Result | Value | Needs |
|---|---|---|---|
| Out-of-sample trades | PASS | 456 | ≥ 100 |
| OOS Profit Factor (break-even) | FAIL | 0.881 | > 1.00 |
| OOS Profit Factor (target) | FAIL | 0.881 | ≥ 1.30 |
| PF retention (OOS ÷ IS) | PASS | 0.779 | ≥ 0.70 |
| Walk-forward efficiency (per day) | FAIL | -0.990 | ≥ 0.50 |
| OOS max drawdown % of peak | PASS | 17.2% | ≤ 20% |
| Bootstrap P(PF < 1) | FAIL | 86.7% | ≤ 10% |
| Monte Carlo 95th pct drawdown | PASS | 22.2% | ≤ 30% |
| PF without best 23 trades | FAIL | 0.620 | ≥ 1.00 |
| PF after extra cost per trade | FAIL | 0.831 | ≥ 1.10 |

## Segments

| Metric | In-sample | Out-of-sample |
|---|---|---|
| Trades | 752 | 456 |
| Period | 2016-09-05 → 2022-12-30 | 2023-01-04 → 2026-11-06 |
| Net profit | 2,448.12 | -1,473.58 |
| Profit Factor | 1.13 | 0.88 |
| Win rate | 43.4% | 40.4% |
| Avg win / avg loss | 65.03 / -44.01 | 59.07 / -45.38 |
| Expectancy per trade | 3.26 | -3.23 |
| t-stat of mean trade | 1.40 | -1.12 |
| Max drawdown | 1,993.18 | 2,147.62 |
| Max drawdown % of peak | 17.5% | 17.2% |
| Recovery factor | 1.23 | -0.69 |
| Longest losing streak | 12 | 13 |
| Trades per month | 9.9 | 9.9 |

## Monte Carlo (out-of-sample, 3,000 runs, seed 42)

| Measure | Value |
|---|---|
| Drawdown, 95th / 99th percentile (trade order shuffled) | 2,920.66 / 3,240.81 (22.2% / 24.8%) |
| Profit Factor, 5th / 50th percentile (trades resampled) | 0.72 / 0.88 |
| Probability PF < 1 | 86.7% |
| Net profit, 5th percentile | -3,681.99 |

## Data

- fx_trades_Asian_range_breakout_to_10_00_trend_ema100_spec.csv: profit from 'Net Profit'
- fx_trades_Asian_range_breakout_to_10_00_trend_ema100_spec.csv: time from 'Closing Time', format %Y-%m-%d %H:%M:%S (day-first where ambiguous)
- Starting balance: 10,000.00
- Stress: 1.5 subtracted from every trade

## What this gate does not cover

- Fill realism: a backtest on m1 bars or interpolated ticks overstates scalper results. Prefer tick-data backtests for anything under 15m.
- Regime change: out-of-sample is still the past. The demo forward test is the next filter.
- Selection bias: if many variants were tried, the best one's OOS result is optimistic. Count the variants you tested and say so in the log.
