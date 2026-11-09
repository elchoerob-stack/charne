# GoldTrend XAUUSD D1

A daily trend-following cBot for gold. It is the one strategy in the
[November 2026 research](../GoldResearch/README.md) that reached a Profit Factor
above 1.8 in both halves of 10 years of data.

**Status: DEMO ONLY. cbot-gate: INCONCLUSIVE.**

- It has only 21 out-of-sample trades, and the gate needs 100.
- Every other gate check passed: OOS PF 3.57, bootstrap P(PF<1) 3.3%, PF 1.66 without its best trades, max drawdown 1.1%.

## Rules

| | |
|---|---|
| **Buy** | A daily bar closes above the highest high of the previous 40 daily bars. The bot buys at the next daily open. |
| **Sell** | A daily bar closes below the lowest low of the previous 40 daily bars (turn off with *Allow Shorts*). |
| **Stop** | 2.5 × ATR(20, daily, Wilder) from entry, sent with the order. |
| **Trail** | Chandelier stop: the best M1 close since entry minus 3 × the entry-day ATR (plus, for shorts). It only ever tightens, and it takes over from the initial stop after a 0.5 ATR move. |
| **Time exit** | 120 daily bars. |
| **Positions** | One at a time. A breakout while a position is open is ignored. |

## Results (research harness, M1 bid/ask, swap and commission included)

| Period | Trades | PF | Avg R | Win | Max DD |
|---|---|---|---|---|---|
| Sep 2016 – Dec 2022 (in-sample) | 30 | 2.18 | +0.34 | 57% | 1.1% |
| Jan 2023 – Oct 2026 (out-of-sample, run once) | 20 | 3.37 | +0.77 | 50% | 1.1% |
| All 10 years | 50 | 2.69 | +0.51 | 54% | 1.1% |

Losing years were 2017, 2021 and 2023. Gold went sideways in all three.

Without trades opened in the COVID years (2020–2021): in-sample PF 1.93 on 21 trades, all 10 years PF 2.61. COVID helped this strategy slightly.
See [the research](../GoldResearch/README.md#excluding-the-covid-years-20202021).

## Four things to know before you run it

1. **It makes little money at 0.5% risk.**
   - It trades about 5 times a year.
   - It turned $10,000 into $11,347 over 10 years.
   - PF measures quality, not size.
2. **It needs a large account.**
   - The stop is about $280/oz at late-2026 volatility.
   - The broker's minimum 0.01 lot is 1 oz, so at 0.5% risk that needs about **$55,000**.
   - On a smaller account it logs `account too small ... (needs equity of about N)` and skips the trade.
   - The chart panel shows the current figure.
3. **It holds over weekends.** That is the strategy: median hold 15 days, longest 82.
   - Weekend gaps can fill a stop worse than planned.
   - You pay swap every night.
   - This is a deliberate exception to GoldGuard's Friday-flat rule.
4. **A forward test takes years.** At 5 trades a year, a demo test is a check that the bot behaves (orders, stop, trail), not proof of the edge.

## Risk constants (top of the file)

| Constant | Value |
|---|---|
| `RiskPerTradePct` | 0.5% of equity at the initial stop |
| `MaxPeakDrawdownPct` | 6%: close all and halt until `KillSwitchEpoch` is changed |
| `MaxVolumeOverRisk` | 1.01: never rounds the lot up past the risk budget |
| `DemoOnly` | true: stops itself on a live account |
| `KillSwitchEpoch` | 1 |

Risk audit: REVIEW, 0 CRITICAL. The two REVIEW notes say the stop and trail distances are parameters. Loss per trade is still capped, because the lot is sized from the stop so the stop always costs 0.5%.

## Load it into cTrader (Desktop, on the laptop)

1. Download `GoldTrend_XAUUSD_D1.cs` and open it in Notepad. Press **Ctrl+A** then **Ctrl+C**.
2. In cTrader go to **Algo → cBots → New**, name it `GoldTrend XAUUSD D1`, press **Ctrl+A** then **Ctrl+V**, then **Ctrl+B** to build.
3. **Backtest it first**:
   - Choose the XAUUSD **Daily** chart.
   - Set the data to **Tick data** (or *m1 bars*) from 2016 or as far back as your broker allows.
   - Set the starting balance to **100,000**, or every trade is skipped for minimum lot size.
   - Compare the trade list with `../GoldResearch/results/trades_trend_A_2016-09_2026-10.csv`.
4. Then add an instance on XAUUSD Daily on a **demo** account with a balance of at least 60,000, and press **Start**.
   - The Log should show `GoldTrend D1 on XAUUSD | mode RealTime | ...`.
   - The chart panel shows the price today must close above to buy, and below to sell.

## Resetting a tripped drawdown halt

1. Review what happened.
2. Change `KillSwitchEpoch = 1` to `2` in the code.
3. Rebuild and restart. Peak equity restarts from current equity.

The halt is stored per account and symbol (LocalStorage, device scope). Restarting the cBot does not clear it.

## Files

| File | What |
|---|---|
| `GoldTrend_XAUUSD_D1.cs` | The cBot |
| `tests/` | Builds the cBot against `cTrader.Automate` 1.0.21 with warnings as errors, runs the unit tests, and checks the bot's signal against the research harness on all 2,621 days (250 breakouts). Run `cd tests && dotnet run`. |
| `tests/d1_bars_signals.csv` | Daily bars and the harness's signals, for that check |
