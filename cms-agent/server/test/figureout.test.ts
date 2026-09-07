import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-figure-"));
process.env.CMS_AGENT_DB = path.join(tmp, "t.db");
process.env.WORKSPACE_DIR = path.join(tmp, "workspace");

const { compileTask } = await import("../src/tasks/compile.js");
const { executeTask, browserLaunchOptions, loadChromium } = await import("../src/tasks/runner.js");
const { Recording } = await import("../src/recorder/schema.js");
const { saveSite } = await import("../src/tasks/sites.js");
import type { RunLogEntry, TaskRun } from "../src/tasks/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const pageUrl = (f: string) => "file://" + path.join(here, "fixtures", f);

async function browserAvailable(): Promise<boolean> {
  try { const c = await loadChromium(); const b = await c.launch({ headless: true, ...browserLaunchOptions() }); await b.close(); return true; }
  catch { return false; }
}
const canRun = await browserAvailable();
const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

// A saved site, so the runner does not refuse for want of a sign-in.
saveSite("https://example.test", { cookies: [], origins: [] } as never);

const recording = (url: string) => Recording.parse({
  id: "rec_change", title: "Create a booking", purpose: "sop", startedAt: "2026-09-05T08:00:00.000Z", endedAt: "2026-09-05T08:00:30.000Z", startUrl: url,
  events: [
    { t: 0, type: "navigate", url, title: "Bookings" },
    { t: 1200, type: "input", value: "Thabo Nkosi", target: { tag: "input", name: "Customer name", id: "customer", selector: "#customer", inputType: "text" } },
    { t: 2400, type: "input", value: "KJ45GP", target: { tag: "input", name: "Vehicle registration", id: "reg", selector: "#reg", inputType: "text" } },
    { t: 3600, type: "change", value: "Morgan Kimberley", target: { tag: "select", name: "Franchise", id: "franchise", selector: "#franchise" } },
    { t: 4800, type: "click", target: { tag: "button", role: "button", name: "Save booking", testId: "btn-save", selector: '[data-testid="btn-save"]' } },
  ],
});

test("a rebuilt page defeats selector replay, so the step must be worked out", { skip: canRun ? false : "no browser" }, async () => {
  const task = compileTask(recording(pageUrl("changed-app.html")), { id: "t_noheal", now: new Date().toISOString() });
  task.selfHeal = false; // prove the fallbacks alone are not enough here
  const run: TaskRun = { id: "run_noheal", taskId: task.id, status: "running", inputs: {}, totalSteps: task.steps.length, log: [], createdAt: "" };
  await assert.rejects(
    () => executeTask(task, run, { onLog: () => {}, isCancelled: () => false }, { headless: true, stepTimeoutMs: 3000 }),
    /element not found/,
    "without working it out, the recording cannot cope with the rebuilt page",
  );
});

/**
 * The same rebuilt page, but the recovery loop is driven by a scripted decider
 * instead of Claude. This proves the mechanics Claude relies on — several
 * actions per step, clearing an obstacle, then reporting the step done — and
 * it runs anywhere, with no API key and no cost.
 */
function scriptedDecider() {
  const byLabel = (els: { i: number; name: string; text: string; placeholder: string; tag: string }[], re: RegExp) =>
    els.find((e) => re.test(`${e.name} ${e.text} ${e.placeholder}`));
  return async (ctx: { step: { text: string }; value: string; elements: any[]; tried: string[] }) => {
    // Anything that blocks the page gets cleared first, whatever the step is.
    const banner = byLabel(ctx.elements, /Accept all/i);
    if (banner && !ctx.tried.some((t) => /Accept all/i.test(t))) return { action: "click" as const, index: banner.i, why: "a cookie banner is covering the page" };
    // The form lives behind a tab that has to be opened.
    const tab = byLabel(ctx.elements, /New booking/i);
    const formShowing = byLabel(ctx.elements, /Client full name|Registration number|Branch/i);
    if (tab && !formShowing) return { action: "click" as const, index: tab.i, why: "the booking form is behind this tab" };

    const intent = ctx.step.text.toLowerCase();
    if (intent.includes("customer name")) {
      const f = byLabel(ctx.elements, /Client full name/i)!;
      if (!ctx.tried.some((t) => /Client full name/i.test(t))) return { action: "fill" as const, index: f.i, value: ctx.value, why: "the field was renamed to Client full name" };
      return { action: "done" as const, why: "name entered" };
    }
    if (intent.includes("vehicle registration")) {
      const f = byLabel(ctx.elements, /Registration number/i)!;
      if (!ctx.tried.some((t) => /Registration number/i.test(t))) return { action: "fill" as const, index: f.i, value: ctx.value, why: "the field was renamed to Registration number" };
      return { action: "done" as const, why: "registration entered" };
    }
    if (intent.includes("franchise")) {
      const f = byLabel(ctx.elements, /Branch/i)!;
      if (!ctx.tried.some((t) => /Branch/i.test(t))) return { action: "select" as const, index: f.i, value: ctx.value, why: "Franchise is now called Branch" };
      return { action: "done" as const, why: "branch chosen" };
    }
    if (intent.includes("save booking")) {
      const b = byLabel(ctx.elements, /Commit booking/i)!;
      if (!ctx.tried.some((t) => /Commit booking/i.test(t))) return { action: "click" as const, index: b.i, why: "Save is now called Commit booking" };
      return { action: "done" as const, why: "booking committed" };
    }
    return { action: "give_up" as const, why: "no rule for this step" };
  };
}

test("it clears the obstacle, finds the renamed fields and completes the booking", { skip: canRun ? false : "no browser" }, async () => {
  const task = compileTask(recording(pageUrl("changed-app.html")), { id: "t_heal", now: new Date().toISOString() });
  task.selfHeal = true;
  const run: TaskRun = { id: "run_heal", taskId: task.id, status: "running", inputs: { customer_name: "Ben Botha", vehicle_registration: "CA123456", franchise: "Morgan Isuzu Ermelo" }, totalSteps: task.steps.length, log: [], createdAt: "" };
  const logs: RunLogEntry[] = [];
  await executeTask(task, run, { onLog: (e) => logs.push(e), isCancelled: () => false, decide: scriptedDecider() as never },
    { headless: true, stepTimeoutMs: 8000 });

  assert.ok(logs.some((l) => l.message === "Finished"), "the run completed on a page it was never recorded against");
  assert.ok(logs.some((l) => /cookie banner/i.test(l.message)), "it cleared the banner in its way");
  assert.ok(logs.some((l) => /behind this tab/i.test(l.message)), "it opened the tab holding the form");
  assert.ok(logs.some((l) => /renamed to Client full name/i.test(l.message)), "it found the renamed field");
  assert.equal(logs.filter((l) => l.level === "error").length, 0);
});

test("it remembers where things actually were, so the next run goes straight there", { skip: canRun ? false : "no browser" }, async () => {
  const task = compileTask(recording(pageUrl("changed-app.html")), { id: "t_learn", now: new Date().toISOString() });
  task.selfHeal = true;
  const run: TaskRun = { id: "run_learn", taskId: task.id, status: "running", inputs: {}, totalSteps: task.steps.length, log: [], createdAt: "" };
  const healed: number[] = [];
  await executeTask(task, run, { onLog: () => {}, isCancelled: () => false, onHeal: (n) => healed.push(n), decide: scriptedDecider() as never },
    { headless: true, stepTimeoutMs: 8000 });
  assert.ok(healed.length > 0, "at least one repair was reported back to be saved onto the task");
  assert.ok(task.steps.some((s) => s.healedSelector), "the working selector is written onto the step");
});
