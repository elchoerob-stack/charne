import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOREMAN_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foreman-support-")), "t.db");
delete process.env.ANTHROPIC_API_KEY; // nothing here may reach Claude
delete process.env.ANTHROPIC_AUTH_TOKEN;

const { classifyEmail, heuristicClassify } = await import("../src/support/classify.js");
const { JiraClient, applyTag, buildIssueFields, jiraConfig } = await import("../src/support/jira.js");
const { draftReply, templateReply } = await import("../src/support/reply.js");
const svc = await import("../src/support/service.js");
const F = await import("../src/support/fields.js");
const { auditFor, getJob, listJobs } = await import("../src/support/store.js");

/* ── sorting ─────────────────────────────────────────────────────────── */

test("keyword fallback sorts the everyday requests", () => {
  const cases: [string, string][] = [
    ["Hi Jacques, please create a new user for Sarah Nel at Suzuki Boksburg, sarah@x.co.za, service advisor role", "user_profile"],
    ["Can you add the stock module to Toyota Kimberley?", "add_product"],
    ["We are onboarding a new dealer in Upington, VAT 4123456789", "new_dealer"],
    ["Please activate Autotrader leads for our Pretoria branch", "lead_aggregator"],
    ["How do I reprint an invoice after it has been posted?", "how_to"],
    ["Please change the opening hours setting for all our branches", "dealer_settings"],
    ["Thanks, see you Monday", "other"],
  ];
  for (const [text, want] of cases) assert.equal(heuristicClassify(text).category, want, text);
});

test("risk follows the category, never the model's say-so", async () => {
  // The model claims a user-creation request is harmless. The guard must not drop.
  const c = await classifyEmail("create a user", {}, async () => ({ category: "user_profile", summary: "s", dealers: [], asks: [], missing: [], confidence: 0.9 }));
  assert.equal(c.risk, "changes_data");
  assert.equal(c.source, "claude");
  const q = await classifyEmail("how do I", {}, async () => ({ category: "how_to", summary: "s", dealers: [], asks: [], missing: [], confidence: 0.9 }));
  assert.equal(q.risk, "read_only");
});

test("a failing or nonsensical model falls back to keywords and still gives an answer", async () => {
  const threw = await classifyEmail("Please create a new user for Anna", {}, async () => { throw new Error("offline"); });
  assert.equal(threw.source, "keywords");
  assert.equal(threw.category, "user_profile");
  const junk = await classifyEmail("Please create a new user for Anna", {}, async () => ({ category: "make_coffee" as never, summary: "", dealers: [], asks: [], missing: [], confidence: 1 }));
  assert.equal(junk.source, "keywords");
});

test("operator hints are kept, and a multi-dealer job lists every dealer once", async () => {
  const c = await classifyEmail("Update settings", { dealer: "Toyota Kimberley", group: "Morgan" }, async () => ({ category: "dealer_settings", summary: "x", dealers: ["Toyota Kimberley", "Toyota Upington"], asks: [], missing: [], confidence: 0.8 }));
  assert.deepEqual(c.dealers, ["Toyota Kimberley", "Toyota Upington"]);
  assert.equal(c.group, "Morgan");
});

test("a user request that omits details lists exactly what is missing", () => {
  const c = heuristicClassify("Please create a new user for Sarah");
  assert.equal(c.category, "user_profile");
  assert.ok(c.missing.some((m) => /e-mail/i.test(m)));
  assert.ok(c.missing.some((m) => /role/i.test(m)));
});

/* ── Jira fields ─────────────────────────────────────────────────────── */

test("tag specs become the right Jira fields", () => {
  const f: Record<string, unknown> = {};
  applyTag(f, "component:Product Support");
  applyTag(f, "label", "Morgan Group");
  applyTag(f, "option:customfield_10042", "Morgan");
  applyTag(f, "text:customfield_10043:abc");
  assert.deepEqual(f.components, [{ name: "Product Support" }]);
  assert.deepEqual(f.labels, ["Morgan-Group"]); // spaces are not allowed in labels
  assert.deepEqual(f.customfield_10042, { value: "Morgan" });
  assert.equal(f.customfield_10043, "abc");
});

