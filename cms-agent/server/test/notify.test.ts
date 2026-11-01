import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { EventEmitter } from "node:events";
import { agentNotice, channels, inQuietHours, notify, priorityFor, startNotifier } from "../src/notify.js";

/** A local stand-in for ntfy.sh and a Zapier catch hook that records what it was sent. */
async function fakeServer(status = 200) {
  const hits: { path: string; headers: http.IncomingHttpHeaders; body: any }[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      hits.push({ path: req.url ?? "", headers: req.headers, body: raw ? JSON.parse(raw) : null });
      res.writeHead(req.url?.includes("broken") ? 500 : status).end("ok");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, hits, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const morning = new Date("2026-11-02T05:00:00Z"); // 07:00 in Centurion, a Monday
const night = new Date("2026-11-02T21:00:00Z"); // 23:00 in Centurion

test("channels are read from a comma or space separated list, unknown names ignored", () => {
  assert.deepEqual(channels({ NOTIFY_CHANNELS: "ntfy, webhook sms" }), ["ntfy", "webhook"]);
  assert.deepEqual(channels({}), []);
});

test("quiet hours wrap midnight and use Centurion time", () => {
  assert.equal(inQuietHours("21:30-06:00", night), true);
  assert.equal(inQuietHours("21:30-06:00", morning), false);
  assert.equal(inQuietHours("12:00-14:00", new Date("2026-11-02T10:30:00Z")), true, "12:30 SAST");
  assert.equal(inQuietHours(undefined, night), false);
});

test("problems are loud even at night; good news goes quiet", () => {
  assert.equal(priorityFor("failed", true), 5);
  assert.equal(priorityFor("partial", true), 4);
  assert.equal(priorityFor("succeeded", false), 3);
  assert.equal(priorityFor("succeeded", true), 2);
});

test("nothing configured means nothing sent, and no error", async () => {
  const r = await notify({ title: "t", message: "m", status: "failed" }, { env: {} });
  assert.equal(r.sent, false);
  assert.match(r.skipped ?? "", /NOTIFY_CHANNELS/);
});

test("ntfy gets a JSON publish with topic, tags, priority and a tap-through link", async () => {
  const s = await fakeServer();
  try {
    const env = { NOTIFY_CHANNELS: "ntfy", NTFY_SERVER: s.url, NTFY_TOPIC: "foreman-test", NTFY_TOKEN: "tk", PUBLIC_URL: "https://foreman.example/" };
    const n = agentNotice({ agentId: "agent_1", name: "Morning bookings", status: "partial", summary: "Two of three bookings loaded; Kimberley failed at the VIN field — résumé attached.", runId: "arun_1" }, env);
    const r = await notify(n, { env, now: morning });
    assert.equal(r.sent, true);
    assert.equal(s.hits.length, 1);
    const { body, headers } = s.hits[0];
    assert.equal(body.topic, "foreman-test");
    assert.equal(body.title, "Morning bookings: partly done");
    assert.ok(body.message.includes("résumé"), "accents survive");
    assert.deepEqual(body.tags, ["warning"]);
    assert.equal(body.priority, 4);
    assert.equal(body.click, "https://foreman.example/board.html");
    assert.equal(headers.authorization, "Bearer tk");
  } finally { await s.close(); }
});

test("webhook payload carries the agent fields for a Zapier zap to map", async () => {
  const s = await fakeServer();
  try {
    const env = { NOTIFY_CHANNELS: "webhook", NOTIFY_WEBHOOK_URL: `${s.url}/hooks/catch/1/abc` };
    await notify(agentNotice({ agentId: "agent_9", name: "Nightly export", status: "succeeded", summary: "Export saved.", runId: "arun_9" }, env), { env, now: night });
    const b = s.hits[0].body;
    assert.equal(s.hits[0].path, "/hooks/catch/1/abc");
    assert.equal(b.source, "foreman");
    assert.equal(b.status, "succeeded");
    assert.equal(b.agentName, "Nightly export");
    assert.equal(b.runId, "arun_9");
    assert.equal(b.quiet, false, "no quiet window configured");
  } finally { await s.close(); }
});

test("NOTIFY_ON=problems skips a clean run but sends a failed one", async () => {
  const s = await fakeServer();
  try {
    const env = { NOTIFY_CHANNELS: "ntfy", NTFY_SERVER: s.url, NTFY_TOPIC: "t", NOTIFY_ON: "problems" };
    const ok = await notify({ title: "a", message: "fine", status: "succeeded" }, { env });
    assert.equal(ok.sent, false);
    const bad = await notify({ title: "a", message: "broke", status: "failed" }, { env });
    assert.equal(bad.sent, true);
    assert.equal(s.hits.length, 1);
  } finally { await s.close(); }
});

test("one broken channel does not stop the others", async () => {
  const s = await fakeServer();
  try {
    const env = { NOTIFY_CHANNELS: "webhook,ntfy,email", NOTIFY_WEBHOOK_URL: `${s.url}/broken`, NTFY_SERVER: s.url, NTFY_TOPIC: "t" };
    const r = await notify({ title: "a", message: "b", status: "failed" }, { env });
    assert.equal(r.sent, true, "ntfy still got through");
    const by = Object.fromEntries(r.results.map((x) => [x.channel, x]));
    assert.equal(by.ntfy.ok, true);
    assert.equal(by.webhook.ok, false);
    assert.match(by.webhook.error ?? "", /500/);
    assert.equal(by.email.ok, false);
    assert.match(by.email.error ?? "", /SMTP_URL/);
  } finally { await s.close(); }
});

test("startNotifier forwards agent reports from the event stream", async () => {
  const s = await fakeServer();
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { NOTIFY_CHANNELS: "ntfy", NTFY_SERVER: s.url, NTFY_TOPIC: "t" });
    const events = new EventEmitter();
    startNotifier(events);
    events.emit("report", { agentId: "a", name: "Morning bookings", status: "failed", summary: "Login expired." });
    for (let i = 0; i < 50 && !s.hits.length; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(s.hits[0]?.body.title, "Morning bookings: failed");
    assert.equal(s.hits[0]?.body.priority, 5);
  } finally {
    process.env = saved;
    await s.close();
  }
});
