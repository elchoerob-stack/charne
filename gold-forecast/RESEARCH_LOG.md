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
| 8 | Small-account sizing (pre-registered, `small_account_test.py`): same rules, 1 oz vs 5 g, equity cap | both periods | gram gold + 33% cap adopted for small accounts; strategy looks +0 |
| 9 | Exploratory slicing of the bot's trades, about 30 slices (rank in the day, entry type, previous trade, hour, z, exits) | both periods | "continuation beats first touch" in both - a hypothesis only |
| 10 | Continuation-only F1 / F2 / F3 / S1, and the bot's own rules (pre-registered, `continuation_test.py`) | **fresh: 2016 - Sep 2024** | all rejected (PF 0.82 - 0.90); the bot's rules PF 0.87, 0 of 9 years profitable |
| 11 | Early exit on a 15m / 5m / 1m structure shift against the trade (pre-registered, `mtf_exit_test.py`) | 2016 - Sep 2024, 2025-26; 1m bars 2023-26 | none adopted: all three make the result worse (PF 0.83 / 0.73 / 0.58 against 0.87) |

Total strategy looks: 16 + 2 + 3 + 2 + 2 + 4 + 3 = 32, plus about 30 exploratory slices of the 2025-26 data.
The 2016 - Sep 2024 history has now been used twice (5 entry rule sets, 3 exit overlays). Oct 2024 - Feb 2025 5-minute bars exist and no trading
test has used them: keep them as a reserve.

## Bottom line (11 Nov 2026)
**The band-breakout rules have no edge.** On nine years of data that no test had used (2016 - Sep 2024, 2,258 sessions,
3,075 trades) the bot's exact rules lost in every calendar year: profit factor 0.87, net -$1,218 per oz after $0.50 a trade.
Before costs they are a coin flip: 50.4% wins, PF 1.04. The 2026 profit (PF 1.14) was a trending year, not a rule that works.
Rescaled to today's volatility and costs the same nine years give PF 0.99 (1 oz) / 0.97 (gram gold): break-even minus costs.
This closes the band-breakout family on gold: tighter boxes, filters, scenario entries, fades and continuation-only all failed.
Getting out early when the 15m / 5m / 1m chart turns does not rescue it either: it shrinks losses and wins alike and adds trades.

## What we know
- The daily trend (EMA stack) does **not** predict the next day: 54.8% hit rate on 259 sessions, 95% band +-6.2%.
- Intraday momentum is weakly real: corr ~+0.14 (about 3 standard errors) between the move so far and the rest of the day;
  big morning moves (>0.5 ATR) continue about 60% of the time (+-10-16%). Worth about $7-11 on a typical morning move, not a strategy.
- The 80% bands are calibrated on average (85%) but hold **95% of closes on calm days and only 36% on trend days (>1 ATR, 10% of days)**.
  This is the main flaw: width does not adapt to the regime.
- The breakout bot earned its 2026 edge in a trending year; before that it was break-even.
- Tuesday 10 Nov 2026 was a trend day (-1.4 ATR): the projection scored 0 of 8, the pre-registered bear scenario hit all 3 targets,
  the breakout paper test made +$57.70 closed, buy-the-low would have lost about $60.

## Next, in order (revised 11 Nov 2026)
0. No more variants of band breakouts on gold. A trading edge needs a different strategy class, and it must be designed
   on 2016-2021, checked on 2022 - Sep 2024, then confirmed once on 2025-26 and the Oct 2024 - Feb 2025 reserve.
   `contsim.py` + the 5-minute history judge an idea over nine years in about a minute.
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

