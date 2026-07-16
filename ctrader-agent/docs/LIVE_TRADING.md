# Phase 3 — Live account: record & operate (design)

This phase lets the agent help with your **real** account: first **recording**
(read-only monitoring & journaling), then **operating** (placing/managing
orders) behind strict safety rails. It is deliberately separate from Phases 1–2
and **off by default** — it involves real money.

This document is the design and safety model. Implementation happens only when
you explicitly turn it on and configure the limits.

## Why a different mechanism than backtesting

Backtesting/optimisation (Phases 1–2) drives the cTrader **desktop UI**, because
that's the only place the tester exists. Live account access is different: it
uses the **cTrader Open API** — Spotware's official programmatic interface —
which is built for exactly this and is far more reliable than clicking the live
UI. Using the API (not UI automation) for anything touching real orders is a
deliberate safety choice.

### cTrader Open API in brief

- OAuth 2.0 to authorise access to your account; Protobuf messages over a
  secure socket (`live.ctraderapi.com` for live, `demo.ctraderapi.com` for
  demo). You register an application in cTrader's Open API portal to get a
  client id/secret, then authorise your specific account.
- Capabilities: read account/positions/orders/balance/equity, subscribe to
  live prices, and place/amend/close orders.
- The demo endpoint is a full, risk-free mirror — **all development and testing
  happens against demo first.**

## 3a. Record (read-only) — safe, runs continuously

No trading. The agent connects read-only and produces a durable record:

- **Journal:** every position/order open, modify, close — written to
  `journal/<date>.jsonl` and summarised in daily markdown.
- **Snapshots:** periodic balance/equity/open-exposure snapshots.
- **Reports:** daily/weekly performance (P&L, win rate, drawdown, per-symbol
  breakdown) — the same style as the cTrader "Analyze" tab, but yours, on disk,
  versioned, and readable by Claude for review.

This is genuinely useful on its own and carries no execution risk, so it's the
first thing built in Phase 3.

## 3b. Operate (guarded execution) — opt-in, bounded

Placing and managing real orders — from your instructions, or from strategies
validated in Phases 1–2. Built behind hard rails:

- **Dry-run by default.** Every order path first logs "would place X" without
  sending, until you explicitly enable live execution.
- **Hard limits (config, enforced in code):** max position size, max open
  positions, max daily loss (auto-halt), allowed symbols, allowed trading
  hours. An order that breaches a limit is refused, not clamped silently.
- **Kill switch.** A single command/file that immediately halts new orders (and
  optionally flattens positions).
- **Demo first.** Every execution feature is proven on the demo endpoint before
  live is even configurable.
- **Full audit.** Every intended and actual order is logged with its reason.
- **You authorise scope.** Live execution is enabled only by your explicit
  configuration and go-ahead — never by default, never inferred.

## Suggested build order

1. Open API client + OAuth against **demo**, read-only. Prove connection.
2. Recording/journaling/reporting (3a) on demo, then live (read-only is safe).
3. Order execution on **demo** with all rails, dry-run first.
4. Only then, and only with your explicit configuration, live execution (3b)
   with limits and kill switch active.

## Where this plugs in

Phase 3 lives in its own module (a separate project referencing the same
`Jobs`/`Reporting` conventions), so the Open API dependency and live-trading
surface stay isolated from the Phase 1 UI-automation agent. The file-based,
inspectable, safe-by-default principles from `ROADMAP.md` apply throughout.
