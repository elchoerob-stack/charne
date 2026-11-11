# GoldBandBreakoutBot v3.1 - guide

An XAUUSD cBot for cTrader: a daily planning engine plus the band-breakout trading rules.

**Status (11 Nov 2026): the trading rules have no edge. Use the plan as a map; do not expect the trades to make money.**
On nine years the rules had never seen (2016 - Sep 2024, 3,075 trades) they lost in 9 of 9 years, profit factor **0.87**.
Before costs they are a coin flip (50.4% wins). The 2026 profit (PF 1.14-1.17) was a trending year. At today's volatility
and costs the long-run estimate is PF 0.97-0.99: about R0.70 lost per trade at the smallest size, roughly R20 a month, plus noise.
Running it on a live account is the owner's decision; v3.x makes that decision explicit (see the tick box below).

### v3.1: it reads the 15-minute, 5-minute and 1-minute charts
- **Every hour** it prints the market structure of all three: `MTF bar 9 (11:00 SAST): gold 4012.30, -19.83 from the prior close |
  15m DOWN since 10:15 (closed below 4018.40) | 5m UP since 10:50 (closed above 4010.10) | 1m UP since 10:58 (...)`.
  UP / DOWN is the direction of the last time that chart closed through its most recent swing high or low.
- **Early exit switch** (`Early exit on a lower-timeframe shift`: Off / M15 / M5 / M1). When on, a trade is closed as soon as
  the chosen chart closes through its last swing against the trade; the journal says `EARLY EXIT: the 15m chart closed below
  its last swing low ... -> closing the BUY`. The hard stop and target stay in place.
