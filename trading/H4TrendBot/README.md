# H4TrendBot

Classic trend follower. **Attach to an H4 chart**, one instance per symbol.

## Logic
- **Trend:** EMA50 above EMA200 for longs, below for shorts.
- **Entry:** an H4 close beyond the 20-bar Donchian channel in the trend direction; market order at the next bar.
- **Stop:** 2×ATR(14) initially (about 40–60 pips on EURUSD). No take profit.
- **Trail:** a chandelier stop at 3×ATR from the best price since entry, tightened after each H4 close and never loosened.
- **Expected profile:** a low win rate (25–35%) with occasional large winners. Long losing streaks are normal.

## Hardcoded risk (constants, not parameters)
1% per trade (skips the trade if the minimum lot would risk >2%), spread must be ≤ 10% of the stop, 20% drawdown kill switch, one position per symbol.

**R100 note:** a 50-pip stop at 0.01 lot is $5, about 90% of R100. This only works on a cent account, where the same trade risks about 1%.

## Backtest results: 2026-10-25 run, **FAIL on a small sample**
Run with `backtest/h4_backtest.py`. Signals are taken on H4 closes, and stops and trailing are simulated on M1 bars. The data is HistData EURUSD M1 for 2020–2021 (3,122 H4 bars). Costs: 0.3 pip spread, $7/lot commission, and 0.5 pip per night of swap. Defaults were fixed before the first run.

| Test | Trades | Win % | PF | Avg R | Best R | Note |
|---|---|---|---|---|---|---|
| Defaults | 60 | 27 | 0.72 | -0.16 | +5.6 | -9.7%, max DD 14.5% |
| 2020 | 25 | 24 | 1.08 | +0.06 | +5.6 | |
| 2021 | 35 | 29 | 0.48 | -0.32 | +3.1 | |
| Zero costs | 60 | 28 | 0.78 | -0.12 | | costs are not the problem |
| Spread 1 pip + swap 1 pip/night | 60 | 25 | 0.68 | -0.20 | | |

**Grid of 72 configs** (Donchian 10–55, SL 1.5–3 ATR, trail 2–4 ATR, slow EMA 100/200): the best 2020 configs scored PF 1.7–2.3. Every one of them failed in 2021, with a median 2021 PF of 0.60 and 0 of 72 configs above 1.0. That is the same overfitting pattern as the London fade.

**How much the result tells you:**
- 60 trades on one pair over two years is **too small a sample** to judge a trend follower. One or two big trends decide a whole year.
- 2021 EURUSD was a slow, choppy grind (1.23 → 1.13 with constant pullbacks), which is the worst kind of market for this style.
- Professional trend following earns its edge across 20+ markets and 10+ years, with any single market often losing.
- **But there is no evidence of an edge here either,** and the rules must not be tuned to 2020.

## The test that decides it (cTrader, when you're at a computer)
Run the defaults, unchanged, on H4 for 2015–2025 on EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD, XAUUSD and US500. Judge the **combined** result:
- PF ≥ 1.3 across all of them together, with ≥ 300 trades in total
- no single year worse than -15%
- at least 4 of the 7 markets profitable

If it fails that, the idea is finished.
