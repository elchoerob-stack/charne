# GoldBreakout XAUUSD

London breakout of gold's Asian range, traded only in the direction of the daily trend.
It is the highest-frequency gold strategy with an edge in the
[November 2026 research](../GoldResearch/README.md#high-frequency-round-stage-5-many-trades-pf-1218):
about **100 trades a year**.

**Status: DEMO ONLY. cbot-gate: FAIL** (out-of-sample PF 1.23, below the 1.30 bar; PF 0.94 without its best 22 trades).
It sits at the bottom of the PF 1.2–1.8 band. At ~100 trades a year, a demo forward test gives the gate 100 fresh trades in about a year.

## Results (research harness: M1 bid/ask, commission, published rules + trend filter)

| Period | Trades | Per year | PF | Avg R | Win | Max DD (0.5% risk) |
|---|---|---|---|---|---|---|
| Sep 2016 – Dec 2022 | 526 | 84 | 1.12 | +0.06 | 42% | 7.5% |
| Same, without 2020–21 | 307 | – | 1.15 | +0.07 | 43% | 4.8% |
| **Jan 2023 – Oct 2026 (untouched, run once)** | **435** | **114** | **1.23** | +0.11 | 43% | 7.6% |
| 10 years without 2020–21 | 742 | 73 | 1.20 | +0.09 | 43% | 7.6% |

- **Average win** +1.29R, **average loss** −0.82R. 43% of trades win.
- **10 years at 0.5% risk:** +44% (+39% without 2020–21).
- **By year (PF):** 2017 1.43 · 2018 1.13 · 2019 1.13 · 2020 0.99 · 2021 1.17 · 2022 1.17 · **2023 0.81** · 2024 1.44 · 2025 1.31 · 2026 1.32.

## Rules

All times are on the usual **broker clock = New York time + 7h**: the trading day starts at 17:00 New York and the hours follow US daylight saving. The cBot runs in New York time and converts, so your chart's time zone doesn't matter.

1. **Range:** the high and low of the M1 bars from 03:00 to 08:00 (bid prices), Monday to Friday.
2. **Filter:** skip the day if the range is under 0.30% or over 1.60% of price.
3. **Trend:** compare yesterday's daily close with its 100-day EMA. Above = buys only, below = sells only.
4. **08:00:**
   - A buy stop goes at the range high + 0.01% (or a sell stop at the low − 0.01%).
   - **If price breaks the other side first, the day is cancelled.**
5. **Stop and target:**
   - The stop goes at the other side of the range, capped at 0.60% of price.
   - Target 2.5× the risk.
   - At 1.5× the risk, the stop moves to entry.
   - After a fill, stop and target are re-set from the actual fill price.
6. **21:00:** close any position and cancel any order. Friday 21:00 is 14:00 New York, so it never holds overnight or over a weekend.

At most one trade a day.

## Risk constants (top of the file)

| Constant | Value |
|---|---|
| `RiskPerTradePct` | 0.5% of equity at the stop |
| `MaxPeakDrawdownPct` | 6%: close all and halt until `KillSwitchEpoch` is changed |
| `MaxVolumeOverRisk` | 1.01: never rounds the lot up past the risk budget |
| `TargetR`, `BreakEvenR` | 2.5 and 1.5, constants so the optimiser can't fit them |
| `DemoOnly` | true: stops itself on a live account |

**Risk audit: REVIEW, 0 CRITICAL.** The one note is that `Stop Cap %` is a parameter. The lot is sized from the stop, so a wider stop means a smaller position, not a bigger loss.

## Account size

The stop is the Asian range. Median stops and the account needed for the broker's minimum 0.01 lot (1 oz) at 0.5% risk:

| Year | Median stop | Account needed |
|---|---|---|
| 2023 | $8/oz | ~$1,700 |
| 2025 | $19/oz | ~$3,900 |
| 2026 | $27/oz | **~$5,300** |

On a smaller account the bot skips the day and logs `account too small ... (needs equity of about N)`.

## Load it into cTrader (Desktop, on the laptop)

1. Download `GoldBreakout_XAUUSD.cs` and open it in Notepad. Press **Ctrl+A**, then **Ctrl+C**.
2. In cTrader go to **Algo → cBots → New**. Name it `GoldBreakout XAUUSD`.
3. Press **Ctrl+A**, then **Ctrl+V**, then **Ctrl+B** to build.
4. **Backtest it:**
   - Use any XAUUSD chart (M1 is easiest to watch).
   - Set the data to **Tick data**.
   - Pick a period from Jan 2023.
   - Set the starting balance to **10,000** or more.
   - Compare the per-year PF with the table above. Different broker data will move it a little, not a lot.
5. **Run it on demo:**
   - Add an instance on XAUUSD on a **demo** account, balance 10,000 or more, and press **Start**.
   - The Log shows `GoldBreakout on XAUUSD | mode RealTime | ... daily closes (EMA100 ...)`.
   - The chart panel shows the broker clock, today's trend side, the range and the order.
   - Start it before 08:00 broker clock. A start after 08:00 waits for the next day.
   - In South African time, while the US is on standard time (Nov – Mar, so now): the range is 03:00–08:00 SAST, orders go in at 08:00, and it goes flat at 21:00.
   - While the US is on daylight saving (Mar – Nov), each of those is one hour earlier.
6. **Feed it to cbot-gate:**
   - After about a year (around 100 trades), export **History** and run cbot-gate on it as the out-of-sample test.
   - Change nothing in between.

## Resetting a tripped drawdown halt

1. Review what happened.
2. Change `KillSwitchEpoch = 1` to `2` in the code.
3. Rebuild and restart. Peak equity restarts from current equity.

## Files

| File | What |
|---|---|
| `GoldBreakout_XAUUSD.cs` | The cBot |
| `tests/` | Builds the cBot against `cTrader.Automate` 1.0.21 with warnings as errors and runs the unit tests (`dotnet run`). With the 10-year M1 file (`dotnet run -c Release -- xau_m1_10y.csv`), it also replays the bot's daily decisions with its own `BreakoutMath`. That replay matches all 961 research trades on direction, entry, stop and target. |
| `tests/harness_trades.csv` | The research harness's trades, for that replay (`../GoldResearch/export_lb.py`) |
