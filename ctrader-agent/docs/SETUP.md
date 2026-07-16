# Setup (Windows)

## Prerequisites

- Windows 10/11 with **cTrader Automate** installed and at least one cBot
  already added/visible in its Automate tab.
- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0).
- You'll be running this in your normal interactive login session (not as a
  background service) — see the note in `README.md` on why.

## 1. Build

```powershell
cd ctrader-agent\agent
dotnet restore
dotnet build -c Release
```

## 2. Point it at your cTrader install

Edit `agent/appsettings.json`:

```jsonc
{
  "CTrader": {
    "ExecutablePath": "C:\\Program Files\\cTrader\\cTrader.exe", // adjust to your actual install path
    "ProcessName": "cTrader",
    "AttachIfAlreadyRunning": true // if cTrader is already open, the agent attaches instead of relaunching
  }
}
```

## 3. Calibrate the UI selectors (first run only)

The agent locates buttons/fields by name/AutomationId, defined in
`agent/uimap.json`. It's already calibrated from cTrader 5.7 screenshots, but
the toolbar icon buttons and date fields (no visible text) carry placeholder
IDs you should confirm. First, in cTrader, open one of your cBots and click
its **Backtesting** tab so those controls exist in the tree. Then:

```powershell
dotnet run -- --inspect
```

This attaches to cTrader, dumps the full UI Automation tree of the main window
to `logs/ui-tree-<timestamp>.txt`, and exits without touching anything. Open
that file and confirm the identifiers for the elements marked
`"needsInspect": true` in `uimap.json` (gear/settings button, Start/Stop,
date pickers, results grid). Update the `value` fields to match — no rebuild
needed, it's read at startup. `docs/CALIBRATION.md` has the full checklist. If
you get stuck, share the dumped tree and I can adjust the map directly.

## 4. Dry-run the queue mechanics

Before letting it touch the real UI, verify job parsing/queueing/reporting
end-to-end:

```powershell
copy ..\jobs\examples\backtest-example.json ..\jobs\pending\
dotnet run -- --dry-run --run-once
```

You should see log lines describing what it *would* do, and a
`reports/backtest-example-01/summary.md` get written.

## 5. Run for real

```powershell
copy ..\jobs\examples\backtest-example.json ..\jobs\pending\
dotnet run -- --run-once
```

Watch it drive the real cTrader Automate UI. If a selector fails to resolve,
the error names the logical element (e.g. `StartButton`) and points back
here — fix it in `uimap.json` and re-run.

## 6. Go autonomous

Once a couple of real jobs succeed end to end:

```powershell
dotnet build -c Release
cd ..\scheduler
.\Install-ScheduledTask.ps1
```

This registers a scheduled task that starts `CTraderAgent.exe --watch` the
next time you log in, so it's always watching `jobs/pending/` and running
whatever you drop in there — including while you're doing other work, as
long as you stay logged in (screen lock is fine).

To add work: drop a job JSON file into `jobs/pending/` (see `docs/JOBS.md`
for the schema, and `jobs/examples/` for templates). Results land in
`reports/<job-id>/` — `summary.md` for a quick read, `result.json` for the
structured data.
