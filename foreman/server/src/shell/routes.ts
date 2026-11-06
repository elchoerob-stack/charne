import { Router, type Response } from "express";
import { ShellError } from "./engine.js";
import { registry, shell } from "./index.js";
import { eventsFor, getJob, listJobs } from "./store.js";

export const shellRoutes = Router();

function fail(res: Response, err: unknown) {
  if (err instanceof ShellError) return res.status(err.status).json({ error: err.message });
  console.error("shell:", (err as Error).message);
  return res.status(500).json({ error: (err as Error).message });
}

/** What Foreman can do, built and planned. Never includes the run functions. */
shellRoutes.get("/shell/workers", (_req, res) => {
  const byWorker: Record<string, { id: string; title: string; description: string; risk: string; available: boolean; inputs: Record<string, unknown> }[]> = {};
  for (const c of registry.all()) (byWorker[c.worker] ??= []).push({ id: c.id, title: c.title, description: c.description, risk: c.risk, available: c.available, inputs: c.inputs });
  res.json(byWorker);
});

// Give the Shell an instruction. The CEO plans it; read-only steps start, changes wait for approval.
shellRoutes.post("/shell/jobs", async (req, res) => {
  const { text, runAt } = req.body ?? {};
  if (typeof text !== "string") return res.status(400).json({ error: "text is required" });
  try { res.status(201).json(await shell.submit(text, { runAt: typeof runAt === "string" && runAt ? runAt : undefined })); } catch (err) { fail(res, err); }
});

shellRoutes.get("/shell/jobs", (req, res) => res.json(listJobs({ archived: req.query.archived === "1" })));

shellRoutes.get("/shell/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "No such job" });
  res.json({ job, events: eventsFor(job.id) });
});

// The only way a step that changes something starts: a person approves it.
shellRoutes.post("/shell/jobs/:id/approve", (req, res) => {
  const refs = Array.isArray(req.body?.steps) ? req.body.steps.map(String) : undefined;
  try { res.json(shell.approve(req.params.id, refs)); } catch (err) { fail(res, err); }
});

shellRoutes.post("/shell/jobs/:id/cancel", (req, res) => { try { res.json(shell.cancel(req.params.id)); } catch (err) { fail(res, err); } });
shellRoutes.post("/shell/jobs/:id/steps/:ref/retry", (req, res) => { try { res.json(shell.retry(req.params.id, req.params.ref)); } catch (err) { fail(res, err); } });
shellRoutes.post("/shell/jobs/:id/archive", (req, res) => { try { res.json(shell.archive(req.params.id, req.body?.archived !== false)); } catch (err) { fail(res, err); } });
