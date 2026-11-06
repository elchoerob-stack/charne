import { db, newId, now } from "../db.js";
import type { Job, JobStatus, JobView, Plan, Step, StepStatus } from "./types.js";

db.exec(`
CREATE TABLE IF NOT EXISTS shell_jobs (
  id TEXT PRIMARY KEY, status TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shell_jobs ON shell_jobs(archived, created_at);
CREATE TABLE IF NOT EXISTS shell_steps (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL, idx INTEGER NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shell_steps ON shell_steps(job_id, idx);
CREATE TABLE IF NOT EXISTS shell_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, step_id TEXT, at TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shell_events ON shell_events(job_id, id);
`);

type JobRow = { id: string; status: JobStatus; archived: number; data: string; created_at: string; updated_at: string };
type StepRow = { id: string; job_id: string; idx: number; status: StepStatus; data: string };

const jobFrom = (r: JobRow): Job => ({ ...(JSON.parse(r.data) as Omit<Job, "id" | "status" | "archived" | "createdAt" | "updatedAt">), id: r.id, status: r.status, archived: r.archived === 1, createdAt: r.created_at, updatedAt: r.updated_at });
const stepFrom = (r: StepRow): Step => ({ ...(JSON.parse(r.data) as Omit<Step, "id" | "jobId" | "idx" | "status">), id: r.id, jobId: r.job_id, idx: r.idx, status: r.status });

export function event(jobId: string, kind: string, detail = "", stepId?: string): void {
  db.prepare("INSERT INTO shell_events (job_id, step_id, at, kind, detail) VALUES (?, ?, ?, ?, ?)").run(jobId, stepId ?? null, now(), kind, detail.slice(0, 2000));
}

export function eventsFor(jobId: string) {
  return (db.prepare("SELECT id, step_id, at, kind, detail FROM shell_events WHERE job_id = ? ORDER BY id").all(jobId) as { id: number; step_id: string | null; at: string; kind: string; detail: string }[])
    .map((e) => ({ id: e.id, stepId: e.step_id, at: e.at, kind: e.kind, detail: e.detail }));
}

export function createJob(text: string, plan: Plan, opts: { runAt?: string } = {}): JobView {
  const t = now();
  const id = newId("sjob");
  const job: Job = { id, text, summary: plan.summary, unsupported: plan.unsupported, questions: plan.questions, runAt: opts.runAt, planSource: plan.source, status: "planning", archived: false, createdAt: t, updatedAt: t };
  const { status, archived, createdAt, updatedAt, id: _id, ...data } = job;
  void _id;
  db.prepare("INSERT INTO shell_jobs (id, status, archived, data, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?)").run(id, status, JSON.stringify(data), createdAt, updatedAt);
  const steps = plan.steps.map((p, idx): Step => ({ id: `${id}:${p.ref}`, jobId: id, ref: p.ref, idx, capability: p.capability, title: p.title, inputs: p.inputs, after: p.after, risk: "read_only", status: "ready" }));
  return { ...job, steps };
}

export function saveSteps(steps: Step[]): void {
  const ins = db.prepare("INSERT INTO shell_steps (id, job_id, idx, status, data, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data, updated_at = excluded.updated_at");
  for (const s of steps) {
    const { id, jobId, idx, status, ...data } = s;
    ins.run(id, jobId, idx, status, JSON.stringify(data), now());
  }
}

export function saveStep(s: Step): void { saveSteps([s]); }

export function setJobStatus(id: string, status: JobStatus): void {
  db.prepare("UPDATE shell_jobs SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), id);
}

export function saveJobData(job: Job): void {
  const { status, archived, createdAt, updatedAt, id, ...data } = job;
  db.prepare("UPDATE shell_jobs SET status = ?, archived = ?, data = ?, updated_at = ? WHERE id = ?").run(status, archived ? 1 : 0, JSON.stringify(data), now(), id);
}

export function stepsOf(jobId: string): Step[] {
  return (db.prepare("SELECT * FROM shell_steps WHERE job_id = ? ORDER BY idx").all(jobId) as StepRow[]).map(stepFrom);
}

export function getJob(id: string): JobView | undefined {
  const r = db.prepare("SELECT * FROM shell_jobs WHERE id = ?").get(id) as JobRow | undefined;
  return r ? { ...jobFrom(r), steps: stepsOf(id) } : undefined;
}

export function listJobs(opts: { archived?: boolean; limit?: number } = {}): JobView[] {
  return (db.prepare("SELECT * FROM shell_jobs WHERE archived = ? ORDER BY created_at DESC LIMIT ?").all(opts.archived ? 1 : 0, opts.limit ?? 100) as JobRow[]).map((r) => ({ ...jobFrom(r), steps: stepsOf(r.id) }));
}

/** Jobs and steps that were in flight when the server stopped. */
export function runningSteps(): Step[] {
  return (db.prepare("SELECT * FROM shell_steps WHERE status = 'running'").all() as StepRow[]).map(stepFrom);
}

/** Jobs that are not finished and might have something to run. */
export function openJobs(): JobView[] {
  return (db.prepare("SELECT * FROM shell_jobs WHERE archived = 0 AND status NOT IN ('done','failed','cancelled')").all() as JobRow[]).map((r) => ({ ...jobFrom(r), steps: stepsOf(r.id) }));
}
