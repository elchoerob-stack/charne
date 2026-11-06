import { ACTIONS, ACTION_IDS, INPUT_KEYS, INPUT_LABEL, bindingIssues, getBinding, listBindings, type Binding, type InputKey, type UserAction } from "../../cms/bindings.js";
import { missingRequired } from "../../tasks/compile.js";
import { getTask } from "../../tasks/store.js";
import { newRun } from "../../tasks/store.js";
import { runToCompletion } from "../../tasks/wait.js";
import type { FormField, Task } from "../../tasks/types.js";
import type { Capability, Preview, RunContext } from "../types.js";

/**
 * The CMS admin user worker: create a user, change one, or deactivate one.
 *
 * It does not know your screens. It runs the workflow you recorded for the job,
 * in its own browser, with the values from the request, in two separate goes:
 *
 *   PREVIEW (before you approve). Runs the recorded steps up to the one that
 *   SAVES, stops, reads back every editable field on the form and takes a
 *   picture. Nothing has been saved. That is what you are asked to approve.
 *
 *   APPLY (after you approve). Runs it again. Just before the save it reads the
 *   form once more and, if it differs at all from what you approved, stops
 *   without saving. After the save it looks for an error from the page, and
 *   then requires the success message you configured. No message, no "done".
 *
 * A save that cannot be confirmed fails the step loudly and stops everything
 * after it: a client must never be told "your user is set up" on a hope.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cap1 = (s: string) => s[0].toUpperCase() + s.slice(1);

/** The task variables to run with: each request input goes to the field it was connected to. */
export function variablesFor(b: Binding, inputs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of INPUT_KEYS) { const v = b.fieldMap[k]; const val = inputs[k]?.trim(); if (v && val) out[v] = val; }
  return out;
}

export function validateUserRequest(inputs: Record<string, string>): string | undefined {
  const action = (inputs.action ?? "").trim().toLowerCase() as UserAction;
  if (!ACTION_IDS.includes(action)) return `What should be done with the user: ${ACTION_IDS.join(", ")}? ("${inputs.action ?? ""}" isn't one of those.)`;
  const spec = ACTIONS[action];
  const b = getBinding(action);
  if (!b) return `There's no recorded workflow for "${spec.title.toLowerCase()}" yet. Record it in CMS admin and set it up on the Workflows page.`;
  const bad = bindingIssues(b).errors;
  if (bad.length) return `The workflow for "${spec.title.toLowerCase()}" needs fixing before I can use it: ${bad[0]}`;
  const has = (k: InputKey) => Boolean(inputs[k]?.trim());
  const missing = spec.requires.filter((k) => !has(k));
  if (missing.length) return `To ${spec.verb} this user I still need ${missing.map((k) => INPUT_LABEL[k]).join(", ")}.`;
  if (spec.oneOf && !spec.oneOf.some(has)) return `What should change on the user: ${spec.oneOf.join(", ")}?`;
  if (!EMAIL.test(inputs.email.trim())) return `"${inputs.email}" doesn't look like an e-mail address. What is the right one?`;
  const unmapped = INPUT_KEYS.filter((k) => has(k) && !b.fieldMap[k]);
  if (unmapped.length) return `The recorded workflow for "${spec.title.toLowerCase()}" has no field for ${unmapped.map((k) => INPUT_LABEL[k]).join(", ")}, so I can't set ${unmapped.length > 1 ? "them" : "it"}.`;
  return undefined;
}

function load(inputs: Record<string, string>): { b: Binding; task: Task; action: UserAction } {
  const action = (inputs.action ?? "").trim().toLowerCase() as UserAction;
  const b = getBinding(action);
  if (!b) throw new Error(`There's no recorded workflow for "${action}" any more.`);
  const task = getTask(b.taskId);
  if (!task) throw new Error("The recorded workflow no longer exists. Record it again and pick it on the Workflows page.");
  const bad = bindingIssues(b, task).errors;
  if (bad.length) throw new Error(`The workflow needs fixing: ${bad[0]}`);
  return { b, task, action };
}

