import { Router } from "express";
import { now } from "../db.js";
import { agentEvents, deleteAgent, getAgent, listAgentRuns, listAgents, newAgent, runAgent, saveAgent, type Agent } from "./agents.js";
import { queue } from "./queue.js";
import { hasSavedSession } from "./runner.js";
import { describeSchedule, nextRun, validateCron } from "./scheduler.js";
import { getTask, listRuns, listTasks, saveTask } from "./store.js";
import type { BoardColumn, Task, TaskSchedule } from "./types.js";
import { remoteStatus, startTunnel, stopTunnel } from "../remote.js";

export const boardRoutes = Router();

/* ── Schedules ─────────────────────────────────────────────────────────── */

function parseSchedule(body: unknown): TaskSchedule | { error: string } {
  const b = (body ?? {}) as Partial<TaskSchedule>;
  if (!["interval", "daily", "weekly", "cron"].includes(String(b.kind))) return { error: "kind must be interval, daily, weekly or cron" };
  const s: TaskSchedule = { enabled: b.enabled !== false, kind: b.kind as TaskSchedule["kind"], timezone: b.timezone || undefined, inputs: b.inputs };
  if (s.kind === "interval") { s.everyMinutes = Math.max(1, Number(b.everyMinutes ?? 60)); }
  if (s.kind === "daily" || s.kind === "weekly") {
    if (!/^\d{2}:\d{2}$/.test(String(b.atTime ?? ""))) return { error: "atTime must be HH:MM" };
    s.atTime = b.atTime;
    if (s.kind === "weekly") s.weekdays = (Array.isArray(b.weekdays) ? b.weekdays : []).map(Number).filter((d) => d >= 0 && d <= 6);
  }
  if (s.kind === "cron") {
    const err = validateCron(String(b.cron ?? ""));
    if (err) return { error: err };
    s.cron = String(b.cron).trim();
  }
  const n = nextRun(s);
  s.nextRunAt = n?.toISOString();
  return s;
}

boardRoutes.put("/tasks/:id/schedule", (req, res) => {
  const t = getTask(req.params.id);
  if (!t) return res.status(404).json({ error: "not found" });
  const s = parseSchedule(req.body);
  if ("error" in s) return res.status(400).json(s);
  t.schedule = s;
  t.boardColumn = s.enabled ? "scheduled" : t.boardColumn === "scheduled" ? "paused" : t.boardColumn;
  t.updatedAt = now();
  saveTask(t);
  res.json({ schedule: s, describe: describeSchedule(s) });
});

boardRoutes.delete("/tasks/:id/schedule", (req, res) => {
  const t = getTask(req.params.id);
  if (!t) return res.status(404).json({ error: "not found" });
  t.schedule = undefined;
  if (t.boardColumn === "scheduled") t.boardColumn = "todo";
  saveTask(t);
  res.json({ ok: true });
});

/* ── Board ──────────────────────────────────────────────────────────────── */

/** Where a task sits if the user has not parked it somewhere explicitly. */
export function derivedColumn(t: Task, activeRuns: Set<string>): BoardColumn {
  if (activeRuns.has(t.id)) return "todo"; // shown with a running badge in the todo/queue lane
  if (t.boardColumn) return t.boardColumn;
  if (t.schedule?.enabled) return "scheduled";
  if (t.schedule && !t.schedule.enabled) return "paused";
  if (t.lastRunStatus === "failed" || t.lastRunStatus === "needs_attention") return "attention";
  if (t.lastRunStatus === "succeeded") return "done";
  return "todo";
}

boardRoutes.get("/board", (req, res) => {
  const dealer = typeof req.query.dealer === "string" && req.query.dealer ? req.query.dealer : undefined;
  const st = queue.status();
  const active = new Set<string>([...(st.active ? [st.active.taskId] : []), ...st.queued.map((q) => q.taskId)]);
  const recent = listRuns(undefined, 200);
  const cards = listTasks(dealer).map((t) => ({
    id: t.id, title: t.title, dealer: t.dealer, steps: t.steps.length, fields: t.variables.length,
    column: derivedColumn(t, active), order: t.boardOrder ?? 0,
    schedule: t.schedule ? { ...t.schedule, describe: describeSchedule(t.schedule) } : undefined,
    running: st.active?.taskId === t.id ? st.active : undefined,
    queued: st.queued.filter((q) => q.taskId === t.id).length,
    lastRunStatus: t.lastRunStatus, lastRunAt: t.lastRunAt, runCount: t.runCount, agentId: t.agentId,
    lastError: recent.find((r) => r.taskId === t.id)?.error,
  }));
  cards.sort((a, b) => a.order - b.order || (b.lastRunAt ?? "").localeCompare(a.lastRunAt ?? ""));
  res.json({ columns: ["todo", "scheduled", "paused", "done", "attention"], cards, hasSession: hasSavedSession(), queue: st });
});

/** Drop a card: move it to a column and/or reorder. The move performs the real action. */
boardRoutes.post("/board/move", (req, res) => {
  const { taskId, column, order } = req.body ?? {};
  const t = getTask(String(taskId));
  if (!t) return res.status(404).json({ error: "not found" });
  const col = String(column) as BoardColumn;
  if (!["todo", "scheduled", "paused", "done", "attention"].includes(col)) return res.status(400).json({ error: "bad column" });
  let action: string | undefined;
  if (col === "scheduled") {
    if (!t.schedule) return res.status(409).json({ error: "This task has no schedule yet. Set one, then it can live here.", needsSchedule: true });
    t.schedule.enabled = true; t.schedule.nextRunAt = nextRun(t.schedule)?.toISOString(); action = "schedule enabled";
  } else if (col === "paused") {
    if (t.schedule) { t.schedule.enabled = false; action = "schedule paused"; }
  } else if (col === "todo" && t.schedule?.enabled) {
    t.schedule.enabled = false; action = "schedule paused";
  }
  t.boardColumn = col;
  if (typeof order === "number") t.boardOrder = order;
  t.updatedAt = now();
  saveTask(t);
  res.json({ ok: true, column: col, action });
});