- **It ships Off, because it was tested first** (pre-registered, 2016-2024 and 2025-26) and made the result worse:
| Early exit | Trades a day | Wins | Average loss | Full stop-outs | Profit factor |
|---|---|---|---|---|---|
| Off | 1.36 | 49% | $18 | 35% of trades | 0.87 |
| 15-minute | 1.47 | 42% | $14 | 16% | 0.83 |
| 5-minute | 1.80 | 33% | $8 | 4% | 0.73 |
| 1-minute | 2.35 | 27% | $4 | 0.4% | 0.58 |
  (2016 - Sep 2024, dollars per oz at today's volatility; the 1-minute row is Jan 2023 - Sep 2024, where Off scored 0.84).
  Losses do shrink, as intended; wins shrink just as much and the bot trades more, so costs rise. In 2025-26 the picture is
  the same: Off 1.07, 15-minute 1.06, 5-minute 0.89, 1-minute 0.91. If you want it on anyway, 15-minute costs the least.
- At each session close it prints its own record: `TRADES so far: 12, 5 won, net -41.20 ZAR, profit factor 0.71 ...`.

### What v3.0 changed (no new trading rule: none passed)
| | v2.2 | v3.0 |
|---|---|---|
| Contract | XAUUSD, 0.01 lot = 1 oz ($1 per $1 move) | **gold in grams, XAUUSDgr, the broker's minimum: 5 g = 0.16 oz ($0.16 per $1 move)**; XAUUSD 0.01 lot only if the broker has no gram contract |
| One stop today | $20-$76 = R330-R1,260 | **R53-R203** |
| Equity guard | 10% on demo, off on live | **33% of equity, demo and live**: an hour whose stop would cost more is skipped and logged |
| Floor | free margin 100 (account currency) | equity below $6 (about R100): no new orders |
| Live account | trades | **plans only until `Trade on a LIVE account` is ticked** |
| Band z | a setting (it was changed to 1.1 once) | a constant, 1.2816 |
| Cost per trade | about $0.44 (R7.30) | about $0.11 (R1.90) - the gram spread is wider per ounce, the trade is 6x smaller |

Attach it to the **XAUUSD 1h chart** exactly as before. It reads XAUUSD for the plan and signals and sends its orders to
XAUUSDgr itself (order prices near 128, not 4,000: that is dollars per gram).

### Reading the Journal (v3.0)
- Start-up: `DEMO account ... | trades XAUUSDgr: 5 g per trade = 0.161 oz ... | one stop may risk at most 33% of equity`.
- `FIT 5 g XAUUSDgr: one stop today costs 53.10 to 203.40 ZAR = 18% to 68% of equity 300.00. Cap 33%: 5 of 20 hours tradable.
  Every hour is tradable from about 616 ZAR of equity.` - what today's stops mean for this account.
- Each hour: `Bar 7 (09:00 SAST): BUY STOP 4063.76 | SELL STOP 4001.88 | stop & target $30.94 per oz = 82.60 ZAR on 5 g (28% of equity)
  | XAUUSDgr order prices 130.653 / 128.663, 995 pips`. The levels are shown in XAUUSD terms, then as the gram order prices.
- `skipped, a $52.84-per-oz stop on 5 g would cost 141.10 ZAR = 47% of equity (cap 33%)` - the account is too small for that hour.
- `LIVE account: planning only` - the tick box is off.
- Hours with no orders: the first hour after the daily break, hour 15 (US 08:30 ET data, 15:00 SAST in winter), the last hour,
  any hour while a position is open, and hours skipped by the cap.

### Small accounts (pre-registered study, 11 Nov 2026)
60-session (3-month) runs from 326 start dates, same rules, on the 2025-26 data (which flatters the rules):
| Start | Size | Wiped | Ends below a quarter | Median end |
|---|---|---|---|---|
| R300 | 1 oz (v2.2 live) | 80% | 89% | R0 |
| R300 | 5 g, no cap | 19% | 43% | R78 |
| R300 | **5 g, 33% cap (v3.0)** | **0%** | **4%** | R195 |
| R2,000 | 5 g | 0% | 0% | R2,089 |
On the nine-year history at today's volatility a R300 account at 5 g ends a year below half its start 89% of the time
(median R90, parked near the R100 floor), doubles 8% of the time and never reached 10x. R2,000 does not get wiped and does not
grow: median R1,751 after a year. Leverage of 1:10,000 changes none of this - it only sets the margin (about R1 for 5 g).

## v2.0: the planning engine inside the bot

`engine/PlanEngine.cs` is the gold-forecast model in plain C#: sessions and ATR, the hourly volatility profile, the 20-day
analog pattern forecast, the key-level ladder (day, week, session extremes, untaken swings, open FVGs, pivots, round
numbers) with touch odds, the scenario plan (levels-v2) and the T1-T8 self-score. It is **verified against the Python**:
`python3 parity_check.py` builds the plan in both languages for 20 past closes and requires identical analog days,
levels, odds and scenarios (worst numeric difference 1e-16); the self-score matches check.py on Tuesday 10 Nov exactly.

What the bot now does by itself, every session:
- at the close (and straight away after a restart) it builds the next day's plan and prints it in the Journal:
  `PLAN`, `RANGE`, `BULL`, `BEAR`, `LEVELS`, `EVENTS`, `BOT first orders`
- when run locally it draws the triggers, targets, prior close and projected high/low on the chart (cloud instances have no chart)
- at the next close it scores yesterday's plan (`SCORE`, `SCORE tests`) and keeps a running `RECORD`
- it trades the same breakout rules as before, now fed by the engine's anchor/ATR/profile (identical to the research)

What it does not do: read news (cloud blocks internet - CPI dates through Dec 2027 are built in, add others in
"Other event dates"), re-tune itself (deliberately - adapting to its own results is how bots overfit), or find a new
edge (that stays research, tested the pre-registered way). Its H1 history starts at 2024-10-10 like the research, so
its plan matches the workbook; if the broker has less history it says so in the log.

## What the research showed

The idea was "every hour, buy at the projected low and sell at the projected
high, and vice versa". Both halves were tested on 212 sessions (14 Jan - 8 Nov
2026, 5-minute bars, walk-forward bands, $0.50 cost per trade, 0.01 lot, fills
resolved against us). Rules were fixed before any result was seen; the first
60% of days chose the variant, the last 40% judged it. 16 variants in total.

| Family | Rule | In-sample PF | Out-of-sample PF | Verdict |
|---|---|---|---|---|
| Fade (buy low / sell high) | limit at the band, target the centre | 0.72 - 0.86 | 0.62 - 0.86 | **All 8 lose** |
| Breakout ("vice versa") | stop at the band, target one more band-width | 1.02 - 1.25 | 1.01 - 1.38 | All 8 positive, thin |

Gold has been trending intraday, not snapping back: fading the band low loses,
buying the break of the band high pays a little.

cbot-gate results (notional $1,000, +$0.50 cost stress):