test("a typo in a tag spec fails loudly instead of silently dropping the tag", () => {
  assert.throws(() => applyTag({}, "compnent:Product Support"), /Unknown tag type/);
  assert.throws(() => applyTag({}, "option:10042", "x"), /customfield_/);
  assert.throws(() => applyTag({}, "label"), /needs a value/);
});

test("the issue carries Product Support and the group, and skips the group when unknown", () => {
  const cfg = jiraConfig({ JIRA_BASE_URL: "https://x.atlassian.net/", JIRA_EMAIL: "a@b.c", JIRA_API_TOKEN: "t", JIRA_PROJECT_KEY: "PS", JIRA_SUPPORT_TAG: "component:Product Support", JIRA_GROUP_TAG: "label" })!;
  const f = buildIssueFields(cfg, { summary: "  New user\n at Boksburg ", description: "line one\nline two\n\nnext", group: "Super Group" }) as any;
  assert.equal(f.summary, "New user at Boksburg");
  assert.deepEqual(f.project, { key: "PS" });
  assert.deepEqual(f.components, [{ name: "Product Support" }]);
  assert.deepEqual(f.labels, ["Super-Group"]);
  assert.equal(f.description.content.length, 2);
  assert.equal((buildIssueFields(cfg, { summary: "s", description: "d" }) as any).labels, undefined);
});

test("Jira is simply 'not configured' until all four settings exist", () => {
  assert.equal(jiraConfig({ JIRA_BASE_URL: "https://x", JIRA_EMAIL: "a" }), undefined);
});

/* ── the Jira client, against a fake ─────────────────────────────────── */

const GROUPS = [
  { id: "10", value: "Morgan", cascadingOptions: [{ id: "11", value: "Toyota Kimberley" }, { id: "12", value: "Toyota Upington" }] },
  { id: "20", value: "Super Group", cascadingOptions: [{ id: "21", value: "Suzuki Boksburg" }, { id: "22", value: "Suzuki Edenvale" }] },
];
const ME = { accountId: "acc-jacques", displayName: "Jacques Robilliard" };

