"""The autonomous cycle, run once per closed M15 bar.

 1. Demo account verified, or stop.
 2. Bookkeeping: sync closed trades, audit positions (missing stop, foreign
    position, late fill).
 3. Snapshot built and validated; one snapshot id per bar.
 4. Shadow book: advance open shadow trades, open a baseline shadow trade for
    every candidate from every setup. This happens even when the bot is
    locked or can't afford a trade, so evidence keeps accumulating.
 5. News blackout, circuit breakers, kill switch, open position: stop here,
    before any AI spend.
 6. Live candidate? Minimum-volume feasibility? Daily AI budget?
 7. Both models in parallel on the same frozen snapshot.
 8. Consensus, then evidence check of both models' claims against the data.
 9. Risk engine.
10. Execution, which re-checks everything with a fresh quote.
Every cycle writes data/health.json for the external watchdog (`health`).
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable

from . import blackouts, evidence
from .ai_common import DecisionResult
from .broker import Broker
from .consensus import build_proposal, consensus
from .execution import ExecutionService
from .journal import Journal, utcnow
from .market_data import build_snapshot
from .models import LiveAccountRefused, MarketSnapshot
from .monitoring import Notifier
from .reconciliation import (audit_positions, lock_if_issues, startup_reconcile,
                             sync_closed_trades)
from .risk_engine import POLICY, apply_trips, build_context, day_start, evaluate, \
    max_stop_at_min_volume
from .shadow import ShadowBook
from .strategy import find_candidates

log = logging.getLogger("gold-ai-bot")

MAX_AI_EVALUATIONS_PER_DAY = 30   # API spend ceiling; at most 96 M15 bars a day exist
MIN_PLAUSIBLE_STOP_ATR = 0.5      # no structural M15 stop is tighter than half an ATR
CYCLE_DELAY_AFTER_CLOSE_S = 5     # let the broker finish the bar


@dataclass
class CycleResult:
    stage: str
    detail: str = ""


class TradingBot:
    def __init__(self, broker: Broker, journal: Journal, gpt, claude, *,
                 config_fp: str = "", kill_switch_path: Path | None = None,
                 blackouts_path: Path | None = None, health_path: Path | None = None,
                 shadow_ai_when_untradeable: bool = False, notify=None,
                 clock: Callable[[], datetime] = utcnow, sleep=asyncio.sleep):
        self.broker, self.journal, self.gpt, self.claude = broker, journal, gpt, claude
        self.config_fp = config_fp
        self.kill_switch_path, self.blackouts_path = kill_switch_path, blackouts_path
        self.health_path = health_path
        self.shadow_ai_when_untradeable = shadow_ai_when_untradeable
        self.clock = clock
        self.notify = notify or Notifier(None)
        self.shadow = ShadowBook(journal)
        self.execution = ExecutionService(broker, journal, kill_switch_path=kill_switch_path,
                                          clock=clock, sleep=sleep, notify=self.notify,
                                          config_fp=config_fp)

    # ---- start-up --------------------------------------------------------------
    async def startup(self) -> list[str]:
        await self.broker.connect()
        acct = await self.broker.account()
        if acct.is_live or not self.broker.demo_verified:
            raise LiveAccountRefused("account is not a verified demo account")
        now = self.clock()
        previous = self.journal.get("config_fp")
        if previous != self.config_fp:
            self.journal.put("config_fp", self.config_fp)
            self.journal.put("config_fp_since", now.isoformat())
            self.journal.event("new_test_period", now, previous=previous, current=self.config_fp)
            if previous:
                self.notify(f"Configuration changed ({previous} -> {self.config_fp}): "
                            "a new test period starts; earlier results are reported separately.")
        issues = await startup_reconcile(self.broker, self.journal, now)
        self.journal.event("startup", now, account=acct.account_id, currency=acct.currency,
                           balance=acct.balance, issues=issues, config_fp=self.config_fp)
        if issues:
            self.notify("Start-up reconciliation locked the bot: " + "; ".join(issues),
                        priority="high")
        return issues

    # ---- one cycle ---------------------------------------------------------------
    def _reject(self, stage: str, reason: str, sid: str | None = None) -> CycleResult:
        self.journal.reject(stage, reason, sid, self.clock())
        return CycleResult(stage, reason)

    async def cycle(self) -> CycleResult:
        try:
            r = await self._cycle()
            self._health(r, "")
            return r
        except Exception as e:
            self._health(CycleResult("error"), repr(e))
            raise

    def _health(self, r: CycleResult, error: str) -> None:
        if self.health_path is None:
            return
        now = self.clock()
        data = {"time": now.isoformat(), "stage": r.stage, "detail": r.detail[:300],
                "error": error[:300], "demo_verified": self.broker.demo_verified,
                "config_fp": self.config_fp,
                "active_locks": [f"#{lk.id} {lk.kind}" for lk in self.journal.active_locks(now)]}
        try:
            self.health_path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.health_path.with_suffix(".tmp")
            tmp.write_text(json.dumps(data, indent=1))
            tmp.replace(self.health_path)
        except OSError as e:
            log.warning("could not write health file: %s", e)

    async def _cycle(self) -> CycleResult:
        now = self.clock()
        if not self.broker.demo_verified:
            return CycleResult("not_verified", "demo account not verified")

        await sync_closed_trades(self.broker, self.journal, now)
        issues = await audit_positions(self.broker, self.journal, self.notify)
        if lock_if_issues(self.journal, issues, now):
            self.notify("Bot locked: " + "; ".join(issues), priority="high")

        snapshot, problems = await build_snapshot(self.broker, POLICY.symbol, now)
        if snapshot is None:
            return self._reject("data", "; ".join(problems))
        sid = snapshot.snapshot_id
        if self.journal.get("last_snapshot") == sid:
            return CycleResult("already_processed", sid)
        self.journal.put("last_snapshot", sid)

        # Shadow book first: evidence accrues whatever happens next.
        self.shadow.update(snapshot.m15, now)
        blackout = blackouts.active(now, self.blackouts_path)
        candidates = [] if blackout else find_candidates(snapshot)
        for c in candidates:
            self.shadow.open(snapshot, c, "baseline", c.stop, c.target, self.config_fp)
        if blackout:
            return self._reject("blackout", blackout, sid)

        ctx = await build_context(self.broker, self.journal, now=now,
                                  snapshot_created_at=snapshot.created_at,
                                  kill_switch_path=self.kill_switch_path)
        for t in apply_trips(self.journal, ctx):
            self.notify(f"Circuit breaker: {t.kind} ({t.reason})", priority="high")
        if ctx.active_locks:  # no point paying for AI opinions we cannot act on
            return CycleResult("locked", "; ".join(lk.kind for lk in ctx.active_locks))
        if ctx.kill_switch:
            return self._reject("kill_switch", "KILL file present", sid)
        if ctx.open_positions or ctx.pending_orders:
            return CycleResult("position_open", f"{len(ctx.open_positions)} open")

        live = next((c for c in candidates if c.mode == "live"), None)
        if live is None:
            return CycleResult("no_candidate", sid)

        # Feasibility: can the broker minimum be traded with any sensible stop?
        widest = max_stop_at_min_volume(ctx.spec, min(ctx.account.balance, ctx.account.equity),
                                        ctx.quote_to_account, snapshot.quote.mid)
        tightest = max(MIN_PLAUSIBLE_STOP_ATR * float(snapshot.features["atr14_m15"]),
                       POLICY.min_stop_spreads * snapshot.quote.spread,
                       ctx.spec.min_stop_distance)
        infeasible = "" if widest >= tightest else (
            f"minimum volume allows a {widest:.2f} stop; the tightest sensible stop is "
            f"{tightest:.2f}")
        if infeasible and not self.shadow_ai_when_untradeable:
            return self._reject("min_volume_precheck", infeasible, sid)
        if self.journal.ai_evaluations_since(day_start(now)) >= MAX_AI_EVALUATIONS_PER_DAY:
            return self._reject("ai_budget", f"{MAX_AI_EVALUATIONS_PER_DAY} evaluations today", sid)

        gpt, claude = await asyncio.gather(self.gpt.decide(snapshot, live),
                                           self.claude.decide(snapshot, live))
        for r in (gpt, claude):
            self._log_ai(snapshot, r)

        result = consensus(gpt.decision, claude.decision, sid, snapshot.quote.mid)
        proof = []
        if result.agreed:
            proof = [f"gpt: {p}" for p in evidence.check(gpt.decision, snapshot)] + \
                    [f"claude: {p}" for p in evidence.check(claude.decision, snapshot)]
        agreed = result.agreed and not proof
        self.shadow.set_verdict(sid, live.strategy, "agreed" if agreed else "vetoed")
        if agreed:
            proposal = build_proposal(gpt.decision, claude.decision, sid)
            self.shadow.open(snapshot, live, "ai", proposal.stop_loss, proposal.take_profit,
                             self.config_fp)
        if not result.agreed:
            return self._reject("consensus", result.reason, sid)
        if proof:
            return self._reject("evidence", "; ".join(proof), sid)
        if infeasible:
            return self._reject("min_volume_precheck", infeasible + " (AI shadow only)", sid)

        approval = evaluate(proposal, ctx)
        if not approval.allowed:
            return self._reject("risk", approval.reason, sid)

        out = await self.execution.execute(proposal, snapshot)  # re-checks with a fresh quote
        self.journal.event("execution", self.clock(), snapshot_id=sid, status=out.status,
                           detail=out.detail, units=out.approval.units if out.approval else 0)
        return CycleResult(f"execution_{out.status.lower()}", out.detail)

    def _log_ai(self, s: MarketSnapshot, r: DecisionResult) -> None:
        d = r.decision
        self.journal.ai_call(snapshot_id=s.snapshot_id, provider=r.provider, model=r.model,
                             action=d.action, ok=r.ok, error=r.error,
                             decision=d.model_dump(), input_tokens=r.input_tokens,
                             output_tokens=r.output_tokens, cost_usd=r.cost_usd,
                             latency_ms=r.latency_ms, config_fp=self.config_fp,
                             now=self.clock())

    # ---- supervisor loop -------------------------------------------------------------
    async def run_forever(self) -> None:
        """Reconnects with backoff. A reconnect re-runs start-up reconciliation
        but never clears a lock: locks only end by time or by review."""
        backoff = 5
        while True:
            try:
                if not self.broker.demo_verified:
                    await self.startup()
                    backoff = 5
                now = self.clock()
                next_close = now.replace(second=0, microsecond=0) + timedelta(
                    minutes=15 - now.minute % 15)
                await asyncio.sleep((next_close - now).total_seconds() + CYCLE_DELAY_AFTER_CLOSE_S)
                r = await self.cycle()
                log.info("%s %s", r.stage, r.detail)
            except LiveAccountRefused as e:
                self.notify(f"REFUSED: {e}", priority="urgent")
                raise
            except Exception as e:  # noqa: BLE001  keep running, but loudly
                log.exception("cycle failed")
                self.journal.event("cycle_error", self.clock(), error=repr(e))
                self.notify(f"Cycle error: {e!r}", priority="high")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 300)
