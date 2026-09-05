import { EventEmitter } from "node:events";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { db, newId, now } from "../db.js";
import { resolveInputs } from "./compile.js";
import { queue } from "./queue.js";
import { getRun, getTask, newRun } from "./store.js";
import type { TaskRun, TaskSchedule } from "./types.js";

/**
 * An Agent is a named worker with a job description and a list of tasks it
 * owns. Running it means running its tasks in order, then having Claude write
 * a short report of what happened — the way a person would tell you "done the
 * three bookings, one failed at the VIN field, screenshot attached".
 *
 * The board of agents is what lets Jacques set several of them going and get
 * on with his own work.
 */

export interface Agent {
  id: string;
  name: string;
  /** What this agent is for, in plain words. Goes into the report prompt. */
  brief: string;
  taskIds: string[];
  /** Per-task input overrides, keyed by task id. */
  inputs?: Record<string, Record<string, string>>;
  schedule?: TaskSchedule;
  enabled: boolean;
  /** Stop after the first failing task, or carry on with the rest. */
  stopOnFailure: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastStatus?: "succeeded" | "partial" | "failed";
  lastSummary?: string;
  runCount: number;
}

export interface AgentRun {
  id: string;
  agentId: string;
  status: "running" | "succeeded" | "partial" | "failed";
  runIds: string[];
  startedAt: string;
  finishedAt?: string;
  summary?: string;
}

db.exec(`
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_runs ON agent_runs(agent_id, created_at);
`);

export function saveAgent(a: Agent): Agent {
  a.updatedAt = now();
  db.prepare(`INSERT INTO agents (id, name, data, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, data=excluded.data, enabled=excluded.enabled, updated_at=excluded.updated_at`)
    .run(a.id, a.name, JSON.stringify(a), a.enabled ? 1 : 0, a.createdAt, a.updatedAt);
  return a;
}
export function getAgent(id: string): Agent | undefined {
  const row = db.prepare("SELECT data FROM agents WHERE id = ?").get(id) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as Agent) : undefined;
}
export function listAgents(): Agent[] {
  return (db.prepare("SELECT data FROM agents ORDER BY updated_at DESC").all() as unknown as { data: string }[]).map((r) => JSON.parse(r.data) as Agent);
}
export function deleteAgent(id: string): number {
  db.prepare("DELETE FROM agent_runs WHERE agent_id = ?").run(id);
  return db.prepare("DELETE FROM agents WHERE id = ?").run(id).changes as number;
}
function saveAgentRun(r: AgentRun): AgentRun {
  db.prepare(`INSERT INTO agent_runs (id, agent_id, status, data, created_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET status=excluded.status, data=excluded.data`).run(r.id, r.agentId, r.status, JSON.stringify(r), r.startedAt);
  return r;
}
export function listAgentRuns(agentId: string, limit = 20): AgentRun[] {
  return (db.prepare("SELECT data FROM agent_runs WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?").all(agentId, limit) as unknown as { data: string }[]).map((r) => JSON.parse(r.data) as AgentRun);
}

export function newAgent(input: Pick<Agent, "name" | "brief" | "taskIds"> & Partial<Agent>): Agent {
  return { id: newId("agent"), enabled: true, stopOnFailure: false, runCount: 0, createdAt: now(), updatedAt: now(), ...input };
}

/* ── Running ───────────────────────────────────────────────────────────── */

export const agentEvents = new EventEmitter();
const client = new Anthropic();

const waitForRun = (runId: string): Promise<TaskRun> =>
  new Promise((resolve) => {
    const check = (r: TaskRun) => { if (r.id === runId && !["queued", "running"].includes(r.status)) { queue.off("update", check); resolve(r); } };
    queue.on("update", check);
    const existing = getRun(runId);
    if (existing && !["queued", "running"].includes(existing.status)) { queue.off("update", check); resolve(existing); }
  });

/** Run an agent's tasks in order and produce a report. Resolves when done. */
export async function runAgent(agent: Agent, opts: { headless?: boolean } = {}): Promise<AgentRun> {
  const ar: AgentRun = { id: newId("arun"), agentId: agent.id, status: "running", runIds: [], startedAt: now() };
  saveAgentRun(ar);
  agentEvents.emit("update", { agentId: agent.id, run: ar });

  const outcomes: { task: string; run: TaskRun }[] = [];
  for (const taskId of agent.taskIds) {
    const task = getTask(taskId);
    if (!task) { outcomes.push({ task: taskId, run: { id: "", taskId, status: "failed", inputs: {}, totalSteps: 0, log: [], createdAt: now(), error: "task no longer exists" } }); continue; }
    const run = queue.enqueue(newRun(task.id, task.steps.length, resolveInputs(task, agent.inputs?.[taskId] ?? {})), { headless: opts.headless ?? true });
    ar.runIds.push(run.id);
    saveAgentRun(ar);
    const finished = await waitForRun(run.id);
    outcomes.push({ task: task.title, run: finished });
    if (finished.status !== "succeeded" && agent.stopOnFailure) break;
  }

  const ok = outcomes.filter((o) => o.run.status === "succeeded").length;
  ar.status = ok === outcomes.length ? "succeeded" : ok === 0 ? "failed" : "partial";
  ar.finishedAt = now();
  ar.summary = await summarise(agent, outcomes).catch((e: Error) => fallbackSummary(outcomes, e.message));
  saveAgentRun(ar);

  agent.runCount += 1;
  agent.lastRunAt = ar.finishedAt;
  agent.lastStatus = ar.status;
  agent.lastSummary = ar.summary;
  saveAgent(agent);
  agentEvents.emit("update", { agentId: agent.id, run: ar });
  agentEvents.emit("report", { agentId: agent.id, name: agent.name, status: ar.status, summary: ar.summary, runId: ar.id });
  return ar;
}

function fallbackSummary(outcomes: { task: string; run: TaskRun }[], why?: string): string {
  const lines = outcomes.map((o) => `• ${o.task}: ${o.run.status}${o.run.error ? ` — ${o.run.error}` : ""}`);
  return lines.join("\n") + (why ? `\n(report written without Claude: ${why})` : "");
}

async function summarise(agent: Agent, outcomes: { task: string; run: TaskRun }[]): Promise<string> {
  const detail = outcomes.map((o) => {
    const last = o.run.log.slice(-6).map((l) => `${l.level}: ${l.message}`).join("\n    ");
    return `Task "${o.task}": ${o.run.status}, step ${o.run.currentStep ?? 0}/${o.run.totalSteps}${o.run.error ? `, error: ${o.run.error}` : ""}\n    ${last}`;
  }).join("\n");
  const res = await client.messages.create({
    model: config.model,
    max_tokens: 600,
    output_config: { effort: "low" },
    system: "You are Foreman, reporting to Jacques (a CMS Systems product specialist) after an agent finished its tasks in a dealership workshop system. Write the report a reliable colleague would: two to five short lines, plain South African business English, what got done, what did not and why, and the one thing he should do next if anything. No preamble, no headings.",
    messages: [{ role: "user", content: `Agent: ${agent.name}\nBrief: ${agent.brief}\n\nOutcomes:\n${detail}` }],
  });
  if (res.stop_reason === "refusal") return fallbackSummary(outcomes);
  return res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim() || fallbackSummary(outcomes);
}
