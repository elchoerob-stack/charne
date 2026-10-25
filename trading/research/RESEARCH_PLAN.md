# Strategy research plan (written BEFORE any test was run)

Goal: find a strategy that survives honest testing well enough to show investors.
The main danger is data mining. Test enough ideas on the same data and one will pass by luck.
These rules exist to prevent that.

## Data
| Market | Source | Development set (may be looked at) | **Holdout (untouched until final test)** |
|---|---|---|---|
| Gold XAUUSD M1 | parshant65-lang archives | 2015-01 → 2024-12 | **2004-07 → 2014-12** |
| WTI crude USOIL M1 | parshant65-lang archives | 2015-01 → 2026-10 | **2005-01 → 2014-12** |

Gold 2025 is excluded (the source is missing about half the year). Gold 2015–2024 was already seen during the H4TrendBot test.
All bars use NY-close server time (D1 = 17:00–17:00 New York).

## Cost model (deliberately pessimistic, per unit: 1 oz gold, 1 bbl oil)
| | Spread | Commission (round turn) | Swap per night (charged on longs AND shorts, x3 on Wednesday) |
|---|---|---|---|
| Gold | $0.30 | $0.07 | $0.20 |
| WTI | $0.04 | $0.00 | $0.015 |

## Candidates (fixed rules, no tuning before the holdout test)
Each one has a documented reason to work. At most 4 candidates, chosen up front.

1. **C1 H4 trend:** H4TrendBot exactly as built (EMA50/200 filter, 20-bar Donchian breakout, 2×ATR(14) stop, 3×ATR chandelier trail).
2. **C2 Gold Asian-session drift:** long gold from server 01:00 (18:00 NY, after the rollover spread normalises) to server 10:00 (03:00 NY, about the London open), every weekday. The disaster stop is 2×ATR(14, D1). Rationale: published research says gold's gains accrue mostly outside London/NY hours. Gold only; this is a gold-specific effect.
3. **C3 D1 Turtle breakout:** enter on a 55-day high/low breakout, exit on the opposite 20-day breakout. The stop is 2×ATR(20, D1) and never widens. Classic commodity trend following on a different timeframe from C1.
4. **C4 D1 RSI(2) pullback in trend:** long when close > SMA200 and RSI(2) < 10, short when close < SMA200 and RSI(2) > 90. Exit on a close back across SMA5. The stop is 3×ATR(14, D1). This is the Connors mean-reversion rule and adds a source of return that doesn't depend on trends.

Risk for every candidate: 1% of balance at the initial stop, one position per strategy per market, entries at the next bar open after the signal, stops checked on M1 bars, and the SL counts first if SL and TP are both inside one bar.

## Pass criteria (decided now)
A candidate **passes** only if **both** are true:
- **Development** (2015+), gold and WTI combined: PF ≥ 1.2 after costs, ≥ 100 trades.
- **Holdout** (≤2014), gold and WTI combined, run ONCE: PF ≥ 1.15 after costs, sum R > 0 in each market it trades, and the worst calendar year better than -12R.

Candidates that pass are combined into one portfolio, which is reported with drawdown at the chosen risk.
Nothing that fails gets "fixed" and re-tested on the holdout. Any new idea would need fresh data.

---
## Round 1 result (development set only): **no candidate passed**
| Candidate | Dev trades | PF after costs | Note |
|---|---|---|---|
| C1 H4 trend | 689 | 1.06 (gold 1.12, WTI 1.00) | |
| C2 Gold Asian drift | 2014 | 1.10 | **zero-cost PF 1.38, t = 4.8, positive in all 10 years**; costs take about 70% |
| C3 D1 Turtle | 91 | 1.03 | |
| C4 D1 RSI(2) | 266 | 0.75 | |
The holdout was not touched.

## Round 2 (written BEFORE running; 2nd look at the data, counted as such)
**R2a Gold Asian core:** long gold from server 03:00 to 06:00 (Tokyo/Shanghai morning), weekdays, with a 2×ATR(D1) disaster stop.
*This window was chosen from the dev-period hourly profile (the hours with the highest t-stats), so only the untouched holdout can validate it.*
Holdout pass: PF ≥ 1.1 after costs, zero-cost t-stat ≥ 2, and the mean session return beats gold's average drift for 3 hours (so it isn't just the 2004–2011 bull market).

**R2b Crypto trend portfolio:** C1 (H4) and C3 (D1) rules **unchanged**, applied to 8 Binance coins (BTC, ETH, BNB, XRP, ADA, LINK, SOL, DOGE) from 2017 to 2026. The rules were fixed on other markets, so all crypto data is out of sample for them.
CFD costs: 0.08% spread, and financing of 0.06% of notional per night (about 22% a year) on longs and shorts.
Pass: portfolio PF ≥ 1.3 after costs, profitable in both 2017–2021 and 2022–2026, and ≥ 5 of 8 coins profitable.

## Round 2 results
- **R2a: FAIL on the holdout.** 2004–2014: zero-cost PF 0.98 (t = -0.4); after costs PF 0.53. The Asian-session gold drift is a post-2015 regime, not a lasting edge.
- **R2b: PASS (C1 rules on crypto).** 8 coins: PF 1.50, profitable in both halves (1.81 / 1.30), 8/8 coins profitable.
  - Extra checks run after the pass: survivorship test on AVAX/DOT/NEAR, cost stress, a 54-config neighbourhood test and a mark-to-market portfolio. See RESULTS.md.
  - C3 Turtle on crypto: PF 3.63 overall, but 2021 alone made 489R and 2023 lost -35R. Too lumpy and too dependent on one year, so it was not adopted.
