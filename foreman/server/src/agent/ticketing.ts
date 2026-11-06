import nodemailer from "nodemailer";
import { db, now } from "../db.js";
import { compileSop, evidenceFromRecording } from "../recorder/sop.js";
import { loadRecording } from "./tools.js";

/**
 * Case-to-ticket bridge.
 *
 * Builds a complete escalation packet from a case (symptom, hypothesis,
 * diagnosis state, recording evidence, dealer facts, timeline) and sends it
 * through the configured channel:
 *
 *   TICKET_CHANNEL=webhook  POST JSON to TICKET_WEBHOOK_URL (Zapier, Make, Power Automate, a helpdesk inbound hook)
 *   TICKET_CHANNEL=jira     Create an issue via Jira Cloud REST (JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY, JIRA_ISSUE_TYPE)
 *   TICKET_CHANNEL=email    Send via SMTP (SMTP_URL e.g. smtps://user:pass@smtp.example.com:465, TICKET_EMAIL_TO, TICKET_EMAIL_FROM)
 *   TICKET_CHANNEL=draft    (default) Do not send; return the packet, a mailto: link and the markdown so a human can paste it.
 *
 * Whatever the channel, the packet markdown is stored on the case and the
 * ticket reference (issue key, message id, webhook response) is recorded.
 */

export type TicketChannel = "draft" | "webhook" | "jira" | "email";

export interface CaseRow {
  id: string; dealer: string | null; title: string; symptom: string; status: string; hypothesis: string | null; resolution: string | null;
  recording_id: string | null; session_id: string | null; data: string | null; created_at: string; updated_at: string;
}

export interface EscalationPacket {
  caseId: string; title: string; dealer: string; to: string; summary: string; symptom: string; hypothesis?: string; tried: string[];
  evidence: { consoleErrors: string[]; failedRequests: string[]; lastUrl?: string; latencyMs?: number; wentOffline?: boolean; health: string[] };
  recording?: { id: string; title: string; steps: number; lastSteps: string[]; link: string; sopLink: string };
  dealerFacts: string[]; timeline: { at: string; note: string }[]; include: string[]; markdown: string; generatedAt: string;
}

export function channel(): TicketChannel {
  const c = (process.env.TICKET_CHANNEL ?? "draft").toLowerCase();
  return (["webhook", "jira", "email"].includes(c) ? c : "draft") as TicketChannel;
}

export function buildPacket(c: CaseRow, opts: { to?: string; baseUrl?: string; include?: string[] } = {}): EscalationPacket {
  const base = (opts.baseUrl ?? process.env.PUBLIC_URL ?? "http://localhost:8787").replace(/\/$/, "");
  const data = c.data ? JSON.parse(c.data) as { notes?: { at: string; note: string }[]; diagnosis?: { hypotheses?: { title: string; confidence: number }[]; escalation?: { to?: string; include?: string[] } } } : {};
  const facts = c.dealer ? (db.prepare("SELECT fact FROM memory WHERE scope = ? ORDER BY created_at DESC LIMIT 10").all(c.dealer) as { fact: string }[]).map((r) => r.fact) : [];
  const evidence: EscalationPacket["evidence"] = { consoleErrors: [], failedRequests: [], health: [] };
  let recording: EscalationPacket["recording"];
  if (c.recording_id) {
    const rec = loadRecording(c.recording_id);
    if (rec) {
      const ev = evidenceFromRecording(rec);
      const sop = compileSop(rec);
      evidence.consoleErrors = ev.consoleErrors.slice(0, 5);
      evidence.failedRequests = ev.failedRequests.slice(0, 8).map((r) => `${r.method} ${r.url} → ${r.status}${r.durationMs ? ` (${r.durationMs} ms)` : ""}`);
      evidence.lastUrl = ev.lastUrl; evidence.latencyMs = ev.latencyMs; evidence.wentOffline = ev.wentOffline;
      recording = { id: rec.id!, title: rec.title, steps: sop.stats.steps, lastSteps: sop.steps.slice(-5).map((s) => `${s.n}. ${s.text.replace(/\*\*/g, "")}`), link: `${base}/api/recordings/${rec.id}`, sopLink: `${base}/api/recordings/${rec.id}/sop?format=md` };
    }
  }
  const tried = (data.diagnosis?.hypotheses ?? []).map((h) => `${h.title} (${Math.round(h.confidence * 100)}%)`);
  const to = opts.to ?? data.diagnosis?.escalation?.to ?? process.env.TICKET_DEFAULT_TO ?? "CMS support desk";
  const include = opts.include ?? data.diagnosis?.escalation?.include ?? ["exact error text", "screen/URL", "steps to reproduce", "recording ID", "dealer code", "time of occurrence"];
  const timeline = [{ at: c.created_at, note: "Case opened" }, ...(data.notes ?? []), ...(c.resolution ? [{ at: c.updated_at, note: `Resolution attempted: ${c.resolution}` }] : [])];
  const summary = `${c.title}. Dealer ${c.dealer ?? "unknown"}. ${c.hypothesis ? `Leading hypothesis: ${c.hypothesis}. ` : ""}${evidence.failedRequests.length ? `${evidence.failedRequests.length} failed request(s) captured. ` : ""}${evidence.consoleErrors.length ? `${evidence.consoleErrors.length} console error(s). ` : ""}Tried: ${tried.join("; ") || "see notes"}.`;

  const md = [
    `# Escalation: ${c.title}`, "",
    `**Case:** ${c.id} · **Dealer:** ${c.dealer ?? "—"} · **Status:** ${c.status} · **Opened:** ${c.created_at} · **To:** ${to}`, "",
    `## Symptom`, c.symptom, "",
    c.hypothesis ? `## Leading hypothesis\n${c.hypothesis}\n` : "",
    tried.length ? `## Hypotheses considered\n${tried.map((t) => `- ${t}`).join("\n")}\n` : "",
    `## Evidence`,
    evidence.failedRequests.length ? `Failed requests:\n${evidence.failedRequests.map((r) => `- ${r}`).join("\n")}` : "- No failed requests captured",
    evidence.consoleErrors.length ? `Console errors:\n${evidence.consoleErrors.map((r) => `- ${r}`).join("\n")}` : "- No console errors captured",
    evidence.lastUrl ? `- Last screen: ${evidence.lastUrl}` : "", evidence.latencyMs ? `- p95 latency: ${evidence.latencyMs} ms` : "", evidence.wentOffline ? "- Browser went offline during the recording" : "", "",
    recording ? `## Recording\n${recording.title} (${recording.id}, ${recording.steps} steps)\n- Raw: ${recording.link}\n- SOP: ${recording.sopLink}\n\nLast steps:\n${recording.lastSteps.map((s) => `- ${s}`).join("\n")}\n` : "",
    facts.length ? `## Known dealer facts\n${facts.map((f) => `- ${f}`).join("\n")}\n` : "",
    `## Timeline\n${timeline.map((t) => `- ${t.at}: ${t.note}`).join("\n")}`, "",
    `## Still needed from the dealer\n${include.map((i) => `- [ ] ${i}`).join("\n")}`, "",
    `_Prepared by Foreman ${new Date().toISOString()}_`,
  ].filter((l) => l !== "").join("\n");

  return { caseId: c.id, title: c.title, dealer: c.dealer ?? "—", to, summary, symptom: c.symptom, hypothesis: c.hypothesis ?? undefined, tried, evidence, recording, dealerFacts: facts, timeline, include, markdown: md, generatedAt: new Date().toISOString() };
}

