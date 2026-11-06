import type { Recording, Target } from "../recorder/schema.js";
import { compileSop } from "../recorder/sop.js";
import type { Task, TaskStep, TaskVariable } from "./types.js";

/**
 * Turn a recording into a runnable Task.
 *
 * compileSop already does the hard part: it drops scroll/console noise,
 * collapses keystroke-by-keystroke input into one value per field, removes the
 * click that merely focused a field, and de-duplicates double clicks. Here we
 * take those steps and make them repeatable.
 */

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "value";

function variableNameFor(target: Target | undefined, used: Set<string>, n: number): string {
  const base = slug(target?.name || target?.placeholder || target?.testId || target?.id || `field_${n}`);
  let name = base;
  let i = 2;
  while (used.has(name)) name = `${base}_${i++}`;
  used.add(name);
  return name;
}

export interface CompileOptions {
  /** Lift typed and selected values into variables. On by default. */
  parameterise?: boolean;
  /** Keep the pauses from the original recording (capped). */
  preserveTiming?: boolean;
  selfHeal?: boolean;
}

export function compileTask(
  rec: Recording,
  ids: { id: string; now: string },
  opts: CompileOptions = {},
): Task {
  const { parameterise = true, preserveTiming = true, selfHeal = true } = opts;
  const sop = compileSop(rec);
  const steps: TaskStep[] = [];
  const variables: TaskVariable[] = [];
  const used = new Set<string>();
  let prevT = 0;

  for (const s of sop.steps) {
    if (s.action === "note") continue; // notes are commentary, not work

    const gap = Math.max(0, s.t - prevT);
    prevT = s.t;
    // Human pauses are mostly thinking time. Keep a little so the app can keep
    // up, but never sit there for the eleven seconds it took to find a pen.
    const delayMs = preserveTiming ? Math.min(1500, Math.max(0, gap - 300)) : 0;

    const step: TaskStep = {
      n: steps.length + 1,
      action: s.action as TaskStep["action"],
      text: s.text.replace(/\*\*/g, ""),
      target: s.target,
      value: s.value,
      url: s.url,
      delayMs,
    };

    if (parameterise && (s.action === "type" || s.action === "select") && s.target) {
      const name = variableNameFor(s.target, used, step.n);
      step.variable = name;
      variables.push({
        name,
        label: s.target.name || s.target.placeholder || s.target.testId || `Field ${step.n}`,
        example: s.target.sensitive ? "" : (s.value ?? ""),
        sensitive: Boolean(s.target.sensitive),
        stepN: step.n,
      });
    }
    steps.push(step);
  }

  // The first navigate is the entry point, not a step to repeat mid-run.
  const startUrl = steps[0]?.action === "navigate" ? (steps.shift()!.url ?? rec.startUrl ?? "") : (rec.startUrl ?? "");
  steps.forEach((s, i) => (s.n = i + 1));
  for (const v of variables) {
    const idx = steps.findIndex((s) => s.variable === v.name);
    v.stepN = idx >= 0 ? steps[idx].n : v.stepN;
  }

  return {
    id: ids.id,
    title: rec.title,
    dealer: rec.dealer,
    recordingId: rec.id,
    startUrl,
    steps,
    variables,
    selfHeal,
    createdAt: ids.now,
    updatedAt: ids.now,
    runCount: 0,
  };
}

/** Values for a run: supplied inputs win, recorded examples fill the rest. */
export function resolveInputs(task: Task, inputs: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of task.variables) {
    const given = inputs[v.name];
    out[v.name] = given !== undefined && given !== "" ? given : v.example;
  }
  return out;
}

/** Variables that must be supplied because the recorder masked them. */
export function missingRequired(task: Task, inputs: Record<string, string> = {}): TaskVariable[] {
  return task.variables.filter((v) => v.sensitive && !(inputs[v.name] ?? "").trim());
}
