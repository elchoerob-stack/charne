# LondonBreakoutBot

Asian-range breakout at the London open. **Attach to an EURUSD M1 chart.** Robot time is London local time (DST-aware).

## Logic
- **Range:** high and low of M1 bars from 00:00 to 07:00 London time.
- **Filter:** the range must be 0.15–0.60× the daily ATR(14). That skips dead days and days where the move already happened overnight.
- **Entry:** the first M1 close beyond the range ± 1 pip between 07:00 and 10:00 enters at the next bar. One attempt per day.
- **Exit:** SL at the far side of the range (median about 26 pips), TP at 1.5R, break-even at 1R, and flat by 16:00 London.

## Hardcoded risk (constants, not parameters)
1% per trade (skips the trade if the minimum lot would risk >2%), 3% daily loss stop, 20% drawdown kill switch, and spread must be ≤ 10% of the stop. Only one trade per day, so there is no overtrading guard.

**R100 note:** a 26-pip stop at 0.01 lot is $2.60, about 48% of R100, so the guard blocks every trade on a standard account. On a **cent account** the same trade risks about 0.5%. A cent account is the only way to run this with R100.

## Backtest results: 2026-10-25 run, **FAIL**
Run with `backtest/lbo_backtest.py`, a bar-by-bar Python replica, on EURUSD M1 for 2020 (MT5 feed, converted to London time). Commission is $7/lot round turn and spread comes from the data. If SL and TP are both inside one bar, the SL counts as hit first. Defaults were fixed before the first run.

| Test | Trades | Win % | PF | Avg R | Max DD |
|---|---|---|---|---|---|
| Defaults, all rules on | 195 | 51 | 0.89 | -0.04 | 12.8% (net -9.2%) |
| Jan–Jun | 92 | 49 | 0.80 | -0.09 | |
| Jul–Dec | 103 | 52 | 0.99 | 0.00 | |
| Zero spread and commission | 195 | 51 | 0.95 | -0.02 | |
| Spread +0.3 pip | 195 | 50 | 0.85 | -0.06 | 12.7% |

**Grid of 72 configs** (TP 1–3R × SL at the range edge or midpoint × max range 0.4–0.8 ATR × entry window to 09/10/12): the best Jan–Jun PF was 0.96. Only 7% of configs had Jul–Dec PF > 1.0, and none reached 1.3.

**Diagnosis:** costs are now small (about 0.06R per trade, against about 0.25R for the M1 trend bot), but the raw breakout direction has no edge on 2020 EURUSD (PF 0.95 with no costs). Because the costs are so low, the strategy's own logic is what fails. This is a cleaner FAIL than KeystoneTrendBot, not a near miss to tweak.

**What this test can't tell you:** it covers one year and one broker feed. The proper test is cTrader's own backtest on your broker's tick data for 2021–2025, with the defaults unchanged. If that also shows PF < 1.1, the idea is done.
