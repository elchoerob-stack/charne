"""Performance report, cbot-gate export and phone alerts."""

from __future__ import annotations

import csv
import json
import logging
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from .config import Settings
from .journal import Journal, parse

log = logging.getLogger("gold-ai-bot")

EVIDENCE_MIN_TRADES = 100  # minimum before any conclusion about the edge


def metrics(journal: Journal, start_balance: float | None = None) -> dict:
    trades = journal.trades()
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
    rej = Counter(r["stage"] + ": " + r["reason"].split(":")[0]
                  for r in journal.db.execute("SELECT stage, reason FROM rejections"))
    ai = journal.db.execute(
        "SELECT provider, COUNT(*) n, SUM(ok) ok, SUM(input_tokens) tin, SUM(output_tokens) tout,"
        " SUM(cost_usd) usd, AVG(latency_ms) ms FROM ai_calls GROUP BY provider").fetchall()
    evals = journal.db.execute("SELECT COUNT(DISTINCT snapshot_id) FROM ai_calls").fetchone()[0]
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
    lines.append("Top rejections")
    lines += [f"  {n:>5}  {k}" for k, n in m["rejections"].items()] or ["  none"]
    lines.append("Locks            " + ("; ".join(m["active_locks"]) or "none"))
    lines.append(f"Evidence         {m['evidence']}")
    return "\n".join(lines)


def export_trades(journal: Journal, path: Path) -> int:
    """CSV that skills/cbot-gate/scripts/gate.py reads directly."""
    rows = journal.trades()
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
