import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, "voice-todo.sqlite"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    transcript TEXT NOT NULL,
    title TEXT,
    intent TEXT NOT NULL DEFAULT 'todo',
    extracted TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    completed_at TEXT
  );
`);

export type Intent = "todo" | "calendar_event" | "email_draft";
export type NoteStatus = "new" | "ready" | "confirmed" | "done" | "dismissed";

export interface NoteRow {
  id: string;
  created_at: string;
  transcript: string;
  title: string | null;
  intent: Intent;
  extracted: string | null;
  status: NoteStatus;
  completed_at: string | null;
}
