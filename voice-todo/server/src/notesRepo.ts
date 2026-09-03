import { nanoid } from "nanoid";
import { db, type Intent, type NoteRow, type NoteStatus } from "./db.js";

export function createNote(transcript: string): NoteRow {
  const row: NoteRow = {
    id: nanoid(10),
    created_at: new Date().toISOString(),
    transcript,
    title: null,
    intent: "todo",
    extracted: null,
    status: "new",
    completed_at: null,
  };
  db.prepare(
    `INSERT INTO notes (id, created_at, transcript, title, intent, extracted, status, completed_at)
     VALUES (@id, @created_at, @transcript, @title, @intent, @extracted, @status, @completed_at)`
  ).run(row);
  return row;
}

export function getNote(id: string): NoteRow | undefined {
  return db.prepare(`SELECT * FROM notes WHERE id = ?`).get(id) as NoteRow | undefined;
}

export function listNotes(): NoteRow[] {
  return db.prepare(`SELECT * FROM notes ORDER BY created_at DESC`).all() as NoteRow[];
}

export function updateClassification(
  id: string,
  fields: { title: string; intent: Intent; extracted: Record<string, unknown> }
): void {
  db.prepare(
    `UPDATE notes SET title = ?, intent = ?, extracted = ?, status = 'ready' WHERE id = ?`
  ).run(fields.title, fields.intent, JSON.stringify(fields.extracted), id);
}

export function setStatus(id: string, status: NoteStatus): void {
  const completedAt = status === "done" ? new Date().toISOString() : null;
  db.prepare(`UPDATE notes SET status = ?, completed_at = ? WHERE id = ?`).run(
    status,
    completedAt,
    id
  );
}

export function deleteNote(id: string): void {
  db.prepare(`DELETE FROM notes WHERE id = ?`).run(id);
}
