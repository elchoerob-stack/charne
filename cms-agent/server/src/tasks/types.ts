import type { Target } from "../recorder/schema.js";

/**
 * A Task is a recording turned into something repeatable.
 *
 * The recorder captures one performance of a job (one booking, one quote).
 * Compiling it into a Task does two things: it strips the noise down to the
 * actions that actually matter, and it lifts the values you typed into named
 * variables, so the same shape of work can be run again with different data.
 */

export type StepAction = "navigate" | "click" | "type" | "select" | "press" | "submit" | "wait" | "expect";

export interface TaskStep {
  n: number;
  action: StepAction;
  /** Human sentence, shown in the run log. */
  text: string;
  target?: Target;
  /** Literal value recorded, used when no variable is bound. */
  value?: string;
  /** Name of the variable supplying this step's value, if parameterised. */
  variable?: string;
  url?: string;
  /** Locator that worked last time; set by self-healing so a fix sticks. */
  healedSelector?: string;
  /** Milliseconds to wait before this step (derived from the recording's pacing). */
  delayMs?: number;
  /** Continue the run if this step fails. */
  optional?: boolean;
}

export interface TaskVariable {
  name: string;
  label: string;
  /** Value captured during recording; the default when a run supplies nothing. */
  example: string;
  /** Masked in the recording (POPIA), so it must be supplied per run. */
  sensitive?: boolean;
  stepN: number;
}

/**
 * When a task runs on its own. Times are wall-clock in `timezone`
 * (Africa/Johannesburg by default), so "08:00 daily" means 08:00 in Centurion
 * whatever the server's clock is set to.
 */
export interface TaskSchedule {
  enabled: boolean;
  kind: "interval" | "daily" | "weekly" | "cron";
  everyMinutes?: number;          // interval
  atTime?: string;                // "HH:MM" for daily / weekly
  weekdays?: number[];            // 0 = Sunday … 6 = Saturday, for weekly
  cron?: string;                  // 5-field cron for cron
  timezone?: string;
  /** Variable values to run with. Missing ones fall back to the recorded example. */
  inputs?: Record<string, string>;
  nextRunAt?: string;
  lastRunAt?: string;
}

export type BoardColumn = "todo" | "scheduled" | "paused" | "done" | "attention";

export interface Task {
  id: string;
  title: string;
  schedule?: TaskSchedule;
  /** Manual position on the task board; lower sorts first. */
  boardOrder?: number;
  /** Set when the user parks a task; overrides the derived column. */
  boardColumn?: BoardColumn;
  agentId?: string;
  dealer?: string;
  recordingId?: string;
  /** Where the task starts; every run navigates here first. */
  startUrl: string;
  steps: TaskStep[];
  variables: TaskVariable[];
  /** Ask Claude to repair a step whose element cannot be found. */
  selfHeal: boolean;
  createdAt: string;
  updatedAt: string;
  runCount: number;
  lastRunAt?: string;
  lastRunStatus?: RunStatus;
}

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "needs_attention";

export interface RunLogEntry {
  at: string;
  stepN?: number;
  level: "info" | "step" | "warn" | "error" | "heal";
  message: string;
  screenshot?: string;
}

export interface TaskRun {
  id: string;
  taskId: string;
  status: RunStatus;
  /** Variable values for this run. */
  inputs: Record<string, string>;
  /** Which row of a batch this is, when run over a list. */
  batchIndex?: number;
  batchId?: string;
  startedAt?: string;
  finishedAt?: string;
  currentStep?: number;
  totalSteps: number;
  log: RunLogEntry[];
  error?: string;
  /** Set when the run stopped for a human decision rather than a hard failure. */
  attention?: string;
  /** Documents the run downloaded or wrote, on disk where you can open them. */
  files?: { name: string; path: string; bytes: number; savedAt: string }[];
  createdAt: string;
}

export interface RunnerOptions {
  headless: boolean;
  /** Abort the whole run if a single step takes longer than this. */
  stepTimeoutMs: number;
  /** Slow each action down, useful when watching a run. */
  slowMoMs: number;
  dryRun: boolean;
}

export const DEFAULT_RUNNER_OPTIONS: RunnerOptions = { headless: true, stepTimeoutMs: 15000, slowMoMs: 0, dryRun: false };
