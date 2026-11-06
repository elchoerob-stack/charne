import { CATEGORY_IDS, classifyEmail, type Category, type Classification } from "./classify.js";
import { JiraClient, buildIssueFields, jiraConfig, type FieldsStatus, type TicketDraft } from "./jira.js";
import { draftReply } from "./reply.js";
import { audit, createJob, findByTicket, getJob, save, type SupportJob } from "./store.js";

/**
 * The rules of the support desk, in one place.
 *
 * The important ones:
 *   - Pasting an e-mail only *proposes*. Nothing is created in Jira until
 *     createTicket() is called, and that is a separate, explicit step.
 *   - A ticket is created once per job. Asking twice returns the first ticket
 *     rather than a duplicate.
 *   - A job is only marked done after Jira has accepted the close. If Jira
 *     refuses, the job stays open and says why.
 *   - Only a finished job can be archived.
 */

export class SupportError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface Deps {
  jira: () => JiraClient | undefined;
  classify: typeof classifyEmail;
  reply: typeof draftReply;
}

export const defaultDeps: Deps = {
  jira: () => { const c = jiraConfig(); return c ? new JiraClient(c) : undefined; },
  classify: classifyEmail,
  reply: draftReply,
};

function need(id: string): SupportJob {
  const job = getJob(id);
  if (!job) throw new SupportError(404, "No such job");
  return job;
}

export async function intake(email: string, hints: { dealer?: string; group?: string } = {}, deps: Deps = defaultDeps): Promise<SupportJob> {
  const text = email.trim();
  if (!text) throw new SupportError(400, "Paste the e-mail text first");
  const classification = await deps.classify(text, hints);
  const job = createJob(text, classification);
  job.reply = { ...(await deps.reply(job)), draftedAt: new Date().toISOString() };
  save(job);
  return job;
}

const KEY = /^[A-Z][A-Z0-9]+-\d+$/;

/**
 * Loads a ticket that already exists in Jira (the desk makes one from every
 * client e-mail), reads what the client wrote, and sorts it like a pasted e-mail.
 * Read-only: nothing in Jira changes. Loading the same ticket twice returns the same job.
 */
export async function importTicket(rawKey: string, deps: Deps = defaultDeps): Promise<SupportJob> {
  const key = rawKey.trim().toUpperCase().replace(/^.*\/browse\//i, "").replace(/\?.*$/, "");
  if (!KEY.test(key)) throw new SupportError(400, "That doesn't look like a Jira ticket key. Use something like CS-259412.");
  const known = findByTicket(key);
  if (known) return known;
  const jira = deps.jira();
  if (!jira) throw new SupportError(412, "Jira is not set up. Add JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN and JIRA_PROJECT_KEY to server/.env and restart.");
  let t;
  try { t = await jira.getTicket(key); } catch (err) { throw new SupportError(502, (err as Error).message); }
  const me = await jira.me().catch(() => undefined);
  const email = `From: ${t.reporter || "unknown"}\nSubject: ${t.summary}\n\n${t.description}`.trim();
  const classification = await deps.classify(email, {});
  const job = createJob(email, classification, { key: t.key, url: t.url, assigned: Boolean(me && t.assignee?.accountId === me.accountId), createdAt: new Date().toISOString() });
  job.reply = { ...(await deps.reply(job)), draftedAt: new Date().toISOString() };
  return save(job);
}

/** Corrections made on the screen before approving. Only while nothing has been created yet. */
export function correct(id: string, patch: Partial<Pick<Classification, "category" | "summary" | "dealers" | "group" | "requester" | "missing">>): SupportJob {
  const job = need(id);
  // An imported ticket is already in Jira, but its type, dealers and group only steer what Foreman proposes, so they stay editable until done.
  const editable = job.status === "proposed" || (job.source === "ticket" && job.status === "open");
  if (!editable) throw new SupportError(409, "The ticket already exists, so the details are fixed. Edit them in Jira.");
  const c = job.classification;
  for (const k of ["dealers", "missing"] as const) if (patch[k] !== undefined && !Array.isArray(patch[k])) throw new SupportError(400, `${k} must be a list`);
  if (patch.category !== undefined) {
    if (!CATEGORY_IDS.includes(patch.category)) throw new SupportError(400, `Unknown category "${patch.category}"`);
    c.category = patch.category as Category;
    c.risk = c.category === "how_to" || c.category === "other" ? "read_only" : "changes_data";
  }
  if (patch.summary !== undefined) c.summary = String(patch.summary).slice(0, 200);
  if (patch.dealers !== undefined) c.dealers = patch.dealers.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 50);
  if (patch.group !== undefined) c.group = String(patch.group).trim() || undefined;
  if (patch.requester !== undefined) c.requester = String(patch.requester).trim() || undefined;
  if (patch.missing !== undefined) c.missing = patch.missing.map(String).map((s) => s.trim()).filter(Boolean);
  audit(id, "corrected", Object.keys(patch).join(", "));
  return save(job);
}

