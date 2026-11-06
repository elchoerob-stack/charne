/**
 * Jira Cloud client for the support desk: create a ticket, assign it, tag it
 * (Product Support + the dealer group), comment, and close it.
 *
 * It talks to the REST API with an API token rather than driving the Jira web
 * page. That is faster, it cannot mis-click, and it needs no daily login.
 *
 * Which Jira field means "Product Support" and which means "group" differs
 * between sites, so both are configured as a small tag spec:
 *
 *   component:Product Support        a Jira component
 *   label:product-support            a label
 *   option:customfield_10042:Value   a single-select custom field
 *   text:customfield_10043:Value     a plain-text custom field
 *
 * JIRA_SUPPORT_TAG  – the spec, with its value, that marks Product Support.
 * JIRA_GROUP_TAG    – the spec without a value (e.g. `component` or
 *                     `option:customfield_10042`); the group name is the value.
 */

import { DEFAULT_FIELD_NAMES, adfToText, fieldsToWrite, parseMeta, planFields, type FieldMeta, type FieldNames, type FieldPlan } from "./fields.js";

export interface JiraConfig {
  baseUrl: string;
  email: string;
  token: string;
  projectKey: string;
  issueType: string;
  /** Tag spec incl. value, e.g. "component:Product Support". */
  supportTag?: string;
  /** Tag spec without a value, e.g. "label" or "option:customfield_10042". */
  groupTag?: string;
  /** Transition name used to close a ticket. */
  doneTransition: string;
  /** Overrides the assignee; default is whoever owns the API token. */
  assigneeAccountId?: string;
  /** The fields that must be filled before a ticket can be closed, by their names in Jira. */
  fieldNames: FieldNames;
  /** Value for Support Enquiry. The CMS desk files these under "Product Support". */
  enquiryValue: string;
}

export function jiraConfig(env: NodeJS.ProcessEnv = process.env): JiraConfig | undefined {
  const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY } = env;
  if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN || !JIRA_PROJECT_KEY) return undefined;
  return {
    baseUrl: JIRA_BASE_URL.replace(/\/$/, ""),
    email: JIRA_EMAIL,
    token: JIRA_API_TOKEN,
    projectKey: JIRA_PROJECT_KEY,
    issueType: env.JIRA_ISSUE_TYPE || "Task",
    supportTag: env.JIRA_SUPPORT_TAG || undefined,
    groupTag: env.JIRA_GROUP_TAG || undefined,
    doneTransition: env.JIRA_DONE_TRANSITION || "Done",
    assigneeAccountId: env.JIRA_ASSIGNEE_ACCOUNT_ID || undefined,
    fieldNames: { agent: env.JIRA_AGENT_FIELD || DEFAULT_FIELD_NAMES.agent, enquiry: env.JIRA_ENQUIRY_FIELD || DEFAULT_FIELD_NAMES.enquiry, group: env.JIRA_GROUP_FIELD || DEFAULT_FIELD_NAMES.group },
    enquiryValue: env.JIRA_ENQUIRY_VALUE || "Product Support",
  };
}

export interface TicketDraft {
  summary: string;
  /** Plain-text paragraphs. Blank lines separate paragraphs. */
  description: string;
  /** Dealer group the ticket belongs to, when known. */
  group?: string;
}

type Fields = Record<string, unknown>;

/** Adds one tag to the issue fields. Throws on a spec it does not understand, so a typo cannot silently drop the tag. */
export function applyTag(fields: Fields, spec: string, value?: string): void {
  const parts = spec.split(":");
  const kind = parts[0];
  if (kind === "component") {
    const v = parts.slice(1).join(":") || value;
    if (!v) throw new Error(`Tag "${spec}" needs a value`);
    ((fields.components ??= []) as unknown[]).push({ name: v });
  } else if (kind === "label") {
    // Jira labels cannot contain spaces.
    const v = (parts.slice(1).join(":") || value || "").trim().replace(/\s+/g, "-");
    if (!v) throw new Error(`Tag "${spec}" needs a value`);
    ((fields.labels ??= []) as unknown[]).push(v);
  } else if (kind === "option" || kind === "text") {
    const field = parts[1];
    const v = parts.slice(2).join(":") || value;
    if (!field?.startsWith("customfield_")) throw new Error(`Tag "${spec}" needs a customfield_ id`);
    if (!v) throw new Error(`Tag "${spec}" needs a value`);
    fields[field] = kind === "option" ? { value: v } : v;
  } else {
    throw new Error(`Unknown tag type "${kind}" in "${spec}". Use component:, label:, option: or text:`);
  }
}