| Variant | OOS trades | OOS PF | P(PF<1) | Verdict |
|---|---|---|---|---|
| Breakout, pattern centre, all hours (formal in-sample pick) | 123 | 1.20 | 18.3% | **FAIL** (PF < 1.30, outlier-dependent) |
| Breakout, prior-close centre, skip US-data hour (**this bot**) | 111 | 1.44 | 4.4% | **PASS** on paper |

Why the 2026 PASS was not trusted (and the unseen test then confirmed it):
- In-sample it barely broke even (PF 1.04, 53% drawdown on $1,000). Most of the
  edge appeared after July 2026: it may be a regime, not a lasting edge.
- It was chosen with 16 variants on the table.
- 5-minute bars, not ticks.

Validation log rows:

```
| 2026-11-09 | GoldBandFade (8 variants) | v1 | FAIL | OOS PF 0.62-0.86 | ~110-310 trades each | - | variants tested: 16 |
| 2026-11-09 | GoldBandBreakout analog/80%/all hours | v1 | FAIL | OOS PF 1.20 | 123 trades | WFE 0.66 | variants tested: 16 |
| 2026-11-09 | GoldBandBreakout prior-close/80%/skip US | v1 | PASS (5m bars, 2026) | OOS PF 1.44 | 111 trades | WFE 6.2 | variants tested: 16 |
| 2026-11-10 | GoldBandBreakout prior-close/80%/skip US, unseen May 2025-Jan 2026 | v1 | **FAIL** | OOS PF 0.99 | 223 trades | WFE -0.05 | variants tested: 16 + 2 looks |
| 2026-11-10 | GoldBandFade same settings, unseen | v1 | FAIL | PF 0.92 | 213 trades | - | looks: 2 |
| 2026-11-10 | GoldBandBreakout v2.1 | v2.1 | LIVE by owner's decision despite FAIL | - | - | - | guard off on live; lot fixed 0.01 |
| 2026-11-11 | Breakout z 1.0 / z 0.674 (tighter box) | v2.1 | FAIL | unseen PF 0.94 / 0.90 | 365 / 689 trades | - | looks: 23 |
| 2026-11-11 | Scenario plan entries, target T1 / T2 | - | FAIL | unseen PF 0.66 / 0.85 (2026: 0.92 / 1.28) | 218 / 242 trades | - | looks: 25 |
| 2026-11-11 | GoldBandBreakout v2.2 | v2.2 | housekeeping only, same rules | - | - | - | cancel race fixed, $ in log, z warning |
| 2026-11-11 | GoldBandBreakout rules, FRESH 2016 - Sep 2024 (max 4 trades a session) | v2.2 rules | **FAIL** | PF 0.87, 0 of 9 years profitable | 3,075 trades | - | gross: 50.4% wins, PF 1.04 |
| 2026-11-11 | Continuation only z 1.6 / 1.28 / 2.0 / half stop, FRESH 2016 - Sep 2024 | - | FAIL | PF 0.88 / 0.90 / 0.86 / 0.82 (used period 1.76 / 1.21 / 1.58 / 1.76) | 1,107 / 1,886 / 571 / 1,208 trades | - | looks: 29 |
| 2026-11-11 | GoldBandBreakout v3.0 | v3.0 | same rules; sizing and guards only | - | - | - | gram gold 5 g, 33% cap, live opt-in, z constant |
| 2026-11-11 | Early exit on a 15m / 5m / 1m structure shift | - | FAIL (worse than no early exit) | PF 0.83 / 0.73 / 0.58 against 0.87 | 3,313 / 4,062 / 1,057 trades | - | looks: 32 |
| 2026-11-11 | GoldBandBreakout v3.1 | v3.1 | same rules; MTF structure line, early-exit switch (Off), trade record | - | - | - | C# structure rule = research code (parity) |
```

## Rules (identical in the backtest and the cBot)

- Session = hourly bars between daily breaks (gap >= 2h). Anchor = previous session close.
- Band per hour k: `d = 1.2816 x sigma[k] x ATR`, where sigma[k] is the RMS move from the
  prior close at hour k over the last 120 sessions (ATR units) and ATR is Wilder 14 over sessions.
- Each hour while flat (not the first hour, not the last, not hour 14 = US 08:30 ET):
  BUY STOP at anchor + d, SELL STOP at anchor - d. Stop loss = d, take profit = d (1:1),
  both sent inside the order. Already beyond a level? Enter at market. First fill cancels
  the other; unfilled orders expire at the end of the hour. Flat before the session close.

## Risk (constants in code, audit CLEAN)

