/**
 * Problem-solving engine types.
 *
 * The engine is hypothesis-driven: a symptom description selects candidate
 * playbooks, each check gathers evidence that raises or lowers the odds of a
 * hypothesis, and the engine keeps asking for the most informative next check
 * until one hypothesis is confident enough to act on (or nothing fits, in
 * which case it produces a structured escalation packet).
 */

export type Domain = "cms" | "evolve" | "infomedia" | "comms" | "network" | "device" | "user" | "learned";

export type CheckOutcome = "pass" | "fail" | "unknown";

/** Evidence gathered automatically from a recording or an integration check. */
export interface Evidence {
  /** Console errors captured by the recorder (message text). */
  consoleErrors: string[];
  /** Failed or slow HTTP requests captured by the recorder. */
  failedRequests: { method: string; url: string; status: number; durationMs?: number }[];
  /** Last URL / screen the user was on. */
  lastUrl?: string;
  /** Health of external systems, if a check has been run. */
  health: Partial<Record<"cms" | "evolve" | "infomedia" | "sms", "up" | "degraded" | "down">>;
  /** Free-form facts, e.g. from dealer memory or the user's own words. */
  facts: string[];
  /** Whether the browser reported being offline at any point. */
  wentOffline?: boolean;
  /** Rough p95 request latency in ms, if known. */
  latencyMs?: number;
}

export const emptyEvidence = (): Evidence => ({ consoleErrors: [], failedRequests: [], health: {}, facts: [] });

export interface Check {
  id: string;
  /** Plain-language question for a human when the check cannot be automated. */
  question: string;
  /** Automatic evaluation from evidence. Return "unknown" when the evidence is silent. */
  auto?: (e: Evidence) => CheckOutcome;
  /** Likelihood ratio when the check passes (>1 supports the hypothesis). */
  lrPass: number;
  /** Likelihood ratio when the check fails (<1 weakens the hypothesis). */
  lrFail: number;
}

export interface Playbook {
  id: string;
  title: string;
  domain: Domain;
  /** Phrases that indicate this problem. Lower-case. */
  symptoms: string[];
  /** Base rate: how often this is the cause among all support requests. 0..1 */
  prior: number;
  checks: Check[];
  /** Ordered resolution steps for the front-line user or the product specialist. */
  resolution: string[];
  /** How to confirm the fix worked. */
  verify: string;
  /** Who to escalate to when the resolution does not work, and what to include. */
  escalate?: { to: string; include: string[] };
}

export interface Hypothesis {
  playbookId: string;
  title: string;
  domain: Domain;
  /** 0..1 posterior probability (normalised across candidates). */
  confidence: number;
  /** Symptom-match score 0..1 (how well the words matched). */
  match: number;
  /** Checks already evaluated for this hypothesis. */
  evaluated: { checkId: string; outcome: CheckOutcome; source: "auto" | "answer" }[];
  /** Checks still worth running, best first. */
  pending: { checkId: string; question: string; informationGain: number }[];
}

export interface Diagnosis {
  symptom: string;
  hypotheses: Hypothesis[];
  /** The next single most useful question or check to run, if any. */
  nextCheck?: { playbookId: string; checkId: string; question: string; automatic: boolean };
  /** Present once a hypothesis clears the confidence threshold. */
  plan?: { playbookId: string; title: string; steps: string[]; verify: string; escalate?: Playbook["escalate"] };
  /** Present when nothing fits well enough to act on. */
  escalation?: EscalationPacket;
  /** Human-readable summary of what the engine currently believes and why. */
  reasoning: string[];
}

export interface EscalationPacket {
  to: string;
  summary: string;
  symptom: string;
  evidence: Evidence;
  triedHypotheses: { title: string; confidence: number }[];
  include: string[];
}