/** Atlassian Document Format from plain text. */
export function adf(text: string) {
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return {
    type: "doc", version: 1,
    content: (paras.length ? paras : [""]).map((p) => ({
      type: "paragraph",
      content: p.split("\n").flatMap((line, i) => (i ? [{ type: "hardBreak" }, { type: "text", text: line }] : [{ type: "text", text: line }])).filter((n) => n.type !== "text" || (n as { text: string }).text !== ""),
    })),
  };
}

/** The exact fields that will be sent. Pure, so the approval screen can show them before anything is created. */
export function buildIssueFields(cfg: JiraConfig, draft: TicketDraft): Fields {
  const fields: Fields = {
    project: { key: cfg.projectKey },
    issuetype: { name: cfg.issueType },
    summary: draft.summary.replace(/\s+/g, " ").trim().slice(0, 250),
    description: adf(draft.description.slice(0, 30000)),
  };
  if (cfg.supportTag) applyTag(fields, cfg.supportTag);
  if (cfg.groupTag && draft.group) applyTag(fields, cfg.groupTag, draft.group);
  return fields;
}

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface TicketSnapshot {
  key: string; url: string; summary: string; description: string; reporter: string; status: string;
  assignee?: { accountId: string; displayName: string };
  raw: Record<string, unknown>;
}

export interface FieldsStatus {
  plan: FieldPlan[];
  assignee: { ok: boolean; name?: string };
  /** True when the assignee and every required field are filled. */
  complete: boolean;
  /** What is still empty, in words. */
  missing: string[];
}

export interface CreatedTicket { key: string; url: string; assigned: boolean; warnings: string[] }

export class JiraClient {
  constructor(private cfg: JiraConfig, private doFetch: FetchLike = fetch as unknown as FetchLike) {}

