# GoldGuard XAUUSD v3

M15 gold cBot for cTrader. It has four setups, each tagged and scored separately:

| Tag | Setup | Source |
|---|---|---|
| `PB` | Pullback to the M15 entry EMA, in the H1 EMA trend | v2 logic |
| `BO` | Close beyond the N-bar structure high or low, in the H1 trend | v2 logic |
| `GT` | Gartley: B = 0.618 XA, D = 0.786 XA, entry on a rejection candle at D, stop beyond X | new: Autochartist-style pattern |
| `AB` | AB=CD: CD = AB, entry on a rejection candle at D | new: Autochartist-style pattern |

**Status: DEMO ONLY. Not validated.** v3 is a new variant: no v2 backtest result carries over.

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
| Manual news blackout in whole hours | Minute-precise windows, e.g. `13:25-13:45, 18:55-19:30` | |
| Optimiser ranked by its own criteria | `GetFitness`: Profit Factor first; < 100 trades always ranks lower | Matches cbot-gate. Choose **Criteria → Custom** in the optimiser |
| No trade log | Writes `Documents\cBotLogs\GoldGuardV3_*.csv` in the cbot-gate format, with Setup and R columns | Goes straight into `gate.py` |
| — | Report on stop: PF, win %, avg R per setup, signals found vs traded, and the top reasons trades were skipped | Shows which setup carries the edge and why the bot doesn't trade |
| — | Chart panel: day P/L vs halt, drawdown from peak, trades, loss streak, last skip | |

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

Times are UTC. SAST = UTC+2, so the session 07:00–20:00 UTC is 09:00–22:00 SAST.

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
5. **Back-test the chosen settings** on the in-sample window and on the unseen window after it. Then gate the results:

   ```bash
   python3 skills/cbot-gate/scripts/gate.py --trades GoldGuardV3_XAUUSD_m15_backtest_....csv \
       --split 2025-07-01 --balance 10000 \
       --source cbots/GoldGuard/GoldGuard_XAUUSD_v3.cs --name "GoldGuard v3 GT" --json gt.json
   ```

   For walk-forward folds, pass `--is f1_is.csv --oos f1_oos.csv --is f2_is.csv --oos f2_oos.csv ...` instead.
6. **Read the report line "peak-drawdown halts".** Anything above 0 is a red flag, even if PF looks fine.
7. **Only a gate PASS** earns a demo forward test with the same settings. Run it on a demo balance close to what you'd run live.

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
| `tests/` | Compiles the bot against `cTrader.Automate` and runs 21 checks on the Gartley/ABCD logic: bull and bear, wrong ratios, failed patterns, no entry before a rejection candle. Run with `cd tests && dotnet run` |
