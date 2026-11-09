# cBot gate: GoldTrend D1, finalist A (40d breakout, 3 ATR chandelier) — **INCONCLUSIVE**

**Why:** Only 21 out-of-sample trades; under 30 nothing can be concluded either way. Extend the out-of-sample period.

**Deployment:** Not eligible yet.

## Checks

| Check | Result | Value | Needs |
|---|---|---|---|
| Out-of-sample trades | FAIL | 21 | ≥ 100 |
| OOS Profit Factor (break-even) | PASS | 3.574 | > 1.00 |
| OOS Profit Factor (target) | PASS | 3.574 | ≥ 1.30 |
| PF retention (OOS ÷ IS) | PASS | 1.782 | ≥ 0.70 |
| Walk-forward efficiency (per day) | PASS | 3.098 | ≥ 0.50 |
| OOS max drawdown % of peak | PASS | 1.1% | ≤ 20% |
| Bootstrap P(PF < 1) | PASS | 3.3% | ≤ 10% |
| Monte Carlo 95th pct drawdown | PASS | 2.0% | ≤ 30% |
| PF without best 2 trades | PASS | 1.663 | ≥ 1.00 |
| PF after extra cost per trade | PASS | 2.989 | ≥ 1.10 |

## Segments

| Metric | In-sample | Out-of-sample |
|---|---|---|
| Trades | 29 | 21 |
| Period | 2017-01-05 → 2022-10-03 | 2023-02-03 → 2026-10-27 |
| Net profit | 446.95 | 899.59 |
| Profit Factor | 2.01 | 3.57 |
| Win rate | 55.2% | 52.4% |
| Avg win / avg loss | 55.71 / -34.19 | 113.56 / -34.95 |
| Expectancy per trade | 15.41 | 42.84 |
| t-stat of mean trade | 1.44 | 1.69 |
| Max drawdown | 114.96 | 115.04 |
| Max drawdown % of peak | 1.1% | 1.1% |
| Recovery factor | 3.89 | 7.82 |
| Longest losing streak | 3 | 3 |
| Trades per month | 0.4 | 0.5 |

## Monte Carlo (out-of-sample, 3,000 runs, seed 42)

| Measure | Value |
|---|---|
| Drawdown, 95th / 99th percentile (trade order shuffled) | 218.05 / 267.01 (2.0% / 2.4%) |
| Profit Factor, 5th / 50th percentile (trades resampled) | 1.22 / 3.56 |
| Probability PF < 1 | 3.3% |
| Net profit, 5th percentile | 95.88 |

## Data

- trades_trend_A_2016-09_2026-10.csv: profit from 'Net Profit'
- trades_trend_A_2016-09_2026-10.csv: time from 'Closing Time', format %Y-%m-%d %H:%M:%S (day-first where ambiguous)
- Starting balance: 10,000.00
- Stress: 5.0 subtracted from every trade

## What this gate does not cover

- Fill realism: a backtest on m1 bars or interpolated ticks overstates scalper results. Prefer tick-data backtests for anything under 15m.
- Regime change: out-of-sample is still the past. The demo forward test is the next filter.
- Selection bias: if many variants were tried, the best one's OOS result is optimistic. Count the variants you tested and say so in the log.