function fakeJira(opts: { assignFails?: boolean; transitions?: { id: string; name: string }[]; createFails?: boolean; filled?: boolean } = {}) {
  const calls: { method: string; path: string; body: any }[] = [];
  const state: { assignee?: typeof ME; fields: Record<string, any> } = {
    assignee: opts.filled ? ME : undefined,
    fields: opts.filled ? { customfield_1: ME, customfield_2: { id: "1", value: "Product Support" }, customfield_3: { id: "20", value: "Super Group", child: { id: "21", value: "Suzuki Boksburg" } } } : {},
  };
  const doFetch = async (url: string, init: any = {}) => {
    const p = url.replace("https://x.atlassian.net/rest/api/3", "");
    const p0 = p.split("?")[0];
    const method = init.method ?? "GET";
    calls.push({ method, path: p, body: init.body ? JSON.parse(init.body) : undefined });
    const reply = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => (body === undefined ? "" : JSON.stringify(body)) });
    if (p0 === "/myself") return reply(200, ME);
    if (p0 === "/issue" && method === "POST") return opts.createFails ? reply(400, { errors: { components: "Component name 'Product Support' is not valid" } }) : reply(201, { key: "PS-101" });
    if (p0.endsWith("/assignee")) { if (opts.assignFails) return reply(403, { errorMessages: ["no permission"] }); state.assignee = ME; return reply(204, undefined); }
    if (p0.endsWith("/editmeta")) return reply(200, { fields: {
      summary: { name: "Summary", schema: { type: "string" } },
      customfield_1: { name: "Support Agent", schema: { type: "user" } },
      customfield_2: { name: "Support Enquiry", schema: { type: "option" }, allowedValues: [{ id: "1", value: "Product Support" }, { id: "2", value: "Billing" }] },
      customfield_3: { name: "Group and Dealership", schema: { type: "option-with-child" }, allowedValues: GROUPS },
    } });
    if (p0.endsWith("/transitions") && method === "GET") return reply(200, { transitions: opts.transitions ?? [{ id: "31", name: "Done" }] });
    if (p0.endsWith("/transitions") && method === "POST") return reply(204, undefined);
    if (p0.endsWith("/comment")) return reply(201, {});
    const m = /^\/issue\/([A-Z]+-\d+)$/.exec(p0);
    if (m && method === "GET") return reply(200, { key: m[1], fields: {
      summary: "[187-328044D2-005E] Violations",
      description: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "Please raise violations with respective dealers" }] }, { type: "paragraph", content: [{ type: "text", text: "Suzuki Boksburg 168066 Incorrect 1st image" }] }] },
      reporter: { displayName: "Auto Trader Group Support", emailAddress: "groupsupport@autotrader.co.za" },
      assignee: state.assignee, status: { name: "Open" }, ...state.fields,
    } });
    if (m && method === "PUT") { Object.assign(state.fields, JSON.parse(init.body).fields); return reply(204, undefined); }
    return reply(404, { errorMessages: ["unexpected " + method + " " + p] });
  };
  const cfg = jiraConfig({ JIRA_BASE_URL: "https://x.atlassian.net", JIRA_EMAIL: "a@b.c", JIRA_API_TOKEN: "t", JIRA_PROJECT_KEY: "PS", JIRA_SUPPORT_TAG: "component:Product Support" })!;
  return { calls, state, client: new JiraClient(cfg, doFetch as never) };
}

test("a ticket is created, then assigned to the token's owner", async () => {
  const { calls, client } = fakeJira();
  const t = await client.createTicket({ summary: "s", description: "d" });
  assert.equal(t.key, "PS-101");
  assert.equal(t.url, "https://x.atlassian.net/browse/PS-101");
  assert.equal(t.assigned, true);
  assert.deepEqual(calls.find((c) => c.path.endsWith("/assignee"))!.body, { accountId: "acc-jacques" });
});

test("if assigning fails the ticket is kept and the failure is reported", async () => {
  const { client } = fakeJira({ assignFails: true });
  const t = await client.createTicket({ summary: "s", description: "d" });
  assert.equal(t.key, "PS-101");
  assert.equal(t.assigned, false);
  assert.match(t.warnings[0], /could not be assigned/);
});

