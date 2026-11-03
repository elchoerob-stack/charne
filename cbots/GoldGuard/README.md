# GoldGuard XAUUSD v3

M15 gold cBot for cTrader. It has four setups, each tagged and scored separately:

| Tag | Setup | Source |
|---|---|---|
| `PB` | Pullback to the M15 entry EMA, in the H1 EMA trend | v2 logic |
| `BO` | Close beyond the N-bar structure high or low, in the H1 trend | v2 logic |
| `GT` | Gartley: B = 0.618 XA, D = 0.786 XA, entry on a rejection candle at D, stop beyond X | new: Autochartist-style pattern |
| `AB` | AB=CD: CD = AB, entry on a rejection candle at D | new: Autochartist-style pattern |

**Status: DEMO ONLY. cbot-gate FAIL (Nov 2026 backtest, see "Backtest" below).** Out-of-sample PF 1.18 across 221 trades: positive, but below the 1.30 bar and not yet distinguishable from luck.

## What changed from v2, and why

| v2 | v3 | Why it mattered |
|---|---|---|
| 8 risk inputs were optimisable `[Parameter]`s. The cbot-gate audit said **CRITICAL** | All 8 are `const`. The audit now says **REVIEW**, with 0 critical findings | The PivotTargetBot lesson: an optimiser or a typo can't touch risk any more |
| Stops, spread and ATR limits were in **pips** | All are in **ATR multiples** | Your broker quotes gold at **$0.01 per pip** (3950.13 → 4025.00 shows as 7487 pips). v2's "Max ATR 500 pips" and "Max Stop 600 pips" meant $5 and $6, so it skipped almost every trade at today's volatility |
| The 6% peak-drawdown halt was **permanent inside a backtest** | Live: it holds until you change `KillSwitchEpoch` in code. Backtest: it re-arms next day, and **every trip is counted** in the report | In v2, a multi-year backtest went silent after the first 6% drawdown. The trade list was cut short and nothing warned you |
| LocalStorage was written in backtests too | Only the live/demo instance saves state | In v2, a backtest could write its peak equity into your demo bot's state, and lock the demo bot on its next start |
| State was saved to disk on every tick that set a new equity high | Saved at most every 5 s | Fewer disk writes, faster backtests |
| R was inferred from TP ÷ Reward/Risk | R is stored in the position comment (`GG3\|setup\|stop\|risk`) | Break-even and trailing stay correct after a restart or a parameter change |
| The H1 bar was picked as `Count - 2` | The H1 bar is picked by time (last fully closed bar) | No off-by-one at the top of each hour |
| The trailing stop was modified on every tick | Moves in steps of at least 0.05 ATR | Doesn't flood the broker with modify requests |
| Commission-only break-even exits counted as losses | Exits within ±0.2R are scratches | The loss-streak halt no longer fires on break-evens |
| Nothing stopped the weekend gap | No entries after 18:00 UTC Friday; flat at 20:30 UTC Friday | Gold gaps on the Sunday open |
| Buy and sell could be open at once | Entries opposite an open bot position are blocked | |
| Session 07:00–20:00 UTC, no daily filter | **Session 12:00–16:00 UTC** (London/NY overlap) and a **Daily Trend EMA 100** filter | The backtest refinement, below. v3's first defaults had PF 0.98 out-of-sample |
| Manual news blackout in whole hours | Minute-precise windows, e.g. `13:25-13:45, 18:55-19:30` | |
| Optimiser ranked by its own criteria | `GetFitness`: Profit Factor first; < 100 trades always ranks lower | Matches cbot-gate. Choose **Criteria → Custom** in the optimiser |
| No trade log | Writes `Documents\cBotLogs\GoldGuardV3_*.csv` in the cbot-gate format, with Setup and R columns | Goes straight into `gate.py` |
| — | Report on stop: PF, win %, avg R per setup, signals found vs traded, and the top reasons trades were skipped | Shows which setup carries the edge and why the bot doesn't trade |
| — | Chart panel: day P/L vs halt, drawdown from peak, trades, loss streak, last skip | |
| Fixed take-profit at the target | **Runner exit** (default): no TP at the target. At the target the stop locks 80% of it, then trails 0.6 ATR behind price. A broker-side backstop TP sits at 3× the target | A move that keeps running is followed instead of cut off |

