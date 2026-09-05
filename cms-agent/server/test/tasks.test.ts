import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.CMS_AGENT_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foreman-tasks-")), "t.db");
const { compileTask, missingRequired, resolveInputs } = await import("../src/tasks/compile.js");
const { strategiesFor } = await import("../src/tasks/runner.js");
const { Recording } = await import("../src/recorder/schema.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const pageUrl = "file://" + path.join(here, "fixtures", "fake-cms.html");

/** A recording of one booking against the fake CMS page. */
const recording = Recording.parse({
  id: "rec_booking",
  title: "Create a booking",
  purpose: "sop",
  dealer: "KIM01",
  startedAt: "2026-09-04T08:00:00.000Z",
  endedAt: "2026-09-04T08:00:40.000Z",
  startUrl: pageUrl,
  events: [
    { t: 0, type: "navigate", url: pageUrl, title: "Bookings" },
    { t: 900, type: "click", target: { tag: "input", name: "Customer name", id: "customer", selector: "#customer", inputType: "text" } },
    { t: 1100, type: "input", value: "T", target: { tag: "input", name: "Customer name", id: "customer", selector: "#customer", inputType: "text" } },
    { t: 2200, type: "input", value: "Thabo Nkosi", target: { tag: "input", name: "Customer name", id: "customer", selector: "#customer", inputType: "text" } },
    { t: 3400, type: "input", value: "KJ45GP", target: { tag: "input", name: "Vehicle registration", id: "reg", selector: "#reg", inputType: "text" } },
    { t: 12000, type: "change", value: "Morgan Kimberley", target: { tag: "select", name: "Franchise", id: "franchise", selector: "#franchise" } },
    { t: 13000, type: "click", target: { tag: "button", role: "button", name: "Save booking", testId: "btn-save", selector: "[data-testid=\"btn-save\"]" } },
  ],
});

test("compiling a recording lifts typed values into named variables", () => {
  const task = compileTask(recording, { id: "task_1", now: "2026-09-04T08:01:00.000Z" });
  assert.equal(task.startUrl, pageUrl, "the opening navigate becomes the entry point, not a step");
  assert.deepEqual(task.steps.map((s) => s.action), ["type", "type", "select", "click"]);
  assert.deepEqual(task.variables.map((v) => v.name), ["customer_name", "vehicle_registration", "franchise"]);
  assert.equal(task.variables[0].example, "Thabo Nkosi", "keeps the recorded value as the default");
  assert.equal(task.steps[0].variable, "customer_name");
  assert.ok(task.steps.every((s) => (s.delayMs ?? 0) <= 1500), "an 11-second human pause is not replayed literally");
});

test("run inputs override recorded values, and blanks fall back", () => {
  const task = compileTask(recording, { id: "task_2", now: "x" });
  const resolved = resolveInputs(task, { customer_name: "Ben Botha", vehicle_registration: "" });
  assert.equal(resolved.customer_name, "Ben Botha");
  assert.equal(resolved.vehicle_registration, "KJ45GP", "empty input falls back to the recorded example");
  assert.equal(resolved.franchise, "Morgan Kimberley");
});

test("masked fields must be supplied per run", () => {
  const withSecret = Recording.parse({
    ...recording,
    id: "rec_secret",
    events: [
      { t: 0, type: "navigate", url: pageUrl, title: "Bookings" },
      { t: 500, type: "input", value: "••••", target: { tag: "input", name: "Customer mobile", id: "mobile", selector: "#mobile", inputType: "tel", sensitive: true } },
    ],
  });
  const task = compileTask(withSecret, { id: "task_3", now: "x" });
  assert.equal(task.variables[0].sensitive, true);
  assert.equal(task.variables[0].example, "", "a masked value is never carried into the task");
  assert.equal(missingRequired(task, {}).length, 1);
  assert.equal(missingRequired(task, { customer_mobile: "0821234567" }).length, 0);
});

test("each step carries several ways to find its element, cheapest first", () => {
  const s = strategiesFor({ tag: "button", role: "button", name: "Save booking", testId: "btn-save", selector: "#x" });
  assert.ok(s[0].how.startsWith("testId="), "a test id survives a redesign, so it is tried first");
  assert.ok(s.some((x) => x.how.startsWith("role=")));
  assert.ok(s[s.length - 1].how.startsWith("css="), "the brittle CSS path is the last resort");
  const healed = strategiesFor({ tag: "button", name: "Save", selector: "#x" }, "#save_v2");
  assert.ok(healed[0].how.startsWith("learned:"), "somewhere it previously found the thing is tried before anything else");
});
