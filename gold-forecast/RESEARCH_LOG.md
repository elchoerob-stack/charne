# Research log - gold-forecast

Every look at the data is counted, because the more ideas tried on the same prices, the weaker a "pass" is.

## Looks so far
| # | What | Data | Result |
|---|---|---|---|
| 1 | 8 fade + 8 breakout variants (pre-fixed rules, 60/40 split) | 5m, Jan-Nov 2026 | fade all lose (OOS PF 0.62-0.86); breakout all positive; formal pick FAIL (PF 1.20), prior-close/skip-US PASS (PF 1.44) |
| 2 | Unseen test of the PASS variant (pre-registered, `unseen_test.py`) | 5m, May 2025 - Jan 2026 | **FAIL**, 223 trades, PF 0.99 |
| 3 | Fade counterpart, same settings (declared in advance) | same | PF 0.92 (-$198) |
| 4 | 3 regime filters (pre-registered, `filters_test.py`) | both periods | all rejected; F2 (trend-aligned) best: PF 1.15 / 1.06, pooled P(PF<1) 26% |
| 5 | Diagnostics (`diagnose.py`), descriptive, nothing selected | H1 sessions | see below |

Total strategy looks: 16 + 2 + 3 = 21. Do not add more on this data without saying so.

## What we know
- The daily trend (EMA stack) does **not** predict the next day: 54.8% hit rate on 259 sessions, 95% band +-6.2%.
- Intraday momentum is weakly real: corr ~+0.14 (about 3 standard errors) between the move so far and the rest of the day;
  big morning moves (>0.5 ATR) continue about 60% of the time (+-10-16%). Worth about $7-11 on a typical morning move, not a strategy.
- The 80% bands are calibrated on average (85%) but hold **95% of closes on calm days and only 36% on trend days (>1 ATR, 10% of days)**.
  This is the main flaw: width does not adapt to the regime.
- The breakout bot earned its 2026 edge in a trending year; before that it was break-even.
- Tuesday 10 Nov 2026 was a trend day (-1.4 ATR): the projection scored 0 of 8, the pre-registered bear scenario hit all 3 targets,
  the breakout paper test made +$57.70 closed, buy-the-low would have lost about $60.

## Next, in order
1. Regime-aware band width: can the pre-open state (previous range/ATR, ATR percentile, scheduled event) predict trend days?
   Needs a historical event calendar (CPI, payrolls, FOMC) - BLS publishes only upcoming dates on its schedule pages; use the archive.
2. Hourly-updating bands: re-centre on the current price and widen when the morning has trended.
3. Keep scoring the locked daily forecast (v1) and run any new model as a challenger alongside it.
4. A different strategy class (not intraday band breakouts) if a trading edge is the goal; test it the same pre-registered way.

## Pressure test: small account (10 Nov 2026)
R200 ($12.08 at USDZAR 16.56) at 1:10,000, 1:1,000, 1:500: stopped out on today's FIRST trade (sell 4,123.57; stop-out near 4,135-4,136,
17-20 minutes before the bot's own stop). In history 96-98% of 60-trade windows wiped it, median at the first trade. 1:200 cannot open a
position (margin R343 > R200). R10,000+ survived every window. Caveat: adverse move uses 5-minute highs/lows, so it is conservative for
larger accounts; the R200 conclusion does not depend on it (the smallest stop, $17, already exceeds the account).
