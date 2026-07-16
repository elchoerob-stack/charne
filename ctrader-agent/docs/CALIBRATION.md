# Calibrating UI selectors

Every UI element the agent looks for is defined in `agent/uimap.json` as a
named entry with an ordered list of lookup strategies (`Name`,
`AutomationId`, or `ClassName`). The code never hardcodes selectors — if a
lookup fails, you fix the JSON, not the C#.

The current `uimap.json` was calibrated from screenshots of **cTrader 5.7.14**
(the Algo → cBot → Backtesting/Optimisation UI). Text-labelled elements (tab
names, dialog field labels, checkboxes, results columns) should already be
correct. The entries marked `"needsInspect": true` are **icon buttons and
date fields with no visible text** — their identifiers are placeholders you
confirm with `--inspect`.

## 1. Dump the real UI tree

`--inspect` dumps **every** cTrader top-level window (main window + any open
popup/dialog), so whatever you have on screen when it fires gets captured.
Use `--delay <seconds>` to give yourself time to arrange the UI first.

Each line is one element:

```
[Button] Name='' AutomationId='BacktestingStartButton_AId' ClassName='Button'
```

To finish calibration, capture these three states (one dump each — they're
timestamped, so just run it three times and commit all the files):

```powershell
cd ctrader-agent\agent

# a) Backtest settings popup — open a bot's Backtesting tab, click the gear so
#    the "Backtesting settings" popup is open, then:
dotnet run -- --inspect

# b) Optimisation — click the Optimisation tab, open its Parameters (sliders)
#    dialog, then:
dotnet run -- --inspect

# c) Finished backtest report — run a short backtest to completion so the
#    report is on screen, then:
dotnet run -- --inspect
```

If a popup closes when you switch to the terminal, use the delay instead and
open it during the countdown:

```powershell
dotnet run -- --inspect --delay 8
```

Then commit the `logs/ui-tree-*.txt` files (they're gitignored, so force-add):

```powershell
git add -f ..\logs\ui-tree-*.txt
git commit -m "Calibration dumps: settings popup, optimisation, report"
git push origin claude/ctrader-autonomous-agent-mngx05
```

## 2. Confirm the `needsInspect` elements

These are the ones most likely to need fixing, because they're toolbar icons
or unlabelled fields:

| uimap element | What it is | How to spot it in the dump |
|---|---|---|
| `BacktestSettingsButton` | gear ⚙ (opens Backtesting settings) | a Button near the start of the toolbar |
| `FromDatePicker` / `ToDatePicker` | the two dd/MM/yyyy date fields | Edit/date controls flanking the range slider |
| `StartButton` / `StopButton` | Play ▶ / Stop ■ | Buttons on the toolbar |
| `OptimisationParamsButton` | sliders icon (opens the ranges dialog) | Button on the Optimisation toolbar |
| `OptimisationResultsGrid` | the passes results grid | a DataGrid/Table with the Pass/Fitness/... columns |
| `BacktestReportButton` / `BacktestReportPanel` | the post-run report | Button + panel that appear after a backtest |

For each: find the real `AutomationId` (preferred) or `Name` in the dump and
replace the placeholder `value` in `uimap.json`. You can keep multiple
fallback strategies — the agent tries them in order and uses the first match.
No rebuild needed; `uimap.json` is read at startup.

## 3. Things the code assumes about layout

- **Optimisation parameter rows** (`ConfigureOptimisation` in
  `agent/Automation/CTraderDriver.cs`): numeric parameters are assumed to
  expose three Edit fields in **Min, Max, Step** left-to-right order, and
  boolean/enum parameters a single value-list field. This matches the 5.7
  Parameters dialog in the screenshots. If your build differs, adjust the
  `editBoxes[...]` indexing there.
- **Completion detection** (`WaitForCompletion`): the agent watches the Play
  button — it waits until the button goes disabled (run started) and then
  re-enables (run finished). If that proves unreliable on your version, the
  `RemainingTimeLabel` / `PassesLabel` elements are mapped as secondary
  signals you can lean on instead.
- **Settings/param dialogs are dismissed** by re-clicking the button that
  opened them. If your version needs an explicit OK/Close, map
  `SettingsDialogCloseButton` to it.

## 4. Iterating with me

If you'd rather not hand-edit `uimap.json`: run `--inspect` with the
Backtesting tab open, commit the resulting `logs/ui-tree-*.txt` (or paste it),
and tell me which step is failing. I'll map the real element identifiers into
`uimap.json` and adjust the driver's assumptions directly.
