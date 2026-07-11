# cTrader Autonomous Agent

A local Windows agent that drives **cTrader Automate** (the desktop app) to run
backtests and optimizations on your cBots unattended — you drop job files in a
folder, the agent runs them against the real cTrader Automate UI while you're
away, and writes results/reports back out.

## Why this exists, and its real constraints

cTrader's backtesting/optimization engine only lives inside the **cTrader
Automate desktop client** (Windows). Spotware does not publish a cloud or
headless API for driving backtests or optimizations — the cTrader Open API
(FIX/Protobuf) is for live/demo order execution and market data only, not
strategy testing. So "autonomous" here means:

- This agent runs **on your Windows PC**, where cTrader Automate is already
  installed and your cBot(s) are already loaded.
- It automates the cTrader Automate **desktop UI** (via Windows UI Automation,
  through the [FlaUI](https://github.com/FlaUI/FlaUI) library) — it clicks the
  same buttons, fills the same fields, and reads the same result grids you
  would by hand.
- Because it drives a real GUI, it needs an interactive desktop session. It
  cannot run as a headless background service (e.g. SYSTEM account) — see
  `docs/SETUP.md` for how to schedule it to still run unattended while you're
  logged in but away from the keyboard.
- **UI Automation selectors are not guaranteed stable across cTrader
  versions.** Spotware doesn't document internal element IDs. This project
  centralizes every selector in `agent/uimap.json` and ships an `--inspect`
  mode specifically so you (or I, in a follow-up session) can recalibrate
  quickly without touching code. Treat the first run as a calibration pass,
  not a guaranteed drop-in.

## What it does

1. You drop a job file (JSON) describing a backtest or an optimization into
   `jobs/pending/`.
2. The agent (running in `--watch` mode) picks it up, drives cTrader Automate
   through: select bot → set symbol/timeframe/date range/balance → set
   parameters (fixed values for a backtest, ranges for an optimization) →
   start the run → wait for completion → export the report.
3. Results are parsed and written to `reports/<job-id>/` (raw export +
   `summary.json` with the headline stats, and for optimizations, a ranked
   top-N table).
4. The job file moves to `jobs/done/` or `jobs/failed/` (with an error log).

## Layout

```
ctrader-agent/
  agent/                  .NET 8 console app (the automation agent itself)
    Automation/           FlaUI driver that operates the cTrader Automate UI
    Config/                appsettings + strongly-typed config
    Jobs/                  Job/result models and JSON (de)serialization
    Queue/                 File-based job queue (pending/processing/done/failed)
    Reporting/             Parses exported reports, writes summaries
    Program.cs             Entry point: --watch, --run-once, --inspect, --dry-run
  jobs/
    examples/              Example backtest.json / optimization.json
    pending/ processing/ done/ failed/   (created at runtime, gitignored)
  reports/                 (created at runtime, gitignored)
  scheduler/
    Install-ScheduledTask.ps1   Registers the agent to auto-start in your
                                 interactive session at logon
  docs/
    SETUP.md               Step-by-step install on your Windows PC
    JOBS.md                 Job file schema reference
    CALIBRATION.md          How to fix UI selectors if they don't match
```

## Quick start

See `docs/SETUP.md` for the full walkthrough. Short version:

```powershell
cd ctrader-agent\agent
dotnet build
dotnet run -- --inspect          # dumps the cTrader Automate UI tree, confirms it can find the app
dotnet run -- --dry-run --watch  # simulates job processing without clicking anything
copy ..\jobs\examples\backtest-example.json ..\jobs\pending\
dotnet run -- --watch            # the real thing
```

Then use `scheduler\Install-ScheduledTask.ps1` to have it start automatically
whenever you log in, so you can drop jobs in and walk away.

## Status

This is a first pass, built without a Windows machine or a live cTrader
Automate instance to test against in this session. The job queue, models,
report parsing, and CLI plumbing are complete and should work as-is. The
`Automation/CTraderDriver.cs` UI selectors are best-effort based on cTrader
Automate's documented panel layout and will very likely need a short
calibration pass against your actual installed version — that's what
`--inspect` and `docs/CALIBRATION.md` are for. Happy to iterate on the
selectors with you once you run `--inspect` and share the output.
