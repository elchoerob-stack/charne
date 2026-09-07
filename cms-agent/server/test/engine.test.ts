import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnose, playbookFromCase, symptomMatch, tokenize } from "../src/problem-solving/engine.js";
import { PLAYBOOKS } from "../src/problem-solving/playbooks.js";

test("tokenize drops stopwords and maps synonyms", () => {
  const t = tokenize("The customer cannot get the authorization OTP");
  assert.ok(t.includes("authorisation"));
  assert.ok(t.includes("otp"));
  assert.ok(!t.includes("the"));
});

test("symptom matching prefers the right playbook", () => {
  const pb = (id: string) => PLAYBOOKS.find((p) => p.id === id)!;
  const s = "Invoice is not posting to Evolve, posting error on the job card";
  assert.ok(symptomMatch(s, pb("evolve-post-fail")) > symptomMatch(s, pb("otp-not-received")));
  assert.ok(symptomMatch(s, pb("evolve-post-fail")) > symptomMatch(s, pb("slow-performance")));
});

test("diagnose ranks the Evolve posting playbook first and asks for the most informative check", () => {
  const d = diagnose({ symptom: "Job card invoice not posting to Evolve DMS" });
  assert.equal(d.hypotheses[0].playbookId, "evolve-post-fail");
  assert.ok(d.nextCheck, "should propose a next check");
  assert.equal(d.nextCheck!.playbookId, "evolve-post-fail");
  assert.ok(!d.plan, "should not act before evidence");
});

test("automatic evidence raises confidence enough to produce a plan", () => {
  const d = diagnose({
    symptom: "Invoice not posting to Evolve",
    evidence: {
      health: { evolve: "down" },
      failedRequests: [{ method: "POST", url: "https://cms.example/api/evolve/post", status: 503 }],
    },
  });
  assert.equal(d.hypotheses[0].playbookId, "evolve-post-fail");
  assert.ok(d.hypotheses[0].confidence >= 0.7, `confidence was ${d.hypotheses[0].confidence}`);
  assert.ok(d.plan, "should recommend a plan");
  assert.ok(d.plan!.steps.length >= 3);
  const evaluated = d.hypotheses[0].evaluated.map((e) => e.checkId);
  assert.ok(evaluated.includes("evolve-health"));
  assert.ok(evaluated.includes("evolve-request"));
});

test("answers to check questions update the posterior", () => {
  const before = diagnose({ symptom: "customer did not receive the OTP sms" });
  const after = diagnose({ symptom: "customer did not receive the OTP sms", answers: { "mobile-format": false, "send-log": false } });
  assert.equal(before.hypotheses[0].playbookId, "otp-not-received");
  assert.ok(after.hypotheses[0].confidence > before.hypotheses[0].confidence);
});

test("unknown symptom yields an escalation packet with triage items", () => {
  const d = diagnose({ symptom: "purple elephants everywhere" });
  assert.equal(d.hypotheses.length, 0);
  assert.ok(d.escalation);
  assert.ok(d.escalation!.include.includes("exact error text"));
});

test("learned playbooks from resolved cases take part in diagnosis", () => {
  const learned = playbookFromCase({
    id: "abc",
    title: "Quote screen blank after Chrome update at Upington",
    symptom: "quote screen blank white after chrome update",
    resolution: "Clear site data for the CMS host. Log in again. Reopen the quote.",
  });
  assert.equal(learned.resolution.length, 3);
  const d = diagnose({ symptom: "the quote screen is blank white since the chrome update", learned: [learned], answers: { "same-context": true } });
  assert.equal(d.hypotheses[0].playbookId, "learned-abc");
});

test("eVHC upload with 413 is recognised from a failed request", () => {
  const d = diagnose({
    symptom: "Technician photos will not upload from the tablet on the eVHC",
    evidence: { failedRequests: [{ method: "POST", url: "https://cms.example/api/evhc/upload", status: 413 }] },
  });
  assert.equal(d.hypotheses[0].playbookId, "evhc-upload-fail");
  assert.ok(d.plan);
});