export interface TicketResult { channel: TicketChannel; sent: boolean; reference?: string; url?: string; mailto?: string; error?: string; packet: EscalationPacket }

export async function sendTicket(c: CaseRow, opts: { to?: string; channelOverride?: TicketChannel } = {}): Promise<TicketResult> {
  const packet = buildPacket(c, { to: opts.to });
  const ch = opts.channelOverride ?? channel();
  const subject = `[Foreman] ${packet.dealer} · ${packet.title} (${packet.caseId})`;
  const mailto = `mailto:${encodeURIComponent(process.env.TICKET_EMAIL_TO ?? "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(packet.markdown.slice(0, 1800))}`;
  let result: TicketResult = { channel: ch, sent: false, mailto, packet };
  try {
    if (ch === "webhook") {
      const url = process.env.TICKET_WEBHOOK_URL;
      if (!url) throw new Error("TICKET_WEBHOOK_URL is not set");
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject, ...packet }) });
      if (!res.ok) throw new Error(`webhook returned ${res.status}`);
      const text = await res.text();
      result = { ...result, sent: true, reference: text.slice(0, 200) || `HTTP ${res.status}` };
    } else if (ch === "jira") {
      const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY, JIRA_ISSUE_TYPE } = process.env;
      if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN || !JIRA_PROJECT_KEY) throw new Error("JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN and JIRA_PROJECT_KEY are required");
      const res = await fetch(`${JIRA_BASE_URL.replace(/\/$/, "")}/rest/api/3/issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Basic ${Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64")}` },
        body: JSON.stringify({ fields: { project: { key: JIRA_PROJECT_KEY }, issuetype: { name: JIRA_ISSUE_TYPE ?? "Task" }, summary: subject.slice(0, 250), labels: ["foreman", packet.dealer.replace(/\s+/g, "_")], description: { type: "doc", version: 1, content: packet.markdown.split("\n\n").map((p) => ({ type: "paragraph", content: [{ type: "text", text: p.slice(0, 5000) }] })) } } }),
      });
      const body = await res.json().catch(() => ({})) as { key?: string; errorMessages?: string[]; errors?: Record<string, string> };
      if (!res.ok) throw new Error(`Jira ${res.status}: ${body.errorMessages?.join("; ") ?? JSON.stringify(body.errors ?? {})}`);
      result = { ...result, sent: true, reference: body.key, url: `${JIRA_BASE_URL.replace(/\/$/, "")}/browse/${body.key}` };
    } else if (ch === "email") {
      const { SMTP_URL, TICKET_EMAIL_TO, TICKET_EMAIL_FROM } = process.env;
      if (!SMTP_URL || !TICKET_EMAIL_TO) throw new Error("SMTP_URL and TICKET_EMAIL_TO are required");
      const transport = nodemailer.createTransport(SMTP_URL);
      const info = await transport.sendMail({ from: TICKET_EMAIL_FROM ?? TICKET_EMAIL_TO, to: TICKET_EMAIL_TO, subject, text: packet.markdown });
      result = { ...result, sent: true, reference: info.messageId };
    }
  } catch (err) {
    result.error = (err as Error).message;
  }
  const data = c.data ? JSON.parse(c.data) : { notes: [] };
  data.notes = data.notes ?? [];
  data.notes.push({ at: now(), note: result.sent ? `Escalated via ${ch}: ${result.reference ?? ""}` : `Escalation packet prepared (${ch}${result.error ? `, not sent: ${result.error}` : ", draft"})` });
  data.ticket = { channel: ch, sent: result.sent, reference: result.reference, url: result.url, at: now(), error: result.error };
  data.packet = packet.markdown;
  db.prepare("UPDATE cases SET status = CASE WHEN ? THEN 'escalated' ELSE status END, data = ?, updated_at = ? WHERE id = ?").run(result.sent ? 1 : 0, JSON.stringify(data), now(), c.id);
  return result;
}
