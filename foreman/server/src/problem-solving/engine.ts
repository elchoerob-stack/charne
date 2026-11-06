import { PLAYBOOKS, STOPWORDS } from "./playbooks.js";
import type { CheckOutcome, Diagnosis, EscalationPacket, Evidence, Hypothesis, Playbook } from "./types.js";

export interface DiagnoseInput {
  symptom: string;
  evidence?: Partial<Evidence>;
  /** Answers to check questions, keyed "<playbookId>:<checkId>" or just "<checkId>". */
  answers?: Record<string, boolean>;
  /** Extra playbooks learned from resolved cases. */
  learned?: Playbook[];
  /** Confidence needed before a plan is produced. */
  actThreshold?: number;
  /** Minimum symptom match to keep a playbook as a candidate. */
  minMatch?: number;
}

/* ── Text matching ────────────────────────────────────────────────────── */

const SYNONYMS: Record<string, string> = {
  authorization: "authorisation", authorise: "authorisation", authorize: "authorisation",
  catalog: "catalogue", "log-out": "logged out", logout: "logged out", pics: "photos", picture: "photo",
  pictures: "photos", invoice: "invoice", invoicing: "invoice", posts: "posting", posted: "posting", post: "posting",
  synch: "sync", syncing: "sync", logs: "logged", signs: "logged", "signed": "logged", "kicks": "kicked", freeze: "stuck", frozen: "stuck", freezes: "stuck", hang: "hangs", hanging: "hangs",
};

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+\s'-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => SYNONYMS[w] ?? w)
    .filter((w) => !STOPWORDS.has(w));
}

/** Score 0..1: fraction of playbook symptom phrases hit, boosted by multiword hits. */
export function symptomMatch(symptom: string, playbook: Playbook): number {
  const text = " " + tokenize(symptom).join(" ") + " ";
  const raw = " " + symptom.toLowerCase() + " ";
  let score = 0;
  let hits = 0;
  for (const phrase of playbook.symptoms) {
    const p = phrase.toLowerCase();
    const inRaw = raw.includes(" " + p + " ") || raw.includes(p);
    const inTok = text.includes(" " + tokenize(p).join(" ") + " ");
    if (inRaw || inTok) {
      hits += 1;
      score += p.includes(" ") ? 2 : 1;
    }
  }
  if (hits === 0) return 0;
  const maxScore = playbook.symptoms.reduce((s, p) => s + (p.includes(" ") ? 2 : 1), 0);
  // Reward absolute hits too so a short symptom with 2 strong hits still ranks.
  return Math.min(1, score / maxScore + Math.min(hits, 3) * 0.15);
}

/* ── Bayesian-style scoring ────────────────────────────────────────────── */

const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

function outcomeFor(pb: Playbook, check: Playbook["checks"][number], evidence: Evidence, answers: Record<string, boolean>): { outcome: CheckOutcome; source: "auto" | "answer" } | undefined {
  const keyed = answers[`${pb.id}:${check.id}`] ?? answers[check.id];
  if (typeof keyed === "boolean") return { outcome: keyed ? "pass" : "fail", source: "answer" };
  if (check.auto) {
    const o = check.auto(evidence);
    if (o !== "unknown") return { outcome: o, source: "auto" };
  }
  return undefined;
}

/** Expected information gain of a binary check on a hypothesis at probability p. */
function informationGain(p: number, lrPass: number, lrFail: number): number {
  // Approximate: how far the posterior can move, weighted by the chance of each outcome.
  const pPass = 0.5; // uninformed
  const post = (lr: number) => sigmoid(logit(clamp(p)) + Math.log(lr));
  const move = (q: number) => Math.abs(q - p);
  return pPass * move(post(lrPass)) + (1 - pPass) * move(post(lrFail));
}

const clamp = (p: number) => Math.min(0.999, Math.max(0.001, p));

