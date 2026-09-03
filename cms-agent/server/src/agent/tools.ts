import type Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, newId, now } from "../db.js";
import { diagnose, playbookFromCase, tokenize } from "../problem-solving/engine.js";
import type { Evidence, Playbook } from "../problem-solving/types.js";
import { compileSop, evidenceFromRecording, renderSopMarkdown } from "../recorder/sop.js";
import { Recording } from "../recorder/schema.js";
import { checkIntegration, type HealthResult, type SystemName } from "./integrations.js";
import { buildReport, getReport, listFiles, listReports, type ReportKind } from "../reports/store.js";

/* ── Tool plumbing ─────────────────────────────────────────────────────── */

export interface ToolContext {
  sessionId: string;
  dealer?: string;
  /** Health results gathered this session, so diagnose can use them as evidence. */
  health: Partial<Record<SystemName, HealthResult>>;
  emit: (event: Record<string, unknown>) => void;
}

export interface AgentTool {
  definition: Anthropic.Beta.BetaTool;
  run: (input: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

const here = path.dirname(fileURLToPath(import.meta.url));

/* ── Knowledge base ────────────────────────────────────────────────────── */

interface KbArticle { id: string; title: string; domain: string; tags: string[]; body: string }

function loadKb(): KbArticle[] {
  const candidates = [path.join(here, "../../knowledge/cms-kb.json"), path.join(here, "../knowledge/cms-kb.json"), path.resolve("knowledge/cms-kb.json")];
  for (const p of candidates) if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  return [];
}
const KB = loadKb();

/** Tiny BM25-style ranker over title/tags/body. */
export function searchKnowledge(query: string, domain?: string, limit = 5) {
  const q = tokenize(query);
  const docs = KB.filter((a) => !domain || a.domain === domain);
  const avg = docs.reduce((s, d) => s + tokenize(d.body).length, 0) / Math.max(1, docs.length);
  const df = new Map<string, number>();
  const toks = docs.map((d) => ({ d, tokens: [...tokenize(d.title + " " + d.tags.join(" ")), ...tokenize(d.body)] }));
  for (const { tokens } of toks) for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  const scored = toks.map(({ d, tokens }) => {
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const term of q) {
      const f = tf.get(term) ?? 0;
      if (!f) continue;
      const idf = Math.log(1 + (docs.length - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5));
      score += idf * ((f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (tokens.length / avg))));
      if (tokenize(d.title).includes(term)) score += 0.8;
    }
    return { d, score };
  }).filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  return scored.map(({ d, score }) => ({ id: d.id, title: d.title, domain: d.domain, score: Number(score.toFixed(2)), body: d.body }));
}

/* ── Learned playbooks ─────────────────────────────────────────────────── */

export function learnedPlaybooks(): Playbook[] {
  const rows = db.prepare("SELECT * FROM learned_playbooks").all() as { id: string; case_id: string; title: string; symptoms: string; resolution: string; domain: string; confirmations: number }[];
  return rows.map((r) => {
    const pb = playbookFromCase({ id: r.case_id, title: r.title, symptom: (JSON.parse(r.symptoms) as string[]).join(" "), resolution: (JSON.parse(r.resolution) as string[]).join("\n") });
    pb.id = r.id;
    pb.prior = Math.min(0.12, 0.03 * r.confirmations);
    return pb;
  });
}

/* ── Recording helpers ─────────────────────────────────────────────────── */

export function loadRecording(id: string): Recording | undefined {
  const row = db.prepare("SELECT data FROM recordings WHERE id = ?").get(id) as { data: string } | undefined;
  return row ? Recording.parse(JSON.parse(row.data)) : undefined;
}

/* ── Tools ─────────────────────────────────────────────────────────────── */

const tool = (definition: Anthropic.Beta.BetaTool, run: AgentTool["run"]): AgentTool => ({ definition, run });

