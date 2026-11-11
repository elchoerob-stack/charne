# cTrader Trader Agent

A **trading assistant that lives on your PC**, runs in its own window, and works
through cTrader tasks autonomously while you're busy — with **Claude guiding it**
for continuous improvement, and (later) helping record and operate your live
account safely.

**Read `ROADMAP.md` for the full vision and the three phases.** In short:

1. **Phase 1 (working now):** autonomous backtesting/optimisation — drop job
   files in a folder, the agent runs them against the real cTrader UI while
   you're away, and writes results back out.
2. **Phase 2 (next):** a local Claude reads results and queues the next tests —
   a continuous-improvement loop (`docs/CONTINUOUS_IMPROVEMENT.md`).
3. **Phase 3 (designed, gated):** record and operate the live account via the
   cTrader Open API, behind strict safety rails (`docs/LIVE_TRADING.md`).

> **Two Claudes:** the cloud Claude (claude.ai) *builds* this and has no access
> to your PC; a **local Claude Code on your Windows machine** *operates and
> guides* it with direct access to run the agent. See `ROADMAP.md`.

The rest of this file covers Phase 1.

---

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
    Start-Agent.ps1             Launch the agent in its OWN window (watch mode)
    Install-ScheduledTask.ps1   Auto-start the agent at logon
  docs/
    SETUP.md                Step-by-step install on your Windows PC
    JOBS.md                 Job file schema reference
    CALIBRATION.md          How to fix/finish UI selectors
    CONTINUOUS_IMPROVEMENT.md  Phase 2: the Claude-guided loop
    LIVE_TRADING.md         Phase 3: live account design & safety
  ROADMAP.md                The full vision and phases
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

To run it in its **own window** alongside your work, use
`scheduler\Start-Agent.ps1` (opens a separate window watching for jobs). To have
it start automatically at logon, use `scheduler\Install-ScheduledTask.ps1`.
Either way, you then drop jobs in `jobs\pending\` and walk away.

## Status (Phase 1)

Calibrated and proven end-to-end against **cTrader 5.7.14**: the agent attaches
to the running app, uses the open cBot, sets the date range, turns Visual Mode
off, writes parameters, starts the backtest, and waits for completion — all with
real UI Automation IDs captured via `--inspect`.

Remaining Phase 1 calibration (a single `--inspect` pass — see
`docs/CALIBRATION.md`):

- **Backtest settings popup** (starting capital / commission / data mode) —
  gated off by `CTrader.DriveBacktestSettingsPopup` until captured; backtests
  currently use cTrader's on-screen values.
- **Optimisation** — the Optimisation tab wasn't in the first capture; that
  path raises a clear "not calibrated yet" error until inspected.
- **Report numbers** — the post-run report panel isn't mapped yet, so summaries
  are empty pending capture.
