"""Performance report, cbot-gate export and phone alerts."""

from __future__ import annotations

import csv
import json
import re
import logging
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from .config import Settings
from .journal import Journal, parse

log = logging.getLogger("gold-ai-bot")

EVIDENCE_MIN_TRADES = 100  # minimum before any conclusion about the edge


def metrics(journal: Journal, start_balance: float | None = None,
            config_fp: str | None = None) -> dict:
    """config_fp limits trades, AI calls and shadow results to one test period."""
    trades = journal.trades_for_config(config_fp) if config_fp else journal.trades()
    nets = [t["net"] for t in trades]
    wins = [n for n in nets if n > 0]
    losses = [n for n in nets if n < 0]
    gross_win, gross_loss = sum(wins), -sum(losses)
    peak = run = start_balance or 0.0
    max_dd = 0.0
    for n in nets:
        run += n
        peak = max(peak, run)
        max_dd = max(max_dd, peak - run)
    rej = Counter(r["stage"] + ": " + re.sub(r"(?<![A-Za-z])-?\d+(\.\d+)?", "#", r["reason"])[:90]
                  for r in journal.db.execute("SELECT stage, reason FROM rejections"))
    where, args = ("WHERE config_fp=?", (config_fp,)) if config_fp else ("", ())
    ai = journal.db.execute(
        "SELECT provider, COUNT(*) n, SUM(ok) ok, SUM(input_tokens) tin, SUM(output_tokens) tout,"
        f" SUM(cost_usd) usd, AVG(latency_ms) ms FROM ai_calls {where} GROUP BY provider",
        args).fetchall()
    evals = journal.db.execute(f"SELECT COUNT(DISTINCT snapshot_id) FROM ai_calls {where}",
                               args).fetchone()[0]
    ai_usd = sum((r["usd"] or 0) for r in ai)
    from .shadow import ShadowBook
    shadow = ShadowBook(journal).summary(config_fp)
    costs = sum(t["commission"] + t["swap"] for t in trades)
    out = {
        "trades": len(nets),
        "wins": len(wins),
        "win_rate": round(len(wins) / len(nets), 3) if nets else None,
        "net": round(sum(nets), 2),
        "costs_commission_swap": round(costs, 2),
        "expectancy_per_trade": round(sum(nets) / len(nets), 2) if nets else None,
        "profit_factor": round(gross_win / gross_loss, 2) if gross_loss else None,
        "max_drawdown": round(max_dd, 2),
        "max_drawdown_pct": round(100 * max_dd / peak, 2) if start_balance and peak else None,
        "ai_evaluations": evals,
        "ai_cost_usd": round(ai_usd, 2),
        "ai_cost_usd_per_trade": round(ai_usd / len(nets), 2) if nets else None,
        "shadow": shadow,
        "ai_by_provider": [dict(r) for r in ai],
        "rejections": dict(rej.most_common(15)),
        "active_locks": [f"#{lk.id} {lk.kind}: {lk.reason}" for lk in journal.locks()
                         if lk.released_at is None],
    }
    ok = out["trades"] >= EVIDENCE_MIN_TRADES and (out["expectancy_per_trade"] or 0) > 0
    out["evidence"] = ("meets the minimum threshold (still not proof of future returns)" if ok
                       else f"not yet: {out['trades']}/{EVIDENCE_MIN_TRADES} trades, "
                            f"expectancy {out['expectancy_per_trade']}")
    return out