export const TOOLS: AgentTool[] = [
  tool(
    {
      name: "search_knowledge",
      description: "Search the CMS knowledge base (product behaviour, Evolve DMS posting, Infomedia menus, authorisation, eVHC, dispatch, pricing, rollout checklist, escalation paths). Returns the best matching articles with their text.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "What you want to know, in plain words." },
          domain: { type: "string", enum: ["cms", "evolve", "infomedia", "comms", "device", "user"], description: "Optional domain filter." },
        },
        required: ["query"],
        additionalProperties: false,
      },
      strict: true,
    },
    async (input) => {
      const results = searchKnowledge(String(input.query), input.domain ? String(input.domain) : undefined);
      return results.length ? results : { results: [], note: "No article matched. Say so rather than guessing; consider web_search for non-CMS topics." };
    },
  ),

  tool(
    {
      name: "list_recordings",
      description: "List workflow recordings captured with the CMS Workflow Recorder (SOP captures and problem captures), newest first.",
      input_schema: {
        type: "object",
        properties: {
          dealer: { type: "string", description: "Filter by dealer code." },
          purpose: { type: "string", enum: ["sop", "problem"], description: "Filter by recording purpose." },
        },
        additionalProperties: false,
      },
    },
    async (input) => {
      const where: string[] = [];
      const args: unknown[] = [];
      if (input.dealer) { where.push("dealer = ?"); args.push(input.dealer); }
      if (input.purpose) { where.push("purpose = ?"); args.push(input.purpose); }
      const rows = db.prepare(`SELECT id, title, dealer, purpose, recorded_by, started_at, event_count FROM recordings ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT 25`).all(...args);
      return rows;
    },
  ),

  tool(
    {
      name: "get_workflow_sop",
      description: "Compile a workflow recording into a standard operating procedure: numbered steps grouped by screen, with any errors that occurred. Use it to answer 'how do I…' questions with real captured steps.",
      input_schema: {
        type: "object",
        properties: {
          recording_id: { type: "string" },
          format: { type: "string", enum: ["markdown", "steps"], description: "markdown for a ready-to-share SOP; steps for structured data." },
        },
        required: ["recording_id"],
        additionalProperties: false,
      },
    },
    async (input) => {
      const rec = loadRecording(String(input.recording_id));
      if (!rec) return { error: `No recording ${input.recording_id}` };
      const sop = compileSop(rec);
      return input.format === "steps" ? { title: sop.title, stats: sop.stats, sections: sop.sections.map((s) => ({ screen: s.screen, steps: s.steps.map((st) => ({ n: st.n, action: st.action, text: st.text, anomalies: st.anomalies })) })) } : renderSopMarkdown(sop);
    },
  ),

  tool(
    {
      name: "analyze_recording",
      description: "Extract diagnostic evidence from a problem recording: console errors, failed requests, latency, offline periods, the last screen, and the step each anomaly followed. Use before diagnose_problem when a recording exists.",
      input_schema: { type: "object", properties: { recording_id: { type: "string" } }, required: ["recording_id"], additionalProperties: false },
      strict: true,
    },
    async (input, ctx) => {
      const rec = loadRecording(String(input.recording_id));
      if (!rec) return { error: `No recording ${input.recording_id}` };
      const sop = compileSop(rec);
      const evidence = evidenceFromRecording(rec);
      ctx.emit({ type: "evidence", recordingId: rec.id, evidence });
      return {
        title: rec.title, purpose: rec.purpose, dealer: rec.dealer, stats: sop.stats,
        lastUrl: evidence.lastUrl, latencyP95Ms: evidence.latencyMs, wentOffline: evidence.wentOffline,
        anomalies: sop.anomalies.map((a) => ({ atSeconds: Number((a.t / 1000).toFixed(1)), kind: a.kind, text: a.text, afterStep: a.afterStep ? sop.steps[a.afterStep - 1]?.text : undefined })),
        lastSteps: sop.steps.slice(-6).map((s) => `${s.n}. ${s.text}`),
      };
    },
  ),

  tool(
    {
      name: "diagnose_problem",
      description: "Run the problem-solving engine. Give it the user's symptom in their words; optionally a recording_id (its evidence is used automatically) and answers to previous check questions keyed by check id. Returns ranked hypotheses with confidence, the single most informative next check, a resolution plan when confident, or an escalation packet.",
      input_schema: {
        type: "object",
        properties: {
          symptom: { type: "string", description: "The problem as reported, including any error wording." },
          recording_id: { type: "string", description: "A problem recording to mine for evidence." },
          answers: { type: "object", description: "Map of check id → true/false from questions the user answered.", additionalProperties: { type: "boolean" } },
          facts: { type: "array", items: { type: "string" }, description: "Extra facts the user stated (e.g. 'other websites are also slow')." },
        },
        required: ["symptom"],
        additionalProperties: false,
      },
    },
    async (input, ctx) => {
      let evidence: Partial<Evidence> = {};
      if (input.recording_id) {
        const rec = loadRecording(String(input.recording_id));
        if (rec) evidence = evidenceFromRecording(rec);
      }
      const health: Evidence["health"] = {};
      for (const [k, v] of Object.entries(ctx.health)) if (v) health[k as SystemName] = v.state;
      const facts = [...(evidence.facts ?? []), ...((input.facts as string[] | undefined) ?? [])];
      if (ctx.dealer) {
        const rows = db.prepare("SELECT fact FROM memory WHERE scope = ? ORDER BY created_at DESC LIMIT 20").all(ctx.dealer) as { fact: string }[];
        facts.push(...rows.map((r) => r.fact));
      }
      const diagnosis = diagnose({
        symptom: String(input.symptom),
        evidence: { ...evidence, health: { ...(evidence.health ?? {}), ...health }, facts },
        answers: (input.answers as Record<string, boolean> | undefined) ?? {},
        learned: learnedPlaybooks(),
      });
      ctx.emit({ type: "diagnosis", diagnosis: { hypotheses: diagnosis.hypotheses.slice(0, 4).map((h) => ({ title: h.title, confidence: h.confidence })), nextCheck: diagnosis.nextCheck, plan: diagnosis.plan?.title } });
      return {
        ...diagnosis,
        hypotheses: diagnosis.hypotheses.slice(0, 5).map((h) => ({ ...h, confidence: Number(h.confidence.toFixed(2)), pending: h.pending.slice(0, 3) })),
      };
    },
  ),

  tool(
    {
      name: "check_integration",
      description: "Check the health of an integration or the CMS platform: cms, evolve (Evolve DMS), infomedia (Superservice/Intelligent Catalog) or sms (OTP/WhatsApp gateway). The result is remembered for this session and used as evidence by diagnose_problem.",
      input_schema: { type: "object", properties: { system: { type: "string", enum: ["cms", "evolve", "infomedia", "sms"] } }, required: ["system"], additionalProperties: false },
      strict: true,
    },
    async (input, ctx) => {
      const result = await checkIntegration(input.system as SystemName);
      ctx.health[result.system] = result;
      ctx.emit({ type: "health", result });
      return result;
    },
  ),

  tool(
    {
      name: "remember",
      description: "Store a durable fact about a dealer (or 'global') for future sessions: network quirks, device models, contacts, configuration decisions. Do not store customer personal information.",
      input_schema: {
        type: "object",
        properties: { scope: { type: "string", description: "Dealer code, or 'global'." }, fact: { type: "string" } },
        required: ["scope", "fact"],
        additionalProperties: false,
      },
      strict: true,
    },
    async (input, ctx) => {
      const id = newId("mem");
      db.prepare("INSERT INTO memory (id, scope, fact, source, created_at) VALUES (?, ?, ?, ?, ?)").run(id, String(input.scope), String(input.fact), ctx.sessionId, now());
      return { stored: id };
    },
  ),

  tool(
    {
      name: "recall",
      description: "Retrieve remembered facts for a dealer (or 'global').",
      input_schema: { type: "object", properties: { scope: { type: "string" } }, required: ["scope"], additionalProperties: false },
      strict: true,
    },
    async (input) => db.prepare("SELECT id, fact, created_at FROM memory WHERE scope = ? ORDER BY created_at DESC LIMIT 50").all(String(input.scope)),
  ),

  tool(
    {
      name: "open_case",
      description: "Open a support case so the problem, evidence and progress are tracked. Returns the case id.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          symptom: { type: "string" },
          dealer: { type: "string" },
          recording_id: { type: "string" },
          hypothesis: { type: "string", description: "Current leading hypothesis." },
        },
        required: ["title", "symptom"],
        additionalProperties: false,
      },
    },
    async (input, ctx) => {
      const id = newId("case");
      db.prepare("INSERT INTO cases (id, dealer, title, symptom, status, hypothesis, recording_id, session_id, created_at, updated_at) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)")
        .run(id, (input.dealer as string | undefined) ?? ctx.dealer ?? null, String(input.title), String(input.symptom), (input.hypothesis as string | undefined) ?? null, (input.recording_id as string | undefined) ?? null, ctx.sessionId, now(), now());
      ctx.emit({ type: "case", id, status: "open", title: input.title });
      return { case_id: id };
    },
  ),

  tool(
    {
      name: "update_case",
      description: "Update a case: status (investigating | resolved | escalated), current hypothesis, and the resolution text. Marking a case resolved with a resolution teaches the engine a new playbook for next time.",
      input_schema: {
        type: "object",
        properties: {
          case_id: { type: "string" },
          status: { type: "string", enum: ["open", "investigating", "resolved", "escalated"] },
          hypothesis: { type: "string" },
          resolution: { type: "string", description: "What fixed it, as steps. Required when status is resolved." },
          note: { type: "string" },
        },
        required: ["case_id"],
        additionalProperties: false,
      },
    },
    async (input, ctx) => {
      const row = db.prepare("SELECT * FROM cases WHERE id = ?").get(String(input.case_id)) as { id: string; title: string; symptom: string; data: string | null } | undefined;
      if (!row) return { error: `No case ${input.case_id}` };
      const data = row.data ? JSON.parse(row.data) : { notes: [] };
      if (input.note) data.notes.push({ at: now(), note: input.note });
      db.prepare("UPDATE cases SET status = COALESCE(?, status), hypothesis = COALESCE(?, hypothesis), resolution = COALESCE(?, resolution), data = ?, updated_at = ? WHERE id = ?")
        .run((input.status as string | undefined) ?? null, (input.hypothesis as string | undefined) ?? null, (input.resolution as string | undefined) ?? null, JSON.stringify(data), now(), row.id);
      let learned: string | undefined;
      if (input.status === "resolved" && input.resolution) {
        const pb = playbookFromCase({ id: row.id, title: row.title, symptom: row.symptom, resolution: String(input.resolution) });
        const existing = db.prepare("SELECT id FROM learned_playbooks WHERE case_id = ?").get(row.id) as { id: string } | undefined;
        if (existing) db.prepare("UPDATE learned_playbooks SET confirmations = confirmations + 1, resolution = ? WHERE id = ?").run(JSON.stringify(pb.resolution), existing.id);
        else db.prepare("INSERT INTO learned_playbooks (id, case_id, title, symptoms, resolution, domain, created_at) VALUES (?, ?, ?, ?, ?, 'learned', ?)").run(pb.id, row.id, row.title, JSON.stringify(pb.symptoms), JSON.stringify(pb.resolution), now());
        learned = pb.id;
      }
      ctx.emit({ type: "case", id: row.id, status: input.status ?? "updated", title: row.title });
      return { updated: row.id, learnedPlaybook: learned };
    },
  ),

  tool(
    {
      name: "schedule_followup",
      description: "Schedule a follow-up reminder (e.g. 'check that the Evolve posting retry succeeded') that will be surfaced in this session and on the case after the given number of minutes.",
      input_schema: {
        type: "object",
        properties: { minutes: { type: "integer", minimum: 1 }, note: { type: "string" }, case_id: { type: "string" } },
        required: ["minutes", "note"],
        additionalProperties: false,
      },
    },
    async (input, ctx) => {
      const id = newId("fu");
      const due = new Date(Date.now() + Number(input.minutes) * 60_000).toISOString();
      db.prepare("INSERT INTO followups (id, case_id, session_id, due_at, note, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, (input.case_id as string | undefined) ?? null, ctx.sessionId, due, String(input.note), now());
      return { followup_id: id, due_at: due };
    },
  ),
];