## Can R300 carry the bot? Ounce vs gram contract (11 Nov 2026, `small_account_test.py`, pre-registered in 4208525)
Measured, read-only: the broker lists gold in grams (XAUUSDgr, 1 lot = 1 g, minimum 5 g, step 1 g); its price is the ounce
price / 31.1035 (20 days of hourly closes: ratio 31.104 - 31.111). 5 g = 0.16 oz, so a $1 move = $0.16. Cost per oz-equivalent:
XAUUSD $0.12-0.16 spread + $35 per $1m per side (the account's own deals: R2.29 a side on 1 oz) = about $0.44; gram gold
$0.37-0.40 spread + the same commission = about $0.67. Leverage (1:10,000) only sets the margin (about R1 for 5 g); it does
not change what a move costs.
Stop size today: $20 (hour 2) to $76 (hour 22) per oz = 111% to 421% of a R300 account at 1 oz, 18% to 68% at 5 g.
326 start dates x 60 sessions, same rules, used periods (which flatter the rules: PF 1.08):
| Start | Size | Wiped | Ends below 25% | Ends above 150% | Median end | Trades |
|---|---|---|---|---|---|---|
| R300 | 1 oz, no cap | 80% | 89% | 8% | R0 | 8 |
| R300 | 5 g, no cap | 19% | 43% | 17% | R78 | 27 |
| R300 | 5 g, cap 50% / 33% / 25% | 0% | 10% / 4% / 0% | 21% / 17% / 7% | R134 / R195 / R225 | 27 / 21 / 14 |
| R1,000 | 5 g, cap 33% | 0% | 4% | 19% | R1,005 | 64 |
| R2,000 | 5 g (cap never binds) | 0% | 0% | 1% | R2,089 | 68 |
Rule 1: 89% -> 43%, gram gold adopted for small accounts. Rule 2: the loosest cap within 10 points of the best is 33%.
Bot v3.0 implements both. Correction to the published trade counts: the bot allows 4 trades a session, the earlier backtests had
no daily maximum; with the maximum the used-period results are 213 trades PF 0.94 (unseen) and 216 trades PF 1.17 (2026).

## Continuation, and the nine-year verdict (11 Nov 2026, `continuation_test.py`, pre-registered in d7f1d08)
Exploration of the used data (hypothesis only): first-touch entries (stop order filled inside the hour) PF 0.70 / 0.89;
continuation entries (already beyond the band at the top of the hour) PF 1.47 / 1.40; continuation-only improved with the band:
z 1.28 PF 1.18, z 1.6 PF 1.67, z 2.0 PF 1.45 (pooled). It looked like the first real lead. It was not.
Fresh data, 2016 - Sep 2024, $0.50 a trade, P&L normalised to a $60 ATR so every year weighs the same:
| Rule | Trades | Win | PF | Years in profit | P(net <= 0) | Used-period PF | Verdict |
|---|---|---|---|---|---|---|---|
| B0 the bot (v2.2 rules) | 3,075 | 49% | 0.87 | 0 of 9 | 100% | 1.07 | fails |
| F1 continuation z 1.6 | 1,107 | 48% | 0.88 | 2 of 9 | 96% | 1.76 | **rejected** |
| F2 continuation z 1.28 | 1,886 | 49% | 0.90 | 3 of 9 | 98% | 1.21 | **rejected** |
| F3 continuation z 2.0 | 571 | 47% | 0.86 | 2 of 9 | 93% | 1.58 | **rejected** |
| S1 F1 with half the stop | 1,208 | 37% | 0.82 | 1 of 9 | 100% | 1.76 | **rejected** |
The lesson is the one the gate exists for: a pattern found by slicing data that had been looked at 25 times went from PF 1.76
to 0.88 on data it had not seen. No rule was added to the bot.

## Long-run odds for small accounts (`small_account_longrun.py`, descriptive)
The 2016-2024 sessions rescaled to today's volatility, today's costs, the bot's rules:
| Start | Size | After 3 months: below half / doubled / median | After 1 year: below half / doubled / median |
|---|---|---|---|
| R300 | 1 oz, no cap | 94% / 5% / R0 (73% wiped) | 97% / 3% / R0 |
| R300 | 5 g, cap 33% | 68% / 10% / R98 | 89% / 8% / R90 |
| R1,000 | 5 g, cap 33% | 10% / 1% / R921 | 37% / 0% / R749 |
| R2,000 | 5 g | 0% / 0% / R1,921 | 11% / 0% / R1,751 |
R300 is three stops from the R100 floor, so most runs end parked near R100. A larger account does not grow either: it loses
about R0.70 a trade on average at 5 g (R1.90 of costs against a coin flip), roughly R20 a month, plus noise. No account size turns these rules into growth.

## Jump out early when a lower timeframe turns? (11 Nov 2026, `mtf_exit_test.py`, pre-registered in bb93ea9)
The owner's idea: watch the 1, 5 and 15-minute charts and close a trade when one of them shifts against it. Definition: that
timeframe closes through its most recent confirmed swing (3-bar fractals, the project's own structure rule); the hard stop and
target stay. Entries are the bot's unchanged rules. P&L per oz normalised to a $60 ATR, $0.50 a trade.
| 2016 - Sep 2024, 2,258 sessions | Trades / day | Wins | Avg win | Avg loss | Full stops | Closed by the shift | PF | Net / day | vs no early exit |
|---|---|---|---|---|---|---|---|---|---|
| B0 no early exit | 1.36 | 49% | 16.2 | -18.3 | 35% | - | 0.87 | -1.70 | - |
| X15 15-minute shift | 1.47 | 42% | 16.0 | -13.7 | 16% | 39% | 0.83 | -1.98 | -0.28 (P no gain 90%) |
| X5 5-minute shift | 1.80 | 33% | 12.5 | -8.5 | 4% | 76% | 0.73 | -2.80 | -1.10 (P no gain 99.9%) |
| X1 1-minute shift (1m bars, Jan 2023 - Sep 2024) | 2.35 | 27% | 6.6 | -4.1 | 0.4% | 95% | 0.58 | -2.93 | -0.68 |
May 2025 - Nov 2026: B0 PF 1.07 (+0.69 a day), X15 1.06 (+0.59), X5 0.89 (-0.96), X1 0.91 (-0.45, 1m bars). The 1-minute-bar
re-run of B0 / X15 / X5 agrees with the 5-minute results. Verdict: none is adopted as the default.
What it shows: the early exit does exactly what it promises - smaller losses, far fewer full stop-outs - and it cuts the winners
by the same amount, because on entries that are a coin flip the lower timeframes turn against winners and losers alike. Each
early exit also frees the bot to trade again the next hour, so costs rise. The faster the timeframe, the worse the result.
For a R300 account at 5 g the 15-minute exit's smaller losses help a little in some periods and not in others (share of
3-month runs ending below half: 68% -> 61% over 2016-24, 52% -> 41% in 2025-26, 82% -> 89% in 2023-24), so it is not a
dependable survival tool either.
Bot v3.1 builds it in as a switch that ships OFF (the owner asked for it; it cannot make one trade's loss larger than its stop),
prints each timeframe's structure every hour, and the C# rule is checked against this code in `parity_check.py`.
1-minute bars are not in the repository (about 20 MB): `python3 fetch_m1.py 2023` ... `2026` recreates them.

## Edge search: PF > 1.3 with many trades, gold or currencies? (12 Nov 2026, `edge_search.py`, pre-registered in db8b602)
Owner's request: find a bot with profit factor above 1.3 and a high trade count on gold or a currency pair.
234 rule x market combinations: XAUUSD + 13 pairs, 1h bars Jun 2015 - Nov 2026, six families (session windows incl. the Tokyo
fix, daily trend, hourly shocks, Asian range at London, previous day's high/low sweep or hold, Bollinger fade). Costs per pair
from spreads sampled on the day x 1.5 plus commission (0.99 - 3.13 bp a round trip). Three stages with fixed pass marks.
**Design stage (2016-2020): 0 of 234 passed** (needed PF >= 1.25, 100+ trades a year, P(PF < 1) <= 2.5%). Validation
(2021 - Sep 2024) and confirmation (Oct 2024 - Nov 2026) were therefore not computed and remain unused for these rules.
Closest: USDJPY Asian-range breakout PF 1.18 (159 trades a year, P 4.5%), gold long-only daily trend 60d / 20d PF 1.13 / 1.11
(P 10-13%), USDJPY after-Tokyo-fix window reversed 1.09, gold previous-day sweep 1.08. Median PF by family 0.86 - 0.94: with one
to three basis points of cost on moves this size, a rule with no signal lands at about 0.9, which is where almost all of them are.
Looks: +234 on the design period only. PF 1.3 at 250 trades a year is an annual Sharpe ratio near 1.6 on one market after
costs; none of the standard, published rule families gets near it on 1h bars at retail costs.
