# Calibrating UI selectors

Every UI element the agent looks for is defined in `agent/uimap.json` as a
named entry with an ordered list of lookup strategies (`Name`,
`AutomationId`, or `ClassName`). The code never hardcodes selectors — if a
lookup fails, you fix the JSON, not the C#.

## 1. Dump the real UI tree

```powershell
cd ctrader-agent\agent
dotnet run -- --inspect
```

Open the generated `logs/ui-tree-<timestamp>.txt`. Each line is one element:

```
[Button] Name='Start' AutomationId='StartButton' ClassName=''
```

## 2. Find each element uimap.json needs

Search the dump for the elements listed in `uimap.json`'s `elements` object
(`AutomateTab`, `BotList`, `BacktestingSubTab`, `SymbolDropdown`,
`StartButton`, `ParametersGrid`, etc — each has a `description` field
explaining what it's for). For each one:

1. Locate the matching control in the dump (use the `description` and your
   knowledge of where it sits in the cTrader UI).
2. Note its `Name` and/or `AutomationId`.
3. Update the corresponding `value` in `uimap.json`. You can list multiple
   fallback strategies — the agent tries them in order and uses the first
   match, so it's safe to add a second guess without removing the first.

No rebuild is required; `uimap.json` is read at process startup.

## 3. Elements needing the most attention

- **`ParameterRow` / parameter grid layout** — `CTraderDriver.SetFixedParameters`
  and `SetParameterRanges` assume the parameters grid exposes one text edit
  per value (backtest) or three text edits in Min/Max/Step order plus a
  checkbox to enable ranging (optimization). If your cTrader version orders
  or labels these differently, adjust the `editBoxes[...]` indexing in
  `agent/Automation/CTraderDriver.cs` (`SetParameterRanges` method) to match
  what `--inspect` shows for an expanded parameter row.
- **`ExportButton` / export flow** — cTrader's export opens a native OS
  save-file dialog, which is a separate top-level window from the main
  cTrader window and isn't covered by `--inspect`'s dump (which only walks
  the main window). If you want raw exported files (not just the
  agent-parsed summary), extend `CTraderDriver.ExportReport` to also drive
  that save dialog — it typically has a filename edit box and a Save
  button, both easy to find with a second `--inspect`-style dump targeted at
  the dialog window once it's open (ask me to add a `--inspect-dialog` mode
  if you want this scripted rather than hand-rolled).
- **`StatusText`** — used to detect run completion. If your version doesn't
  expose a plain status text element, the driver falls back to polling
  whether the Start button re-enables, which is coarser but usually works.

## 4. Iterating with me

If you'd rather not hand-edit `uimap.json` yourself: run `--inspect`, paste
me (or commit) the resulting `ui-tree-*.txt`, and tell me which job step is
failing. I can map the real element names into `uimap.json` and adjust
`CTraderDriver.cs`'s grid-column assumptions directly.