export function diagnose(input: DiagnoseInput): Diagnosis {
  const evidence: Evidence = { consoleErrors: [], failedRequests: [], health: {}, facts: [], ...(input.evidence ?? {}) };
  const answers = input.answers ?? {};
  const actThreshold = input.actThreshold ?? 0.7;
  const minMatch = input.minMatch ?? 0.15;
  const playbooks = [...PLAYBOOKS, ...(input.learned ?? [])];
  const reasoning: string[] = [];

  // 1. Candidate generation from symptom words.
  const candidates = playbooks
    .map((pb) => ({ pb, match: symptomMatch(input.symptom, pb) }))
    .filter((c) => c.match >= minMatch)
    .sort((a, b) => b.match - a.match);

  if (candidates.length === 0) {
    reasoning.push("No playbook matched the symptom wording; producing a structured escalation with triage questions.");
    return {
      symptom: input.symptom,
      hypotheses: [],
      reasoning,
      escalation: buildEscalation(input.symptom, evidence, [], "CMS support desk", ["exact error text", "screen/URL", "steps to reproduce", "recording ID", "dealer code", "time of occurrence"]),
    };
  }
  reasoning.push(`Matched ${candidates.length} candidate playbook(s): ${candidates.map((c) => `${c.pb.title} (${(c.match * 100).toFixed(0)}%)`).join("; ")}.`);

  // 2. Score each candidate: prior × symptom match, then update with evidence.
  const scored = candidates.map(({ pb, match }) => {
    let logOdds = logit(clamp(pb.prior * (0.4 + 0.6 * match)));
    const evaluated: Hypothesis["evaluated"] = [];
    const pending: { checkId: string; question: string; informationGain: number; auto: boolean }[] = [];
    for (const check of pb.checks) {
      const r = outcomeFor(pb, check, evidence, answers);
      if (r) {
        logOdds += Math.log(r.outcome === "pass" ? check.lrPass : check.lrFail);
        evaluated.push({ checkId: check.id, outcome: r.outcome, source: r.source });
      } else {
        pending.push({ checkId: check.id, question: check.question, informationGain: 0, auto: Boolean(check.auto) });
      }
    }
    return { pb, match, logOdds, evaluated, pending };
  });

  // 3. Normalise across candidates so confidences sum to ≤ 1 (leave headroom for "something else").
  const weights = scored.map((s) => Math.exp(s.logOdds));
  const unknownWeight = Math.exp(logit(0.08));
  const total = weights.reduce((a, b) => a + b, 0) + unknownWeight;

  const hypotheses: Hypothesis[] = scored
    .map((s, i) => {
      const confidence = weights[i] / total;
      const pending = s.pending
        .map((p) => ({ ...p, informationGain: informationGain(confidence, s.pb.checks.find((c) => c.id === p.checkId)!.lrPass, s.pb.checks.find((c) => c.id === p.checkId)!.lrFail) }))
        .sort((a, b) => b.informationGain - a.informationGain);
      return { playbookId: s.pb.id, title: s.pb.title, domain: s.pb.domain, confidence, match: s.match, evaluated: s.evaluated, pending };
    })
    .sort((a, b) => b.confidence - a.confidence);

  for (const h of hypotheses.slice(0, 3)) {
    const ev = h.evaluated.map((e) => `${e.checkId}=${e.outcome}${e.source === "auto" ? " (auto)" : ""}`).join(", ");
    reasoning.push(`${h.title}: ${(h.confidence * 100).toFixed(0)}% confidence${ev ? ` after ${ev}` : ""}.`);
  }

  const top = hypotheses[0];
  const diagnosis: Diagnosis = { symptom: input.symptom, hypotheses, reasoning };

  // 4. Act, ask, or escalate.
  if (top.confidence >= actThreshold) {
    const pb = playbooks.find((p) => p.id === top.playbookId)!;
    diagnosis.plan = { playbookId: pb.id, title: pb.title, steps: pb.resolution, verify: pb.verify, escalate: pb.escalate };
    reasoning.push(`Confidence ${(top.confidence * 100).toFixed(0)}% ≥ ${(actThreshold * 100).toFixed(0)}%: recommending the resolution plan for "${pb.title}".`);
  }

  // Next check: most informative pending check among the top two hypotheses.
  const nextCandidates = hypotheses.slice(0, 2).flatMap((h) => h.pending.map((p) => ({ h, p })));
  if (nextCandidates.length > 0) {
    const best = nextCandidates.sort((a, b) => b.p.informationGain * b.h.confidence - a.p.informationGain * a.h.confidence)[0];
    const pb = playbooks.find((p) => p.id === best.h.playbookId)!;
    const check = pb.checks.find((c) => c.id === best.p.checkId)!;
    diagnosis.nextCheck = { playbookId: pb.id, checkId: check.id, question: check.question, automatic: Boolean(check.auto) };
    if (!diagnosis.plan) reasoning.push(`Most informative next check: "${check.question}"`);
  }

  // Everything evaluated and still nothing confident → escalate with what we know.
  const allExhausted = hypotheses.every((h) => h.pending.length === 0);
  if (!diagnosis.plan && (allExhausted || top.confidence < 0.2)) {
    const pb = playbooks.find((p) => p.id === top.playbookId)!;
    diagnosis.escalation = buildEscalation(
      input.symptom,
      evidence,
      hypotheses.map((h) => ({ title: h.title, confidence: h.confidence })),
      pb.escalate?.to ?? "CMS support desk",
      pb.escalate?.include ?? ["exact error text", "steps to reproduce", "recording ID"],
    );
    reasoning.push("No hypothesis is confident and no checks remain; prepared an escalation packet.");
  }

  return diagnosis;
}

