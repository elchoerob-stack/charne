"""Shadow trades: virtual trades on live data, measured in R.

Every candidate from every setup (live or shadow mode) opens a BASELINE
shadow trade at its mechanical levels, whether or not the models are asked
and whether or not the account can afford it. When the models are asked,
the baseline row records their verdict, and an agreed proposal also opens
an AI shadow trade at the AI's levels.

That answers the questions that matter before any real money:
  - Does a setup have an edge on its own?            baseline, by strategy
  - Does the AI filter pick better trades?           baseline: agreed vs vetoed
  - Are the AI's levels better than mechanical ones? ai vs baseline on the same bars
  - Is the AI worth its cost?                        the above vs the API spend in the report

Results are in R (multiples of the initial stop distance), so they don't
depend on account size. That means an R4,000 demo that can't place real
trades still collects evidence. Entry includes the spread; commission and
stop slippage are not included, so treat shadow R as slightly optimistic.
Exits: stop first when one bar touches both, then target, else close after
MAX_BARS bars.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta

from .journal import Journal, iso, parse
from .models import Candle, MarketSnapshot
from .strategy import Candidate

MAX_BARS = 96  # one trading day of M15 bars

SCHEMA = """
CREATE TABLE IF NOT EXISTS shadow_trades (
  id INTEGER PRIMARY KEY, snapshot_id TEXT NOT NULL, strategy TEXT NOT NULL,
  variant TEXT NOT NULL, side TEXT NOT NULL, entry REAL NOT NULL, stop REAL NOT NULL,
  target REAL NOT NULL, opened_at TEXT NOT NULL, bars_seen INTEGER NOT NULL DEFAULT 0,
  last_bar TEXT, ai_verdict TEXT NOT NULL DEFAULT 'not_asked', closed_at TEXT,
  exit_price REAL, result_r REAL, exit_reason TEXT, config_fp TEXT,
  UNIQUE(snapshot_id, strategy, variant));
"""


class ShadowBook:
    def __init__(self, journal: Journal):
        self.j = journal
        self.j.db.executescript(SCHEMA)

    def open(self, s: MarketSnapshot, c: Candidate, variant: str, stop: float, target: float,
             fp: str = "") -> None:
        entry = s.quote.ask if c.side == "BUY" else s.quote.bid
        bad = (stop >= entry or target <= entry) if c.side == "BUY" else \
            (stop <= entry or target >= entry)
        if bad:
            return
        try:
            self.j.db.execute(
                "INSERT INTO shadow_trades(snapshot_id, strategy, variant, side, entry, stop,"
                " target, opened_at, last_bar, config_fp) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (s.snapshot_id, c.strategy, variant, c.side, entry, stop, target,
                 iso(s.created_at), iso(s.m15[-1].time), fp))
        except sqlite3.IntegrityError:
            pass  # already recorded for this bar

    def set_verdict(self, snapshot_id: str, strategy: str, verdict: str) -> None:
        self.j.db.execute("UPDATE shadow_trades SET ai_verdict=? WHERE snapshot_id=? AND "
                          "strategy=? AND variant='baseline'", (verdict, snapshot_id, strategy))

    def update(self, bars: list[Candle], now: datetime) -> int:
        """Walk every open shadow trade through bars it hasn't seen. Returns closes."""
        closed = 0
        rows = self.j.db.execute("SELECT * FROM shadow_trades WHERE closed_at IS NULL").fetchall()
        for r in rows:
            last = parse(r["last_bar"])
            new = [b for b in bars if b.time > last]
            seen, exit_ = r["bars_seen"], None
            buy = r["side"] == "BUY"
            for b in new:
                seen += 1
                if buy:
                    if b.low <= r["stop"]:
                        exit_ = (r["stop"], "stop", b)
                    elif b.high >= r["target"]:
                        exit_ = (r["target"], "target", b)
                else:
                    if b.high >= r["stop"]:
                        exit_ = (r["stop"], "stop", b)
                    elif b.low <= r["target"]:
                        exit_ = (r["target"], "target", b)
                if exit_ is None and seen >= MAX_BARS:
                    exit_ = (b.close, "time", b)
                if exit_:
                    break
            if exit_:
                price, why, b = exit_
                risk = abs(r["entry"] - r["stop"])
                res = ((price - r["entry"]) if buy else (r["entry"] - price)) / risk
                self.j.db.execute(
                    "UPDATE shadow_trades SET closed_at=?, exit_price=?, result_r=?, exit_reason=?,"
                    " bars_seen=?, last_bar=? WHERE id=?",
                    (iso(b.time + timedelta(minutes=15)), price, round(res, 4), why, seen,
                     iso(b.time), r["id"]))
                closed += 1
            elif new:
                self.j.db.execute("UPDATE shadow_trades SET bars_seen=?, last_bar=? WHERE id=?",
                                  (seen, iso(new[-1].time), r["id"]))
        return closed

    def summary(self, fp: str | None = None) -> list[dict]:
        where, args = ("WHERE closed_at IS NOT NULL AND config_fp=?", (fp,)) if fp \
            else ("WHERE closed_at IS NOT NULL", ())
        rows = self.j.db.execute(f"SELECT * FROM shadow_trades {where}", args).fetchall()
        groups: dict[tuple, list[float]] = {}
        for r in rows:
            groups.setdefault((r["strategy"], r["variant"], "all"), []).append(r["result_r"])
            if r["variant"] == "baseline":
                groups.setdefault((r["strategy"], "baseline", r["ai_verdict"]),
                                  []).append(r["result_r"])
        out = []
        for (strat, variant, verdict), rs in sorted(groups.items()):
            wins, losses = sum(x for x in rs if x > 0), -sum(x for x in rs if x < 0)
            out.append({"strategy": strat, "variant": variant, "ai_verdict": verdict,
                        "n": len(rs), "expectancy_r": round(sum(rs) / len(rs), 3),
                        "profit_factor": round(wins / losses, 2) if losses else None,
                        "total_r": round(sum(rs), 2)})
        return out

    def rows(self, strategy: str | None, variant: str, fp: str | None) -> list[sqlite3.Row]:
        q = "SELECT * FROM shadow_trades WHERE closed_at IS NOT NULL AND variant=?"
        args: list = [variant]
        if strategy:
            q += " AND strategy=?"
            args.append(strategy)
        if fp:
            q += " AND config_fp=?"
            args.append(fp)
        return self.j.db.execute(q + " ORDER BY closed_at", args).fetchall()
