/**
 * The Jira fields that must be filled before a ticket can be closed.
 *
 * On the CMS service desk these are pinned on every ticket: Assignee, Support
 * Agent, Support Enquiry, and Group and Dealership. They are custom fields
 * whose ids and types differ between sites, so Foreman finds them by *name*
 * from the ticket's own edit screen, reads their allowed values, and works out
 * what to put in each.
 *
 * The rule throughout is: fill a field only when exactly one allowed value
 * clearly matches. An ambiguous or missing match is never guessed. It is
 * returned as "needs a choice" with the options, and the operator picks.
 */

export interface AllowedValue { id?: string; label: string; children?: AllowedValue[] }

export interface FieldMeta {
  id: string;
  name: string;
  /** Jira schema type: option, option-with-child, array, user, string, ... */
  type: string;
  /** For arrays, the item type. */
  items?: string;
  allowed: AllowedValue[];
}

export interface FieldNames { agent: string; enquiry: string; group: string }

export const DEFAULT_FIELD_NAMES: FieldNames = { agent: "Support Agent", enquiry: "Support Enquiry", group: "Group and Dealership" };

export type FieldRole = "agent" | "enquiry" | "group";

export interface FieldPlan {
  role: FieldRole;
  name: string;
  id?: string;
  /** supported: can be set from here. missing: not on this ticket's edit screen. unsupported: a field type this cannot write. */
  kind: "supported" | "missing" | "unsupported";
  /** What the ticket holds now, as text. Empty when unset. */
  current: string;
  filled: boolean;
  /** What would be written if the operator applies, when exactly one value clearly matches. */
  proposal?: { label: string; payload: unknown };
  /** Every label the operator can choose from. Empty for free-text and user fields. */
  options: string[];
  note?: string;
}

export interface PlanContext {
  me: { accountId: string; displayName: string };
  /** Candidate labels for Support Enquiry, best first. */
  enquiry: string[];
  group?: string;
  dealers: string[];
}

const SEP = " › ";
export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The single option that clearly fits one wanted text: an exact match, else a unique loose one. Ambiguous means none. */
function resolveOne(options: AllowedValue[], x: string): AllowedValue | undefined {
  const exact = options.filter((o) => norm(o.label) === x);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return undefined;
  if (x.length < 4) return undefined;
  const loose = options.filter((o) => { const n = norm(o.label); return n.length >= 4 && (n.includes(x) || x.includes(n)); });
  return loose.length === 1 ? loose[0] : undefined;
}

/**
 * The one option every wanted text points at, or nothing. If the wanted texts
 * point at different options (a ticket about two dealers), that is a choice for
 * a person, not something to settle by taking the first.
 */
export function matchOne(options: AllowedValue[], wanted: (string | undefined)[]): AllowedValue | undefined {
  const hits = new Map<AllowedValue, true>();
  for (const x of wanted.map((w) => norm(w ?? "")).filter(Boolean)) {
    const r = resolveOne(options, x);
    if (r) hits.set(r, true);
  }
  return hits.size === 1 ? [...hits.keys()][0] : undefined;
}

/** Reads one field out of Jira's edit metadata. */
export function parseMeta(id: string, raw: { name?: string; schema?: { type?: string; items?: string }; allowedValues?: any[] }): FieldMeta {
  const label = (v: any): AllowedValue => ({
    id: v.id ?? undefined,
    label: String(v.value ?? v.name ?? v.displayName ?? ""),
    children: Array.isArray(v.cascadingOptions) ? v.cascadingOptions.map(label) : undefined,
  });
  return { id, name: raw.name ?? id, type: raw.schema?.type ?? "unknown", items: raw.schema?.items, allowed: (raw.allowedValues ?? []).map(label).filter((a) => a.label) };
}

/** Text for whatever value a field holds, so the screen can show "Morgan › Toyota Kimberley". */
export function valueText(v: unknown): string {
  if (v == null || v === "") return "";
  if (Array.isArray(v)) return v.map(valueText).filter(Boolean).join(", ");
  if (typeof v === "object") {
    const o = v as { value?: string; name?: string; displayName?: string; accountId?: string; child?: unknown };
    // A field that holds something must never read as empty, even if Jira sent no display text.
    const base = o.value ?? o.name ?? o.displayName ?? o.accountId ?? (Object.keys(o).length ? "(set)" : "");
    const child = o.child ? valueText(o.child) : "";
    return child ? `${base}${SEP}${child}` : String(base);
  }
  return String(v);
}

/** Every label an operator can pick, flattened ("Group › Dealership" for cascading fields). */
export function optionLabels(m: FieldMeta): string[] {
  if (m.type === "option-with-child") return m.allowed.flatMap((p) => (p.children?.length ? p.children.map((c) => `${p.label}${SEP}${c.label}`) : [p.label]));
  return m.allowed.map((a) => a.label);
}

/** The JSON Jira wants for a chosen label, or undefined if the label is not an allowed one. */
export function payloadFor(m: FieldMeta, label: string, me?: PlanContext["me"]): unknown {
  const ref = (a: AllowedValue) => (a.id ? { id: a.id } : { value: a.label });
  const one = (): unknown => {
    if (m.type === "user") return me && norm(label) === norm(me.displayName) ? { accountId: me.accountId } : undefined;
    if (m.type === "string") return label;
    if (m.type === "option-with-child") {
      const [p, c] = label.split(SEP).map((s) => s.trim());
      const parent = m.allowed.find((a) => norm(a.label) === norm(p ?? ""));
      if (!parent) return undefined;
      if (!c) return parent.children?.length ? undefined : ref(parent);
      const child = parent.children?.find((a) => norm(a.label) === norm(c));
      return child ? { ...ref(parent), child: ref(child) } : undefined;
    }
    const hit = m.allowed.find((a) => norm(a.label) === norm(label));
    return hit ? ref(hit) : undefined;
  };
  const v = one();
  if (v === undefined) return undefined;
  return m.type === "array" ? [v] : v;
}