def report_text(m: dict, currency: str = "") -> str:
    lines = [
        f"Trades           {m['trades']}  (wins {m['wins']}, win rate {m['win_rate']})",
        f"Net              {m['net']} {currency}  (commission+swap {m['costs_commission_swap']})",
        f"Expectancy/trade {m['expectancy_per_trade']}",
        f"Profit factor    {m['profit_factor']}",
        f"Max drawdown     {m['max_drawdown']} ({m['max_drawdown_pct']}%)",
        f"AI evaluations   {m['ai_evaluations']}",
    ]
    for p in m["ai_by_provider"]:
        lines.append(f"  {p['provider']:<10} calls {p['n']}, ok {p['ok']}, tokens "
                     f"{p['tin']}/{p['tout']}, ${(p['usd'] or 0):.2f}, avg {int(p['ms'] or 0)} ms")
    lines.append(f"AI spend         ${m['ai_cost_usd']} total, ${m['ai_cost_usd_per_trade']} per "
                 "real trade (compare with expectancy after converting to USD)")
    lines.append("Shadow trades (R; entry includes spread, excludes commission)")
    if m["shadow"]:
        lines.append(f"  {'setup':<16}{'variant':<10}{'AI verdict':<11}{'n':>5}"
                     f"{'exp R':>8}{'PF':>7}{'total R':>9}")
        for r in m["shadow"]:
            lines.append(f"  {r['strategy']:<16}{r['variant']:<10}{r['ai_verdict']:<11}"
                         f"{r['n']:>5}{r['expectancy_r']:>8}{str(r['profit_factor']):>7}"
                         f"{r['total_r']:>9}")
    else:
        lines.append("  none closed yet")
    lines.append("Top rejections")
    lines += [f"  {n:>5}  {k}" for k, n in m["rejections"].items()] or ["  none"]
    lines.append("Locks            " + ("; ".join(m["active_locks"]) or "none"))
    lines.append(f"Evidence         {m['evidence']}")
    return "\n".join(lines)


def export_trades(journal: Journal, path: Path, config_fp: str | None = None) -> int:
    """CSV that skills/cbot-gate/scripts/gate.py reads directly."""
    rows = journal.trades_for_config(config_fp) if config_fp else journal.trades()
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["Closing Time", "Net Profit", "Direction", "Units", "Entry", "Exit",
                    "Commission", "Swap", "Position"])
        for t in rows:
            ct = parse(t["close_time"])
            w.writerow([ct.strftime("%Y-%m-%d %H:%M"), f"{t['net']:.2f}", t["side"],
                        t["units"], t["entry_price"], t["exit_price"], t["commission"],
                        t["swap"], t["position_id"]])
    return len(rows)


def export_shadow(book, path: Path, strategy: str | None, variant: str,
                  config_fp: str | None) -> int:
    """Shadow trades in R as 'Net Profit', for cbot-gate. With --balance 100,
    1R reads as 1% in its drawdown figures."""
    rows = book.rows(strategy, variant, config_fp)
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["Closing Time", "Net Profit", "Direction", "Setup", "AI verdict", "Exit"])
        for r in rows:
            w.writerow([parse(r["closed_at"]).strftime("%Y-%m-%d %H:%M"), f"{r['result_r']:.4f}",
                        r["side"], r["strategy"], r["ai_verdict"], r["exit_reason"]])
    return len(rows)


class Notifier:
    """Phone alerts through ntfy and/or a webhook (e.g. a Zapier Catch Hook),
    configured exactly like Foreman. Never raises: an alert failing must not
    stop the bot from managing risk."""

    def __init__(self, settings: Settings | None = None):
        self.s = settings

    def __call__(self, message: str, priority: str = "default", title: str = "Gold AI bot"):
        log.info("ALERT %s", message)
        s = self.s
        if s is None:
            return
        try:
            if s.ntfy_topic:
                req = urllib.request.Request(
                    f"{s.ntfy_server.rstrip('/')}/{s.ntfy_topic}", data=message.encode(),
                    headers={"Title": title, "Priority": priority,
                             **({"Authorization": f"Bearer {s.ntfy_token}"} if s.ntfy_token
                                else {})})
                urllib.request.urlopen(req, timeout=10).read()
            if s.notify_webhook_url:
                body = json.dumps({"title": title, "message": message, "priority": priority,
                                   "time": datetime.now(timezone.utc).isoformat()}).encode()
                req = urllib.request.Request(s.notify_webhook_url, data=body,
                                             headers={"Content-Type": "application/json"})
                urllib.request.urlopen(req, timeout=10).read()
        except Exception as e:  # noqa: BLE001
            log.warning("alert failed: %s", e)
