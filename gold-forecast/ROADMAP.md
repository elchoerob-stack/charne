# Roadmap - from a one-day study to platform grade

_Updated 10 Nov 2026: see RESEARCH_LOG.md. The breakout bot failed the unseen-period test; the biggest model flaw is band width on trend days (36% coverage)._

Ordered by what moves accuracy and trust the most. Nothing here changes a
forecast after it is frozen; every new model is tested *alongside* v1.

## 1. Track record before trust (weeks 1-4)
- Run the loop every trading day: freeze at 00:00 SAST, lock targets, score at
  close. 20 days gives a first read, 60 days a real one.
- Champion / challenger: v1 stays frozen; every change ships as v2 and is scored
  on the same days. Promote only if it beats v1 out of sample.
- Report probabilistic scores, not just hits: CRPS / pinball loss for the bands,
  Brier and reliability for level touches, PIT histogram for calibration.

## 2. Data quality
- Score on the feed you trade: add the CFI MT5 feed (export or bridge) next to
  the cTrader demo feed and measure the difference.
- Bid *and* ask, spread by hour; tick-volume sanity checks; holiday calendar.
- Store bars in Parquet / DuckDB instead of CSV snapshots; hash every snapshot.

## 3. Model accuracy
- Event-aware volatility: separate hourly profiles for CPI / NFP / FOMC days;
  widen bands only from the event bar onward.
- Volatility forecast (HAR-RV or GARCH) for the day's ATR instead of trailing ATR.
- Cross-asset drivers for gold: DXY, US 10y real yield, ETF flows, COT.
- Condition level-touch probabilities on regime (trend score, vol percentile)
  and on the analogs; keep the unconditional version as the baseline.
- Ensemble analog + momentum + mean-reversion, weighted by rolling skill.
- Longer validation: 3-5 years, several regimes, purged walk-forward folds,
  and a final untouched hold-out period.

## 4. From forecast to edge
- A forecast that beats a random walk is not yet a strategy. Turn the scenario
  rules into a cBot with risk as fixed constants, then run it through
  `skills/cbot-gate` (Profit Factor, walk-forward, out-of-sample).
- Include spread, slippage and swap; size from the 80% band, never from the
  centre line.

## 5. Operations
- Scheduled nightly build + close-of-day check; phone alert on trigger /
  invalidation (Foreman ntfy is already in this repo).
- Version every model (`model_version`), keep the SHA-256 of each frozen file,
  and keep the scorecard log append-only.