export function ticketDraft(job: SupportJob): TicketDraft {
  const c = job.classification;
  const lines = [
    `Type: ${c.category.replace(/_/g, " ")}`,
    c.requester && `From: ${c.requester}`,
    c.dealers.length && `Dealer${c.dealers.length > 1 ? "s" : ""}: ${c.dealers.join(", ")}`,
    c.group && `Group: ${c.group}`,
  ].filter(Boolean).join("\n");
  const asks = c.asks.length ? `Requested:\n${c.asks.map((a) => `- ${a}`).join("\n")}` : "";
  const missing = c.missing.length ? `Still needed from the client:\n${c.missing.map((m) => `- ${m}`).join("\n")}` : "";
  return {
    summary: c.summary,
    group: c.group,
    description: [lines, asks, missing, `Original e-mail:\n${job.email.slice(0, 8000)}`].filter(Boolean).join("\n\n"),
  };
}

/** What would be sent to Jira, without sending it. Powers the approval screen. */
export function previewTicket(id: string): { configured: boolean; draft: TicketDraft; fields?: Record<string, unknown>; error?: string } {
  const job = need(id);
  const draft = ticketDraft(job);
  const cfg = jiraConfig();
  if (!cfg) return { configured: false, draft };
  try { return { configured: true, draft, fields: buildIssueFields(cfg, draft) }; }
  catch (err) { return { configured: true, draft, error: (err as Error).message }; }
}

export async function createTicket(id: string, deps: Deps = defaultDeps): Promise<SupportJob> {
  const job = need(id);
  if (job.ticket) return job; // already done: never a second ticket
  if (job.status !== "proposed") throw new SupportError(409, `This job is ${job.status}`);
  const jira = deps.jira();
  if (!jira) throw new SupportError(412, "Jira is not set up. Add JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN and JIRA_PROJECT_KEY to server/.env and restart.");
  let made;
  try { made = await jira.createTicket(ticketDraft(job)); }
  catch (err) { audit(id, "ticket-failed", (err as Error).message); throw new SupportError(502, (err as Error).message); }
  job.ticket = { key: made.key, url: made.url, assigned: made.assigned, createdAt: new Date().toISOString() };
  job.warnings.push(...made.warnings);
  job.status = "open";
  save(job);
  audit(id, "ticket-created", `${made.key}${made.assigned ? " (assigned)" : " (NOT assigned)"}`);
  // The acknowledgement now carries the reference. A failure here must not undo the ticket.
  try { job.reply = { ...(await deps.reply(job)), draftedAt: new Date().toISOString() }; save(job); } catch { /* keep the earlier draft */ }
  return job;
}

