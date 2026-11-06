import { db, now } from "../db.js";
import { getTask } from "../tasks/store.js";
import type { Task } from "../tasks/types.js";

/**
 * Which recorded workflow does each kind of user job.
 *
 * Foreman cannot know how your CMS admin screens are laid out, so it doesn't
 * pretend to. You record yourself doing each job once (create a user, change a
 * role, deactivate a user), and here you say which recording that is, which of
 * its fields hold the dealer, name, e-mail and role, which step is the one that
 * SAVES, and what message CMS shows when the save worked.
 *
 * The "which step saves" matters most. Everything before it is only filling in a
 * form, and that is what is shown to you for approval. The save itself only
 * happens after you approve.
 */

export type UserAction = "create" | "update" | "deactivate";
export type InputKey = "dealer" | "name" | "email" | "role";

export const INPUT_LABEL: Record<InputKey, string> = { dealer: "the dealer or branch", name: "the user's name", email: "the user's e-mail address", role: "the role or access level" };

export const ACTIONS: Record<UserAction, { title: string; verb: string; requires: InputKey[]; oneOf?: InputKey[]; optional: InputKey[] }> = {
  create: { title: "Create a user", verb: "create", requires: ["dealer", "name", "email", "role"], optional: [] },
  update: { title: "Change a user", verb: "change", requires: ["email"], oneOf: ["role", "name", "dealer"], optional: ["role", "name", "dealer"] },
  deactivate: { title: "Deactivate a user", verb: "deactivate", requires: ["email"], optional: ["dealer"] },
};
export const ACTION_IDS = Object.keys(ACTIONS) as UserAction[];
export const INPUT_KEYS: InputKey[] = ["dealer", "name", "email", "role"];

export interface Binding {
  action: UserAction;
  taskId: string;
  /** The step number (in the recorded task) that saves. Nothing from here on happens before approval. */
  commitStep: number;
  /** Which task variable carries each input. */
  fieldMap: Partial<Record<InputKey, string>>;
  /** What CMS shows when the save worked. Without it a save can never be confirmed. */
  expectText: string;
  updatedAt: string;
}

db.exec("CREATE TABLE IF NOT EXISTS workflow_bindings (action TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)");

export function getBinding(action: string): Binding | undefined {
  const r = db.prepare("SELECT data FROM workflow_bindings WHERE action = ?").get(action) as { data: string } | undefined;
  return r ? (JSON.parse(r.data) as Binding) : undefined;
}

export function listBindings(): Binding[] {
  return (db.prepare("SELECT data FROM workflow_bindings").all() as { data: string }[]).map((r) => JSON.parse(r.data) as Binding);
}

export function saveBinding(b: Omit<Binding, "updatedAt">): Binding {
  const full: Binding = { ...b, expectText: b.expectText.trim(), updatedAt: now() };
  db.prepare("INSERT INTO workflow_bindings (action, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(action) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at").run(full.action, JSON.stringify(full), full.updatedAt);
  return full;
}

export function deleteBinding(action: string): boolean {
  return (db.prepare("DELETE FROM workflow_bindings WHERE action = ?").run(action).changes as number) > 0;
}

export interface Issues { errors: string[]; warnings: string[] }

/** Is this binding fit to be used right now, against the task as it currently is? */
export function bindingIssues(b: Pick<Binding, "action" | "taskId" | "commitStep" | "fieldMap" | "expectText">, task = getTask(b.taskId)): Issues {
  const errors: string[] = [], warnings: string[] = [];
  const spec = ACTIONS[b.action];
  if (!spec) return { errors: [`"${b.action}" is not a user action`], warnings };
  if (!task) return { errors: ["The recorded workflow no longer exists. Record it again and pick it here."], warnings };

  const commit = task.steps.find((s) => s.n === b.commitStep);
  if (!commit) errors.push(`Step ${b.commitStep} isn't in "${task.title}". Pick the step that saves.`);
  else {
    if (!["click", "submit", "press"].includes(commit.action)) errors.push(`Step ${commit.n} ("${commit.text}") isn't a click, so it can't be the Save. Pick the step that presses Save.`);
    else if (!/\b(save|submit|create|add|confirm|update|apply|deactivate|disable|ok|done|finish)\b/i.test(commit.text)) warnings.push(`Step ${commit.n} reads "${commit.text}". Make sure that is the one that saves.`);
  }
  if (!b.expectText?.trim()) errors.push("Type the message CMS shows when the save worked (for example “User saved”). Without it a save can never be confirmed.");

  const vars = new Map(task.variables.map((v) => [v.name, v]));
  for (const k of spec.requires) {
    const v = b.fieldMap[k];
    if (!v) errors.push(`Choose which field of the recording holds ${INPUT_LABEL[k]}.`);
  }
  for (const [k, v] of Object.entries(b.fieldMap)) if (v && !vars.has(v)) errors.push(`The field "${v}" (for ${INPUT_LABEL[k as InputKey] ?? k}) isn't in "${task.title}".`);
  const mapped = new Set(Object.values(b.fieldMap));
  for (const v of task.variables) if (v.sensitive && !mapped.has(v.name)) errors.push(`"${v.label}" was masked when you recorded it, so it has no value to use, and no input is connected to it. Connect one, or record again without it.`);
  if (commit && task.steps.some((s) => s.n > commit.n && ["type", "select"].includes(s.action))) warnings.push("There are steps that fill in fields after the Save step. Check that the Save step really is the one that saves.");
  return { errors, warnings };
}

export const isUsable = (b: Binding) => bindingIssues(b).errors.length === 0;

/** The workflow-field names, picked by what they are called. The person confirms or corrects. */
export function suggestBinding(task: Task): { commitStep?: number; fieldMap: Partial<Record<InputKey, string>> } {
  const guess: Record<InputKey, RegExp> = { dealer: /dealer|franchise|branch|store|outlet/i, email: /e-?mail/i, role: /role|access|permission|profile|group|level/i, name: /name/i };
  const fieldMap: Partial<Record<InputKey, string>> = {};
  for (const k of ["email", "dealer", "role", "name"] as InputKey[]) {
    const hit = task.variables.find((v) => guess[k].test(`${v.name} ${v.label}`) && !Object.values(fieldMap).includes(v.name) && !(k === "name" && /e-?mail|user ?name|login/i.test(`${v.name} ${v.label}`)));
    if (hit) fieldMap[k] = hit.name;
  }
  const clicks = task.steps.filter((s) => ["click", "submit"].includes(s.action));
  const saves = clicks.filter((s) => /\b(save|submit|create|add|confirm|update|apply|deactivate|disable)\b/i.test(s.text));
  const commit = (saves.length ? saves : clicks).at(-1);
  return { commitStep: commit?.n, fieldMap };
}
