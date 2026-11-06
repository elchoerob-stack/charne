/**
 * The Shell: one front door for every instruction, with a "CEO" (Claude) that
 * turns it into steps and hands each step to the right worker.
 *
 *   instruction → plan (steps, each owned by a worker) → approve → run → report
 *
 * Three rules hold everywhere:
 *   1. The CEO can only choose steps that a registered worker offers. It cannot
 *      invent a worker, and it cannot invent what a worker is able to do.
 *   2. Whether a step changes anything outside Foreman is declared by the worker,
 *      never by the model. Steps that change things wait for a person.
 *   3. Nothing that has started is retried or resumed automatically, whether it
 *      failed or Foreman was stopped part-way. A half-finished change is something
 *      a person looks at, not something that quietly runs again.
 */

export type Risk = "read_only" | "changes_data";

export interface InputSpec { description: string; required?: boolean }

export interface Capability {
  /** worker.action, e.g. "support.close_ticket" */
  id: string;
  worker: string;
  title: string;
  /** What the CEO reads when deciding whether this is the right step. */
  description: string;
  risk: Risk;
  inputs: Record<string, InputSpec>;
  /** False for workers that are planned but not built. The CEO is told, so it can say "I can't do that yet". */
  available: boolean;
  /**
   * Steps that return the same key never run at the same time. This is what
   * lets many jobs run at once without two of them editing the same ticket or dealer.
   */
  lockKey?: (inputs: Record<string, string>) => string | undefined;
  run?: (inputs: Record<string, string>) => Promise<Record<string, unknown>>;
}

export type StepStatus = "awaiting_approval" | "ready" | "running" | "done" | "failed" | "skipped" | "cancelled";

export interface Step {
  id: string;
  jobId: string;
  /** Stable reference inside the job: s1, s2, ... Later steps cite earlier ones as {{s1.jobId}}. */
  ref: string;
  idx: number;
  capability: string;
  title: string;
  inputs: Record<string, string>;
  /** Refs this step waits for. */
  after: string[];
  risk: Risk;
  status: StepStatus;
  approvedAt?: string;
  output?: Record<string, unknown>;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

export type JobStatus = "planning" | "awaiting_approval" | "scheduled" | "running" | "done" | "failed" | "cancelled" | "needs_input";

export interface Job {
  id: string;
  /** What the person typed or pasted. Treated as data, never as instructions to Foreman. */
  text: string;
  summary: string;
  /** Things the request needs that no worker can do yet. */
  unsupported: string[];
  /** What the CEO needs to know before it can plan the rest. */
  questions: string[];
  runAt?: string;
  planSource: "claude" | "rules";
  status: JobStatus;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface JobView extends Job { steps: Step[] }

export interface PlannedStep { ref: string; capability: string; title: string; inputs: Record<string, string>; after: string[] }
export interface Plan { summary: string; steps: PlannedStep[]; unsupported: string[]; questions: string[]; source: "claude" | "rules" }
