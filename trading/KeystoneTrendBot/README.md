# KeystoneTrendBot

H1 trend-pullback cBot for cTrader. Start symbol: **EURUSD H1** (cheapest spread, deepest history).

## Logic
- **Trend:** close and EMA50 on the same side of EMA200, EMA200 sloping that way (5 bars).
- **Entry:** the last closed bar dipped into the EMA50 zone (±0.25 ATR) and closed back in trend direction. RSI 40–70 for longs, 30–60 for shorts.
- **Exit:** SL 1.5×ATR, TP 2.5×ATR, stop moves to break-even at 1R.
- **Filters:** 07:00–17:00 UTC session, spread under 15% of ATR.

## Hardcoded risk (constants, not parameters)
| Rule | Value |
|---|---|
| Risk per trade | 1% (skips the trade if the minimum lot would risk >2%) |
| Daily loss stop | 3% |
| Kill switch | 20% drawdown from equity peak: closes everything and stops |
| Max positions | 1 |

## Validation protocol (in this order, no skipping)
1. **In-sample backtest** 2018–2022, tick data. Optimise only the Strategy group.
2. **Out-of-sample** 2023–2025 with fixed parameters. Pass bar: PF ≥ 1.3, ≥ 100 trades, max DD ≤ 15%.
3. **Robustness:** ±20% parameter changes should keep PF > 1.1. Run GBPUSD and USDJPY as an untouched sanity check.
4. **Forward demo** for 3 months. Results should sit within the OOS range.
5. **Live** small, on a verified (Myfxbook/FXBlue) track record.

A FAIL at any step is a result. Do not tweak and re-run the same OOS window.