| Constant | Value | Why |
|---|---|---|
| `MaxGramsPerTrade` | 5 | gram contract: the broker's minimum is traded, and only if it is 5 g or less (5 g = $0.16 per $1 move) |
| `LotSize` | 0.01 | ounce contract, used only when the broker has no gram contract: 1 oz = $1 per $1 move |
| `BandZ` | 1.2816 | the 80% band; a constant since v3.0 because it sets the stop distance |
| `MaxOpenPositions` | 1 | as backtested |
| `MaxTradesPerSession` | 4 | the backtest averaged 1.1 per day |
| `MaxLossPerTradeUsd` | 100 (USD) | skips set-ups whose stop would risk more (very high volatility) |
| `MaxDailyLossUsd` | 150 (USD) | no new entries that session after this realised loss |
| `MinEquityUsd` | 6 (USD, about R100) | no orders on an empty account |
| `MaxStopRiskPercentOfEquity` | 33 (%) | v3.0, demo and live: skips an hour whose stop would cost more than this share of equity (chosen by the pre-registered small-account study) |
| `MaxContractDriftPercent` | 0.25 (%) | the gram price x 31.1035 must match the XAUUSD price, or the hour is skipped |

Loss caps are in USD (gold's quote currency), so they mean the same on a ZAR, EUR or USD account
(v1.2; v1.1 had them in account currency and the EUR demo made them ~18x looser than intended).
Change them only by editing the code, never as instance settings.

## Steps

0. **Fund the demo.** The connected cTrader demo account shows a balance of R0.55; it cannot
   open 0.01 lot. Top it up or open a new demo with about R20,000 (close to the $1,000 the
   gate used).
1. **Install.** On any cTrader app (Mobile too): Algo > cBots > Upload, pick
   `dist/GoldBandBreakoutBot.algo` (stop and remove the v2.2 instance first). It runs in the cloud
   (AccessRights.None). Add an instance on **XAUUSD, 1h** - not on XAUUSDgr. Leave the settings as they are;
   on a live account it places no orders until `Trade on a LIVE account` is ticked.
   Cloud limits on demo accounts: **1 running cloud instance per demo account** and a
   **7-day maximum** before it stops and must be restarted. Run it on its own demo account if
   another bot already uses the cloud slot. Closed trades print as `TRADE,...` lines in the log.
2. **Unseen-period backtest (the real test).** Backtester, XAUUSD, **tick data**,
   1 Jan 2023 - 12 Jan 2026, default parameters, no optimisation. That period played no part
   in choosing the rules. The bot writes `Documents/cBotLogs/*.csv` when the run ends; gate it:
   `python skills/cbot-gate/scripts/gate.py --oos <log>.csv --balance <start> --stress-cost 0.5 --source gold-forecast/cbot/GoldBandBreakoutBot.cs`
   FAIL here = stop. Log it; don't re-tune on that period.
3. **Agreement check.** Backtest 13 Jan - 8 Nov 2026 on ticks; it should land near the Python
   result (PF ~1.0 in-sample, ~1.4 out-of-sample). A big gap means the cBot and the research differ.
4. **Demo forward test.** Run it on demo with the same constants for at least 3 months (~60+
   trades at ~1 a day), then gate the demo log. Each day's paper result also appears in `check.py`.
5. **Live** only after steps 2-4 pass, at the minimum size, same constants. Scale only after another
   gated period. (11 Nov 2026: step 2's question has been answered by the nine-year test - the rules fail.)

## Account size (pressure test, 10 Nov 2026 - `pressure_test.py`)

Leverage sets the margin a position ties up; it does not change what a position can lose. 0.01 lot = 1 oz, so $1 = $1,
and the bot's stops are $17-$75. Tested on today's trades and all 458 historical trades (worst move inside each trade,
stop-out at 50% margin level):

| Account | Today | History: wiped within 60 trades |
|---|---|---|
| R200 ($12) at 1:10,000 / 1:1,000 / 1:500 | stopped out on the first trade (03:07 SAST), ends R0-R47 | 96-98% (median: the first trade) |
| R1,000 | survives (low R422), ends R1,971 | 83% |
| R5,000 | survives | 23% |
| R10,000 and up | survives | 0% |

v1.3 refuses set-ups whose stop is more than 10% of equity, so R200 and R1,000 accounts do not trade at all.
Guidance: about R10,000 (about $600) is the smallest account where 0.01 lot of gold never failed in the history.
