import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { config } from "./config.js";

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
// Node's built-in SQLite (Node 22.13+ / 24+). Deliberately not better-sqlite3:
// that is a native addon, and on any Node release newer than its prebuilt
// binaries it tries to compile from source and demands Visual Studio.
export const db = new DatabaseSync(config.dbPath);
db.exec("PRAGMA journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  dealer TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  title TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,          -- JSON: MessageParam.content
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);

CREATE TABLE IF NOT EXISTS memory (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,            -- dealer code, or 'global'
  fact TEXT NOT NULL,
  source TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_scope ON memory(scope);

CREATE TABLE IF NOT EXISTS recordings (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  dealer TEXT,
  purpose TEXT NOT NULL,          -- 'sop' | 'problem'
  recorded_by TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  event_count INTEGER NOT NULL,
  data TEXT NOT NULL,             -- JSON: Recording (screenshots stripped)
  screenshots TEXT,               -- JSON: Record<id, dataUrl>
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  dealer TEXT,
  title TEXT NOT NULL,
  symptom TEXT NOT NULL,
  status TEXT NOT NULL,           -- open | investigating | resolved | escalated
  hypothesis TEXT,
  resolution TEXT,
  recording_id TEXT,
  session_id TEXT,
  data TEXT,                      -- JSON: diagnostic state
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS learned_playbooks (
  id TEXT PRIMARY KEY,
  case_id TEXT,
  title TEXT NOT NULL,
  symptoms TEXT NOT NULL,         -- JSON string[]
  resolution TEXT NOT NULL,       -- JSON string[]
  domain TEXT NOT NULL,
  confirmations INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT,                      -- workshop | contacts | other
  mime TEXT,
  size INTEGER NOT NULL,
  path TEXT NOT NULL,
  dealer TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,             -- workshop | campaign
  title TEXT NOT NULL,
  file_id TEXT,
  dealer TEXT,
  summary TEXT NOT NULL,          -- JSON: model-friendly summary
  html_path TEXT,
  xlsx_path TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  dealer TEXT,
  recording_id TEXT,
  data TEXT NOT NULL,             -- JSON: Task
  run_count INTEGER NOT NULL DEFAULT 0,
  last_run_at TEXT,
  last_run_status TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  batch_id TEXT,
  status TEXT NOT NULL,
  data TEXT NOT NULL,             -- JSON: TaskRun
  created_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_task ON task_runs(task_id, created_at);

CREATE TABLE IF NOT EXISTS followups (
  id TEXT PRIMARY KEY,
  case_id TEXT,
  session_id TEXT,
  due_at TEXT NOT NULL,
  note TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
`);

export const now = () => new Date().toISOString();
export const newId = (prefix: string) => `${prefix}_${nanoid(10)}`;

export interface SessionRow {
  id: string;
  dealer: string | null;
  created_at: string;
  updated_at: string;
  title: string | null;
}

export function getOrCreateSession(id: string | undefined, dealer?: string): SessionRow {
  if (id) {
    const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
    if (row) {
      if (dealer && dealer !== row.dealer) {
        db.prepare("UPDATE sessions SET dealer = ?, updated_at = ? WHERE id = ?").run(dealer, now(), id);
        row.dealer = dealer;
      }
      return row;
    }
  }
  const row: SessionRow = { id: id ?? newId("ses"), dealer: dealer ?? null, created_at: now(), updated_at: now(), title: null };
  db.prepare("INSERT INTO sessions (id, dealer, created_at, updated_at, title) VALUES (?, ?, ?, ?, ?)").run(
    row.id, row.dealer, row.created_at, row.updated_at, row.title,
  );
  return row;
}
