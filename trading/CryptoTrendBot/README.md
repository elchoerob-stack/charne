# CryptoTrendBot

**The strategy that passed.** Full evidence is in `../research/RESULTS.md`.

The H4TrendBot rules, unchanged, run as an 11-coin crypto CFD portfolio: BTC, ETH, BNB, XRP, ADA, LINK, SOL, DOGE, AVAX, DOT, NEAR.

## Two ways to run it
- **`CryptoTrendPortfolio.cs`: one instance trades all 11 coins.** Use this if you can only run one cBot at a time (e.g. cTrader Cloud). See "Single-instance setup" below.
- **`CryptoTrendBot.cs`:** one instance per coin chart (the original setup below).

Both use the same rules and the same v2 risk profile.

## Single-instance setup (CryptoTrendPortfolio)
1. Open any chart (any symbol, any timeframe) and attach CryptoTrendPortfolio. It loads H4 data for every coin itself.
2. In **Symbols**, enter your broker's exact names, comma separated (e.g. `BTCUSD,ETHUSD,...`). Check them in Market Watch, because some brokers use `BTC/USD` or `BITCOIN`.
3. Start it. The log should say `Trading 11 markets: ...`. A `WARNING: symbol 'X' not found` line means a name needs fixing.
4. cTrader's backtester supports multi-symbol cBots, so you can backtest this version as a whole portfolio.

## Setup (one instance per coin, CryptoTrendBot)
1. In cTrader, open an **H4 chart for each of the 11 coins** (USD crypto CFDs).
2. Attach CryptoTrendBot to every chart with the default parameters. Do not optimise them; the tests showed tuning doesn't help.
3. Start all 11 instances at the same time, so they share the same equity peak for the 20% kill switch.
4. Check the log for `SKIP: min volume would risk...`. If it appears, the account is too small for that coin at 0.15% risk.

## Hardcoded risk (v2 growth profile)
- 0.4% per trade; trades are skipped if the minimum lot would risk >0.8%
- **at most 4 positions open across all 11 coins** (worst-case open risk 1.6%)
- spread must be ≤ 10% of the stop
- 25% account drawdown kill switch

Backtest 2017–2026 (`research/position_cap.py`): about 26% a year, max drawdown 19.2%, every year positive. 2022–2026 alone: about 16% a year. The original v1 profile (0.15%, no cap, 20% kill switch: about 11% a year, 15% max drawdown) is in git history.

## Before going live
1. Run cTrader's backtest on your broker's data (2018–2026, tick data), with the real crypto **swap** and spread. Compare it with RESULTS.md.
2. Run a demo forward test for at least 3 months on a verified Myfxbook or FXBlue track record.
3. Fund at least about $12k (all 11 coins) or $4k (without BTC/ETH). See RESULTS.md for the capital table.
