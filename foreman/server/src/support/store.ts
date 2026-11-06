import { db, newId, now } from "../db.js";
import type { Classification } from "./classify.js";

/**
 * A support job is one client e-mail on its way from "pasted in" to "ticket
 * closed and archived".
 *
 *   proposed → open → done          (archived is a separate flag, only for done jobs)
 *
 *   proposed  Sorted and drafted. Nothing exists in Jira yet. Waiting for a person to approve.
 *   open      Ticket created and assigned. The work is in progress.
 *   done      Ticket closed.
 */

export type JobStatus = "proposed" | "open" | "done";

export interface SupportJob {
  id: string;
  status: JobStatus;
  archived: boolean;
  email: string;
  classification: Classification;
  ticket?: { key: string; url: string; assigned: boolean; createdAt: string };
  /** "pasted": an e-mail pasted in. "ticket": an existing Jira ticket loaded (e.g. one the desk made from an e-mail). */
  source?: "pasted" | "ticket";
  reply?: { text: string; draftedAt: string; source: "claude" | "template" };
  /** Anything the system noticed that the person should see (e.g. assignment failed). */
  warnings: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface AuditEntry { id: number; jobId: string; at: string; action: string; detail: string }

db.exec(`
CREATE TABLE IF NOT EXISTS support_jobs (
  id TEXT PRIMARY KEY, status TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_support_jobs ON support_jobs(archived, status, created_at);
CREATE TABLE IF NOT EXISTS support_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, at TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_support_audit ON support_audit(job_id, id);
`);

type Row = { id: string; status: JobStatus; archived: number; data: string; created_at: string; updated_at: string };

function fromRow(r: Row): SupportJob {
  const d = JSON.parse(r.data) as Omit<SupportJob, "id" | "status" | "archived" | "createdAt" | "updatedAt">;
  return { ...d, id: r.id, status: r.status, archived: r.archived === 1, createdAt: r.created_at, updatedAt: r.updated_at };
}

export function audit(jobId: string, action: string, detail = ""): void {
  db.prepare("INSERT INTO support_audit (job_id, at, action, detail) VALUES (?, ?, ?, ?)").run(jobId, now(), action, detail.slice(0, 2000));
}

export function auditFor(jobId: string): AuditEntry[] {
  return (db.prepare("SELECT id, job_id, at, action, detail FROM support_audit WHERE job_id = ? ORDER BY id").all(jobId) as { id: number; job_id: string; at: string; action: string; detail: string }[])
    .map((r) => ({ id: r.id, jobId: r.job_id, at: r.at, action: r.action, detail: r.detail }));
}

export function createJob(email: string, classification: Classification, existing?: NonNullable<SupportJob["ticket"]>): SupportJob {
  const t = now();
  const job: SupportJob = { id: newId("job"), status: existing ? "open" : "proposed", archived: false, email, classification, ticket: existing, source: existing ? "ticket" : "pasted", warnings: [], createdAt: t, updatedAt: t };
  save(job, true);
  audit(job.id, existing ? "imported" : "received", `${existing ? existing.key + ": " : ""}${classification.category} (${classification.source}, ${Math.round(classification.confidence * 100)}%)`);
  return job;
}

/** The job already tracking this Jira ticket, so loading the same ticket twice never makes two jobs. */
export function findByTicket(key: string): SupportJob | undefined {
  const rows = db.prepare("SELECT * FROM support_jobs WHERE data LIKE ?").all(`%"key":${JSON.stringify(key)}%`) as Row[];
  return rows.map(fromRow).find((j) => j.ticket?.key === key);
}

export function getJob(id: string): SupportJob | undefined {
  const r = db.prepare("SELECT * FROM support_jobs WHERE id = ?").get(id) as Row | undefined;
  return r ? fromRow(r) : undefined;
}

export function listJobs(opts: { archived?: boolean; limit?: number } = {}): SupportJob[] {
  return (db.prepare("SELECT * FROM support_jobs WHERE archived = ? ORDER BY created_at DESC LIMIT ?").all(opts.archived ? 1 : 0, opts.limit ?? 100) as Row[]).map(fromRow);
}

export function save(job: SupportJob, insert = false): SupportJob {
  job.updatedAt = now();
  const { id, status, archived, createdAt, updatedAt, ...data } = job;
  if (insert) db.prepare("INSERT INTO support_jobs (id, status, archived, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, status, archived ? 1 : 0, JSON.stringify(data), createdAt, updatedAt);
  else db.prepare("UPDATE support_jobs SET status = ?, archived = ?, data = ?, updated_at = ? WHERE id = ?").run(status, archived ? 1 : 0, JSON.stringify(data), updatedAt, id);
  return job;
}
