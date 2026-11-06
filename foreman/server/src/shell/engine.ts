import { EventEmitter } from "node:events";
import { planJob } from "./planner.js";
import { WHOLE_TEMPLATE } from "./planner.js";
import type { Registry } from "./registry.js";
import { createJob, event, getJob, openJobs, previewingSteps, runningSteps, saveJobData, saveStep, saveSteps, setJobStatus } from "./store.js";
import type { Capability, Job, JobStatus, JobView, Plan, Step } from "./types.js";

/**
 * Runs jobs. Its whole purpose is to let several things happen at once without
 * anything happening that a person did not approve.
 *
 *  - Steps that only read run straight away. Steps that change something
 *    outside Foreman wait for approval, and run only after it.
 *  - Different jobs run side by side (up to `concurrency`), but two steps that
 *    share a lock key (the same ticket, the same dealer) never overlap.
 *  - A job can be set to start later. Nothing in it runs before then.
 *  - A step that fails stops everything that depended on it. It is not retried
 *    by itself; a person looks, then retries, and a retry of a change asks
 *    for approval again.
 *  - If Foreman stops while a step is running, that step is marked failed
 *    ("check the target system") and is never silently re-run.
 */

export interface ShellOptions {
  registry: Registry;
  planner?: (text: string, registry: Registry) => Promise<Plan>;
  concurrency?: number;
  stepTimeoutMs?: number;
  now?: () => Date;
}

const TERMINAL = ["done", "failed", "skipped", "cancelled"];

export class ShellError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export class Shell extends EventEmitter {
  private running = new Set<string>();
  private locks = new Set<string>();
  private concurrency: number;
  private stepTimeoutMs: number;
  private now: () => Date;
  private planner: NonNullable<ShellOptions["planner"]>;

  constructor(private opts: ShellOptions) {
    super();
    this.concurrency = Math.max(1, opts.concurrency ?? 3);
    this.stepTimeoutMs = opts.stepTimeoutMs ?? 120_000;
    this.now = opts.now ?? (() => new Date());
    this.planner = opts.planner ?? planJob;
  }

  get registry() { return this.opts.registry; }

  /** Takes an instruction, has the CEO plan it, and starts whatever is safe to start. */
  async submit(text: string, opts: { runAt?: string } = {}): Promise<JobView> {
    const t = text.trim();
    if (!t) throw new ShellError(400, "Tell me what you need first");
    let runAt: string | undefined;
    if (opts.runAt) {
      const d = new Date(opts.runAt);
      if (Number.isNaN(d.getTime())) throw new ShellError(400, "That start time isn't a valid date");
      runAt = d.toISOString();
    }
    const plan = await this.planner(t, this.opts.registry);
    const job = createJob(t, plan, { runAt });
    for (const s of job.steps) {
      const cap = this.opts.registry.get(s.capability)!; // validatePlan only lets registered steps through
      s.risk = cap.risk;
      s.status = cap.risk === "changes_data" ? "awaiting_approval" : "ready";
      if (cap.risk === "changes_data" && cap.preview) s.previewState = "pending";
    }
    saveSteps(job.steps);
    event(job.id, "planned", `${plan.steps.length} step(s), planned by ${plan.source}${runAt ? `, starts ${runAt}` : ""}`);
    this.refresh(job.id);
    this.pump();
    return getJob(job.id)!;
  }

  /** Approves the steps that change things. `refs` omitted approves every step still waiting. */
  approve(jobId: string, refs?: string[], via?: string): JobView {
    const job = this.need(jobId);
    if (job.status === "cancelled") throw new ShellError(409, "This job was cancelled");
    const waiting = job.steps.filter((s) => s.status === "awaiting_approval");
    const chosen = refs ? waiting.filter((s) => refs.includes(s.ref)) : waiting;
    if (refs && chosen.length !== refs.length) throw new ShellError(409, "Some of those steps are not waiting for approval");
    if (!chosen.length) throw new ShellError(409, "Nothing is waiting for approval");
    // A change that can show what it will do must have shown it. Approving blind is not approving.
    for (const s of chosen) {
      if (!s.previewState) continue;
      if (s.previewState === "failed") throw new ShellError(409, `"${s.title}" can't be approved yet: its preview failed (${s.previewError}). Retry the preview first.`);
      if (s.previewState !== "ready") throw new ShellError(409, `"${s.title}" can't be approved yet: its preview isn't ready.`);
    }
    for (const s of chosen) { s.status = "ready"; s.approvedAt = this.now().toISOString(); event(jobId, "approved", via ? `${s.title} (via ${via})` : s.title, s.id); }
    saveSteps(chosen);
    this.refresh(jobId);
    this.pump();
    return getJob(jobId)!;
  }

  cancel(jobId: string): JobView {
    const job = this.need(jobId);
    if (["done", "failed", "cancelled"].includes(job.status)) throw new ShellError(409, `This job is already ${job.status}`);
    const stopped = job.steps.filter((s) => s.status === "ready" || s.status === "awaiting_approval");
    for (const s of stopped) s.status = "cancelled";
    saveSteps(stopped);
    const live = job.steps.filter((s) => s.status === "running").length;
    event(jobId, "cancelled", live ? `${live} step(s) already running will finish; check their result` : "");
    setJobStatus(jobId, "cancelled");
    this.emit("change", jobId);
    return getJob(jobId)!;
  }