/* ── Reports & campaign lists ──────────────────────────────────────────── */

TOOLS.push(
  tool(
    {
      name: "list_files",
      description: "List uploaded workbooks (CMS workshop bookings exports and Marketing Contacts exports) with their guessed kind, so you can build a report or campaign list from one.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
      strict: true,
    },
    async () => listFiles().map((f) => ({ id: f.id, name: f.name, kind: f.kind, sizeKb: Math.round(f.size / 1024), dealer: f.dealer, uploaded: f.created_at })),
  ),
  tool(
    {
      name: "build_report",
      description: "Build a report from an uploaded workbook. kind 'workshop' turns a CMS workshop bookings export into the Workshop Performance Dashboard (KPIs, dealer and advisor tables, close rates, carry-over abuse, weekly breakdown, tracking, insights). kind 'campaign' turns a Marketing Contacts export into a validated, deduplicated SMS and e-mail campaign list (RSA mobile and e-mail format rules, status breakdown, send list workbook and CSVs). Returns the summary; the HTML and files are available in the console.",
      input_schema: {
        type: "object",
        properties: { file_id: { type: "string" }, kind: { type: "string", enum: ["workshop", "campaign"] }, title: { type: "string" } },
        required: ["file_id"],
        additionalProperties: false,
      },
    },
    async (input, ctx) => {
      const built = buildReport(String(input.file_id), input.kind as ReportKind | undefined, { title: input.title ? String(input.title) : undefined, dealer: ctx.dealer });
      ctx.emit({ type: "report", id: built.report.id, kind: built.report.kind, title: built.report.title });
      return { report_id: built.report.id, kind: built.report.kind, title: built.report.title, warnings: built.warnings, summary: built.summary, links: { html: `/api/reports/${built.report.id}/html`, xlsx: built.report.xlsx_path ? `/api/reports/${built.report.id}/xlsx` : undefined } };
    },
  ),
  tool(
    {
      name: "list_reports",
      description: "List built reports and campaign lists, newest first.",
      input_schema: { type: "object", properties: { kind: { type: "string", enum: ["workshop", "campaign"] } }, additionalProperties: false },
    },
    async (input) => listReports(input.kind as ReportKind | undefined).map((r) => ({ id: r.id, kind: r.kind, title: r.title, dealer: r.dealer, created: r.created_at })),
  ),
  tool(
    {
      name: "get_report",
      description: "Read a built report's summary to answer questions about it: totals, dealer and advisor performance, close rates, carry-over abuse, zero-close advisors, weekly trend and insights for workshop reports; validity counts, status breakdown, rejection reasons, warnings and reconciliation for campaign lists.",
      input_schema: { type: "object", properties: { report_id: { type: "string" } }, required: ["report_id"], additionalProperties: false },
      strict: true,
    },
    async (input) => {
      const r = getReport(String(input.report_id));
      if (!r) return { error: `No report ${input.report_id}` };
      return { id: r.id, kind: r.kind, title: r.title, dealer: r.dealer, created: r.created_at, summary: JSON.parse(r.summary), links: { html: `/api/reports/${r.id}/html`, xlsx: r.xlsx_path ? `/api/reports/${r.id}/xlsx` : undefined } };
    },
  ),
);

export const TOOL_MAP = new Map(TOOLS.map((t) => [t.definition.name, t]));

/** Short, safe summary of a tool result for the UI activity feed. */
export function summariseResult(name: string, result: unknown): string {
  if (typeof result === "string") return result.slice(0, 160);
  if (Array.isArray(result)) return `${result.length} result(s)`;
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (name === "diagnose_problem" && Array.isArray(r.hypotheses)) {
      const top = r.hypotheses[0] as { title?: string; confidence?: number } | undefined;
      return top ? `top: ${top.title} (${Math.round((top.confidence ?? 0) * 100)}%)` : "no hypotheses";
    }
    if (name === "check_integration") return `${r.system}: ${r.state} (${r.detail})`;
    if (r.error) return `error: ${r.error}`;
    return Object.keys(r).slice(0, 6).join(", ");
  }
  return String(result);
}
