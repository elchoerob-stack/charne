import { test } from "node:test";
import assert from "node:assert/strict";
import { compileSop, evidenceFromRecording, playwrightLocator, renderPlaywright, renderSopMarkdown } from "../src/recorder/sop.js";
import { Recording } from "../src/recorder/schema.js";

const sample = Recording.parse({
  title: "Create a booking",
  purpose: "problem",
  dealer: "UPN01",
  startedAt: "2026-09-01T08:00:00.000Z",
  endedAt: "2026-09-01T08:01:30.000Z",
  startUrl: "https://cms.example/bookings",
  events: [
    { t: 0, type: "navigate", url: "https://cms.example/bookings", title: "Bookings" },
    { t: 500, type: "click", url: "https://cms.example/bookings", target: { tag: "button", role: "button", name: "New booking", selector: "#new" } },
    { t: 900, type: "navigate", url: "https://cms.example/bookings/new", title: "New booking" },
    { t: 1200, type: "click", target: { tag: "input", name: "Customer mobile", selector: "#mobile" } },
    { t: 1300, type: "input", value: "0", target: { tag: "input", name: "Customer mobile", selector: "#mobile" } },
    { t: 1400, type: "input", value: "08", target: { tag: "input", name: "Customer mobile", selector: "#mobile" } },
    { t: 1500, type: "input", value: "••••", target: { tag: "input", name: "Customer mobile", selector: "#mobile", sensitive: true } },
    { t: 1600, type: "scroll", scrollY: 300 },
    { t: 2000, type: "change", value: "Bulls Motors Pretoria", target: { tag: "select", name: "Franchise", selector: "#franchise" } },
    { t: 2500, type: "click", target: { tag: "button", role: "button", name: "Next", selector: "#next" } },
    { t: 2600, type: "click", target: { tag: "button", role: "button", name: "Next", selector: "#next" } },
    { t: 2900, type: "network", request: { method: "POST", url: "https://cms.example/api/bookings/save", status: 422, durationMs: 340, ok: false } },
    { t: 2950, type: "console", level: "error", message: "Uncaught TypeError: cannot read properties of undefined (reading 'advisorId')" },
    { t: 3000, type: "network", request: { method: "GET", url: "https://cms.example/api/advisors", status: 200, durationMs: 120, ok: true } },
  ],
});

test("compileSop collapses inputs, drops the focus click and de-duplicates double clicks", () => {
  const sop = compileSop(sample);
  const texts = sop.steps.map((s) => s.text);
  assert.equal(sop.steps.filter((s) => s.action === "type").length, 1, "one type step for the mobile field");
  assert.ok(texts.some((t) => t.includes("masked")), "masked value shown as masked");
  assert.equal(sop.steps.filter((s) => s.text.includes("**Next**")).length, 1, "double click collapsed");
  assert.ok(texts[0].startsWith("Go to **Bookings**"));
  assert.equal(sop.sections.length, 2);
});

test("anomalies attach to the step they followed", () => {
  const sop = compileSop(sample);
  const next = sop.steps.find((s) => s.text.includes("**Next**"))!;
  assert.ok(next.anomalies && next.anomalies.length === 2);
  assert.equal(sop.stats.failedRequests, 1);
  assert.equal(sop.stats.errors, 1);
});

test("markdown and playwright renderers produce usable output", () => {
  const sop = compileSop(sample);
  const md = renderSopMarkdown(sop);
  assert.ok(md.includes("# Create a booking"));
  assert.ok(md.includes("## New booking"));
  assert.ok(md.includes("⚠"));
  const pw = renderPlaywright(sop);
  assert.ok(pw.includes(`page.getByRole("button", { name: "New booking" }).click()`));
  assert.ok(pw.includes(`fill("<MASKED>")`));
  assert.ok(pw.includes(`selectOption({ label: "Bulls Motors Pretoria" })`));
});

test("playwright locator prefers test ids, then roles, then labels", () => {
  assert.equal(playwrightLocator({ tag: "button", testId: "save", selector: "x" }), `page.getByTestId("save")`);
  assert.equal(playwrightLocator({ tag: "button", name: "Save", selector: "x" }), `page.getByRole("button", { name: "Save" })`);
  assert.equal(playwrightLocator({ tag: "input", name: "VIN", selector: "x" }), `page.getByLabel("VIN")`);
});

test("evidenceFromRecording surfaces failed requests, errors and latency", () => {
  const e = evidenceFromRecording(sample);
  assert.equal(e.failedRequests.length, 1);
  assert.equal(e.failedRequests[0].status, 422);
  assert.equal(e.consoleErrors.length, 1);
  assert.equal(e.wentOffline, false);
  assert.ok(e.latencyMs && e.latencyMs >= 120);
});
