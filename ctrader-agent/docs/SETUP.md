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

The agent locates buttons/fields in cTrader Automate by name/AutomationId,
defined in `agent/uimap.json`. These are best-guess defaults and may not
match your exact cTrader version. To check:

```powershell
dotnet run -- --inspect
```

This launches/attaches cTrader, dumps the full UI Automation tree of the main
window to `logs/ui-tree-<timestamp>.txt`, and exits without touching
anything. Open that file and search for the labels of the controls the agent
needs (Automate tab, Backtesting/Optimization sub-tabs, Symbol/Period
dropdowns, Start button, parameter grid, etc). If a name in `uimap.json`
doesn't match what you see, update the corresponding `value` field — no
rebuild needed, it's read at startup. See `docs/CALIBRATION.md` for the full
list of elements and how to fix each one. If you get stuck, share the dumped
tree and I can help adjust the map directly.

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