const describe = (action: UserAction, i: Record<string, string>) =>
  `${cap1(ACTIONS[action].title.toLowerCase())}${i.dealer ? ` at ${i.dealer}` : ""}\n` + INPUT_KEYS.filter((k) => i[k]?.trim()).map((k) => `  ${cap1(INPUT_LABEL[k].replace(/^the /, ""))}: ${i[k]}`).join("\n");

function previewText(action: UserAction, inputs: Record<string, string>, fields: FormField[]): string {
  const shown = fields.filter((f) => f.value.trim());
  return `${describe(action, inputs)}\n\nThe form in CMS admin, filled in and NOT saved:\n${shown.length ? shown.map((f) => `  ${f.label}: ${f.value}`).join("\n") : "  (no fields could be read from the page)"}\n\nApproving presses Save.`;
}

async function runWorkflow(b: Binding, task: Task, inputs: Record<string, string>, options: Parameters<typeof runToCompletion>[1], ctx: RunContext) {
  const vars = variablesFor(b, inputs);
  const missing = missingRequired(task, vars);
  if (missing.length) throw new Error(`The workflow needs a value for ${missing.map((v) => `"${v.label}"`).join(", ")} that I wasn't given.`);
  const run = newRun(task.id, task.steps.length, vars);
  const done = await runToCompletion(run, { headless: true, ...options }, ctx.signal);
  if (done.status === "needs_attention") throw new Error(done.attention ?? done.error ?? "The browser run stopped for attention.");
  if (done.status !== "succeeded") throw new Error(done.error ?? `The browser run ${done.status}.`);
  return done;
}

export const cmsUserCapability: Capability = {
  id: "cms_admin.manage_user",
  worker: "cms_admin",
  title: "Create, change or deactivate a user in CMS admin",
  description:
    "Creates, changes or deactivates a user profile in CMS admin by running the workflow recorded for that job, in its own browser. Before it is approved, it fills in the form WITHOUT saving and shows you exactly how the form looks; approving presses Save, and it only counts as done if CMS confirms. " +
    "action=create needs dealer, name, email and role. action=update needs email and what to change (role, name and/or dealer). action=deactivate needs email. Never guess a missing detail: leave the step out and ask.",
  risk: "changes_data",
  inputs: {
    action: { description: "create, update or deactivate", required: true },
    dealer: { description: "The dealer or branch the user belongs to, as the client wrote it" },
    name: { description: "The user's full name" },
    email: { description: "The user's e-mail address, exactly as written", required: true },
    role: { description: "The role or access level, as the client wrote it" },
  },
  timeoutMs: 300_000,
  get available() { return listBindings().some((b) => bindingIssues(b).errors.length === 0); },
  get unavailableReason() { return "no recorded workflow is set up for it yet (see the Workflows page)"; },
  validate: validateUserRequest,
  lockKey: (i) => `cms-user:${(i.email || i.name || "").trim().toLowerCase()}`,

  async preview(inputs, ctx): Promise<Preview> {
    const { b, task, action } = load(inputs);
    const done = await runWorkflow(b, task, inputs, { stopBeforeStep: b.commitStep }, ctx);
    const prepared = done.outcome?.prepared;
    if (!prepared) throw new Error("The workflow finished without stopping before Save, so there's nothing to approve safely. Check which step is set as the Save.");
    return { text: previewText(action, inputs, prepared.fields), image: prepared.screenshot, data: { fields: prepared.fields, runId: done.id, commitStep: b.commitStep } };
  },

  async run(inputs, ctx) {
    const { b, task, action } = load(inputs);
    const approved = ctx.preview?.data?.fields as FormField[] | undefined;
    if (!approved) throw new Error("There's no approved preview to compare against, so nothing was saved.");
    const done = await runWorkflow(b, task, inputs, { commitStep: b.commitStep, approvedForm: approved, expectText: b.expectText }, ctx);
    if (done.outcome?.verified !== true) {
      throw new Error(`Save was pressed but could not be confirmed: ${done.outcome?.note ?? "no confirmation"} Check CMS admin before doing anything else. If the change is not there, retry (it asks for approval again).`);
    }
    return { action, saved: true, verified: true, dealer: inputs.dealer ?? null, name: inputs.name ?? null, email: inputs.email, role: inputs.role ?? null, confirmedBy: b.expectText, runId: done.id };
  },
};
