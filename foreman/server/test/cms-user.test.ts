import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";

process.env.FOREMAN_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foreman-cmsuser-")), "t.db");
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

const { compileTask } = await import("../src/tasks/compile.js");
const { saveTask } = await import("../src/tasks/store.js");
const { loadChromium, browserLaunchOptions } = await import("../src/tasks/runner.js");
const { Recording } = await import("../src/recorder/schema.js");
const B = await import("../src/cms/bindings.js");
const { Registry } = await import("../src/shell/registry.js");
const { Shell } = await import("../src/shell/engine.js");
const { validatePlan } = await import("../src/shell/planner.js");
const { cmsUserCapability, validateUserRequest, variablesFor } = await import("../src/shell/workers/cms.js");
const store = await import("../src/shell/store.js");
const { previewFile, previewImages } = await import("../src/shell/previews.js");
const { approvalFingerprint, formatJob } = await import("../src/mcp/format.js");
const { compareForms } = await import("../src/tasks/form.js");
type Task = import("../src/tasks/types.js").Task;

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (f: string) => fs.readFileSync(path.join(here, "fixtures", f), "utf8");

async function browserAvailable(): Promise<boolean> {
  try { const b = await (await loadChromium()).launch({ headless: true, ...browserLaunchOptions() }); await b.close(); return true; } catch { return false; }
}
const canRun = await browserAvailable();
const skip = canRun ? false : "no browser installed";

/* ── a fake CMS admin that records what really gets saved ───────────── */

