# KeystoneTrendBot

Multi-timeframe trend-pullback cBot for cTrader. **Attach to an EURUSD M1 chart.**

## Logic
- **Trend (H1, set by `Trend TimeFrame`):** the last closed H1 bar and its EMA50 sit on the same side of the H1 EMA200, and the EMA200 slopes that way over 5 bars.
- **Entry (M1 chart):** the last closed M1 bar dipped into the M1 EMA50 zone (±0.25 ATR) and closed back in trend direction. RSI 40–70 for longs, 30–60 for shorts.
- **Exit:** SL 1.5×ATR(M1), TP 2.5×ATR(M1), stop moves to break-even at 1R.
- **Filters:** 07:00–17:00 UTC session; spread must be ≤ 10% of the stop distance.

## Hardcoded risk (constants, not parameters)
| Rule | Value |
|---|---|
| Risk per trade | 1% (skips the trade if the minimum lot would risk >2%) |
| Daily loss stop | 3% |
| Max trades per day | 8 (M1 overtrading guard) |
| Kill switch | 20% drawdown from equity peak: closes everything and stops |
| Max positions | 1 |

## M1-specific warnings
- Backtest with **tick data** and the broker's **real commission** entered. On M1, costs are the strategy: a 2–3 pip stop against a 0.2 pip spread plus about 0.7 pip of commission is a 30%+ headwind on every trade.
- The spread gate will block many signals during wide-spread periods. That is intended.
- The higher-timeframe EMA200 needs about 210 H1 bars of warm-up. Start backtests at least 2 weeks before the window you score.

## Validation protocol (in this order, no skipping)
1. **In-sample backtest** 2021–2023, tick data, with commission. Optimise only the Strategy group.
2. **Out-of-sample** 2024–2025 with fixed parameters. Pass bar: PF ≥ 1.3 after costs, ≥ 300 trades, max DD ≤ 15%.
3. **Robustness:** ±20% parameter changes should keep PF > 1.1. Re-run with spread +0.3 pip: it must stay profitable.
4. **Forward demo** for 6–8 weeks. M1 gives a large sample quickly, but live fills and slippage are the real test.
5. **Live** small, on a verified (Myfxbook/FXBlue) track record.

A FAIL at any step is a result. Do not tweak and re-run the same OOS window.
