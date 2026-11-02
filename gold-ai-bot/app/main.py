"""Command line.

    python -m app.main accounts              # setup: list the accounts your token can see
    python -m app.main check                 # week 1: connect to the demo, print what the broker says
    python -m app.main check-ai              # week 3: one real call to each model; both must pass
    python -m app.main run                   # autonomous demo trading, one evaluation per closed M15 bar
    python -m app.main health                # watchdog: exit 1 and alert if the bot has stalled
    python -m app.main replay bars.csv       # offline: M15 CSV through the paper broker and offline agents
    python -m app.main report [--all]        # performance, shadow evidence, rejections, API spend, locks
    python -m app.main export-trades out.csv # for skills/cbot-gate/scripts/gate.py
    python -m app.main export-shadow out.csv # shadow trades in R, same format
    python -m app.main locks | unlock ID "review note"
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .ai_common import RuleFollowerAgent, preflight
from .bot import CYCLE_DELAY_AFTER_CLOSE_S, TradingBot
from .broker import PaperBroker
from .config import Settings, load_settings
from .fingerprint import components, fingerprint
from .journal import Journal, parse, utcnow
from .models import Candle, Quote, SymbolSpec
from .monitoring import Notifier, export_shadow, export_trades, metrics, report_text
from .risk_engine import POLICY, max_stop_at_min_volume
from .shadow import ShadowBook

log = logging.getLogger("gold-ai-bot")
HEALTH_MAX_AGE_MIN = 25  # a cycle runs every 15 minutes


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


async def cmd_check_ai(s: Settings) -> int:
    missing = [p for p in s.problems_for_live_run() if p.startswith(("OPENAI", "ANTHROPIC"))]
    if missing:
        print("\n".join(missing))
        return 2
    failed = 0
    for agent in make_agents(s):
        err = await preflight(agent)
        print(f"{agent.provider:<10} {agent.model:<22} {'OK' if not err else 'FAILED: ' + err}")
        failed += bool(err)
    return 1 if failed else 0


async def cmd_run(s: Settings) -> int:
    from .ctrader_broker import CTraderBroker
    problems = s.problems_for_live_run()
    if problems:
        print("Cannot start:\n  " + "\n  ".join(problems))
        return 2
    gpt, claude = make_agents(s)
    errors = [e for e in await asyncio.gather(preflight(gpt), preflight(claude)) if e]
    if errors:  # a wrong or retired model ID fails here, not silently as HOLD forever
        print("Cannot start, model preflight failed:\n  " + "\n  ".join(errors))
        return 2
    notify = Notifier(s)
    fp = fingerprint(s.openai_model, s.anthropic_model)
    log.info("test-period fingerprint %s", fp)
    bot = TradingBot(CTraderBroker(s), Journal(s.db_path), gpt, claude, config_fp=fp,
                     kill_switch_path=s.kill_switch_path, blackouts_path=s.blackouts_path,
                     health_path=s.health_path,
                     shadow_ai_when_untradeable=s.shadow_ai_when_untradeable, notify=notify)
    await bot.run_forever()
    return 0


def cmd_health(s: Settings, max_age_min: float = HEALTH_MAX_AGE_MIN) -> int:
    """For Windows Task Scheduler / cron every 15 minutes. The bot can't report
    its own death, so something outside it has to notice."""
    notify = Notifier(s)
    try:
        h = json.loads(s.health_path.read_text())
    except (OSError, ValueError) as e:
        msg = f"Gold bot health file missing or unreadable ({e}); is the bot running?"
        print(msg)
        notify(msg, priority="high")
        return 1
    age = (utcnow() - parse(h["time"])).total_seconds() / 60
    print(json.dumps(h, indent=1))
    if age > max_age_min:
        msg = f"Gold bot stalled: last cycle {age:.0f} min ago (stage {h['stage']})"
        print(msg)
        notify(msg, priority="high")
        return 1
    if h.get("error"):
        print(f"Last cycle errored: {h['error']}")
        return 1
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
                     claude or RuleFollowerAgent("claude-offline"), config_fp="replay",
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


def current_fp(s: Settings, j: Journal) -> str:
    return j.get("config_fp") or fingerprint(s.openai_model, s.anthropic_model)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="gold-ai-bot", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("accounts")
    sub.add_parser("check")
    sub.add_parser("check-ai")
    sub.add_parser("run")
    hp = sub.add_parser("health")
    hp.add_argument("--max-age-min", type=float, default=HEALTH_MAX_AGE_MIN)
    sub.add_parser("fingerprint")
    rp = sub.add_parser("replay")
    rp.add_argument("csv", type=Path)
    rp.add_argument("--balance", type=float, default=4000.0)
    rp.add_argument("--spread", type=float, default=0.30)
    rp.add_argument("--rate", type=float, default=17.5, help="quote->account rate, e.g. USDZAR")
    rp.add_argument("--min-units", type=float, default=1.0)
    rp.add_argument("--units-per-lot", type=float, default=100.0)
    rp.add_argument("--export-shadow", type=Path, default=None,
                    help="write the ICT setup's mechanical results (R) for cbot-gate")
    rp.add_argument("--strategy", default="ict_2022")
    rep = sub.add_parser("report")
    rep.add_argument("--all", action="store_true", help="include earlier test periods")
    ex = sub.add_parser("export-trades")
    ex.add_argument("path", type=Path)
    ex.add_argument("--all", action="store_true")
    es = sub.add_parser("export-shadow")
    es.add_argument("path", type=Path)
    es.add_argument("--strategy", default=None)
    es.add_argument("--variant", default="baseline", choices=["baseline", "ai"])
    es.add_argument("--all", action="store_true")
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
    if a.cmd == "check-ai":
        return asyncio.run(cmd_check_ai(s))
    if a.cmd == "run":
        return asyncio.run(cmd_run(s))
    if a.cmd == "health":
        return cmd_health(s, a.max_age_min)
    if a.cmd == "fingerprint":
        print(fingerprint(s.openai_model, s.anthropic_model))
        print(json.dumps(components(s.openai_model, s.anthropic_model), indent=1, default=str))
        return 0
    if a.cmd == "replay":
        spec = SymbolSpec(symbol="XAUUSD", digits=2, quote_currency="USD",
                          units_per_lot=a.units_per_lot, min_units=a.min_units,
                          max_units=a.units_per_lot * 50, step_units=a.min_units)
        rj = Journal(":memory:")
        out = asyncio.run(replay(load_bars(a.csv), spec, balance=a.balance, spread=a.spread,
                                 quote_to_account=a.rate, journal=rj))
        print("Stages:", out["stages"])
        print(report_text(out["metrics"]))
        if a.export_shadow:
            n = export_shadow(ShadowBook(rj), a.export_shadow, a.strategy, "baseline", None)
            print(f"\n{n} {a.strategy} trades (R) written to {a.export_shadow}. Gate them with:\n"
                  f"  python ../skills/cbot-gate/scripts/gate.py --oos {a.export_shadow} "
                  f"--balance 100")
        return 0
    j = Journal(s.db_path)
    fp = None if getattr(a, "all", False) else current_fp(s, j)
    if a.cmd == "report":
        print(f"Test period {fp or 'ALL'}" + (f" since {j.get('config_fp_since')}"
                                              if fp and j.get("config_fp_since") else ""))
        print(report_text(metrics(j, config_fp=fp)))
    elif a.cmd == "export-shadow":
        n = export_shadow(ShadowBook(j), a.path, a.strategy, a.variant, fp)
        print(f"{n} shadow trades (R units) written to {a.path}. Check with: python "
              f"../skills/cbot-gate/scripts/gate.py --oos {a.path} --balance 100")
    elif a.cmd == "export-trades":
        n = export_trades(j, a.path, fp)
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
