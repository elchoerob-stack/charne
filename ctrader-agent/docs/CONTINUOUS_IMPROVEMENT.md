# Phase 2 — Claude-guided continuous improvement

This is how you get "Claude guides my agent for continuous improvement": a
**local Claude** running on your PC reads the agent's results and writes the
next batch of jobs, while the agent runs them in the background.

## 1. Put a Claude on your PC

Install **Claude Code** on your Windows machine (the local CLI/desktop app —
claude.ai/code has the download). Then open *this repo folder* in it:

```powershell
cd C:\Users\Jacqu\charne\ctrader-agent
claude
```

That local Claude has direct access to your machine — unlike the cloud session
that built this, it can actually run the agent, read `reports/`, edit code, and
create job files. It is the guide for the loop below.

## 2. The loop

```
   you set a goal ─▶ Claude writes jobs ─▶ agent runs them ─▶ results on disk
        ▲                                                            │
        └──────────────  Claude reviews & proposes next  ◀──────────┘
```

1. **You set a direction**, e.g. "find better EMA settings for EurusdWaveCapture
   on h1 over 2024–2025" or "check if the Scalps engine helps or hurts."
2. **Local Claude writes job files** into `jobs\pending\` — parameter sweeps,
   different date windows (walk-forward), symbols, or timeframes — following
   the schema in `docs/JOBS.md`.
3. **The agent runs them** (keep it running via `scheduler\Start-Agent.ps1` or
   the scheduled task). Results land in `reports/<job-id>/`.
4. **Local Claude reviews** the results, tells you what it found, and proposes
   the next batch. You approve the direction; it does the legwork.

Because jobs and results are just files in the repo, this loop works whether
you're driving it live in a local Claude session or reviewing later — and every
step is versioned in git.

## 3. The leaderboard (aggregated results)

To compare runs at a glance, the agent will aggregate every `reports/*/result.json`
into `reports/index.md` (a ranked table) and `reports/index.json`. Local Claude
reads that to reason across runs instead of opening each report. (This
aggregator is wired in once optimisation/report reading is calibrated — see
`docs/CALIBRATION.md` — so the numbers it ranks are real.)

## 4. Guardrails for the loop

- Claude proposes; **you approve the direction.** Nothing here touches live
  trading — Phase 2 is entirely backtest/optimisation on historical data.
- Keep job batches bounded (e.g. tens, not thousands) so runs finish in
  reasonable time and results stay reviewable.
- Everything is logged and versioned, so you can always see what was tested and
  why, and roll back.