function proposeFor(role: FieldRole, m: FieldMeta, ctx: PlanContext): { label: string; payload: unknown } | undefined {
  const make = (label: string) => { const payload = payloadFor(m, label, ctx.me); return payload === undefined ? undefined : { label, payload }; };
  const elementType = m.type === "array" ? m.items ?? "option" : m.type;
  const asOption: FieldMeta = m.type === "array" ? { ...m, type: elementType } : m;

  if (role === "agent") {
    if (elementType === "user" || elementType === "string") return make(ctx.me.displayName);
    const hit = matchOne(asOption.allowed, [ctx.me.displayName]);
    return hit ? make(hit.label) : undefined;
  }
  if (role === "enquiry") {
    const hit = matchOne(asOption.allowed, ctx.enquiry);
    return hit ? make(hit.label) : undefined;
  }
  // group and dealership
  if (elementType === "option-with-child") {
    const parent = matchOne(asOption.allowed, [ctx.group]);
    if (parent) {
      const child = parent.children?.length ? matchOne(parent.children, ctx.dealers) : undefined;
      if (child) return make(`${parent.label}${SEP}${child.label}`);
      return parent.children?.length ? undefined : make(parent.label);
    }
    // No group given: a dealership that exists under exactly one group tells us the group.
    const all = asOption.allowed.flatMap((p) => (p.children ?? []).map((c) => ({ p, c })));
    const found = new Map<string, { p: AllowedValue; c: AllowedValue }>();
    for (const d of ctx.dealers.map(norm).filter((x) => x.length >= 4)) {
      const hits = all.filter(({ c }) => norm(c.label) === d);
      if (hits.length === 1) found.set(`${hits[0].p.label}${SEP}${hits[0].c.label}`, hits[0]);
    }
    // Several different dealerships named (one ticket about many dealers) is the operator's call.
    return found.size === 1 ? make([...found.keys()][0]) : undefined;
  }
  const hit = matchOne(asOption.allowed, [ctx.group, ...ctx.dealers]);
  return hit ? make(hit.label) : undefined;
}

export function planFields(names: FieldNames, metas: FieldMeta[], current: Record<string, unknown>, ctx: PlanContext): FieldPlan[] {
  const roles: FieldRole[] = ["agent", "enquiry", "group"];
  return roles.map((role) => {
    const name = names[role];
    const meta = metas.find((m) => norm(m.name) === norm(name));
    if (!meta) return { role, name, kind: "missing", current: "", filled: false, options: [], note: `"${name}" is not on this ticket's edit screen, so it cannot be set from here. Set it in Jira.` };
    const type = meta.type === "array" ? meta.items ?? "option" : meta.type;
    if (!["option", "option-with-child", "user", "string"].includes(type)) return { role, name, id: meta.id, kind: "unsupported", current: valueText(current[meta.id]), filled: valueText(current[meta.id]) !== "", options: [], note: `"${name}" is a ${meta.type} field, which Foreman cannot set. Set it in Jira.` };
    const cur = valueText(current[meta.id]);
    const proposal = cur ? undefined : proposeFor(role, meta, ctx);
    return { role, name, id: meta.id, kind: "supported", current: cur, filled: cur !== "", proposal, options: optionLabels(meta) };
  });
}

/** Turns the operator's choices (and the confident proposals) into the fields to write. Throws if something would have to be guessed. */
export function fieldsToWrite(plan: FieldPlan[], metas: FieldMeta[], choices: Record<string, string>, me: PlanContext["me"]): { fields: Record<string, unknown>; summary: string[] } {
  const fields: Record<string, unknown> = {};
  const summary: string[] = [];
  const problems: string[] = [];
  for (const p of plan) {
    const chosen = choices[p.name]?.trim();
    if (p.kind !== "supported") { if (!p.filled) problems.push(p.note ?? `${p.name} cannot be set from here`); continue; }
    if (p.filled && !chosen) continue; // never overwrite what is there unless asked
    const meta = metas.find((m) => m.id === p.id)!;
    let payload: unknown, label: string;
    if (chosen) {
      payload = payloadFor(meta, chosen, me); label = chosen;
      if (payload === undefined) { problems.push(`"${chosen}" is not an allowed value for ${p.name}`); continue; }
    } else if (p.proposal) { payload = p.proposal.payload; label = p.proposal.label; }
    else { problems.push(`${p.name} needs a choice (nothing matched clearly)`); continue; }
    fields[p.id!] = payload; summary.push(`${p.name} → ${label}`);
  }
  if (problems.length) throw new Error(problems.join("; "));
  return { fields, summary };
}

/** Atlassian Document Format back to plain text, for reading the client's e-mail from a ticket. */
export function adfToText(node: any): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  switch (node.type) {
    case "text": return node.text ?? "";
    case "hardBreak": return "\n";
    case "mention": return node.attrs?.text ?? "";
    case "emoji": return node.attrs?.text ?? "";
    case "inlineCard": return node.attrs?.url ?? "";
    case "tableCell": case "tableHeader": return (node.content ?? []).map(adfToText).join(" ").trim() + " | ";
    case "tableRow": return (node.content ?? []).map(adfToText).join("") + "\n";
  }
  const inner = Array.isArray(node.content) ? node.content.map(adfToText).join("") : "";
  const block = ["paragraph", "heading", "listItem", "blockquote", "codeBlock", "rule", "panel"].includes(node.type);
  return block ? inner.replace(/\s+$/, "") + "\n\n" : inner;
}