boardRoutes.post("/board/reorder", (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]) : [];
  ids.forEach((id, i) => { const t = getTask(id); if (t) { t.boardOrder = i; saveTask(t); } });
  res.json({ ok: true, count: ids.length });
});

/* ── Agents ─────────────────────────────────────────────────────────────── */

boardRoutes.get("/agents", (_req, res) => {
  res.json(listAgents().map((a) => ({ ...a, describe: describeSchedule(a.schedule), tasks: a.taskIds.map((id) => getTask(id)?.title ?? "(missing)") })));
});

boardRoutes.post("/agents", (req, res) => {
  const { name, brief, taskIds, stopOnFailure, schedule, inputs } = req.body ?? {};
  if (!name || typeof name !== "string") return res.status(400).json({ error: "name required" });
  const ids = (Array.isArray(taskIds) ? taskIds : []).filter((id) => getTask(String(id)));
  const a = newAgent({ name: name.trim(), brief: String(brief ?? ""), taskIds: ids, stopOnFailure: Boolean(stopOnFailure), inputs });
  if (schedule) { const s = parseSchedule(schedule); if ("error" in s) return res.status(400).json(s); a.schedule = s; }
  for (const id of ids) { const t = getTask(id)!; t.agentId = a.id; saveTask(t); }
  saveAgent(a);
  res.status(201).json({ agent: a });
});

boardRoutes.patch("/agents/:id", (req, res) => {
  const a = getAgent(req.params.id);
  if (!a) return res.status(404).json({ error: "not found" });
  const { name, brief, taskIds, stopOnFailure, enabled, schedule, inputs } = req.body ?? {};
  if (typeof name === "string") a.name = name.trim();
  if (typeof brief === "string") a.brief = brief;
  if (Array.isArray(taskIds)) {
    for (const old of a.taskIds) { const t = getTask(old); if (t && t.agentId === a.id) { t.agentId = undefined; saveTask(t); } }
    a.taskIds = taskIds.map(String).filter((id) => getTask(id));
    for (const id of a.taskIds) { const t = getTask(id)!; t.agentId = a.id; saveTask(t); }
  }
  if (typeof stopOnFailure === "boolean") a.stopOnFailure = stopOnFailure;
  if (typeof enabled === "boolean") a.enabled = enabled;
  if (inputs && typeof inputs === "object") a.inputs = inputs;
  if (schedule === null) a.schedule = undefined;
  else if (schedule) { const s = parseSchedule(schedule); if ("error" in s) return res.status(400).json(s); a.schedule = s; }
  saveAgent(a);
  res.json({ agent: a });
});

boardRoutes.delete("/agents/:id", (req, res) => {
  const a = getAgent(req.params.id);
  if (a) for (const id of a.taskIds) { const t = getTask(id); if (t && t.agentId === a.id) { t.agentId = undefined; saveTask(t); } }
  res.json({ deleted: deleteAgent(req.params.id) });
});

/** Start an agent now. Returns immediately; the report arrives on the event stream. */
boardRoutes.post("/agents/:id/run", (req, res) => {
  const a = getAgent(req.params.id);
  if (!a) return res.status(404).json({ error: "not found" });
  if (!a.taskIds.length) return res.status(422).json({ error: "This agent has no tasks yet." });
  if (!hasSavedSession()) return res.status(409).json({ error: "No saved CMS session. Connect CMS first.", needsSession: true });
  void runAgent(a, { headless: req.body?.headless !== false }).catch((err) => agentEvents.emit("report", { agentId: a.id, name: a.name, status: "failed", summary: `Agent crashed: ${(err as Error).message}` }));
  res.status(202).json({ started: true });
});

boardRoutes.get("/agents/:id/runs", (req, res) => res.json(listAgentRuns(req.params.id)));

boardRoutes.get("/agents-stream", (req, res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const onUpdate = (d: unknown) => send("update", d);
  const onReport = (d: unknown) => send("report", d);
  agentEvents.on("update", onUpdate); agentEvents.on("report", onReport);
  const ping = setInterval(() => res.write(": ping\n\n"), 15000);
  req.on("close", () => { clearInterval(ping); agentEvents.off("update", onUpdate); agentEvents.off("report", onReport); res.end(); });
});

/* ── Remote access ──────────────────────────────────────────────────────── */

boardRoutes.get("/remote", (_req, res) => res.json(remoteStatus()));
boardRoutes.post("/remote/tunnel", async (_req, res) => {
  try { res.json(await startTunnel()); } catch (err) { res.status(409).json({ ...remoteStatus(), error: (err as Error).message }); }
});
boardRoutes.delete("/remote/tunnel", (_req, res) => res.json(stopTunnel()));

/* Agents also run on a schedule; the scheduler calls this each tick. */
export function tickAgents(now = new Date()): Agent[] {
  const fired: Agent[] = [];
  for (const a of listAgents()) {
    const s = a.schedule;
    if (!a.enabled || !s?.enabled) continue;
    if (!s.nextRunAt) { const n = nextRun(s, now); if (n) { s.nextRunAt = n.toISOString(); saveAgent(a); } continue; }
    if (new Date(s.nextRunAt) > now) continue;
    s.lastRunAt = now.toISOString();
    s.nextRunAt = nextRun(s, now)?.toISOString();
    saveAgent(a);
    if (hasSavedSession() && a.taskIds.length) { void runAgent(a).catch(() => {}); fired.push(a); }
  }
  return fired;
}