  private async call<T = unknown>(path: string, method = "GET", body?: unknown): Promise<T> {
    const res = await this.doFetch(`${this.cfg.baseUrl}/rest/api/3${path}`, {
      method,
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Basic ${Buffer.from(`${this.cfg.email}:${this.cfg.token}`).toString("base64")}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const raw = await res.text();
    let parsed: unknown = undefined;
    try { parsed = raw ? JSON.parse(raw) : undefined; } catch { /* non-JSON error page */ }
    if (!res.ok) {
      const p = parsed as { errorMessages?: string[]; errors?: Record<string, string> } | undefined;
      const detail = [...(p?.errorMessages ?? []), ...Object.entries(p?.errors ?? {}).map(([k, v]) => `${k}: ${v}`)].join("; ");
      throw new Error(`Jira ${res.status} on ${method} ${path}${detail ? ` — ${detail}` : ""}`);
    }
    return parsed as T;
  }

  private async myAccountId(): Promise<string> {
    if (this.cfg.assigneeAccountId) return this.cfg.assigneeAccountId;
    return (await this.call<{ accountId: string }>("/myself")).accountId;
  }

  /** Creates the ticket, then assigns it. A failed assignment does not lose the ticket; it comes back as a warning. */
  async createTicket(draft: TicketDraft): Promise<CreatedTicket> {
    const created = await this.call<{ key: string }>("/issue", "POST", { fields: buildIssueFields(this.cfg, draft) });
    const out: CreatedTicket = { key: created.key, url: `${this.cfg.baseUrl}/browse/${created.key}`, assigned: false, warnings: [] };
    try {
      await this.call(`/issue/${created.key}/assignee`, "PUT", { accountId: await this.myAccountId() });
      out.assigned = true;
    } catch (err) {
      out.warnings.push(`Ticket ${created.key} was created but could not be assigned: ${(err as Error).message}`);
    }
    return out;
  }

  async me(): Promise<{ accountId: string; displayName: string }> {
    const m = await this.call<{ accountId: string; displayName?: string }>("/myself");
    return { accountId: this.cfg.assigneeAccountId ?? m.accountId, displayName: m.displayName ?? this.cfg.email };
  }

  /** Reads a ticket the way the desk sees it: who raised it, what they wrote, who has it. */
  async getTicket(key: string, extraFields: string[] = []): Promise<TicketSnapshot> {
    const fields = ["summary", "description", "reporter", "assignee", "status", ...extraFields].join(",");
    const r = await this.call<{ key: string; fields: Record<string, any> }>(`/issue/${encodeURIComponent(key)}?fields=${encodeURIComponent(fields)}`);
    const f = r.fields ?? {};
    return {
      key: r.key, url: `${this.cfg.baseUrl}/browse/${r.key}`,
      summary: String(f.summary ?? ""),
      description: adfToText(f.description).trim(),
      reporter: f.reporter ? `${f.reporter.displayName ?? ""}${f.reporter.emailAddress ? ` <${f.reporter.emailAddress}>` : ""}`.trim() : "",
      status: String(f.status?.name ?? ""),
      assignee: f.assignee ? { accountId: f.assignee.accountId, displayName: f.assignee.displayName } : undefined,
      raw: f,
    };
  }

  private async editMeta(key: string): Promise<FieldMeta[]> {
    const r = await this.call<{ fields?: Record<string, any> }>(`/issue/${encodeURIComponent(key)}/editmeta`);
    return Object.entries(r.fields ?? {}).map(([id, raw]) => parseMeta(id, raw));
  }

  /** What each required field holds now and what could go in it. Read-only. */
  async fieldsStatus(key: string, ctx: { group?: string; dealers: string[] }): Promise<FieldsStatus & { metas: FieldMeta[]; me: { accountId: string; displayName: string } }> {
    const [metas, me] = await Promise.all([this.editMeta(key), this.me()]);
    const names = Object.values(this.cfg.fieldNames).map((n) => n.toLowerCase());
    const wanted = metas.filter((m) => names.includes(m.name.toLowerCase()));
    const ticket = await this.getTicket(key, wanted.map((m) => m.id));
    const plan = planFields(this.cfg.fieldNames, metas, ticket.raw, { me, enquiry: [this.cfg.enquiryValue], group: ctx.group, dealers: ctx.dealers });
    const assigneeOk = ticket.assignee?.accountId === me.accountId;
    const missing = [...(assigneeOk ? [] : ["Assignee"]), ...plan.filter((p) => !p.filled).map((p) => p.name)];
    return { plan, assignee: { ok: assigneeOk, name: ticket.assignee?.displayName }, complete: missing.length === 0, missing, metas, me };
  }

  /** Fills the required fields (the confident matches plus the operator's choices) and takes the ticket. Throws rather than guess. */
  async fillFields(key: string, ctx: { group?: string; dealers: string[] }, choices: Record<string, string> = {}): Promise<{ written: string[]; status: FieldsStatus }> {
    const st = await this.fieldsStatus(key, ctx);
    const { fields, summary } = fieldsToWrite(st.plan, st.metas, choices, st.me);
    if (Object.keys(fields).length) await this.call(`/issue/${encodeURIComponent(key)}`, "PUT", { fields });
    if (!st.assignee.ok) { await this.call(`/issue/${encodeURIComponent(key)}/assignee`, "PUT", { accountId: st.me.accountId }); summary.unshift(`Assignee → ${st.me.displayName}`); }
    const after = await this.fieldsStatus(key, ctx);
    return { written: summary, status: after };
  }

  async comment(key: string, text: string): Promise<void> {
    await this.call(`/issue/${key}/comment`, "POST", { body: adf(text) });
  }

  /** Moves the ticket to its done state. Fails loudly, with the available transitions, rather than guessing. */
  async close(key: string): Promise<{ transition: string }> {
    const { transitions } = await this.call<{ transitions: { id: string; name: string; to?: { name?: string; statusCategory?: { key?: string } } }[] }>(`/issue/${key}/transitions`);
    const want = this.cfg.doneTransition.toLowerCase();
    const t = transitions.find((x) => x.name.toLowerCase() === want) ?? transitions.find((x) => x.to?.name?.toLowerCase() === want);
    if (!t) throw new Error(`No "${this.cfg.doneTransition}" transition on ${key}. Available: ${transitions.map((x) => x.name).join(", ") || "none"}. Set JIRA_DONE_TRANSITION to one of them.`);
    await this.call(`/issue/${key}/transitions`, "POST", { transition: { id: t.id } });
    return { transition: t.name };
  }
}
