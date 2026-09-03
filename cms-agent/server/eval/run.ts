/**
 * Foreman eval harness.
 *
 * Level 1 (no API key needed): engine accuracy. For every case, does the
 * problem-solving engine rank the expected playbook first (top-1) or in the
 * top three? Cases with expect=null must produce an escalation, not a plan.
 *
 * Level 2 (needs credentials, --agent): end-to-end. The agent is given the
 * symptom and any evidence; a grader checks that it (a) called
 * diagnose_problem, (b) surfaced the expected playbook's title or resolution
 * in its answer, and (c) asked at most one question when confidence was low.
 * A Claude judge scores clarity and correctness 1–5 against a rubric.
 *
 * Usage:
 *   npx tsx eval/run.ts              # level 1
 *   npx tsx eval/run.ts --agent      # level 1 + 2 (spends tokens)
 *   npx tsx eval/run.ts --limit 10 --agent
 *
 * Results are written to eval/results/<timestamp>.json so runs can be compared.
 * The seed cases are synthesised from the playbooks; replace or extend them
 * with real support transcripts as they accumulate (see docs/EVALS.md).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { diagnose } from "../src/problem-solving/engine.js";
import type { Evidence } from "../src/problem-solving/types.js";
import { PLAYBOOKS } from "../src/problem-solving/playbooks.js";

interface Case { id: string; symptom: string; expect: string | null; evidence?: Partial<Evidence>; answers?: Record<string, boolean> }

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const agentMode = args.includes("--agent");
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;
const cases = (JSON.parse(fs.readFileSync(path.join(here, "cases.json"), "utf8")) as Case[]).slice(0, limit);

/* ── Level 1: engine ─────────────────────────────────────────────────── */
interface EngineResult { id: string; expect: string | null; top: string | null; top3: string[]; confidence: number; top1: boolean; top3hit: boolean; escalated: boolean; ok: boolean }
const engine: EngineResult[] = cases.map((c) => {
  const d = diagnose({ symptom: c.symptom, evidence: c.evidence, answers: c.answers });
  const top = d.hypotheses[0]?.playbookId ?? null;
  const top3 = d.hypotheses.slice(0, 3).map((h) => h.playbookId);
  const ok = c.expect === null ? Boolean(d.escalation) && !d.plan : top === c.expect;
  return { id: c.id, expect: c.expect, top, top3, confidence: d.hypotheses[0]?.confidence ?? 0, top1: top === c.expect, top3hit: c.expect !== null && top3.includes(c.expect), escalated: Boolean(d.escalation), ok };
});
const withExpect = engine.filter((e) => e.expect !== null);
const summary = {
  cases: engine.length,
  top1: withExpect.filter((e) => e.top1).length / Math.max(1, withExpect.length),
  top3: withExpect.filter((e) => e.top3hit).length / Math.max(1, withExpect.length),
  escalationCorrect: engine.filter((e) => e.expect === null).every((e) => e.ok),
  passed: engine.filter((e) => e.ok).length,
  byPlaybook: Object.fromEntries(PLAYBOOKS.map((p) => [p.id, { n: withExpect.filter((e) => e.expect === p.id).length, top1: withExpect.filter((e) => e.expect === p.id && e.top1).length }])),
};
console.log(`Level 1 · engine: ${summary.passed}/${summary.cases} passed · top-1 ${(summary.top1 * 100).toFixed(0)}% · top-3 ${(summary.top3 * 100).toFixed(0)}% · escalation cases ${summary.escalationCorrect ? "ok" : "FAILED"}`);
for (const e of engine.filter((x) => !x.ok)) console.log(`  ✖ ${e.id}: expected ${e.expect ?? "escalation"}, got ${e.top ?? "none"} (${(e.confidence * 100).toFixed(0)}%) top3=${e.top3.join(",")}`);

/* ── Level 2: agent (optional) ───────────────────────────────────────── */
interface AgentResult { id: string; calledDiagnose: boolean; mentionedPlaybook: boolean; questions: number; judge?: { correctness: number; clarity: number; notes: string }; answer: string; tokens: { input: number; output: number } }
const agentResults: AgentResult[] = [];

