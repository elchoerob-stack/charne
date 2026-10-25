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

## Gold (XAUUSD) H4, 2015–2024: 2026-10-25 run, **REAL BUT THIN EDGE, not investable yet**
Data: XAUUSD M1 for 2015–2024 (3.5M bars; spot checks match known prices; 2025 is excluded because the source is missing about half the year). Times are converted to NY-close server time, so the H4 bars match a cTrader broker. Costs are on purpose not optimistic: $0.30 spread, $7 per 100 oz commission, and $0.20/oz/night swap charged on both longs and shorts. Defaults are unchanged from EURUSD; none were tuned for gold.

| Defaults (kill switch off, to measure the edge) | Trades | Win % | PF | Sum R | Max DD |
|---|---|---|---|---|---|
| **Zero costs (raw edge)** | 300 | 36 | **1.25** | +39 | 18% |
| 2015–19 / 2020–24 with zero costs | 141 / 159 | 38 / 34 | 1.37 / 1.17 | +24 / +15 | |
| **Realistic costs** | 301 | 35 | **1.12** | +21 | 20% |
| 2015–19 / 2020–24 with costs | 141 / 160 | 37 / 33 | 1.16 / 1.10 | +12 / +10 | |
| Double costs | 301 | 31 | 0.99 | +1 | 23% |
| With all risk rules on | 258 | 33 | 1.01 | +3 | **kill switch hit Aug 2023** |

Sum R by year (realistic costs): 2015 -11.7 · 2016 +6.8 · 2017 -0.5 · 2018 -0.6 · 2019 +17.6 · 2020 +9.9 · 2021 +0.4 · 2022 -10.8 · 2023 +2.2 · 2024 +8.0

**Robustness grid** (72 configs, selected on 2015–19 and checked on 2020–24): **92% of configs were profitable after costs in 2020–24** (median PF 1.10). That is the opposite of the EURUSD and London-fade grids, where almost everything failed out of sample. Only 3% reached PF 1.3, and the correlation between in-sample and out-of-sample PF is about 0. Optimising doesn't help, so keep the defaults. The best in-sample config (Donchian 55, slow EMA 100) also hit the kill switch, during the 2021–2023 chop.

**Verdict:**
- This is the first edge in the project that holds across a decade and both halves of the data. Trend following on gold works before costs (PF 1.25).
- Costs take about half of it. Spread plus about 3 nights of swap per trade cost about 0.06R per trade, against a raw edge of about 0.13R.
- At PF 1.12 with 20% drawdowns, it makes about +1.8% a year at 1% risk. That's not enough to raise money on, and the 20% kill switch would have stopped it in 2023.

**To make it investable (next steps, in order):**
1. Re-run this test with **your broker's real gold spread, commission and swap**; cost is the main lever. At half the assumed costs, PF is 1.20.
2. **Diversify:** the same unchanged rules on 5–10 uncorrelated markets (indices, oil, JPY pairs), each at a smaller risk. Trend-following returns come from the portfolio, not from any one market. This needs more data (export from MT5 or cTrader).
3. Do not tune parameters to the 2015–2024 gold result.

**R100 on gold:** a 2×ATR(H4) stop is about $30–50 per oz. The smallest trade (0.01 lot = 1 oz) therefore risks $30–50 on a standard account. On a cent account it risks 30–50 USC, so 1% risk needs about 3,000–5,000 USC (≈ R550–R900).