### Exits: the runner

The target (2R for PB/BO, the 0.618 retrace for GT/AB) is no longer a price the
trade closes at. It is the point where the bot changes how it protects the profit:

| Profit | What the stop does |
|---|---|
| Below 1R | Original stop |
| 1R | Break-even + 0.1R |
| 1.5R | Trails 1.5 ATR behind price |
| **Target reached** | Jumps to lock **80% of the target**, then trails **0.6 ATR** behind price. Every tick it uses whichever of the two is tighter |
| Beyond | Keeps following, only ever in your favour. It never loosens |

Example (buy at 100, stop 90, target 120, ATR 4):
- Price touches 120: the stop goes to 117.6.
- Price runs to 130: the stop is at 127.6.
- Price dips back to 128.5: the stop stays at 127.6.

The cost: if price touches the target and turns straight back, you exit just below it,
at about 1.7–1.8R instead of exactly 2R. Whether the runners pay for that is a
backtest question, so it is switchable:

| Setting | Default | |
|---|---|---|
| Trail Past Target (runner) | on | Off = the v2 fixed take-profit at the target, for an A/B test |
| Runner Lock at Target (share) | 0.8 | How much of the target is locked the moment it is reached |
| Runner Trail (x ATR) | 0.6 | How close the trail follows. Smaller = tighter |
| Runner Hard TP (x target, 0 = none) | 3 | Far take-profit held by the broker at 3× the target distance (a 2R target gives a 6R ceiling). 0 = no ceiling |

The trailing is done by the bot. If cTrader closes or the laptop sleeps, the stop
stays where it was last moved (break-even or the locked level) until the bot is
back. It does not follow price in the meantime. The backstop take-profit at 3× the
target is held by the broker, so a big spike while the bot is offline still gets
banked. With the bot running, it only closes a trade that has gone 3× past its
expected profit.

The end-of-run report adds a line comparing exits with the targets:
`Runners: N reached target | exit avg xR vs target avg yR | best zR | k exited below target`.

### Risk constants (top of the file)

| Constant | Value |
|---|---|
| Risk per trade | 0.5% of equity |
| Total open risk | 1.0% |
| Daily loss halt | −2% from 00:00 UTC equity: close all positions, no entries until midnight |
| Peak drawdown halt | −6% from peak equity: close all positions, halt until `KillSwitchEpoch` changes |
| Max open positions / trades per day / losses per day | 2 / 6 / 3 |
| Min-lot overshoot | Skip the trade if broker lot rounding would risk more than 1.01 × budget |

To change any of these, edit the code, rebuild, and treat the result as a new variant.

## Backtest (November 2026)

The backtest runs in my own simulator (`backtest/`), not in cTrader. It uses 1-minute
gold data with real bid and ask prices, from January 2023 to 28 October 2026. The
pattern and exit maths are the bot's own code.

- **In-sample (IS):** Jan 2023 – Jun 2025. All tuning happened here.
- **Out-of-sample (OOS):** Jul 2025 – Oct 2026. Untouched until the final settings were fixed, then run once.

### What the first v3 defaults did

They had no edge:

| | Trades | Profit Factor | Kill-switch trips | Worst drawdown |
|---|---|---|---|---|
| In-sample | 875 | 1.01 | 10 | 16.4% |
| Out-of-sample | 639 | 0.98 | (15 over the whole run) | 16.4% |

Sells lost heavily in the 2023–25 bull market (PF 0.70). Changing stops and targets
made no difference: 144 combinations of stop, R:R, lookback and trail start all landed
between PF 0.99 and 1.06.

### What the refinement changed (now the defaults)

| Setting | Was | Now | In-sample evidence |
|---|---|---|---|
| Session (UTC) | 07–20 | **12–16** (London/NY overlap, 14:00–18:00 SAST) | PF 1.01 → 1.14. Kill-switch trips 10 → 1. All of the top 6 filter variants used this window |
| Daily Trend EMA | — | **100**: buys only above it, sells only below | PF 1.14 → 1.20. No kill-switch trips |
| Runner exit | on | on | PF 1.22 with the runner, 1.17 with a fixed take-profit |

### Result

