import { EventEmitter } from "node:events";
import { now } from "../db.js";
import { executeTask } from "./runner.js";
import { getTask, markTaskRun, newRun, saveRun, saveTask } from "./store.js";
import type { RunLogEntry, RunnerOptions, TaskRun } from "./types.js";

/**
 * A small in-process queue so a task runs to completion in the background
 * while Jacques carries on working. Runs are executed one at a time on
 * purpose: two browsers hitting the same CMS session at once is a good way to
 * create duplicate bookings.
 */

class RunQueue extends EventEmitter {
  private pending: { run: TaskRun; options: Partial<RunnerOptions> }[] = [];
  private active: TaskRun | undefined;
  private cancelled = new Set<string>();
  private draining = false;

  enqueue(run: TaskRun, options: Partial<RunnerOptions> = {}): TaskRun {
    run.status = "queued";
    saveRun(run);
    this.pending.push({ run, options });
    this.emit("update", run);
    void this.drain();
    return run;
  }

  cancel(runId: string): boolean {
    this.cancelled.add(runId);
    const idx = this.pending.findIndex((p) => p.run.id === runId);
    if (idx >= 0) {
      const [{ run }] = this.pending.splice(idx, 1);
      run.status = "cancelled";
      run.finishedAt = now();
      saveRun(run);
      this.emit("update", run);
      return true;
    }
    return this.active?.id === runId; // running: the executor checks isCancelled
  }

  status() {
    return {
      active: this.active ? { id: this.active.id, taskId: this.active.taskId, currentStep: this.active.currentStep, totalSteps: this.active.totalSteps } : null,
      queued: this.pending.map((p) => ({ id: p.run.id, taskId: p.run.taskId })),
    };
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.pending.length) {
        const next = this.pending.shift()!;
        await this.runOne(next.run, next.options);
      }
    } finally {
      this.draining = false;
    }
  }

  private async runOne(run: TaskRun, options: Partial<RunnerOptions>): Promise<void> {
    const task = getTask(run.taskId);
    if (!task) {
      run.status = "failed";
      run.error = `Task ${run.taskId} no longer exists`;
      run.finishedAt = now();
      saveRun(run);
      this.emit("update", run);
      return;
    }

    this.active = run;
    run.status = "running";
    run.startedAt = now();
    saveRun(run);
    this.emit("update", run);

    const append = (entry: RunLogEntry) => {
      run.log.push(entry);
      if (run.log.length % 3 === 0) saveRun(run);
      this.emit("log", { runId: run.id, entry });
    };

    try {
      await executeTask(task, run, {
        onLog: append,
        isCancelled: () => this.cancelled.has(run.id),
        onHeal: (stepN, selector) => {
          const s = task.steps.find((x) => x.n === stepN);
          if (s) { s.healedSelector = selector; saveTask(task); }
        },
      }, options);
      run.status = this.cancelled.has(run.id) ? "cancelled" : "succeeded";
    } catch (err) {
      const e = err as Error & { attention?: boolean };
      run.status = this.cancelled.has(run.id) ? "cancelled" : e.attention ? "needs_attention" : "failed";
      run.error = e.message;
      if (e.attention) run.attention = e.message;
    } finally {
      run.finishedAt = now();
      saveRun(run);
      markTaskRun(task, run.status);
      this.cancelled.delete(run.id);
      this.active = undefined;
      this.emit("update", run);
    }
  }
}

export const queue = new RunQueue();

/** Queue one run per row of data, so a list of jobs is one action. */
export function enqueueBatch(taskId: string, rows: Record<string, string>[], totalSteps: number, options: Partial<RunnerOptions> = {}): { batchId: string; runs: TaskRun[] } {
  const batchId = `batch_${Date.now().toString(36)}`;
  const runs = rows.map((inputs, i) => queue.enqueue(newRun(taskId, totalSteps, inputs, { id: batchId, index: i }), options));
  return { batchId, runs };
}