  /** Puts a failed step (and what was skipped because of it) back. A change asks for approval again. */
  retry(jobId: string, ref: string): JobView {
    const job = this.need(jobId);
    const failed = job.steps.find((s) => s.ref === ref);
    if (failed && failed.status === "awaiting_approval" && failed.previewState === "failed") {
      failed.previewState = "pending"; failed.previewError = undefined; failed.preview = undefined;
      saveStep(failed); event(jobId, "preview-retry", failed.title, failed.id);
      this.refresh(jobId); this.pump();
      return getJob(jobId)!;
    }
    if (!failed || failed.status !== "failed") throw new ShellError(409, "Only a failed step can be retried");
    const reset = [failed, ...job.steps.filter((s) => s.status === "skipped")];
    for (const s of reset) { s.status = s.risk === "changes_data" ? "awaiting_approval" : "ready"; s.previewState = s.risk === "changes_data" && this.opts.registry.get(s.capability)?.preview ? "pending" : undefined; s.preview = undefined; s.previewError = undefined; s.error = undefined; s.output = undefined; s.startedAt = undefined; s.finishedAt = undefined; s.approvedAt = undefined; }
    saveSteps(reset);
    event(jobId, "retry", failed.title, failed.id);
    this.refresh(jobId);
    this.pump();
    return getJob(jobId)!;
  }

  archive(jobId: string, archived = true): JobView {
    const job = this.need(jobId);
    if (archived && !["done", "failed", "cancelled", "needs_input"].includes(job.status)) throw new ShellError(409, "Only a finished job can be archived");
    saveJobData({ ...job, archived });
    event(jobId, archived ? "archived" : "unarchived");
    this.emit("change", jobId);
    return getJob(jobId)!;
  }

  /** At start-up: anything that was mid-step is marked, not re-run. */
  recover(): number {
    const stuck = runningSteps();
    for (const s of stuck) {
      s.status = "failed"; s.finishedAt = this.now().toISOString();
      s.error = "Foreman stopped while this was running. It may or may not have finished: check the system it was working on before trying again.";
      saveStep(s); event(s.jobId, "interrupted", s.title, s.id);
    }
    // A preview changes nothing, so one that was mid-way is simply started again.
    const previews = previewingSteps();
    for (const s of previews) { s.previewState = "pending"; saveStep(s); }
    for (const id of new Set([...stuck, ...previews].map((s) => s.jobId))) this.refresh(id);
    return stuck.length;
  }

