# GoldBandBreakoutBot v2.2 - guide

An XAUUSD cBot for cTrader built from the gold-forecast bands.

**Status (10 Nov 2026): FAILED the unseen-period test; running on a LIVE cTrader account is the owner's decision.**
On 5-minute bars from May 2025 to Jan 2026 (never used to design the rules) the locked rules made
223 trades with Profit Factor **0.99** (net -$26.87). Pooled over both periods (458 trades) the Profit Factor is 1.09
with a 23% chance the edge is luck. Expect roughly break-even before costs.

### Reading the Journal (v2.2)
- The platform's order lines show stop loss / take profit in **pips**. For XAUUSD 1 pip = $0.01, so `SL 3094 / TP 3094` means
  $30.94 each side - not a price of 3,094. v2.2 also prints every placement in dollars:
  `Bar 7 (09:00 SAST): BUY STOP 4063.76 | SELL STOP 4001.88 | stop & target $30.94 each (order log shows 3094 pips)`.
- Leave **Band z at 1.2816**. Anything else prints `WARNING: Band z ... is UNTESTED`. z 1.0 and 0.674 were tested on 11 Nov 2026
  and rejected (more trades, less money; both lost in the unseen year).
- Orders expire at the end of their hour by themselves; v2.2 no longer tries to cancel them at that moment, so the
  `cancel ... FAILED (EntityNotFound / TechnicalError)` lines stop. They were harmless.
- Hours with no orders: the first hour after the daily break, hour 14 (US 08:30 ET data, 15:00 SAST in winter), the last hour,
  and any hour while a position is open.

### Live settings (v2.1)
| Setting | Live | Demo |
|---|---|---|
| Lot size | exactly 0.01 (code constant; never rounded up; the bot stops itself if the broker cannot trade 0.01) | same |
| 10% equity guard | **off** (owner's decision) | on |
| $100 per-trade cap, $150 per session, 4 trades per session, 1 position, $1 spread cap | on | on |
| Cloud | up to 10 instances, runs 24/7 | 1 instance, stops after 7 days |

With the guard off, a small live account is exposed to the pressure-test result: R200-R1,000 accounts were wiped out in
83-98% of 60-trade runs; about R10,000 is the smallest account that never failed in the history.

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
| `LotSize` | 0.01 | 1 oz: $1 per $1 move |
| `MaxOpenPositions` | 1 | as backtested |
| `MaxTradesPerSession` | 4 | the backtest averaged 1.1 per day |
| `MaxLossPerTradeUsd` | 100 (USD) | skips set-ups whose stop would risk more (very high volatility) |
| `MaxDailyLossUsd` | 150 (USD) | no new entries that session after this realised loss |
| `MinFreeMarginAccount` | 100 (account currency) | no orders on an empty account |
| `MaxStopRiskPercentOfEquity` | 10 (%) | v1.3: skips set-ups whose stop risks more than this share of equity; a tiny account cannot be wiped by one stop |

Loss caps are in USD (gold's quote currency), so they mean the same on a ZAR, EUR or USD account
(v1.2; v1.1 had them in account currency and the EUR demo made them ~18x looser than intended).
Change them only by editing the code, never as instance settings.

## Steps

0. **Fund the demo.** The connected cTrader demo account shows a balance of R0.55; it cannot
   open 0.01 lot. Top it up or open a new demo with about R20,000 (close to the $1,000 the
   gate used).
1. **Install.** On any cTrader app (Mobile too): Algo > cBots > Upload, pick
   `dist/GoldBandBreakoutBot.algo`. v2.1 runs in the cloud (AccessRights.None; cloud refuses
   Full access). Add an instance on XAUUSD, 1h; the defaults are the tested settings.
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
5. **Live** only after steps 2-4 pass, at 0.01 lot, same constants. Scale only after another
   gated period.

If you optimise `Band z` or `Profile sessions`, do it walk-forward on in-sample windows only and
count every combination as a variant.

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