| Refined defaults | Trades | Win % | Profit Factor | Avg R | Worst drawdown |
|---|---|---|---|---|---|
| In-sample | 290 | 50.3% | 1.22 | +0.09 | 3.8% |
| **Out-of-sample** | **221** | 49.3% | **1.18** | +0.08 | 7.4% |
| Whole period | 511 | 49.9% | 1.21 | +0.09 | 8.1% (1 kill-switch trip) |

### cbot-gate verdict: **FAIL**

Three checks failed:

1. **OOS PF 1.18**, below the 1.30 target. It is above break-even.
2. **Bootstrap P(PF < 1) = 13.5%**, above the 10% limit. 221 trades at +0.08R could still be luck.
3. **PF without the best 5% of trades = 0.90.** The profit rests on a dozen big winners.

Passed: OOS trade count, break-even, PF retention 0.97, walk-forward efficiency 1.28,
drawdown 7.4%, Monte Carlo 95th-percentile drawdown 8.6%, PF 1.13 after extra costs.
Full report: `backtest/results/gate_report_v3_refined.md`.

```
| 2026-11-03 | GoldGuard XAUUSD m15 | v3 refined (12-16 UTC, D1 EMA100, runner) | FAIL | OOS PF 1.18 | 221 trades | WFE 1.28 | variants tested: 203 |
```

### Read this before trusting any of it

- **203 variants were tried.** The best in-sample one is flattered by that alone. The OOS result partly makes up for it, but not fully.
- **The setups swapped places out-of-sample.** Breakouts went from PF 1.90 to 0.74; pullbacks from 1.04 to 1.34. The combination held, but the per-setup numbers are noise.
- **The in-sample edge sits in Apr 2024 – Jun 2025**, gold's strongest bull leg. Jan 2023 – Mar 2024 alone had PF 0.97.
- **The runner gave back profit out-of-sample.** Trades that reached the target exited at 1.67R on average against a 2.0R target. In-sample it was the other way round (runner PF 1.22 vs 1.17 for a fixed take-profit). The jury is still out.
- **The harmonics almost never trade:** one AB=CD trade in four years after the filters. They can't be validated. They do no harm, but don't expect them to fire.
- **The simulator is not cTrader.** It fills on M1 bars, adds no swap, and uses a different data feed. Re-run the same test in cTrader on tick data before relying on any number.

## Load it into cTrader (Desktop, on the laptop)

1. **Stop any GoldGuard v2 instance.** v3 uses a different label (`GoldGuardV3-XAU`), so it won't manage v2's positions. Close those positions, or let their own stops and targets run.
2. **Algo** (left sidebar) → **cBots** → **New**. Name it `GoldGuard XAUUSD v3`.
3. In the code editor, select all and delete it. Paste in all of `GoldGuard_XAUUSD_v3.cs`.
4. **Build** (Ctrl+B). It should report success with no errors. This file was compiled against Spotware's `cTrader.Automate` 1.0.21 package with warnings treated as errors.
5. When cTrader asks, allow **Full Access**. The only thing it's used for is writing the trade-log CSV. If you'd rather not grant it, change `AccessRights.FullAccess` to `AccessRights.None` at the top of the file and set *Write Trade Log CSV* to off.
6. **Add instance** → symbol **XAUUSD**, timeframe **m15**. The bot stops itself on any other chart, and on a live account.
7. Check the first log lines:
   - `PipSize 0.01, TickSize 0.01 ...`: confirms your broker's gold units.
   - `Risk constants: 0.5% per trade ...`: confirms the constants that are compiled in.

## Validation plan (cbot-gate)

Times are UTC. SAST = UTC+2, so the session 12:00–16:00 UTC is 14:00–18:00 SAST. The Daily Trend EMA needs 100 closed daily bars. If cTrader's backtest has no history before your start date, entries stay blocked ("daily trend warming up") for about 5 months, so start backtests early enough.

1. **Smoke test.** Run a visual backtest of the last month on **tick data**. Check that:
   - entries appear,
   - Gartley/ABCD lines are drawn (blue = bullish, red = bearish),
   - the report prints on stop,
   - a CSV appears in `Documents\cBotLogs`.