if (agentMode) {
  process.env.CMS_AGENT_DB = process.env.CMS_AGENT_DB ?? path.join(here, "results", "eval.db");
  const { runTurn } = await import("../src/agent/agent.js");
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic();
  const { config } = await import("../src/config.js");
  for (const c of cases) {
    const events: Record<string, unknown>[] = [];
    let text = "";
    const sessionId = `eval_${c.id}_${Date.now()}`;
    const { getOrCreateSession } = await import("../src/db.js");
    getOrCreateSession(sessionId, "EVAL01");
    const facts = c.evidence ? `\n\nEvidence already gathered: ${JSON.stringify(c.evidence)}` : "";
    const answers = c.answers ? `\n\nAnswers to obvious checks: ${JSON.stringify(c.answers)}` : "";
    await runTurn({ sessionId, dealer: "EVAL01", mode: "think", text: c.symptom + facts + answers }, (ev) => { events.push(ev); if (ev.type === "text") text += ev.delta; });
    const pb = PLAYBOOKS.find((p) => p.id === c.expect);
    const mentioned = pb ? text.toLowerCase().includes(pb.title.toLowerCase().slice(0, 25)) || pb.resolution.some((s) => text.includes(s.slice(0, 40))) : /escalat/i.test(text);
    const done = events.find((e) => e.type === "done") as { usage?: { input: number; output: number } } | undefined;
    const result: AgentResult = { id: c.id, calledDiagnose: events.some((e) => e.type === "tool_start" && e.name === "diagnose_problem"), mentionedPlaybook: mentioned, questions: (text.match(/\?/g) ?? []).length, answer: text, tokens: { input: done?.usage?.input ?? 0, output: done?.usage?.output ?? 0 } };
    try {
      const judge = await client.messages.parse({
        model: config.model, max_tokens: 1024, output_config: { effort: "low", format: { type: "json_schema", schema: { type: "object", properties: { correctness: { type: "integer", minimum: 1, maximum: 5 }, clarity: { type: "integer", minimum: 1, maximum: 5 }, notes: { type: "string" } }, required: ["correctness", "clarity", "notes"], additionalProperties: false } } },
        messages: [{ role: "user", content: `You grade a workshop-support agent's reply.\n\nUser report: ${c.symptom}\nExpected root cause playbook: ${pb ? `${pb.title}. Resolution steps: ${pb.resolution.join(" | ")}` : "None fits; the agent should escalate with a clear packet and triage questions."}\n\nAgent reply:\n${text}\n\nScore correctness (does it identify the right cause or ask the single most useful question toward it; 5 = right cause and right steps, 1 = wrong or misleading) and clarity (numbered steps, no filler, verify step present) from 1 to 5. Be strict.` }],
      });
      result.judge = judge.parsed_output as AgentResult["judge"];
    } catch (err) { result.judge = { correctness: 0, clarity: 0, notes: `judge failed: ${(err as Error).message}` }; }
    agentResults.push(result);
    console.log(`  ${c.id}: diagnose=${result.calledDiagnose ? "y" : "n"} playbook=${result.mentionedPlaybook ? "y" : "n"} correctness=${result.judge?.correctness} clarity=${result.judge?.clarity} tokens=${result.tokens.input}/${result.tokens.output}`);
  }
  const n = agentResults.length || 1;
  console.log(`Level 2 · agent: diagnose called ${agentResults.filter((r) => r.calledDiagnose).length}/${n} · expected playbook surfaced ${agentResults.filter((r) => r.mentionedPlaybook).length}/${n} · mean correctness ${(agentResults.reduce((s, r) => s + (r.judge?.correctness ?? 0), 0) / n).toFixed(2)} · mean clarity ${(agentResults.reduce((s, r) => s + (r.judge?.clarity ?? 0), 0) / n).toFixed(2)} · tokens ${agentResults.reduce((s, r) => s + r.tokens.input, 0)} in / ${agentResults.reduce((s, r) => s + r.tokens.output, 0)} out`);
}

const out = path.join(here, "results", `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), agentMode, summary, engine, agent: agentResults }, null, 2));
console.log(`Results → ${path.relative(process.cwd(), out)}`);
if (!agentMode && summary.passed < summary.cases) process.exitCode = 1;
