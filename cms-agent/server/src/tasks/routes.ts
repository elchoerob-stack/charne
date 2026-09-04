import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { newId, now } from "../db.js";
import { loadRecording } from "../agent/tools.js";
import { compileTask, missingRequired, resolveInputs } from "./compile.js";
import { enqueueBatch, queue } from "./queue.js";
import { captureSession, hasSavedSession, runShotsDir } from "./runner.js";
import { deleteTask, getRun, getTask, listRuns, listTasks, newRun, saveTask } from "./store.js";

export const taskRoutes = Router();

/** Turn a recording into a repeatable task. */
taskRoutes.post("/tasks", (req, res) => {
  const { recording_id, title, parameterise, preserveTiming, selfHeal } = req.body ?? {};
  if (!recording_id) return res.status(400).json({ error: "recording_id required" });
  const rec = loadRecording(String(recording_id));
  if (!rec) return res.status(404).json({ error: `No recording ${recording_id}` });
  const task = compileTask(rec, { id: newId("task"), now: now() }, {
    parameterise: parameterise !== false,
    preserveTiming: preserveTiming !== false,
    selfHeal: selfHeal !== false,
  });
  if (title) task.title = String(title);
  if (!task.startUrl) return res.status(422).json({ error: "This recording has no starting URL, so there is nothing to replay. Re-record starting from the CMS screen where the job begins." });
  if (!task.steps.length) return res.status(422).json({ error: "This recording has no repeatable actions in it." });
  saveTask(task);
  res.status(201).json({ task });
});

taskRoutes.get("/tasks", (req, res) => {
  const dealer = typeof req.query.dealer === "string" && req.query.dealer ? req.query.dealer : undefined;
  res.json(listTasks(dealer).map((t) => ({
    id: t.id, title: t.title, dealer: t.dealer, steps: t.steps.length,
    variables: t.variables.map((v) => ({ name: v.name, label: v.label, example: v.example, sensitive: v.sensitive })),
    selfHeal: t.selfHeal, runCount: t.runCount, lastRunAt: t.lastRunAt, lastRunStatus: t.lastRunStatus, startUrl: t.startUrl,
  })));
});

taskRoutes.get("/tasks/:id", (req, res) => {
  const t = getTask(req.params.id);
  if (!t) return res.status(404).json({ error: "not found" });
  res.json(t);
});

taskRoutes.patch("/tasks/:id", (req, res) => {
  const t = getTask(req.params.id);
  if (!t) return res.status(404).json({ error: "not found" });
  const { title, selfHeal, steps, variables } = req.body ?? {};
  if (typeof title === "string") t.title = title;
  if (typeof selfHeal === "boolean") t.selfHeal = selfHeal;
  if (Array.isArray(steps)) t.steps = steps;
  if (Array.isArray(variables)) t.variables = variables;
  t.updatedAt = now();
  saveTask(t);
  res.json({ task: t });
});

taskRoutes.delete("/tasks/:id", (req, res) => res.json({ deleted: deleteTask(req.params.id) }));

/** Run a task once, or once per row when given a list. Returns immediately. */
taskRoutes.post("/tasks/:id/run", (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: "not found" });
  const { inputs, rows, headless, dryRun, slowMoMs } = req.body ?? {};
  const options = {
    headless: headless !== false,
    dryRun: Boolean(dryRun),
    slowMoMs: Number(slowMoMs ?? 0),
  };

  if (!options.dryRun && !hasSavedSession()) {
    return res.status(409).json({ error: "No saved CMS session. Click 'Connect CMS' first: a browser opens, you log in once, and only the session cookie is kept — never your password.", needsSession: true });
  }

  if (Array.isArray(rows) && rows.length) {
    const bad = rows.map((r, i) => ({ i, missing: missingRequired(task, r).map((v) => v.label) })).filter((x) => x.missing.length);
    if (bad.length) return res.status(422).json({ error: "Some rows are missing values the recorder masked for privacy.", rows: bad });
    const { batchId, runs } = enqueueBatch(task.id, rows as Record<string, string>[], task.steps.length, options);
    return res.status(202).json({ batchId, runs: runs.map((r) => r.id), queued: runs.length });
  }

  const supplied = (inputs ?? {}) as Record<string, string>;
  const missing = missingRequired(task, supplied);
  if (missing.length) return res.status(422).json({ error: "Values are needed for fields the recorder masked.", missing: missing.map((v) => ({ name: v.name, label: v.label })) });
  const run = queue.enqueue(newRun(task.id, task.steps.length, resolveInputs(task, supplied)), options);
  res.status(202).json({ runId: run.id, status: run.status });
});

taskRoutes.get("/runs", (req, res) => {
  const taskId = typeof req.query.task === "string" ? req.query.task : undefined;
  res.json(listRuns(taskId).map((r) => ({
    id: r.id, taskId: r.taskId, status: r.status, batchId: r.batchId, batchIndex: r.batchIndex,
    currentStep: r.currentStep, totalSteps: r.totalSteps, startedAt: r.startedAt, finishedAt: r.finishedAt,
    error: r.error, attention: r.attention, createdAt: r.createdAt,
  })));
});

taskRoutes.get("/runs/:id", (req, res) => {
  const r = getRun(req.params.id);
  if (!r) return res.status(404).json({ error: "not found" });
  res.json(r);
});

taskRoutes.post("/runs/:id/cancel", (req, res) => res.json({ cancelling: queue.cancel(req.params.id) }));

taskRoutes.get("/runs/:id/shot/:file", (req, res) => {
  const file = path.basename(req.params.file);
  if (!file.startsWith(`${req.params.id}_`)) return res.status(400).json({ error: "bad file" });
  const p = path.join(runShotsDir, file);
  if (!fs.existsSync(p)) return res.status(404).end();
  res.type("image/jpeg").send(fs.readFileSync(p));
});

/** Live feed of every run's progress, so the console can watch without polling. */
taskRoutes.get("/runs-stream", (req, res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send("status", queue.status());
  const onUpdate = (run: unknown) => send("update", run);
  const onLog = (payload: unknown) => send("log", payload);
  queue.on("update", onUpdate);
  queue.on("log", onLog);
  const ping = setInterval(() => res.write(": ping\n\n"), 15000);
  req.on("close", () => {
    clearInterval(ping);
    queue.off("update", onUpdate);
    queue.off("log", onLog);
    res.end();
  });
});

taskRoutes.get("/queue", (_req, res) => res.json({ ...queue.status(), hasSession: hasSavedSession() }));

/** One-time CMS login: opens a real browser, keeps only the cookies. */
taskRoutes.post("/cms-session", async (req, res) => {
  const url = String(req.body?.url ?? "").trim();
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: "A CMS URL is required, e.g. https://cms.example.co.za" });
  try {
    const result = await captureSession(url);
    res.json({ saved: result.saved, url: result.url, message: result.saved ? "Session saved. Tasks can now run on their own." : "No session was captured; try again and complete the login before closing the browser." });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

taskRoutes.get("/cms-session", (_req, res) => res.json({ hasSession: hasSavedSession() }));
