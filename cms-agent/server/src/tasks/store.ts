import { db, newId, now } from "../db.js";
import type { RunStatus, Task, TaskRun } from "./types.js";

export function saveTask(task: Task): Task {
  db.prepare(
    `INSERT INTO tasks (id, title, dealer, recording_id, data, run_count, last_run_at, last_run_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET title=excluded.title, dealer=excluded.dealer, data=excluded.data,
       run_count=excluded.run_count, last_run_at=excluded.last_run_at, last_run_status=excluded.last_run_status,
       updated_at=excluded.updated_at`,
  ).run(task.id, task.title, task.dealer ?? null, task.recordingId ?? null, JSON.stringify(task), task.runCount,
    task.lastRunAt ?? null, task.lastRunStatus ?? null, task.createdAt, now());
  return task;
}

export function getTask(id: string): Task | undefined {
  const row = db.prepare("SELECT data FROM tasks WHERE id = ?").get(id) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as Task) : undefined;
}

export function listTasks(dealer?: string): Task[] {
  const rows = (dealer
    ? db.prepare("SELECT data FROM tasks WHERE dealer = ? ORDER BY updated_at DESC LIMIT 100").all(dealer)
    : db.prepare("SELECT data FROM tasks ORDER BY updated_at DESC LIMIT 100").all()) as unknown as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as Task);
}

export function deleteTask(id: string): number {
  db.prepare("DELETE FROM task_runs WHERE task_id = ?").run(id);
  return db.prepare("DELETE FROM tasks WHERE id = ?").run(id).changes as number;
}

export function saveRun(run: TaskRun): TaskRun {
  db.prepare(
    `INSERT INTO task_runs (id, task_id, batch_id, status, data, created_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status=excluded.status, data=excluded.data, finished_at=excluded.finished_at`,
  ).run(run.id, run.taskId, run.batchId ?? null, run.status, JSON.stringify(run), run.createdAt, run.finishedAt ?? null);
  return run;
}

export function getRun(id: string): TaskRun | undefined {
  const row = db.prepare("SELECT data FROM task_runs WHERE id = ?").get(id) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as TaskRun) : undefined;
}

export function listRuns(taskId?: string, limit = 50): TaskRun[] {
  const rows = (taskId
    ? db.prepare("SELECT data FROM task_runs WHERE task_id = ? ORDER BY created_at DESC LIMIT ?").all(taskId, limit)
    : db.prepare("SELECT data FROM task_runs ORDER BY created_at DESC LIMIT ?").all(limit)) as unknown as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as TaskRun);
}

export function newRun(taskId: string, totalSteps: number, inputs: Record<string, string>, batch?: { id: string; index: number }): TaskRun {
  return {
    id: newId("run"), taskId, status: "queued", inputs, totalSteps, log: [], createdAt: now(),
    batchId: batch?.id, batchIndex: batch?.index,
  };
}

export function markTaskRun(task: Task, status: RunStatus): void {
  task.runCount += 1;
  task.lastRunAt = now();
  task.lastRunStatus = status;
  saveTask(task);
}
