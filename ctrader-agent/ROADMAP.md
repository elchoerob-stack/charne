# cTrader Trader Agent — vision & roadmap

The goal: a **trading assistant that lives on your PC**, runs in its own
window, and works through cTrader tasks autonomously while you're busy with
other things — with **Claude guiding it** for continuous improvement, and
eventually helping **record and operate your live account** safely.

This document is the scope. It has three phases. Phase 1 is built and working;
Phases 2 and 3 build on the same foundation.

## The two Claudes (important)

- **Remote Claude (claude.ai / Claude Code on the web)** — where this project
  was *built and calibrated*. Runs in the cloud against your GitHub repo. It
  has **no access to your PC**, so it can't run the agent or your cTrader.
- **Local Claude (Claude Code installed on your Windows PC)** — where the
  agent *lives and is operated*. Has direct access to your machine: it can run
  the agent, read its results, edit its code, and drive the improvement loop.
  **This is the "Claude that guides your agent."** See
  `docs/CONTINUOUS_IMPROVEMENT.md` for setup.

You keep using remote Claude for big changes (like this build), and local
Claude for day-to-day operation and iteration. Both share the same repo, so
work flows between them through git.

## Phase 1 — Autonomous backtesting & optimisation  ✅ working

The agent drives the cTrader Automate desktop UI to run backtests (and, once
calibrated, optimisations) on your cBots, unattended.

- Drop a job file in `jobs/pending/` → the agent runs it in cTrader → results
  land in `reports/<job-id>/`.
- Runs in its own window in `--watch` mode; a scheduled task can auto-start it
  at logon. Launcher: `scheduler/Start-Agent.ps1`.
- Status: backtest path proven end-to-end on cTrader 5.7. Remaining
  calibration (optimisation panel, settings popup, report numbers) is a
  single `--inspect` pass away — see `docs/CALIBRATION.md`.

## Phase 2 — Claude-guided continuous improvement  🔜 next

Close the loop: results feed back into new jobs, with Claude proposing what to
test next.

- The agent aggregates every run into a leaderboard (`reports/index.md`) so
  results are comparable at a glance.
- **Local Claude** reads the leaderboard and the per-run reports, reasons about
  what's working, and writes new job files (parameter sweeps, walk-forward
  windows, different symbols/timeframes) into `jobs/pending/` — then the agent
  runs them while you work.
- Over time this becomes a research loop: hypothesis → jobs → results →
  refined hypothesis, with you approving direction and Claude doing the
  legwork. See `docs/CONTINUOUS_IMPROVEMENT.md`.

## Phase 3 — Live account: record & operate  🔒 designed, gated

Help manage the real account "like a broker": first **record** (read-only
monitoring, journaling, reporting), then **operate** (place/manage orders)
behind strict safety rails. This uses cTrader's **Open API** (not UI
automation) and is deliberately separate and opt-in because it involves real
money. Design and safety model: `docs/LIVE_TRADING.md`.

- 3a. **Record (read-only):** connect to the account via Open API, log
  positions/orders/balance/equity, produce daily journals and performance
  reports. No trading. Safe to run continuously.
- 3b. **Operate (guarded execution):** place and manage orders from
  instructions or from strategies validated in Phases 1–2, behind hard limits
  (max position size, max daily loss, allowed symbols, kill switch) and with
  a dry-run default. Enabled only with your explicit configuration and go-ahead.

## Design principles carried across all phases

- **File-based and inspectable.** Jobs, results, and journals are plain
  files in the repo, so both you and Claude can read/write them, and
  everything is versioned in git.
- **Safe by default.** Anything that can touch money or live orders is
  off by default, dry-runnable, and bounded by explicit limits.
- **Nothing hidden.** Every action the agent takes is logged; every result is
  written to disk.
