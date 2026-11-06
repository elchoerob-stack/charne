import { queue } from "./queue.js";
import type { RunnerOptions, TaskRun } from "./types.js";

const FINISHED = ["succeeded", "failed", "cancelled", "needs_attention"];

/**
 * Queues a run and waits for it to end. If `signal` fires (the Shell gave up on
 * the step) the run is cancelled so it stops before doing anything further.
 */
export function runToCompletion(run: TaskRun, options: Partial<RunnerOptions>, signal?: AbortSignal): Promise<TaskRun> {
  return new Promise((resolve, reject) => {
    const done = (r: TaskRun) => { if (r.id !== run.id || !FINISHED.includes(r.status)) return; cleanup(); resolve(r); };
    const abort = () => { queue.cancel(run.id); cleanup(); reject(new Error("Stopped: the step timed out or was cancelled, and its browser run was told to stop.")); };
    const cleanup = () => { queue.off("update", done); signal?.removeEventListener("abort", abort); };
    queue.on("update", done);
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort);
    queue.enqueue(run, options);
  });
}