interface Admin { users: Map<string, any>; saves: number; posts: string[]; branch: string; success: string; expired: boolean; strict: boolean }
async function admin() {
  const state: Admin = { users: new Map(), saves: 0, posts: [], branch: "HO-01", success: "User saved successfully", expired: false, strict: false };
  const server = http.createServer((req, res) => {
    const send = (status: number, body: unknown, type = "application/json") => { res.writeHead(status, { "content-type": type }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };
    if (req.method === "GET" && req.url?.startsWith("/admin")) {
      return send(200, state.expired ? fixture("fake-cms-login.html") : fixture("fake-cms-admin.html").replace("{{BRANCH}}", state.branch).replace("{{NOW}}", new Date().toISOString()), "text/html");
    }
    let raw = ""; req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const b = raw ? JSON.parse(raw) : {}; state.posts.push(`${req.url} ${b.email ?? ""}`);
      const email = String(b.email ?? "").toLowerCase(); const ex = state.users.get(email);
      if (req.url === "/api/users/deactivate") { if (!ex) return send(404, { error: "No such user" }); ex.active = false; state.saves++; return send(200, { message: "User deactivated" }); }
      if (!email) return send(400, { error: "E-mail is required" });
      if (ex && state.strict) return send(409, { error: "A user with that e-mail already exists" });
      if (ex) { for (const k of ["fullname", "role", "dealer"]) if (b[k]) ex[k] = b[k]; state.saves++; return send(200, { message: state.success }); }
      if (!b.fullname) return send(400, { error: "Full name is required" });
      state.users.set(email, { ...b, active: true }); state.saves++; return send(200, { message: state.success });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/admin`;
  return { state, url, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/* ── recordings of the three jobs, as the recorder would have made them ─ */

const tgt = {
  name: { tag: "input", name: "Full name", id: "fullname", selector: "#fullname", inputType: "text" },
  email: { tag: "input", name: "E-mail", id: "email", selector: "#email", inputType: "email", sensitive: true },
  role: { tag: "select", name: "Role", id: "role", selector: "#role" },
  dealer: { tag: "select", name: "Dealer", id: "dealer", selector: "#dealer" },
  save: { tag: "button", role: "button", name: "Save user", testId: "btn-save", selector: '[data-testid="btn-save"]' },
  off: { tag: "button", role: "button", name: "Deactivate user", testId: "btn-deactivate", selector: '[data-testid="btn-deactivate"]' },
};
function recording(id: string, title: string, url: string, events: any[]) {
  return Recording.parse({ id, title, purpose: "sop", startedAt: "2026-11-01T08:00:00.000Z", endedAt: "2026-11-01T08:00:40.000Z", startUrl: url, events: [{ t: 0, type: "navigate", url, title: "Users" }, ...events.map((e, i) => ({ t: 900 * (i + 1), ...e }))] });
}
function makeTask(kind: "create" | "update" | "deactivate", url: string): Task {
  const events = {
    create: [{ type: "input", value: "Sample Person", target: tgt.name }, { type: "input", value: "", target: tgt.email }, { type: "change", value: "Technician", target: tgt.role }, { type: "change", value: "Suzuki Boksburg", target: tgt.dealer }, { type: "click", target: tgt.save }],
    update: [{ type: "input", value: "", target: tgt.email }, { type: "change", value: "Technician", target: tgt.role }, { type: "click", target: tgt.save }],
    deactivate: [{ type: "input", value: "", target: tgt.email }, { type: "click", target: tgt.off }],
  }[kind];
  const task = compileTask(recording(`rec_${kind}`, `CMS: ${kind} user`, url, events), { id: `task_${kind}`, now: new Date().toISOString() });
  task.selfHeal = false; // the locators alone must do it: no API calls here
  return saveTask(task);
}
function bind(kind: "create" | "update" | "deactivate", task: Task, expectText = "User saved successfully") {
  const s = B.suggestBinding(task);
  return B.saveBinding({ action: kind, taskId: task.id, commitStep: s.commitStep!, fieldMap: s.fieldMap, expectText: kind === "deactivate" ? "User deactivated" : expectText });
}
const resetBindings = () => { for (const a of B.ACTION_IDS) B.deleteBinding(a); };

/* ── driving the worker through the Shell, as a real job ─────────────── */

const reg = new Registry().register(cmsUserCapability);
const jobFor = (inputs: Record<string, string>) => new Shell({
  registry: reg, stepTimeoutMs: 120_000,
  planner: async (_t, r) => validatePlan({ summary: "user job", steps: [{ ref: "s1", capability: "cms_admin.manage_user", title: "User job", inputs: Object.entries(inputs).map(([key, value]) => ({ key, value })), after: [] }], unsupported: [], questions: [] }, r),
});
const until = async (cond: () => boolean, ms = 60_000) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) throw new Error("timed out waiting"); await new Promise((r) => setTimeout(r, 40)); } };
const s1 = (id: string) => store.getJob(id)!.steps[0];
const CREATE = { action: "create", dealer: "Suzuki Boksburg", name: "Thabo Dlamini", email: "thabo@dealer.co.za", role: "Service advisor" };

/* ── the checks that need no browser ─────────────────────────────────── */

test("the worker is unavailable until a workflow is set up, and says why", () => {
  resetBindings();
  assert.equal(cmsUserCapability.available, false);
  assert.match(cmsUserCapability.unavailableReason!, /no recorded workflow/);
});

test("asking for a user job without a workflow gets a question, not a guess", () => {
  resetBindings();
  assert.match(validateUserRequest(CREATE)!, /no recorded workflow for "create a user" yet/);
});

test("a recording is matched to the right fields, and the Save step is found", async () => {
  const a = await admin(); try {
    const t = makeTask("create", a.url);
    const s = B.suggestBinding(t);
    assert.deepEqual(s.fieldMap, { email: "e_mail", dealer: "dealer", role: "role", name: "full_name" });
    assert.equal(s.commitStep, 5, "the Save button click");
  } finally { await a.close(); }
});

test("a binding is refused until it is safe: a Save that isn't a click, no success message, an unconnected masked field", async () => {
  const a = await admin(); try {
    const t = makeTask("create", a.url);
    const good = { action: "create" as const, taskId: t.id, commitStep: 5, fieldMap: B.suggestBinding(t).fieldMap, expectText: "User saved successfully" };
    assert.deepEqual(B.bindingIssues(good).errors, []);
    assert.match(B.bindingIssues({ ...good, commitStep: 3 }).errors[0], /isn't a click/);
    assert.match(B.bindingIssues({ ...good, commitStep: 99 }).errors[0], /isn't in/);
    assert.match(B.bindingIssues({ ...good, expectText: "  " }).errors.join(), /message CMS shows when the save worked/);
    const noEmail = { ...good, fieldMap: { ...good.fieldMap, email: undefined } };
    assert.ok(B.bindingIssues(noEmail).errors.some((e) => /Choose which field .* e-mail/.test(e)));
    assert.ok(B.bindingIssues(noEmail).errors.some((e) => /E-mail" was masked/.test(e)), "a masked field with nothing connected to it would be saved blank");
    assert.match(B.bindingIssues({ ...good, fieldMap: { ...good.fieldMap, role: "nope" } }).errors.join(), /"nope"/);
    assert.match(B.bindingIssues({ ...good, taskId: "task_gone" }).errors[0], /no longer exists/);
  } finally { await a.close(); }
});

test("requests that are not enough to act on come back as questions", async () => {
  const a = await admin(); try {
    resetBindings(); bind("create", makeTask("create", a.url));
    assert.equal(validateUserRequest(CREATE), undefined);
    assert.match(validateUserRequest({ ...CREATE, role: "" })!, /still need the role or access level/);
    assert.match(validateUserRequest({ ...CREATE, name: "", role: "" })!, /the user's name, the role/);
    assert.match(validateUserRequest({ ...CREATE, email: "thabo@dealer" })!, /doesn't look like an e-mail address/);
    assert.match(validateUserRequest({ ...CREATE, action: "delete" })!, /create, update, deactivate/);
    assert.match(validateUserRequest({ action: "update", email: "a@b.co" })!, /no recorded workflow for "change a user"/);
    assert.equal(cmsUserCapability.available, true);
  } finally { await a.close(); }
});

test("the plan keeps a complete request and turns an incomplete one into a question", async () => {
  const a = await admin(); try {
    resetBindings(); bind("create", makeTask("create", a.url));
    const mk = (inp: Record<string, string>) => validatePlan({ steps: [{ ref: "s1", capability: "cms_admin.manage_user", title: "u", inputs: Object.entries(inp).map(([key, value]) => ({ key, value })), after: [] }] }, reg);
    assert.equal(mk(CREATE).steps.length, 1);
    const p = mk({ ...CREATE, role: "" });
    assert.equal(p.steps.length, 0);
    assert.match(p.questions[0], /still need the role/);
  } finally { await a.close(); }
});

test("the form comparison catches a changed, a vanished and a newly pre-filled field, and ignores case and spacing", () => {
  const approved = [{ label: "Full name", value: "Thabo  Dlamini" }, { label: "Role", value: "Service advisor" }, { label: "Branch code", value: "HO-01" }];
  assert.deepEqual(compareForms(approved, [{ label: "full name", value: "thabo dlamini" }, { label: "Role", value: "Service Advisor" }, { label: "Branch code", value: "HO-01" }]), []);
  assert.match(compareForms(approved, [{ label: "Full name", value: "Thabo Dlamini" }, { label: "Role", value: "Technician" }, { label: "Branch code", value: "HO-01" }])[0], /"Role" was "Service advisor" and is now "Technician"/);
  assert.match(compareForms(approved, [{ label: "Full name", value: "Thabo Dlamini" }, { label: "Role", value: "Service advisor" }])[0], /"Branch code" is no longer on the form/);
  assert.match(compareForms(approved, [...approved, { label: "Approver", value: "Someone" }])[0], /"Approver" has appeared with "Someone"/);
  assert.deepEqual(compareForms([{ label: "Notes", value: "" }], []), [], "an empty field that is gone is no change");
  assert.equal(compareForms([{ label: "Name", value: "A" }, { label: "Name", value: "B" }], [{ label: "Name", value: "A" }, { label: "Name", value: "C" }]).length, 1, "two boxes with the same label are told apart");
});

test("request values go to the recorded fields they were connected to, and only those", async () => {
  const a = await admin(); try {
    const b = bind("create", makeTask("create", a.url));
    assert.deepEqual(variablesFor(b, { ...CREATE, notes: "ignored" }), { e_mail: "thabo@dealer.co.za", dealer: "Suzuki Boksburg", role: "Service advisor", full_name: "Thabo Dlamini" });
  } finally { await a.close(); }
});

/* ── the real thing: a browser, a fake CMS admin, and the Shell ─────── */

test("before approval the form is filled in and photographed, and NOTHING is saved", { skip }, async () => {
  const a = await admin(); try {
    resetBindings(); bind("create", makeTask("create", a.url));
    const shell = jobFor(CREATE); const job = await shell.submit("create thabo");
    await until(() => s1(job.id).previewState === "ready");
    const step = s1(job.id);
    assert.equal(step.status, "awaiting_approval");
    assert.equal(store.getJob(job.id)!.status, "awaiting_approval");
    assert.equal(a.state.saves, 0, "no user was saved");
    assert.ok(!a.state.posts.some((p) => p.startsWith("/api/users")), "the Save button was never pressed");
    const text = step.preview!.text;
    assert.match(text, /Create a user at Suzuki Boksburg/);
    assert.match(text, /Full name: Thabo Dlamini/);
    assert.match(text, /E-mail: thabo@dealer\.co\.za/);
    assert.match(text, /Role: Service advisor/);
    assert.match(text, /Dealer: Suzuki Boksburg/);
    assert.match(text, /Branch code: HO-01/, "pre-filled defaults are shown too, so nothing is hidden");
    assert.match(text, /NOT saved/);
    assert.doesNotMatch(text, /Created:/, "a read-only, self-updating field is not part of the form");
    const file = previewFile(step)!;
    assert.ok(file && fs.statSync(file).size > 1000, "there is a real screenshot");
    const [img] = previewImages(store.getJob(job.id)!.steps);
    assert.equal(img.mimeType, "image/jpeg");
    assert.equal(Buffer.from(img.data, "base64").subarray(0, 2).toString("hex"), "ffd8", "and Claude can be shown it");
    shell.cancel(job.id);
  } finally { await a.close(); }
});

test("approving presses Save, and it is done only because CMS said so", { skip }, async () => {
  const a = await admin(); try {
    resetBindings(); bind("create", makeTask("create", a.url));
    const shell = jobFor(CREATE); const job = await shell.submit("create thabo");
    await until(() => s1(job.id).previewState === "ready");
    assert.equal(a.state.saves, 0);
    shell.approve(job.id);
    await until(() => store.getJob(job.id)!.status === "done");
    assert.equal(a.state.saves, 1);
    const u = a.state.users.get("thabo@dealer.co.za");
    assert.deepEqual([u.fullname, u.role, u.dealer], ["Thabo Dlamini", "Service advisor", "Suzuki Boksburg"]);
    const out = s1(job.id).output!;
    assert.equal(out.verified, true);
    assert.equal(out.confirmedBy, "User saved successfully");
  } finally { await a.close(); }
});

test("if the form is not what was approved by the time of the save, nothing is saved", { skip }, async () => {
  const a = await admin(); try {
    resetBindings(); bind("create", makeTask("create", a.url));
    const shell = jobFor(CREATE); const job = await shell.submit("create thabo");
    await until(() => s1(job.id).previewState === "ready");
    a.state.branch = "ED-09"; // CMS pre-fills something different from what the person saw
    shell.approve(job.id);
    await until(() => store.getJob(job.id)!.status === "failed");
    assert.match(s1(job.id).error!, /Not saved\. The form no longer matches what you approved/);
    assert.match(s1(job.id).error!, /"Branch code" was "HO-01" and is now "ED-09"/);
    assert.equal(a.state.saves, 0);
  } finally { await a.close(); }
});

test("when CMS says no (duplicate user), the step fails with CMS's own words and nothing after it runs", { skip }, async () => {
  const a = await admin(); try {
    a.state.users.set("thabo@dealer.co.za", { fullname: "Existing" }); a.state.strict = true;
    resetBindings(); bind("create", makeTask("create", a.url));
    const shell = jobFor(CREATE); const job = await shell.submit("create thabo");
    await until(() => s1(job.id).previewState === "ready");
    shell.approve(job.id);
    await until(() => store.getJob(job.id)!.status === "failed");
    assert.match(s1(job.id).error!, /The page reported a problem after saving: A user with that e-mail already exists/);
    assert.equal(a.state.saves, 0);
  } finally { await a.close(); }
});

test("a save the page never confirms is reported as unconfirmed, with a warning to check CMS", { skip }, async () => {
  const a = await admin(); try {
    resetBindings(); bind("create", makeTask("create", a.url), "Welcome e-mail sent"); // a message this page never shows
    const shell = jobFor(CREATE); const job = await shell.submit("create thabo");
    await until(() => s1(job.id).previewState === "ready");
    shell.approve(job.id);
    await until(() => store.getJob(job.id)!.status === "failed");
    assert.match(s1(job.id).error!, /Save was pressed but could not be confirmed/);
    assert.match(s1(job.id).error!, /Check CMS admin before doing anything else/);
    assert.equal(s1(job.id).output, undefined, "not recorded as done");
  } finally { await a.close(); }
});

test("an expired CMS sign-in stops at the preview, cannot be approved, and recovers on retry", { skip }, async () => {
  const a = await admin(); try {
    a.state.expired = true;
    resetBindings(); bind("create", makeTask("create", a.url));
    const shell = jobFor(CREATE); const job = await shell.submit("create thabo");
    await until(() => s1(job.id).previewState === "failed");
    assert.match(s1(job.id).previewError!, /asking for a login/);
    assert.equal(store.getJob(job.id)!.status, "failed");
    assert.throws(() => shell.approve(job.id), (e: any) => e.status === 409 && /preview failed/.test(e.message));
    a.state.expired = false;
    shell.retry(job.id, "s1");
    await until(() => s1(job.id).previewState === "ready");
    assert.equal(store.getJob(job.id)!.status, "awaiting_approval");
    assert.equal(a.state.saves, 0);
    shell.cancel(job.id);
  } finally { await a.close(); }
});

test("changing a user's role works the same way, on the same safeguards", { skip }, async () => {
  const a = await admin(); try {
    a.state.users.set("thabo@dealer.co.za", { fullname: "Thabo Dlamini", role: "Technician" });
    resetBindings(); bind("update", makeTask("update", a.url));
    const shell = jobFor({ action: "update", email: "thabo@dealer.co.za", role: "Workshop manager" });
    const job = await shell.submit("promote thabo");
    await until(() => s1(job.id).previewState === "ready");
    assert.equal(a.state.users.get("thabo@dealer.co.za").role, "Technician", "unchanged until approved");
    assert.match(s1(job.id).preview!.text, /Change a user/);
    shell.approve(job.id);
    await until(() => store.getJob(job.id)!.status === "done");
    assert.equal(a.state.users.get("thabo@dealer.co.za").role, "Workshop manager");
  } finally { await a.close(); }
});

test("deactivating a user needs only the e-mail, and is confirmed by CMS's own message", { skip }, async () => {
  const a = await admin(); try {
    a.state.users.set("thabo@dealer.co.za", { fullname: "Thabo Dlamini", active: true });
    resetBindings(); bind("deactivate", makeTask("deactivate", a.url));
    const shell = jobFor({ action: "deactivate", email: "thabo@dealer.co.za" });
    const job = await shell.submit("remove thabo");
    await until(() => s1(job.id).previewState === "ready");
    assert.equal(a.state.users.get("thabo@dealer.co.za").active, true);
    shell.approve(job.id);
    await until(() => store.getJob(job.id)!.status === "done");
    assert.equal(a.state.users.get("thabo@dealer.co.za").active, false);
    assert.equal(s1(job.id).output!.confirmedBy, "User deactivated");
  } finally { await a.close(); }
});

/* ── what Claude is shown ────────────────────────────────────────────── */

test("the approval fingerprint covers the preview, and Claude is told when a preview isn't ready", () => {
  const job = (preview: string, state: string) => ({ id: "j", status: "awaiting_approval", archived: false, summary: "s", unsupported: [], questions: [], planSource: "claude", steps: [
    { ref: "s1", capability: "cms_admin.manage_user", title: "User job", status: "awaiting_approval", risk: "changes_data", inputs: {}, after: [], previewState: state, preview: { text: preview } },
  ] }) as any;
  assert.notEqual(approvalFingerprint(job("Role: Technician", "ready")), approvalFingerprint(job("Role: Workshop manager", "ready")), "a changed preview needs a fresh approval");
  const ready = formatJob(job("Role: Technician", "ready"), { allowApprove: true });
  assert.match(ready, /Preview of step s1 .*exactly what approving will do:\nRole: Technician/);
  assert.match(ready, /To approve, ONLY after the user has clearly said to/);
  const pending = formatJob(job("", "running"), { allowApprove: true });
  assert.match(pending, /Not ready to approve yet: User job \[s1\] — preview still being prepared/);
  assert.doesNotMatch(pending, /To approve, ONLY/, "no approval recipe until the form has been shown");
});