function buildEscalation(symptom: string, evidence: Evidence, tried: { title: string; confidence: number }[], to: string, include: string[]): EscalationPacket {
  const bits: string[] = [];
  if (evidence.consoleErrors.length) bits.push(`${evidence.consoleErrors.length} console error(s), first: "${evidence.consoleErrors[0].slice(0, 120)}"`);
  if (evidence.failedRequests.length) bits.push(`${evidence.failedRequests.length} failed request(s), e.g. ${evidence.failedRequests[0].method} ${evidence.failedRequests[0].url} → ${evidence.failedRequests[0].status}`);
  const health = Object.entries(evidence.health).map(([k, v]) => `${k}:${v}`).join(", ");
  if (health) bits.push(`integration health: ${health}`);
  return {
    to,
    symptom,
    summary: `${symptom}. ${bits.join("; ") || "No automated evidence captured."} Hypotheses tried: ${tried.map((t) => `${t.title} (${(t.confidence * 100).toFixed(0)}%)`).join("; ") || "none"}.`,
    evidence,
    triedHypotheses: tried,
    include,
  };
}

/** Turn a resolved case into a learned playbook with a conservative prior. */
export function playbookFromCase(c: { id: string; title: string; symptom: string; resolution: string; domain?: string }): Playbook {
  const words = tokenize(c.symptom);
  const phrases = [...new Set([...words, c.symptom.toLowerCase().trim()])].filter((w) => w.length > 2).slice(0, 12);
  return {
    id: `learned-${c.id}`,
    title: c.title,
    domain: "learned",
    symptoms: phrases,
    prior: 0.03,
    checks: [
      { id: "same-context", question: `Does this look like the previously resolved case "${c.title}" (same screen, same error wording)?`, lrPass: 6, lrFail: 0.3 },
    ],
    resolution: c.resolution.split(/\n+|(?<=\.)\s+(?=[A-Z])/).map((s) => s.trim()).filter(Boolean),
    verify: "The original symptom no longer occurs after applying the steps that resolved the earlier case.",
    escalate: { to: "CMS support desk", include: ["reference to the earlier case", "what differs this time"] },
  };
}

export { PLAYBOOKS };
