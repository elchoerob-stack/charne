import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

process.env.CMS_AGENT_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foreman-")), "t.db");
const { db, newId, now } = await import("../src/db.js");
const { buildPacket, sendTicket } = await import("../src/agent/ticketing.js");
const { learnedPlaybooks } = await import("../src/agent/tools.js");
const { readCustomPlaybooks, saveCustomPlaybooks } = await import("../src/problem-solving/custom.js");

test("escalation packet carries evidence, recording links, dealer facts and a checklist", async () => {
  const rec = JSON.parse(fs.readFileSync(new URL("./fixtures/sample-recording.json", import.meta.url), "utf8"));
  db.prepare("INSERT OR REPLACE INTO recordings (id, title, dealer, purpose, recorded_by, started_at, ended_at, event_count, data, screenshots, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)")
    .run(rec.id, rec.title, rec.dealer, rec.purpose, rec.recordedBy, rec.startedAt, rec.endedAt, rec.events.length, JSON.stringify(rec), now());
  db.prepare("INSERT INTO memory (id, scope, fact, source, created_at) VALUES (?, ?, ?, ?, ?)").run(newId("mem"), "KIM01", "Dealership proxy inspects SSL", "test", now());
  const id = newId("case");
  db.prepare("INSERT INTO cases (id, dealer, title, symptom, status, hypothesis, recording_id, data, created_at, updated_at) VALUES (?, 'KIM01', 'Booking wizard stuck at slot step', 'Next does nothing on the slot step', 'investigating', 'Validation error on save', ?, ?, ?, ?)")
    .run(id, rec.id, JSON.stringify({ notes: [{ at: now(), note: "Advisor re-tried twice" }], diagnosis: { hypotheses: [{ title: "Booking wizard cannot proceed or save", confidence: 0.96 }], escalation: { to: "CMS support desk (product)", include: ["recording ID", "browser and version"] } } }), now(), now());
  const row = db.prepare("SELECT * FROM cases WHERE id = ?").get(id) as Parameters<typeof buildPacket>[0];
  const p = buildPacket(row, { baseUrl: "https://foreman.example" });
  assert.equal(p.to, "CMS support desk (product)");
  assert.equal(p.evidence.failedRequests.length, 2);
  assert.ok(p.evidence.consoleErrors[0].includes("advisorId"));
  assert.ok(p.recording && p.recording.sopLink.startsWith("https://foreman.example/api/recordings/rec_sample/sop"));
  assert.deepEqual(p.dealerFacts, ["Dealership proxy inspects SSL"]);
  assert.ok(p.markdown.includes("- [ ] browser and version"));
  assert.ok(p.markdown.includes("## Timeline"));

  const r = await sendTicket(row); // TICKET_CHANNEL unset → draft
  assert.equal(r.channel, "draft");
  assert.equal(r.sent, false);
  assert.ok(r.mailto?.startsWith("mailto:"));
  const after = db.prepare("SELECT status, data FROM cases WHERE id = ?").get(id) as { status: string; data: string };
  assert.equal(after.status, "investigating", "draft does not change status");
  assert.ok(JSON.parse(after.data).packet.includes("# Escalation"));
});

test("promoted custom playbooks are loaded alongside learned ones", () => {
  const before = readCustomPlaybooks();
  saveCustomPlaybooks([...before, { id: "custom-test", title: "Quote screen blank after Chrome update", domain: "learned", symptoms: ["quote screen blank", "chrome update"], prior: 0.05, checks: [{ id: "same-context", question: "Same as before?", lrPass: 5, lrFail: 0.4 }], resolution: ["Clear site data", "Log in again"], verify: "Quote screen renders." }]);
  try {
    assert.ok(learnedPlaybooks().some((p) => p.id === "custom-test"));
  } finally {
    saveCustomPlaybooks(before);
  }
});
