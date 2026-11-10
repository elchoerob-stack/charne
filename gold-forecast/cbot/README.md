# GoldBandBreakoutBot v1 - guide

An XAUUSD cBot for cTrader built from the gold-forecast bands. **Demo only.**
It has passed a backtest gate on 5-minute bars but has not yet passed on
years this research never saw, nor on tick data.

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

Why the PASS is not yet trusted:
- In-sample it barely broke even (PF 1.04, 53% drawdown on $1,000). Most of the
  edge appeared after July 2026: it may be a regime, not a lasting edge.
- It was chosen with 16 variants on the table.
- 5-minute bars, not ticks.

Validation log rows:

```
| 2026-11-09 | GoldBandFade (8 variants) | v1 | FAIL | OOS PF 0.62-0.86 | ~110-310 trades each | - | variants tested: 16 |
| 2026-11-09 | GoldBandBreakout analog/80%/all hours | v1 | FAIL | OOS PF 1.20 | 123 trades | WFE 0.66 | variants tested: 16 |
| 2026-11-09 | GoldBandBreakout prior-close/80%/skip US | v1 | PASS (5m bars) | OOS PF 1.44 | 111 trades | WFE 6.2 | variants tested: 16 |
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

Loss caps are in USD (gold's quote currency), so they mean the same on a ZAR, EUR or USD account
(v1.2; v1.1 had them in account currency and the EUR demo made them ~18x looser than intended).
Change them only by editing the code, never as instance settings.

## Steps

0. **Fund the demo.** The connected cTrader demo account shows a balance of R0.55; it cannot
   open 0.01 lot. Top it up or open a new demo with about R20,000 (close to the $1,000 the
   gate used).
1. **Install.** On any cTrader app (Mobile too): Algo > cBots > Upload, pick
   `dist/GoldBandBreakoutBot.algo`. v1.2 runs in the cloud (AccessRights.None; cloud refuses
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
