import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.CMS_AGENT_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foreman-replay-")), "t.db");

const { compileTask } = await import("../src/tasks/compile.js");
const { executeTask, browserLaunchOptions, loadChromium } = await import("../src/tasks/runner.js");
const { Recording } = await import("../src/recorder/schema.js");
import type { RunLogEntry, TaskRun } from "../src/tasks/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const pageUrl = (file: string) => "file://" + path.join(here, "fixtures", file);

/** Skip rather than fail when no browser is installed on this machine. */
async function browserAvailable(): Promise<boolean> {
  try {
    const chromium = await loadChromium();
    const b = await chromium.launch({ headless: true, ...browserLaunchOptions() });
    await b.close();
    return true;
  } catch { return false; }
}
const canRun = await browserAvailable();

function bookingRecording(url: string) {
  return Recording.parse({
    id: "rec_booking", title: "Create a booking", purpose: "sop", dealer: "KIM01",
    startedAt: "2026-09-04T08:00:00.000Z", endedAt: "2026-09-04T08:00:40.000Z", startUrl: url,
    events: [
      { t: 0, type: "navigate", url, title: "Bookings" },
      { t: 900, type: "click", target: { tag: "input", name: "Customer name", id: "customer", selector: "#customer", inputType: "text" } },
      { t: 2200, type: "input", value: "Thabo Nkosi", target: { tag: "input", name: "Customer name", id: "customer", selector: "#customer", inputType: "text" } },
      { t: 3400, type: "input", value: "KJ45GP", target: { tag: "input", name: "Vehicle registration", id: "reg", selector: "#reg", inputType: "text" } },
      { t: 12000, type: "change", value: "Morgan Kimberley", target: { tag: "select", name: "Franchise", id: "franchise", selector: "#franchise" } },
      { t: 13000, type: "click", target: { tag: "button", role: "button", name: "Save booking", testId: "btn-save", selector: '[data-testid="btn-save"]' } },
    ],
  });
}

async function replay(file: string, inputs: Record<string, string>) {
  const task = compileTask(bookingRecording(pageUrl(file)), { id: "task_e2e", now: new Date().toISOString() });
  task.selfHeal = false; // prove the locator fallbacks alone, with no API calls
  const run: TaskRun = { id: `run_${file}`, taskId: task.id, status: "running", inputs, totalSteps: task.steps.length, log: [], createdAt: new Date().toISOString() };
  const logs: RunLogEntry[] = [];
  await executeTask(task, run, { onLog: (e) => logs.push(e), isCancelled: () => false }, { headless: true, stepTimeoutMs: 8000 });
  return logs;
}

test("replays a recorded booking with new data", { skip: canRun ? false : "no browser installed" }, async () => {
  const logs = await replay("fake-cms.html", { customer_name: "Ben Botha", vehicle_registration: "CA123456", franchise: "Morgan Isuzu Ermelo" });
  const steps = logs.filter((l) => l.level === "step");
  assert.equal(steps.length, 4);
  assert.ok(steps[0].message.includes('→ "Ben Botha"'), "uses the run input, not the recorded name");
  assert.ok(logs.some((l) => l.message === "Finished"));
  assert.equal(logs.filter((l) => l.level === "error").length, 0);
});

test("still works when the page is redesigned and the recorded ids are gone", { skip: canRun ? false : "no browser installed" }, async () => {
  // fake-cms-moved.html renames every id and deletes the save button's test id.
  // Only the visible labels are unchanged, which is what a person would go by.
  const logs = await replay("fake-cms-moved.html", { customer_name: "Cindy Coetzee", vehicle_registration: "NC777", franchise: "Morgan Kimberley" });
  assert.equal(logs.filter((l) => l.level === "step").length, 4);
  assert.ok(logs.some((l) => l.message === "Finished"));
  assert.equal(logs.filter((l) => l.level === "error").length, 0);
});

test("a step that cannot be found fails loudly instead of carrying on", { skip: canRun ? false : "no browser installed" }, async () => {
  const rec = bookingRecording(pageUrl("fake-cms.html"));
  const task = compileTask(rec, { id: "task_missing", now: new Date().toISOString() });
  task.selfHeal = false;
  task.steps.push({ n: task.steps.length + 1, action: "click", text: "Click the Approve warranty button", target: { tag: "button", role: "button", name: "Approve warranty", selector: "#nope" } });
  const run: TaskRun = { id: "run_missing", taskId: task.id, status: "running", inputs: {}, totalSteps: task.steps.length, log: [], createdAt: "" };
  const logs: RunLogEntry[] = [];
  await assert.rejects(
    () => executeTask(task, run, { onLog: (e) => logs.push(e), isCancelled: () => false }, { headless: true, stepTimeoutMs: 3000 }),
    /Approve warranty/,
  );
  assert.ok(logs.some((l) => l.level === "error"), "the failure is written to the run log");
});