2. **Learn the trade rate.** Run a full backtest with default settings from 2023-01-01 to today. The report shows trades per setup. Use it to size the out-of-sample (OOS) windows so the gate gets **≥ 100 OOS trades**.
3. **One setup at a time.** Run the PB+BO pair, then GT alone, then AB alone. Turn the other setups off. Each run is one variant in your log; count it.
4. **Optimise a few inputs, in-sample only, with Criteria → Custom:**
   - Trend setups: `ATR Stop Multiple`, `Reward / Risk`, `Structure Lookback`, `Trail Starts at R`
   - Harmonics: `Ratio Tolerance`, `D Zone (x ATR)`, `Harmonic Target`, `Min Swing Leg (x ATR)`

   Leave the filters at their defaults while you do this.
5. **Runner vs fixed take-profit.** Run the same in-sample period twice: *Trail Past Target* on, then off. Keep the exit that wins on Profit Factor and avg R. Count it as one more variant.
6. **Back-test the chosen settings** on the in-sample window and on the unseen window after it. Then gate the results:

   ```bash
   python3 skills/cbot-gate/scripts/gate.py --trades GoldGuardV3_XAUUSD_m15_backtest_....csv \
       --split 2025-07-01 --balance 10000 \
       --source cbots/GoldGuard/GoldGuard_XAUUSD_v3.cs --name "GoldGuard v3 GT" --json gt.json
   ```

   For walk-forward folds, pass `--is f1_is.csv --oos f1_oos.csv --is f2_is.csv --oos f2_oos.csv ...` instead.
7. **Read the report line "peak-drawdown halts".** Anything above 0 is a red flag, even if PF looks fine.
8. **Only a gate PASS** earns a demo forward test with the same settings. Run it on a demo balance close to what you'd run live.

## Account size

The bot sizes every trade to lose 0.5% of equity at the stop. Gold's minimum lot on your broker is 0.01, and 0.01 lot loses about €0.90 per $1 move. Typical v3 stops are $7–15, so the minimum lot alone risks about €6–13. On the **€293 account** in the screenshots, that is 2–4.5% per trade, and v3 will refuse every trade with *"minimum lot risks more than the per-trade budget"*. That is the risk rule working. The rule only fits accounts of roughly €2,000 or more.

The manual BUY on that screen (0.01 lot, SL 3930) risks €18. That is 6% of €293, the size of the whole peak-drawdown kill switch, in a single trade.

## The Signals tab (Autochartist and Trading Central)

- **A cBot can't read either feed.** The cAlgo API has no access to the Signals tab, and neither feed has a history you could backtest. The `GT` and `AB` setups instead detect the same pattern family from price. They use the textbook ratios, so they won't match Autochartist one for one. Autochartist's tolerances are looser and not published. To compare on demo, the bot draws its X-A-B-C-D next to Autochartist's pattern on the same chart.
- **Trading Central's levels are proprietary.** *Daily Pivot Bias (TC-style rule)* applies only their rule: longs only above the pivot, shorts only below. It uses the classic floor pivot from the previous daily bar, not TC's number. It is off by default; test it as its own variant.
- **The two signals in the screenshots disagree.** Autochartist's bullish Gartley completes at D ≈ 3921.47, which is below Trading Central's "upside prevails above 3930" support. By the time price reaches the Gartley buy zone, the TC view is already invalid. The BUY button at 3950 enters about $29 above the pattern's entry zone.

## Resetting a tripped drawdown halt

1. Review what happened.
2. Change `private const int KillSwitchEpoch = 1;` to `2`.
3. Rebuild and restart.

Peak equity then restarts from current equity. There is deliberately no parameter for this, so a setting left on can't quietly defeat the kill switch after a restart.

## Files

| File | |
|---|---|
| `GoldGuard_XAUUSD_v3.cs` | The cBot. Paste this into cTrader |
| `GoldGuard_XAUUSD_v2_Aggressive.cs` | The original, kept for comparison |
| `backtest/` | The simulator, the data preparation script, and `results/` (trade log and cbot-gate report). See `backtest/README.md` |
| `tests/` | Compiles the bot against `cTrader.Automate` (warnings as errors) and runs 36 checks. 21 cover the Gartley/ABCD logic: bull and bear, wrong ratios, failed patterns, no entry before a rejection candle. 15 cover the exits: break-even, trail, runner lock and trail, never loosening, sells, gaps. Run with `cd tests && dotnet run` |
