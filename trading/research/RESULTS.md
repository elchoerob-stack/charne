# Strategy research results (2026-10-25)

## Bottom line
**One strategy passed every pre-registered test: H4 trend following on an 11-coin crypto CFD portfolio** (`trading/CryptoTrendBot`).
It has a real, robust edge in backtests. Realistic expectations from the most recent period (2022–2026) are **about 5–11% a year with drawdowns up to about 16%** at the chosen risk. It is not a get-rich-quick system, and it needs proper capital to trade at the correct risk.

## What was tested (in order; every rule was fixed before its test)
| # | Strategy | Market / data | Result |
|---|---|---|---|
| 1 | M1 EMA pullback (KeystoneTrendBot) | EURUSD 2020 | FAIL: no edge even with zero costs (PF 0.96) |
| 2 | London breakout | EURUSD 2020 | FAIL: PF 0.89 |
| 3 | London failed-breakout fade | EURUSD 2020 | FAIL: overfit trap (PF 1.5 in-sample → 0.65 out-of-sample) |
| 4 | H4 trend (H4TrendBot) | EURUSD 2020–21 | FAIL on a small sample (PF 0.72) |
| 5 | H4 trend | Gold 2015–24 | Thin edge, PF 1.12 |
| C1–C4 | H4 trend, gold Asian drift, D1 Turtle, D1 RSI(2) | Gold + WTI 2015–26 | None reached PF 1.2 (best 1.10) |
| R2a | Gold Asian-session core (03–06 server) | Gold holdout 2004–14 | **FAIL: the edge didn't exist before 2015** (zero-cost PF 0.98) |
| **R2b** | **H4 trend rules, unchanged, on crypto** | **11 Binance coins 2017–2026** | **PASS** |

## The passing strategy: CryptoTrendBot
**Rules** (identical to H4TrendBot; designed on FX/gold before crypto was ever tested):
- EMA50/EMA200 trend filter
- entry on an H4 close beyond the 20-bar Donchian channel
- 2×ATR(14) initial stop, 3×ATR chandelier trailing stop, no take profit

**Costs assumed:** 0.08% spread, plus 0.06% of notional per night of financing (about 22% a year) on both longs and shorts. Stops are resolved on 5-minute bars, and the stop counts first when a target and stop are both inside one bar.

| Test | Trades | Win % | PF | Note |
|---|---|---|---|---|
| 8 main coins | 2,617 | 36 | **1.50** | all 8 coins profitable |
| 2017–2021 | 1,068 | 39 | 1.81 | |
| 2022–2026 | 1,549 | 34 | **1.30** | includes the 2022 crash |
| Longs / shorts | 1,339 / 1,278 | | 1.63 / 1.35 | **shorts make money too** |
| **Survivorship test:** AVAX, DOT, NEAR (-76% to -98% from their 2021 peaks, never used for anything) | 761 | 34 | 1.07 | about break-even on coins that collapsed; it didn't blow up |
| **All 11 coins** | 3,378 | 36 | **1.40** | |
| 11 coins, zero costs | 3,355 | 37 | 1.54 | |
| 11 coins, **2× costs** | 3,404 | 34 | 1.26 | 2022+ PF 1.07 |
| 11 coins, 3× costs | 3,425 | 33 | 1.15 | 2022+ PF 0.96 |

**Parameter neighbourhood:** I tested 54 variations (Donchian 10/20/40 × stop 1.5/2/3 ATR × trail 2/3/4 ATR × EMA 20/100 or 50/200). **All 54 are profitable after costs (PF 1.19–1.79, median 1.42).** The defaults sit in the middle. The edge is a broad plateau rather than one lucky setting, and the defaults were kept, not optimised.

**Portfolio, marked to market daily, risk as % of starting capital (no compounding):**

| Risk per trade per coin | Total 2017–Oct 2026 | Max drawdown | Worst year | Sharpe |
|---|---|---|---|---|
| 0.25% | +161% | 27.0% | +5.7% | 1.08 |
| 0.20% | +128% | 21.6% | +4.6% | 1.08 |
| **0.15% (chosen; fits the 20% kill switch)** | **+96%** | **16.2%** | **+3.4%** | 1.08 |

Yearly returns at 0.15%: 2017 +3.4 · 2018 +12.1 · 2019 +8.4 · 2020 +25.7 · 2021 +12.3 · 2022 +5.5 · 2023 +6.7 · 2024 +7.2 · 2025 +11.4 · 2026 (to Oct) +3.6. **No losing calendar year.**

## Honest caveats (tell investors these)
1. **The edge is weaker in recent years.** PF went from 1.81 (2017–21) to 1.30 (2022–26). Plan on the recent numbers, not the average.
2. **Costs are the biggest risk.** At double my assumed costs, the 2022+ PF is only 1.07. Altcoin CFD spreads and overnight financing vary a lot between brokers. **Check your broker's real crypto spreads and swap rates before going live.**
3. **The returns come from a few big trends.** Removing the best 50 of 3,378 trades cuts total R from 642 to 127. That's normal for trend following, but it means long flat stretches.
4. **Survivorship:** the 8 main coins are today's survivors. On coins that collapsed the system broke even rather than profiting, so returns on future coin picks may be lower than the 8-coin numbers.
5. **This is a Python replica,** not cTrader's own backtester. Verify in cTrader on your broker's data before going live.

## Capital needed
Minimum trade sizes make small accounts impossible at 0.15% risk. These are approximate cTrader crypto CFD minimums at October 2026 prices; they vary by broker:

| Basket | Balance needed |
|---|---|
| All 11 coins (BTC needs the most) | about **$12,000 (≈ R210k)** |
| Without BTC and ETH | about $4,000 (≈ R70k) |
| Cheapest 4 (LINK, AVAX, DOT, ADA) | about $900 (≈ R16k), but too undiversified to trust |

**R100 cannot run this at the correct risk.** Use a cTrader demo with these settings, with a verified track record (Myfxbook or FXBlue), until it is funded.

## Reproduce
```
RESEARCH_CACHE=<data dir> python crypto_validation.py <Historical-Data/crypto> --grid
```
Data: Binance 1-minute klines from github.com/parshant65-lang/Historical-Data (crypto/), resampled to 5-minute and H4.
