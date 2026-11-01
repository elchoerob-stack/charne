"""Entry point and the autonomous cycle.

    python -m app.main accounts              # setup: list the accounts your token can see
    python -m app.main check                 # week 1: connect to the demo, print what the broker says
    python -m app.main run                   # autonomous demo trading, one evaluation per closed M15 bar
    python -m app.main replay bars.csv       # offline: M15 CSV through the paper broker and offline agents
    python -m app.main report                # performance, rejections, API spend, locks
    python -m app.main export-trades out.csv # for skills/cbot-gate/scripts/gate.py
    python -m app.main locks | unlock ID "review note"
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import logging
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from .ai_common import DecisionResult, RuleFollowerAgent
from .broker import Broker, PaperBroker
from .config import Settings, load_settings
from .consensus import build_proposal, consensus
from .execution import ExecutionService
from .journal import Journal, utcnow
from .market_data import build_snapshot
from .models import Candle, LiveAccountRefused, MarketSnapshot, Quote, SymbolSpec
from .monitoring import Notifier, export_trades, metrics, report_text
from .reconciliation import (audit_positions, lock_if_issues, startup_reconcile,
                             sync_closed_trades)
from .risk_engine import (POLICY, apply_trips, build_context, day_start, evaluate,
                          max_stop_at_min_volume)
from .strategy import find_candidate

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
                 kill_switch_path: Path | None = None, notify=None,
                 clock: Callable[[], datetime] = utcnow, sleep=asyncio.sleep):
        self.broker, self.journal, self.gpt, self.claude = broker, journal, gpt, claude
        self.kill_switch_path, self.clock = kill_switch_path, clock
        self.notify = notify or Notifier(None)
        self.execution = ExecutionService(broker, journal, kill_switch_path=kill_switch_path,
                                          clock=clock, sleep=sleep, notify=self.notify)

    async def startup(self) -> list[str]:
        await self.broker.connect()
        acct = await self.broker.account()
        if acct.is_live or not self.broker.demo_verified:
            raise LiveAccountRefused("account is not a verified demo account")
        issues = await startup_reconcile(self.broker, self.journal, self.clock())
        self.journal.event("startup", self.clock(), account=acct.account_id,
                           currency=acct.currency, balance=acct.balance, issues=issues)
        if issues:
            self.notify("Start-up reconciliation locked the bot: " + "; ".join(issues),
                        priority="high")
        return issues

    def _reject(self, stage: str, reason: str, sid: str | None = None) -> CycleResult:
        self.journal.reject(stage, reason, sid, self.clock())
        return CycleResult(stage, reason)

    async def cycle(self) -> CycleResult:
        now = self.clock()
        if not self.broker.demo_verified:
            return CycleResult("not_verified", "demo account not verified")

        # Bookkeeping first, so the breakers see every closed trade.
        await sync_closed_trades(self.broker, self.journal, now)
        issues = await audit_positions(self.broker, self.journal)
        if lock_if_issues(self.journal, issues, now):
            self.notify("Bot locked: " + "; ".join(issues), priority="high")

        snapshot, problems = await build_snapshot(self.broker, POLICY.symbol, now)
        if snapshot is None:
            return self._reject("data", "; ".join(problems))
        sid = snapshot.snapshot_id
        if self.journal.get("last_snapshot") == sid:
            return CycleResult("already_processed", sid)
        self.journal.put("last_snapshot", sid)

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

        candidate = find_candidate(snapshot)
        if candidate is None:
            return CycleResult("no_candidate", sid)
        # Don't pay for two AI opinions when even the tightest sensible stop
        # can't be traded at the broker's minimum volume.
        widest = max_stop_at_min_volume(ctx.spec, min(ctx.account.balance, ctx.account.equity),
                                        ctx.quote_to_account, snapshot.quote.mid)
        tightest = max(MIN_PLAUSIBLE_STOP_ATR * float(snapshot.features["atr14_m15"]),
                       POLICY.min_stop_spreads * snapshot.quote.spread,
                       ctx.spec.min_stop_distance)
        if widest < tightest:
            return self._reject("min_volume_precheck",
                                f"minimum volume allows a {widest:.2f} stop; the tightest "
                                f"sensible stop is {tightest:.2f}", sid)
        if self.journal.ai_evaluations_since(day_start(now)) >= MAX_AI_EVALUATIONS_PER_DAY:
            return self._reject("ai_budget", f"{MAX_AI_EVALUATIONS_PER_DAY} evaluations today", sid)

        gpt, claude = await asyncio.gather(self.gpt.decide(snapshot, candidate),
                                           self.claude.decide(snapshot, candidate))
        for r in (gpt, claude):
            self._log_ai(snapshot, r)

        result = consensus(gpt.decision, claude.decision, sid, snapshot.quote.mid)
        if not result.agreed:
            return self._reject("consensus", result.reason, sid)

        proposal = build_proposal(gpt.decision, claude.decision, sid)
        approval = evaluate(proposal, ctx)
        if not approval.allowed:
            return self._reject("risk", approval.reason, sid)

        # execution re-checks risk with a fresh quote before it sends anything
        out = await self.execution.execute(proposal, snapshot)
        self.journal.event("execution", self.clock(), snapshot_id=sid, status=out.status,
                           detail=out.detail, units=out.approval.units if out.approval else 0)
        return CycleResult(f"execution_{out.status.lower()}", out.detail)

    def _log_ai(self, s: MarketSnapshot, r: DecisionResult) -> None:
        d = r.decision
        self.journal.ai_call(snapshot_id=s.snapshot_id, provider=r.provider, model=r.model,
                             action=d.action, ok=r.ok, error=r.error,
                             decision=d.model_dump(), input_tokens=r.input_tokens,
                             output_tokens=r.output_tokens, cost_usd=r.cost_usd,
                             latency_ms=r.latency_ms, now=self.clock())

    async def run_forever(self) -> None:
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


# ---- commands ----------------------------------------------------------------------
def make_agents(s: Settings):
    from .claude_agent import ClaudeAgent
    from .gpt_agent import GPTAgent
    return (GPTAgent(s.openai_model, s.openai_api_key, s.ai_timeout_seconds,
                     usd_per_mtok_in=s.openai_usd_per_mtok_in,
                     usd_per_mtok_out=s.openai_usd_per_mtok_out),
            ClaudeAgent(s.anthropic_model, s.anthropic_api_key, s.ai_timeout_seconds,
                        usd_per_mtok_in=s.anthropic_usd_per_mtok_in,
                        usd_per_mtok_out=s.anthropic_usd_per_mtok_out))


async def cmd_accounts(s: Settings) -> int:
    from .ctrader_broker import CTraderBroker
    b = CTraderBroker(s)
    try:
        for aid, live, login in await b.list_accounts():
            print(f"{aid:>12}  {'LIVE - never use' if live else 'demo':<16}  login {login}")
    finally:
        await b.disconnect()
    print("Put the demo account's first number in CTRADER_ACCOUNT_ID and "
          "CTRADER_DEMO_ACCOUNT_ALLOWLIST.")
    return 0


async def cmd_check(s: Settings) -> int:
    from .ctrader_broker import CTraderBroker
    missing = [p for p in s.problems_for_live_run()
               if p.startswith(("CTRADER", "CTRADER_ACCOUNT"))]
    if missing:
        print("\n".join(missing))
        return 2
    b = CTraderBroker(s)
    await b.connect()
    try:
        acct = await b.account()
        spec = await b.symbol_spec("XAUUSD")
        q = await b.quote("XAUUSD")
        rate = await b.conversion_rate(spec.quote_currency, acct.currency)
        m15 = await b.candles("XAUUSD", "M15", 5)
        print(f"Account   {acct.account_id}  demo={not acct.is_live}  {acct.currency}  "
              f"balance {acct.balance:.2f}  equity {acct.equity:.2f}  leverage 1:{acct.leverage:g}")
        print(f"Symbol    {spec.model_dump()}")
        print(f"Quote     bid {q.bid} ask {q.ask} spread {q.spread:.2f} at {q.time:%H:%M:%S}Z")
        print(f"Rate      1 {spec.quote_currency} = {rate:.4f} {acct.currency}")
        for c in m15:
            print(f"M15       {c.time:%Y-%m-%d %H:%M} O {c.open} H {c.high} L {c.low} C {c.close}")
        widest = max_stop_at_min_volume(spec, min(acct.balance, acct.equity), rate, q.mid)
        print(f"\nAt {POLICY.risk_per_trade:.1%} risk, the broker minimum of {spec.min_units:g} oz "
              f"allows a stop of at most {widest:.2f} USD/oz (after spread allowance and "
              f"commission). Wider stops will be rejected for minimum volume.")
        print(f"Policy    max spread {POLICY.max_spread}, slippage allowance "
              f"{POLICY.stop_slippage_allowance}: compare with the spread above.")
    finally:
        await b.disconnect()
    return 0


async def cmd_run(s: Settings) -> int:
    from .ctrader_broker import CTraderBroker
    problems = s.problems_for_live_run()
    if problems:
        print("Cannot start:\n  " + "\n  ".join(problems))
        return 2
    gpt, claude = make_agents(s)
    bot = TradingBot(CTraderBroker(s), Journal(s.db_path), gpt, claude,
                     kill_switch_path=s.kill_switch_path, notify=Notifier(s))
    await bot.run_forever()
    return 0


def load_bars(path: Path) -> list[Candle]:
    """CSV with time,open,high,low,close (bar open time, UTC). cTrader and MT5
    exports both work once the header names are these."""
    out = []
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            r = {k.strip().lower(): v for k, v in r.items()}
            t = datetime.fromisoformat(r["time"].replace("Z", ""))
            out.append(Candle(time=t.replace(tzinfo=timezone.utc), open=float(r["open"]),
                              high=float(r["high"]), low=float(r["low"]),
                              close=float(r["close"])))
    return out


def resample_h1(m15: list[Candle]) -> list[Candle]:
    groups: dict[datetime, list[Candle]] = {}
    for c in m15:
        groups.setdefault(c.time.replace(minute=0), []).append(c)
    return [Candle(time=k, open=v[0].open, high=max(x.high for x in v),
                   low=min(x.low for x in v), close=v[-1].close)
            for k, v in sorted(groups.items())]


async def replay(bars: list[Candle], spec: SymbolSpec, *, balance: float, spread: float,
                 quote_to_account: float, journal: Journal, gpt=None, claude=None) -> dict:
    """Bar-by-bar replay through the paper broker. A plumbing and rules test,
    not a backtest: the offline agents are not the models."""
    broker = PaperBroker(spec, balance=balance, quote_to_account=quote_to_account)
    clock = {"now": bars[0].time}
    bot = TradingBot(broker, journal, gpt or RuleFollowerAgent("gpt-offline"),
                     claude or RuleFollowerAgent("claude-offline"),
                     clock=lambda: clock["now"], sleep=lambda _s: asyncio.sleep(0))
    await broker.connect()
    stages: dict[str, int] = {}
    warm = 4 * 120  # five days of H1
    for i in range(warm, len(bars)):
        bar = bars[i]
        now = bar.time + timedelta(minutes=15, seconds=CYCLE_DELAY_AFTER_CLOSE_S)
        clock["now"] = now
        broker.advance(bar, bar.time + timedelta(minutes=15))
        hist = bars[: i + 1]
        h1 = [c for c in resample_h1(hist) if c.time + timedelta(hours=1) <= now]
        broker.set_market(hist, h1, Quote(bid=round(bar.close - spread / 2, 2),
                                          ask=round(bar.close + spread / 2, 2), time=now))
        r = await bot.cycle()
        stages[r.stage] = stages.get(r.stage, 0) + 1
    return {"stages": stages, "final_balance": (await broker.account()).balance,
            "metrics": metrics(journal, balance)}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="gold-ai-bot", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("accounts")
    sub.add_parser("check")
    sub.add_parser("run")
    rp = sub.add_parser("replay")
    rp.add_argument("csv", type=Path)
    rp.add_argument("--balance", type=float, default=4000.0)
    rp.add_argument("--spread", type=float, default=0.30)
    rp.add_argument("--rate", type=float, default=17.5, help="quote->account rate, e.g. USDZAR")
    rp.add_argument("--min-units", type=float, default=1.0)
    rp.add_argument("--units-per-lot", type=float, default=100.0)
    sub.add_parser("report")
    ex = sub.add_parser("export-trades")
    ex.add_argument("path", type=Path)
    sub.add_parser("locks")
    un = sub.add_parser("unlock")
    un.add_argument("lock_id", type=int)
    un.add_argument("note")
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    s = load_settings()

    if a.cmd == "accounts":
        return asyncio.run(cmd_accounts(s))
    if a.cmd == "check":
        return asyncio.run(cmd_check(s))
    if a.cmd == "run":
        return asyncio.run(cmd_run(s))
    if a.cmd == "replay":
        spec = SymbolSpec(symbol="XAUUSD", digits=2, quote_currency="USD",
                          units_per_lot=a.units_per_lot, min_units=a.min_units,
                          max_units=a.units_per_lot * 50, step_units=a.min_units)
        out = asyncio.run(replay(load_bars(a.csv), spec, balance=a.balance, spread=a.spread,
                                 quote_to_account=a.rate, journal=Journal(":memory:")))
        print("Stages:", out["stages"])
        print(report_text(out["metrics"]))
        return 0
    j = Journal(s.db_path)
    if a.cmd == "report":
        print(report_text(metrics(j)))
    elif a.cmd == "export-trades":
        n = export_trades(j, a.path)
        print(f"{n} trades written to {a.path}. Next: python ../skills/cbot-gate/scripts/gate.py "
              f"--oos {a.path} --balance <start balance>")
    elif a.cmd == "locks":
        now = utcnow()
        for lk in j.locks():
            state = "ACTIVE" if lk.active(now) else ("released" if lk.released_at else "expired")
            created = lk.created_at.strftime("%Y-%m-%d %H:%M")
            print(f"#{lk.id} {state:<8} {lk.kind:<17} {lk.reason}  (created {created}, "
                  f"earliest release {lk.auto_release_at or 'after review'})")
    elif a.cmd == "unlock":
        print(j.release_lock(a.lock_id, a.note))
    return 0


if __name__ == "__main__":
    sys.exit(main())