test("Jira's own explanation is passed through when it refuses", async () => {
  const { client } = fakeJira({ createFails: true });
  await assert.rejects(client.createTicket({ summary: "s", description: "d" }), /Product Support' is not valid/);
});

test("closing finds the transition by name, and lists the choices when it cannot", async () => {
  const ok = fakeJira();
  assert.deepEqual(await ok.client.close("PS-101"), { transition: "Done" });
  const bad = fakeJira({ transitions: [{ id: "1", name: "Resolve" }, { id: "2", name: "Won't do" }] });
  await assert.rejects(bad.client.close("PS-101"), /Available: Resolve, Won't do/);
  assert.equal(bad.calls.filter((c) => c.method === "POST").length, 0, "it must not guess a transition");
});

/* ── replies ─────────────────────────────────────────────────────────── */

test("a how-to draft never claims work is done, and flags what it cannot answer", () => {
  const job = { classification: heuristicClassify("How do I reprint an invoice?"), email: "How do I reprint an invoice?", status: "proposed", warnings: [] } as never;
  const t = templateReply(job);
  assert.match(t, /\[ANSWER/);
  assert.doesNotMatch(t, /has been (done|updated|set up)/);
});

test("a finished change says it is done, an unfinished one does not", () => {
  const base = { classification: heuristicClassify("Please create a new user for Sarah, sarah@x.co.za, advisor, Boksburg dealer"), email: "x", warnings: [], ticket: { key: "PS-7" } } as never;
  assert.match(templateReply(base, { done: true }), /has been updated \(reference PS-7\)/);
  assert.doesNotMatch(templateReply(base), /has been updated/);
});

test("when Claude is unreachable the draft still arrives, from the template", async () => {
  const job = { classification: heuristicClassify("Please create a new user for Sarah"), email: "x", warnings: [], status: "proposed" } as never;
  const r = await draftReply(job, {}, async () => { throw new Error("offline"); });
  assert.equal(r.source, "template");
});

/* ── the whole life of a job ─────────────────────────────────────────── */

function deps(jira?: ReturnType<typeof fakeJira>["client"]) {
  return {
    jira: () => jira,
    classify: (t: string, h: any) => classifyEmail(t, h, async () => undefined),
    reply: (j: any, o: any) => draftReply(j, o, async () => { throw new Error("offline"); }),
  } as never;
}

const EMAIL = "From: Sarah Nel <sarah@dealer.co.za>\nSubject: New user\n\nPlease create a new user for Thabo Dlamini, thabo@dealer.co.za, service advisor, Suzuki Boksburg dealer.";

test("pasting an e-mail proposes; it does not touch Jira", async () => {
  const f = fakeJira();
  const job = await svc.intake(EMAIL, { group: "Super Group" }, deps(f.client));
  assert.equal(job.status, "proposed");
  assert.equal(job.classification.category, "user_profile");
  assert.equal(job.classification.group, "Super Group");
  assert.ok(job.reply?.text.includes("Sarah"), "addressed to the sender");
  assert.equal(f.calls.length, 0, "nothing may be created before approval");
});

test("approve → ticket exists once, however many times it is asked", async () => {
  const f = fakeJira();
  const d = deps(f.client);
  const job = await svc.intake(EMAIL, {}, d);
  const a = await svc.createTicket(job.id, d);
  const b = await svc.createTicket(job.id, d);
  assert.equal(a.status, "open");
  assert.equal(b.ticket?.key, "PS-101");
  assert.equal(f.calls.filter((c) => c.method === "POST" && c.path === "/issue").length, 1, "no duplicate ticket");
  assert.match(a.reply!.text, /PS-101/, "the acknowledgement now carries the reference");
});

test("without Jira set up, approval is refused with a clear reason", async () => {
  const job = await svc.intake(EMAIL, {}, deps(undefined));
  await assert.rejects(svc.createTicket(job.id, deps(undefined)), (e: any) => e.status === 412 && /JIRA_BASE_URL/.test(e.message));
  assert.equal(getJob(job.id)!.status, "proposed");
});

test("a job is only marked done after Jira has closed the ticket", async () => {
  const stuck = fakeJira({ transitions: [{ id: "1", name: "Resolve" }], filled: true });
  const d = deps(stuck.client);
  const job = await svc.intake(EMAIL, {}, d);
  await svc.createTicket(job.id, d);
  await assert.rejects(svc.complete(job.id, {}, d), (e: any) => e.status === 502 && /did not close PS-101/.test(e.message));
  assert.equal(getJob(job.id)!.status, "open", "still open, so it cannot be forgotten");

  const fine = fakeJira({ filled: true });
  const done = await svc.complete(job.id, { note: "Profile created." }, deps(fine.client));
  assert.equal(done.status, "done");
  assert.ok(fine.calls.some((c) => c.path.endsWith("/comment")));
  assert.ok(fine.calls.some((c) => c.method === "POST" && c.path.endsWith("/transitions")));
  assert.match(done.reply!.text, /has been updated/);
});

test("only finished jobs archive, and archiving takes them off the active list", async () => {
  const f = fakeJira();
  const d = deps(f.client);
  const job = await svc.intake(EMAIL, {}, d);
  assert.throws(() => svc.archive(job.id), (e: any) => e.status === 409);
  await svc.createTicket(job.id, d);
  await svc.fillFields(job.id, {}, d);
  await svc.complete(job.id, {}, d);
  svc.archive(job.id);
  assert.ok(!listJobs().some((j) => j.id === job.id));
  assert.ok(listJobs({ archived: true }).some((j) => j.id === job.id));
  svc.archive(job.id, false);
  assert.ok(listJobs().some((j) => j.id === job.id));
});

test("corrections are allowed before approval and locked after", async () => {
  const f = fakeJira();
  const d = deps(f.client);
  const job = await svc.intake("Thanks for the call earlier", {}, d);
  assert.equal(job.classification.risk, "read_only");
  const fixed = svc.correct(job.id, { category: "add_product", dealers: ["Toyota Kimberley", " "], group: "Morgan" });
  assert.equal(fixed.classification.risk, "changes_data", "moving to a change category raises the guard");
  assert.deepEqual(fixed.classification.dealers, ["Toyota Kimberley"]);
  assert.throws(() => svc.correct(job.id, { category: "nope" as never }), (e: any) => e.status === 400);
  assert.throws(() => svc.correct(job.id, { dealers: "x" as never }), (e: any) => e.status === 400);
  await svc.createTicket(job.id, d);
  assert.throws(() => svc.correct(job.id, { summary: "late edit" }), (e: any) => e.status === 409);
});

test("every step leaves an audit trail", async () => {
  const f = fakeJira();
  const d = deps(f.client);
  const job = await svc.intake(EMAIL, {}, d);
  await svc.createTicket(job.id, d);
  await svc.fillFields(job.id, {}, d);
  await svc.complete(job.id, {}, d);
  svc.archive(job.id);
  const actions = auditFor(job.id).map((a) => a.action);
  assert.deepEqual(actions, ["received", "ticket-created", "fields-filled", "ticket-closed", "done", "archived"]);
});

test("the ticket preview shows exactly what would be sent", async () => {
  const f = fakeJira();
  const job = await svc.intake(EMAIL, { group: "Super Group" }, deps(f.client));
  const d = svc.ticketDraft(job);
  assert.match(d.description, /Dealer: Suzuki Boksburg/);
  assert.match(d.description, /Original e-mail:/);
  assert.equal(d.group, "Super Group");
});

/* ── the fields the desk requires on every closed ticket ─────────────── */

const meta = (id: string, name: string, type: string, allowed: any[] = []) => F.parseMeta(id, { name, schema: { type }, allowedValues: allowed });
const ctx = (over: Partial<Parameters<typeof F.planFields>[3]> = {}) => ({ me: ME, enquiry: ["Product Support"], group: undefined, dealers: [], ...over });
const METAS = [
  meta("customfield_1", "Support Agent", "user"),
  meta("customfield_2", "Support Enquiry", "option", [{ id: "1", value: "Product Support" }, { id: "2", value: "Billing" }]),
  meta("customfield_3", "Group and Dealership", "option-with-child", GROUPS),
];
const plan = (c: ReturnType<typeof ctx>, current: Record<string, unknown> = {}) => F.planFields(F.DEFAULT_FIELD_NAMES, METAS, current, c);

test("a value is matched only when exactly one allowed value clearly fits", () => {
  const opts = [{ label: "Toyota Kimberley" }, { label: "Toyota Upington" }, { label: "Toyota Kimberley Used" }];
  assert.equal(F.matchOne(opts, ["toyota kimberley"])?.label, "Toyota Kimberley", "an exact match wins over a longer name");
  assert.equal(F.matchOne(opts, ["Toyota"]), undefined, "several fit, so nothing is picked");
  assert.equal(F.matchOne(opts, ["Honda Pretoria"]), undefined);
  assert.equal(F.matchOne([{ label: "A" }, { label: "A" }], ["a"]), undefined, "duplicate exact matches are ambiguous");
});

test("the agent is you, the enquiry is Product Support, and the group comes from the dealership", () => {
  const p = plan(ctx({ dealers: ["Suzuki Boksburg"] }));
  assert.deepEqual(p.find((x) => x.role === "agent")!.proposal!.payload, { accountId: "acc-jacques" });
  assert.deepEqual(p.find((x) => x.role === "enquiry")!.proposal!.payload, { id: "1" });
  const g = p.find((x) => x.role === "group")!;
  assert.equal(g.proposal!.label, "Super Group › Suzuki Boksburg");
  assert.deepEqual(g.proposal!.payload, { id: "20", child: { id: "21" } });
});

test("a known group narrows the dealership; an unknown dealership is left for you to choose", () => {
  const known = plan(ctx({ group: "Morgan", dealers: ["Toyota Upington"] })).find((x) => x.role === "group")!;
  assert.equal(known.proposal!.label, "Morgan › Toyota Upington");
  const unknown = plan(ctx({ group: "Morgan", dealers: ["Toyota Springbok"] })).find((x) => x.role === "group")!;
  assert.equal(unknown.proposal, undefined, "no guessing");
  assert.ok(unknown.options.includes("Morgan › Toyota Kimberley"), "but every choice is offered");
  assert.equal(plan(ctx()).find((x) => x.role === "group")!.proposal, undefined, "no group and no dealer: nothing to go on");
});

test("a ticket about several dealers is never settled by taking the first", () => {
  // Real shape: one e-mail naming two dealerships that sit under the same group.
  const two = plan(ctx({ dealers: ["Suzuki Boksburg", "Suzuki Edenvale"], group: "Super Group" }), {});
  assert.equal(two.find((x) => x.role === "group")!.proposal, undefined, "same group, two dealerships: pick one");
  assert.equal(plan(ctx({ dealers: ["Suzuki Boksburg", "Suzuki Edenvale"] })).find((x) => x.role === "group")!.proposal, undefined, "and with no group given");
  assert.equal(plan(ctx({ dealers: ["Suzuki Boksburg"], group: "Super Group" })).find((x) => x.role === "group")!.proposal!.label, "Super Group › Suzuki Boksburg", "one dealership is still settled automatically");
  const noGroup = plan(ctx({ dealers: ["Suzuki Boksburg", "Toyota Kimberley"] })).find((x) => x.role === "group")!;
  assert.equal(noGroup.proposal, undefined, "two dealers in two groups: still a choice");
  assert.ok(noGroup.options.length > 0, "but the options are all there to choose from");
  // The same dealer named twice is still just one dealer.
  assert.equal(plan(ctx({ dealers: ["Suzuki Boksburg", "suzuki boksburg"] })).find((x) => x.role === "group")!.proposal!.label, "Super Group › Suzuki Boksburg");
});

test("fields already filled are left alone and not proposed again", () => {
  const p = plan(ctx({ dealers: ["Suzuki Boksburg"] }), { customfield_2: { id: "2", value: "Billing" } });
  const e = p.find((x) => x.role === "enquiry")!;
  assert.equal(e.filled, true);
  assert.equal(e.current, "Billing");
  assert.equal(e.proposal, undefined);
  assert.deepEqual(F.fieldsToWrite(p, METAS, {}, ME).fields.customfield_2, undefined, "Billing is not overwritten");
});

test("an operator's choice is checked against the allowed values", () => {
  const p = plan(ctx());
  const ok = F.fieldsToWrite(p, METAS, { "Group and Dealership": "Morgan › Toyota Kimberley" }, ME);
  assert.deepEqual(ok.fields.customfield_3, { id: "10", child: { id: "11" } });
  assert.throws(() => F.fieldsToWrite(p, METAS, { "Group and Dealership": "Morgan › Nowhere" }, ME), /not an allowed value/);
  assert.throws(() => F.fieldsToWrite(p, METAS, {}, ME), /Group and Dealership needs a choice/);
});

test("a field missing from the ticket's edit screen is reported, not skipped", () => {
  const p = F.planFields(F.DEFAULT_FIELD_NAMES, METAS.slice(0, 2), {}, ctx());
  const g = p.find((x) => x.role === "group")!;
  assert.equal(g.kind, "missing");
  assert.match(g.note!, /not on this ticket's edit screen/);
});

test("a ticket's rich-text body reads back as plain text", () => {
  const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi CMS" }] }, { type: "paragraph", content: [{ type: "text", text: "line one" }, { type: "hardBreak" }, { type: "text", text: "line two" }] }] };
  assert.equal(F.adfToText(doc).trim(), "Hi CMS\n\nline one\nline two");
});

/* ── loading a ticket the desk already made ──────────────────────────── */

test("an existing ticket is loaded read-only, sorted, and not duplicated", async () => {
  const f = fakeJira();
  const d = deps(f.client);
  const job = await svc.importTicket("https://cmsdev.atlassian.net/browse/cs-259412?focusedId=1", d);
  assert.equal(job.ticket?.key, "CS-259412");
  assert.equal(job.status, "open");
  assert.equal(job.source, "ticket");
  assert.match(job.email, /From: Auto Trader Group Support <groupsupport@autotrader.co.za>/);
  assert.match(job.email, /Suzuki Boksburg 168066/);
  assert.deepEqual(job.classification.dealers, ["Suzuki Boksburg"]);
  assert.ok(f.calls.every((c) => c.method === "GET"), "importing must not change anything in Jira");
  const again = await svc.importTicket("CS-259412", d);
  assert.equal(again.id, job.id);
});

test("a bad key or a missing Jira setup is refused plainly", async () => {
  await assert.rejects(svc.importTicket("not a key", deps(fakeJira().client)), (e: any) => e.status === 400);
  await assert.rejects(svc.importTicket("CS-1", deps(undefined)), (e: any) => e.status === 412);
});

/* ── the close gate ──────────────────────────────────────────────────── */

test("a ticket cannot be closed until all four required things are filled", async () => {
  const f = fakeJira();
  const d = deps(f.client);
  const job = await svc.importTicket("CS-300001", d);
  await assert.rejects(svc.complete(job.id, {}, d), (e: any) => e.status === 409 && /Assignee, Support Agent, Support Enquiry, Group and Dealership/.test(e.message));
  assert.equal(f.calls.filter((c) => c.path.endsWith("/transitions") && c.method === "POST").length, 0, "no close attempted");
  assert.equal(getJob(job.id)!.status, "open");
  assert.ok(auditFor(job.id).some((a) => a.action === "close-blocked"));
});

test("filling the fields takes the ticket and writes only what clearly matched", async () => {
  const f = fakeJira();
  const d = deps(f.client);
  const job = await svc.importTicket("CS-300002", d);
  const r = await svc.fillFields(job.id, {}, d);
  assert.deepEqual(r.written, ["Assignee → Jacques Robilliard", "Support Agent → Jacques Robilliard", "Support Enquiry → Product Support", "Group and Dealership → Super Group › Suzuki Boksburg"]);
  assert.equal(r.status.complete, true);
  const done = await svc.complete(job.id, {}, d);
  assert.equal(done.status, "done");
});

test("when a field needs a choice nothing is written until the operator makes it", async () => {
  const f = fakeJira();
  const d = deps(f.client);
  const job = await svc.importTicket("CS-300003", d);
  svc.correct(job.id, { dealers: ["Toyota Springbok"], group: "Morgan" });
  const before = f.calls.length;
  await assert.rejects(svc.fillFields(job.id, {}, d), (e: any) => e.status === 422 && /Group and Dealership needs a choice/.test(e.message));
  assert.ok(!f.calls.slice(before).some((c) => c.method === "PUT"), "a refused fill must not write anything");
  const r = await svc.fillFields(job.id, { "Group and Dealership": "Morgan › Toyota Kimberley" }, d);
  assert.equal(r.status.complete, true);
  assert.deepEqual(f.state.fields.customfield_3, { id: "10", child: { id: "11" } }, "Morgan › Toyota Kimberley, by id");
});