  /** Looks at every open job and starts what can start. Called after every change and on a timer. */
  pump(): void {
    const jobs = openJobs().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const job of jobs) {
      const due = !job.runAt || new Date(job.runAt) <= this.now();
      if (due) {
        // A step whose prerequisite failed, was skipped or was cancelled can never run.
        for (const s of job.steps) {
          if (s.status !== "ready" && s.status !== "awaiting_approval") continue;
          const dead = s.after.find((r) => { const d = job.steps.find((x) => x.ref === r); return !d || ["failed", "skipped", "cancelled"].includes(d.status); });
          if (dead) { s.status = "skipped"; s.error = `Not run: ${dead} did not finish`; saveStep(s); event(job.id, "skipped", s.title, s.id); }
        }
        for (const s of job.steps) {
          if (s.status !== "ready") continue;
          if (this.running.size >= this.concurrency) break;
          if (!s.after.every((r) => job.steps.find((x) => x.ref === r)?.status === "done")) continue;
          this.tryStart(job, s);
        }
        for (const s of job.steps) {
          if (s.status !== "awaiting_approval" || s.previewState !== "pending") continue;
          if (this.running.size >= this.concurrency) break;
          if (!s.after.every((r) => job.steps.find((x) => x.ref === r)?.status === "done")) continue;
          this.tryPreview(job, s);
        }
      }
      this.refresh(job.id);
    }
  }

  /** Runs `work` with a time limit. On timeout the worker is told to stop, and the error says it may have got part-way. */
  private limited<T>(cap: Capability, work: (ctx: { signal: AbortSignal }) => Promise<T>): Promise<T> {
    const ms = cap.timeoutMs ?? this.stepTimeoutMs;
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, rej) => {
      timer = setTimeout(() => { ac.abort(); rej(new Error(`Timed out after ${Math.round(ms / 1000)}s. It may still be running: check the system it was working on before retrying.`)); }, ms);
      timer.unref?.();
    });
    return Promise.race([work({ signal: ac.signal }), timeout]).finally(() => clearTimeout(timer));
  }

  private tryStart(job: JobView, step: Step): void {
    const cap = this.opts.registry.get(step.capability);
    if (!cap?.run) return this.fail(job, step, `No worker is available for ${step.capability}`);
    let inputs: Record<string, string>;
    try { inputs = this.resolve(step, job.steps); } catch (err) { return this.fail(job, step, (err as Error).message); }
    const lock = cap.lockKey?.(inputs);
    if (lock && this.locks.has(lock)) return; // wait: something else is working on the same thing
    if (lock) this.locks.add(lock);
    this.running.add(step.id);
    step.status = "running"; step.startedAt = this.now().toISOString();
    saveStep(step); event(job.id, "started", step.title, step.id);

    this.limited(cap, ({ signal }) => cap.run!(inputs, { signal, preview: step.preview }))
      .then((output) => { step.status = "done"; step.output = output; event(job.id, "done", step.title, step.id); })
      .catch((err) => { step.status = "failed"; step.error = (err as Error).message; event(job.id, "failed", `${step.title}: ${step.error}`, step.id); })
      .finally(() => {
        step.finishedAt = this.now().toISOString();
        this.running.delete(step.id); if (lock) this.locks.delete(lock);
        saveStep(step);
        this.pump();
      });
  }

  /** Shows what a change will look like, before anyone is asked to approve it. Changes nothing. */
  private tryPreview(job: JobView, step: Step): void {
    const cap = this.opts.registry.get(step.capability);
    if (!cap?.preview) { step.previewState = undefined; saveStep(step); return; }
    let inputs: Record<string, string>;
    try { inputs = this.resolve(step, job.steps); }
    catch (err) { step.previewState = "failed"; step.previewError = (err as Error).message; saveStep(step); event(job.id, "preview-failed", step.previewError, step.id); return; }
    const lock = cap.lockKey?.(inputs);
    if (lock && this.locks.has(lock)) return;
    if (lock) this.locks.add(lock);
    const key = `${step.id}#preview`;
    this.running.add(key);
    step.previewState = "running"; saveStep(step); event(job.id, "preview-started", step.title, step.id);

    this.limited(cap, ({ signal }) => cap.preview!(inputs, { signal }))
      .then((p) => { step.preview = p; step.previewState = "ready"; step.previewError = undefined; event(job.id, "preview-ready", step.title, step.id); })
      .catch((err) => { step.previewState = "failed"; step.previewError = (err as Error).message; event(job.id, "preview-failed", `${step.title}: ${step.previewError}`, step.id); })
      .finally(() => {
        this.running.delete(key); if (lock) this.locks.delete(lock);
        saveStep(step);
        this.pump();
      });
  }

  private fail(job: JobView, step: Step, message: string): void {
    step.status = "failed"; step.error = message; step.finishedAt = this.now().toISOString();
    saveStep(step); event(job.id, "failed", `${step.title}: ${message}`, step.id);
  }

  /** Fills {{sN.key}} from earlier steps' results. Only a value that is entirely a reference is replaced. */
  private resolve(step: Step, steps: Step[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(step.inputs)) {
      const m = WHOLE_TEMPLATE.exec(v);
      if (!m) { out[k] = v; continue; }
      const val = steps.find((s) => s.ref === m[1])?.output?.[m[2]];
      if (val == null || val === "") throw new Error(`${m[1]} did not produce "${m[2]}", so this step cannot run`);
      out[k] = typeof val === "string" ? val : JSON.stringify(val);
    }
    return out;
  }

  private need(id: string): JobView {
    const j = getJob(id);
    if (!j) throw new ShellError(404, "No such job");
    return j;
  }

  /** Works out where a job stands from its steps, stores it, and tells listeners if it changed. */
  private refresh(jobId: string): void {
    const job = getJob(jobId);
    if (!job) return;
    const next = deriveStatus(job, this.now());
    if (next !== job.status) { setJobStatus(jobId, next); this.emit("status", { ...job, status: next } as JobView, job.status); }
    this.emit("change", jobId);
  }
}

export function deriveStatus(job: Pick<Job, "status" | "runAt"> & { steps: Step[] }, now: Date): JobStatus {
  if (job.status === "cancelled") return "cancelled";
  const steps = job.steps;
  if (!steps.length) return "needs_input";
  if (steps.some((s) => s.status === "running")) return "running";
  const live = steps.filter((s) => !TERMINAL.includes(s.status));
  if (!live.length) return steps.some((s) => s.status === "failed" || s.status === "skipped") ? "failed" : "done";
  const started = steps.some((s) => s.startedAt);
  if (job.runAt && new Date(job.runAt) > now && !started) return "scheduled";
  const depsDone = (s: Step) => s.after.every((r) => steps.find((x) => x.ref === r)?.status === "done");
  const runnable = live.some((s) => s.status === "ready" && depsDone(s));
  if (runnable) return "running";
  // A preview still being prepared is work in progress, not a decision waiting for the person.
  if (live.some((s) => s.status === "awaiting_approval" && (s.previewState === "running" || (s.previewState === "pending" && depsDone(s))))) return "running";
  // A change whose preview failed can't be approved: that is something to look at, not a decision waiting.
  return steps.some((s) => s.status === "failed" || (s.status === "awaiting_approval" && s.previewState === "failed")) ? "failed" : "awaiting_approval";
}
