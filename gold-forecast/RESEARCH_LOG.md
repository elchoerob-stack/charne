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
| 6 | Tighter boxes z 1.0 / 0.674 (pre-registered, `opportunity_test.py`) | both periods | both rejected (unseen PF 0.94 / 0.90) |
| 7 | Trade the scenario plan, target T1 / T2 (pre-registered, `scenario_test.py`) | both periods | both rejected (unseen PF 0.66 / 0.85) |

Total strategy looks: 16 + 2 + 3 + 2 + 2 = 25. Do not add more on this data without saying so.

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

## The day after a big move, and a band challenger (10 Nov 2026, `challenger.py`, data before Tuesday)
| After ... | n | next day up | mean move | mean range | range > 1.5 ATR |
|---|---|---|---|---|---|
| a big DOWN day (< -1 ATR) | 29 | 69% +-17% | +0.16 ATR | 1.20 ATR | 28% |
| a big UP day (> +1 ATR) | 42 | 57% +-15% | +0.09 ATR | 1.33 ATR | 26% |
| a normal day | 439 | 55% +-5% | +0.07 ATR | 0.98 ATR | 9% |
Volatility clusters (big days are followed by wider days); direction after a big down day leans up but is not significant.
Challenger v2 (bands x1.24 after a big day, k walk-forward): coverage after big days 80% -> 87%, but the 80% interval score got
WORSE (1.94 -> 2.02; all days 1.704 -> 1.712). Rejected - v1 stays the champion. The trend-day failure is on the trend day itself,
not predictable from the day before. Looks: +1 (model).

## Pipeline fixes (10 Nov 2026)
- Reproducibility: fetch.py used a rolling 760-day window, so the oldest session dropped out and a rebuild of a frozen forecast
  came out different. H1 and D1 history now have fixed start dates; Tuesday's forecast rebuilds byte-for-byte.
- Scenario plan v2 (targets.py, scenario_version "levels-v2"): the v1 rules were written around Monday 9 Nov's chart and
  would have produced nonsense triggers after a one-way day. v2: trigger = first key level >= 0.20 ATR from the close on each side,
  targets = next three levels >= 0.15 ATR apart, invalidation = a 1h close back through the prior close. Tuesday's locked plan is unchanged.

## Planning engine in C# (10 Nov 2026)
`cbot/engine/PlanEngine.cs` ports analysis.py + targets.py. Parity: 20 closes (Dec 2025 - Nov 2026) identical, worst numeric
difference 1.1e-16; one rounding subtlety fixed (Python rounds the exact binary value, e.g. 3976.915 -> 3976.91). Self-score
identical to check.py on Tue 10 Nov. Bot v2.0 uses it for planning and trading inputs; no new trading rules (looks: +0).

## Missed opportunities? (11 Nov 2026, `opportunity_test.py`, pre-registered, looks 21 -> 23)
A. Days the z 1.2816 bot sat out were small days: range ~0.70 ATR and close-to-close ~0.25-0.30 ATR, against ~1.2 ATR and ~0.65 ATR
   on days it traded (both periods).
B. Tighter boxes trade more and earn less:
| Box | 2026 trades / PF / $ per day | Unseen trades / PF / $ per day | Pooled P(PF<1) | Verdict |
|---|---|---|---|---|
| z 1.2816 (current) | 235 / 1.14 / +3.06 | 223 / 0.99 / -0.16 | 23% | - |
| z 1.0 | 352 / 1.14 / +3.83 | 365 / 0.94 / -1.10 | 25% | reject |
| z 0.674 | 695 / 1.04 / +1.75 | 689 / 0.90 / -2.78 | 54% | reject |
The moves inside the box are mostly noise; trading them adds cost, not edge (fading them lost too: PF 0.62-0.92).

## Trade the scenario plan? (11 Nov 2026, `scenario_test.py`, pre-registered in commit e0c04f7 before running, looks 23 -> 25)
Question (from a review of the bot's screen recording): the bot prints a bull/bear scenario plan but does not trade it - should it?
Rules: at each 1h close from hour 2 to 22, while flat, close beyond the bull (bear) trigger -> buy (sell) at the next 5m open;
stop = prior close (the plan's invalidation), target = T1 (A) or T2 (B); each scenario once a day; flat at the close; $0.50 cost.
| Variant | 2026 (212 days) trades / win / PF / $ per day | Unseen 2025 (225 days) trades / win / PF / $ per day | Pooled PF, P(PF<1) | Verdict |
|---|---|---|---|---|
| A: target T1 | 191 / 66% / 0.92 / -0.72 | 218 / 59% / 0.66 / -2.52 | 0.80, 96% | **reject** |
| B: target T2 | 216 / 56% / 1.28 / +3.79 | 242 / 47% / 0.85 / -1.64 | 1.08, 25% | **reject** |
A wins often but small (avg +$14 / -$30 in 2026): the stop at the prior close is further away than T1. B paid in 2026 and lost in the
unseen year - the same "worked in 2026 only" pattern as the band breakout. Neither side alone survives the unseen year (sell PF 0.74 / 0.89),
so a sell-only version is not a rescue (and would be a new look). The scenario plan stays a map for a human, not an entry rule.
Bot v2.2 (no rule change): stops cancelling orders that are already expiring (journal 'EntityNotFound/TechnicalError' race), prints each
order's prices and stop/target in dollars (the order log shows pips: 3094 pips = $30.94), warns when Band z is not the tested 1.2816,
and closes an extra position if two orders ever fill together.
