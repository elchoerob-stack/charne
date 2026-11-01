"""Persistent ledger and audit log (SQLite, standard library).

Everything that matters survives a restart: orders (written BEFORE they are
sent), closed trades, circuit-breaker locks, every AI answer and every
rejection. If the process dies mid-order, the next start finds the PENDING row
and reconciles it against the broker instead of guessing.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from .models import ClosedTrade

SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, ts TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ai_calls (
  id INTEGER PRIMARY KEY, ts TEXT NOT NULL, snapshot_id TEXT NOT NULL,
  provider TEXT NOT NULL, model TEXT NOT NULL, action TEXT NOT NULL,
  ok INTEGER NOT NULL, error TEXT, decision TEXT,
  input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0, latency_ms INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS rejections (
  id INTEGER PRIMARY KEY, ts TEXT NOT NULL, snapshot_id TEXT, stage TEXT NOT NULL,
  reason TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orders (
  client_order_id TEXT PRIMARY KEY, ts TEXT NOT NULL, snapshot_id TEXT NOT NULL,
  side TEXT NOT NULL, units REAL NOT NULL, entry_reference REAL NOT NULL,
  stop_loss REAL NOT NULL, take_profit REAL NOT NULL, risk_amount REAL NOT NULL,
  state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 1,
  position_id TEXT, fill_price REAL, detail TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS trades (
  position_id TEXT PRIMARY KEY, client_order_id TEXT, symbol TEXT NOT NULL,
  side TEXT NOT NULL, units REAL NOT NULL, entry_price REAL NOT NULL,
  exit_price REAL NOT NULL, open_time TEXT, close_time TEXT NOT NULL,
  gross REAL NOT NULL, commission REAL NOT NULL, swap REAL NOT NULL, net REAL NOT NULL);
CREATE TABLE IF NOT EXISTS locks (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, reason TEXT NOT NULL,
  created_at TEXT NOT NULL, auto_release_at TEXT, requires_review INTEGER NOT NULL,
  released_at TEXT, release_note TEXT);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""

# Order states. ABSENT = confirmed with the broker that the order never landed.
PENDING, FILLED, REJECTED, UNKNOWN, ABSENT = "PENDING", "FILLED", "REJECTED", "UNKNOWN", "ABSENT"
OPEN_STATES = (PENDING, UNKNOWN)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime | None) -> str | None:
    return dt.astimezone(timezone.utc).isoformat() if dt else None


def parse(ts: str | None) -> datetime | None:
    return datetime.fromisoformat(ts) if ts else None


@dataclass
class Lock:
    id: int
    kind: str
    reason: str
    created_at: datetime
    auto_release_at: datetime | None
    requires_review: bool
    released_at: datetime | None

    def active(self, now: datetime) -> bool:
        if self.released_at is not None:
            return False
        if self.requires_review:
            return True
        return self.auto_release_at is None or now < self.auto_release_at


class Journal:
    def __init__(self, path: str | Path = ":memory:"):
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path), isolation_level=None)  # autocommit
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript(SCHEMA)
        self._ensure_column("orders", "config_fp", "TEXT")
        self._ensure_column("ai_calls", "config_fp", "TEXT")

    def _ensure_column(self, table: str, column: str, decl: str) -> None:
        """Forward-only migration for journals created by an older version."""
        cols = {r[1] for r in self.db.execute(f"PRAGMA table_info({table})")}
        if column not in cols:
            self.db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")

    # ---- audit ---------------------------------------------------------------
    def event(self, event_kind: str, now: datetime | None = None, /, **data) -> None:
        self.db.execute("INSERT INTO events(ts, kind, data) VALUES (?,?,?)",
                        (iso(now or utcnow()), event_kind, json.dumps(data, default=str)))

    def reject(self, stage: str, reason: str, snapshot_id: str | None = None,
               now: datetime | None = None) -> None:
        self.db.execute("INSERT INTO rejections(ts, snapshot_id, stage, reason) VALUES (?,?,?,?)",
                        (iso(now or utcnow()), snapshot_id, stage, reason))

    def ai_call(self, *, snapshot_id: str, provider: str, model: str, action: str, ok: bool,
                error: str = "", decision: dict | None = None, input_tokens: int = 0,
                output_tokens: int = 0, cost_usd: float = 0.0, latency_ms: int = 0,
                config_fp: str = "", now: datetime | None = None) -> None:
        self.db.execute(
            "INSERT INTO ai_calls(ts, snapshot_id, provider, model, action, ok, error, decision,"
            " input_tokens, output_tokens, cost_usd, latency_ms, config_fp)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (iso(now or utcnow()), snapshot_id, provider, model, action, int(ok), error,
             json.dumps(decision) if decision else None, input_tokens, output_tokens,
             cost_usd, latency_ms, config_fp))

    def ai_evaluations_since(self, since: datetime) -> int:
        row = self.db.execute("SELECT COUNT(DISTINCT snapshot_id) FROM ai_calls WHERE ts >= ?",
                              (iso(since),)).fetchone()
        return int(row[0])

    # ---- orders --------------------------------------------------------------
    def get_order(self, client_order_id: str) -> sqlite3.Row | None:
        return self.db.execute("SELECT * FROM orders WHERE client_order_id = ?",
                               (client_order_id,)).fetchone()

    def record_order(self, *, client_order_id: str, snapshot_id: str, side: str, units: float,
                     entry_reference: float, stop_loss: float, take_profit: float,
                     risk_amount: float, config_fp: str = "",
                     now: datetime | None = None) -> None:
        """Write-ahead: the row exists before the order is sent. A second insert
        with the same id raises, which is what stops duplicate orders. There is
        no retry path: one bar, one attempt."""
        ts = iso(now or utcnow())
        self.db.execute(
            "INSERT INTO orders(client_order_id, ts, snapshot_id, side, units, entry_reference,"
            " stop_loss, take_profit, risk_amount, state, updated_at, config_fp)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (client_order_id, ts, snapshot_id, side, units, entry_reference, stop_loss,
             take_profit, risk_amount, PENDING, ts, config_fp))

    def set_order_state(self, client_order_id: str, state: str, *, position_id: str = "",
                        fill_price: float | None = None, detail: str = "",
                        now: datetime | None = None) -> None:
        self.db.execute(
            "UPDATE orders SET state=?, position_id=COALESCE(NULLIF(?, ''), position_id),"
            " fill_price=COALESCE(?, fill_price), detail=?, updated_at=? WHERE client_order_id=?",
            (state, position_id, fill_price, detail, iso(now or utcnow()), client_order_id))

    def orders_in_states(self, states: tuple[str, ...]) -> list[sqlite3.Row]:
        q = ",".join("?" * len(states))
        return self.db.execute(f"SELECT * FROM orders WHERE state IN ({q})", states).fetchall()

    def orders_opened_since(self, since: datetime) -> int:
        row = self.db.execute("SELECT COUNT(*) FROM orders WHERE state=? AND ts >= ?",
                              (FILLED, iso(since))).fetchone()
        return int(row[0])

    def client_order_for_position(self, position_id: str) -> str | None:
        row = self.db.execute("SELECT client_order_id FROM orders WHERE position_id=?",
                              (position_id,)).fetchone()
        return row[0] if row else None

    # ---- trades --------------------------------------------------------------
    def add_trade(self, t: ClosedTrade) -> bool:
        """Idempotent on position_id. Returns True if the trade is new."""
        cur = self.db.execute(
            "INSERT OR IGNORE INTO trades(position_id, client_order_id, symbol, side, units,"
            " entry_price, exit_price, open_time, close_time, gross, commission, swap, net)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (t.position_id, self.client_order_for_position(t.position_id) or t.label or None,
             t.symbol, t.side, t.units, t.entry_price, t.exit_price, iso(t.open_time),
             iso(t.close_time), t.gross, t.commission, t.swap, t.net))
        return cur.rowcount == 1

    def trades_for_config(self, config_fp: str) -> list[sqlite3.Row]:
        return self.db.execute(
            "SELECT t.* FROM trades t JOIN orders o ON o.client_order_id = t.client_order_id"
            " WHERE o.config_fp = ? ORDER BY t.close_time", (config_fp,)).fetchall()

    def trades(self, since: datetime | None = None) -> list[sqlite3.Row]:
        if since is None:
            return self.db.execute("SELECT * FROM trades ORDER BY close_time").fetchall()
        return self.db.execute("SELECT * FROM trades WHERE close_time >= ? ORDER BY close_time",
                               (iso(since),)).fetchall()

    # ---- locks ---------------------------------------------------------------
    def add_lock(self, kind: str, reason: str, *, requires_review: bool,
                 auto_release_at: datetime | None, now: datetime | None = None) -> int:
        cur = self.db.execute(
            "INSERT INTO locks(kind, reason, created_at, auto_release_at, requires_review)"
            " VALUES (?,?,?,?,?)",
            (kind, reason, iso(now or utcnow()), iso(auto_release_at), int(requires_review)))
        return int(cur.lastrowid)

    def locks(self) -> list[Lock]:
        rows = self.db.execute("SELECT * FROM locks ORDER BY id").fetchall()
        return [Lock(r["id"], r["kind"], r["reason"], parse(r["created_at"]),
                     parse(r["auto_release_at"]), bool(r["requires_review"]),
                     parse(r["released_at"])) for r in rows]

    def active_locks(self, now: datetime) -> list[Lock]:
        return [lk for lk in self.locks() if lk.active(now)]

    def release_lock(self, lock_id: int, note: str, now: datetime | None = None) -> str:
        """Manual review. Refused before the lock's own reset time: reviewing a
        monthly drawdown lock does not let you trade the rest of that month."""
        now = now or utcnow()
        lk = next((x for x in self.locks() if x.id == lock_id), None)
        if lk is None:
            return f"No lock with id {lock_id}."
        if lk.released_at is not None:
            return f"Lock {lock_id} was already released."
        if not note.strip():
            return "A review note is required."
        if lk.auto_release_at is not None and now < lk.auto_release_at:
            return f"Lock {lock_id} ({lk.kind}) cannot be released before {iso(lk.auto_release_at)}."
        self.db.execute("UPDATE locks SET released_at=?, release_note=? WHERE id=?",
                        (iso(now), note.strip(), lock_id))
        self.event("lock_released", now, lock_id=lock_id, kind=lk.kind, note=note.strip())
        return f"Lock {lock_id} ({lk.kind}) released."

    def last_release(self, kind: str) -> datetime | None:
        row = self.db.execute("SELECT MAX(released_at) FROM locks WHERE kind=?", (kind,)).fetchone()
        return parse(row[0]) if row and row[0] else None

    # ---- kv ------------------------------------------------------------------
    def get(self, key: str, default: str | None = None) -> str | None:
        row = self.db.execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone()
        return row[0] if row else default

    def put(self, key: str, value: str) -> None:
        self.db.execute("INSERT INTO kv(key, value) VALUES (?,?)"
                        " ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))
