# CryptoTrendBot

**The strategy that passed.** Full evidence is in `../research/RESULTS.md`.

The H4TrendBot rules, unchanged, run as an 11-coin crypto CFD portfolio: BTC, ETH, BNB, XRP, ADA, LINK, SOL, DOGE, AVAX, DOT, NEAR.

## Setup
1. In cTrader, open an **H4 chart for each of the 11 coins** (USD crypto CFDs).
2. Attach CryptoTrendBot to every chart with the default parameters. Do not optimise them; the tests showed tuning doesn't help.
3. Start all 11 instances at the same time, so they share the same equity peak for the 20% kill switch.
4. Check the log for `SKIP: min volume would risk...`. If it appears, the account is too small for that coin at 0.15% risk.

## Hardcoded risk
- 0.15% per trade per coin (worst-case open risk is 1.65% with all 11 open); trades are skipped if the minimum lot would risk >0.30%
- spread must be ≤ 10% of the stop
- 20% account drawdown kill switch

## Before going live
1. Run cTrader's backtest on your broker's data (2018–2026, tick data), with the real crypto **swap** and spread. Compare it with RESULTS.md.
2. Run a demo forward test for at least 3 months on a verified Myfxbook or FXBlue track record.
3. Fund at least about $12k (all 11 coins) or $4k (without BTC/ETH). See RESULTS.md for the capital table.