/** Read-only: what each required field holds now and what Foreman would put in it. */
export async function fieldsStatus(id: string, deps: Deps = defaultDeps): Promise<Omit<FieldsStatus, never> | { configured: false }> {
  const job = need(id);
  if (!job.ticket) throw new SupportError(409, "There is no Jira ticket for this job yet.");
  const jira = deps.jira();
  if (!jira) return { configured: false };
  try {
    const { plan, assignee, complete, missing } = await jira.fieldsStatus(job.ticket.key, { group: job.classification.group, dealers: job.classification.dealers });
    return { plan, assignee, complete, missing };
  } catch (err) { throw new SupportError(502, (err as Error).message); }
}

/** Fills the required fields and takes the ticket. Explicit and operator-triggered; refuses rather than guesses. */
export async function fillFields(id: string, choices: Record<string, string> = {}, deps: Deps = defaultDeps): Promise<{ written: string[]; status: FieldsStatus }> {
  const job = need(id);
  if (!job.ticket) throw new SupportError(409, "There is no Jira ticket for this job yet.");
  if (job.status === "done") throw new SupportError(409, "This job is already done.");
  const jira = deps.jira();
  if (!jira) throw new SupportError(412, "Jira is not set up.");
  try {
    const r = await jira.fillFields(job.ticket.key, { group: job.classification.group, dealers: job.classification.dealers }, choices);
    job.ticket.assigned = r.status.assignee.ok; save(job);
    audit(id, "fields-filled", r.written.join("; ") || "nothing to change");
    return r;
  } catch (err) {
    audit(id, "fields-failed", (err as Error).message);
    throw new SupportError(422, (err as Error).message);
  }
}

export async function redraft(id: string, instruction?: string, deps: Deps = defaultDeps): Promise<SupportJob> {
  const job = need(id);
  job.reply = { ...(await deps.reply(job, { done: job.status === "done", instruction: instruction?.slice(0, 1000) })), draftedAt: new Date().toISOString() };
  audit(id, "reply-drafted", instruction ? `instruction: ${instruction.slice(0, 200)}` : "");
  return save(job);
}

export async function complete(id: string, opts: { note?: string } = {}, deps: Deps = defaultDeps): Promise<SupportJob> {
  const job = need(id);
  if (job.status === "done") return job;
  if (job.ticket) {
    const jira = deps.jira();
    if (!jira) throw new SupportError(412, "Jira is not set up, so the ticket cannot be closed from here.");
    // The desk requires these on every closed ticket. Check first, so a close never half-happens.
    try {
      const st = await jira.fieldsStatus(job.ticket.key, { group: job.classification.group, dealers: job.classification.dealers });
      if (!st.complete) { audit(id, "close-blocked", `missing: ${st.missing.join(", ")}`); throw new SupportError(409, `Not closed. Still empty in Jira: ${st.missing.join(", ")}. Fill them in (the Required fields panel does it) and try again.`); }
    } catch (err) {
      if (err instanceof SupportError) throw err;
      throw new SupportError(502, `Could not check the required fields on ${job.ticket.key}: ${(err as Error).message}`);
    }
    try {
      if (opts.note?.trim()) await jira.comment(job.ticket.key, opts.note.trim());
      const { transition } = await jira.close(job.ticket.key);
      audit(id, "ticket-closed", `${job.ticket.key} via "${transition}"`);
    } catch (err) {
      audit(id, "close-failed", (err as Error).message);
      throw new SupportError(502, `The job was not marked done because Jira did not close ${job.ticket.key}: ${(err as Error).message}`);
    }
  }
  job.status = "done";
  job.completedAt = new Date().toISOString();
  save(job);
  audit(id, "done", job.ticket ? job.ticket.key : "no ticket");
  try { job.reply = { ...(await deps.reply(job, { done: true })), draftedAt: new Date().toISOString() }; save(job); } catch { /* keep the earlier draft */ }
  return job;
}

export function archive(id: string, archived = true): SupportJob {
  const job = need(id);
  if (archived && job.status !== "done") throw new SupportError(409, "Only a finished job can be archived. Complete it first.");
  job.archived = archived;
  audit(id, archived ? "archived" : "unarchived");
  return save(job);
}
