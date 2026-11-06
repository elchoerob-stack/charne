import { Router, type Response } from "express";
import { jiraConfig } from "./jira.js";
import { CATEGORIES } from "./classify.js";
import { auditFor, getJob, listJobs } from "./store.js";
import { SupportError, archive, complete, correct, createTicket, intake, previewTicket, redraft } from "./service.js";

export const supportRoutes = Router();

function fail(res: Response, err: unknown) {
  if (err instanceof SupportError) return res.status(err.status).json({ error: err.message });
  console.error("support:", (err as Error).message);
  return res.status(500).json({ error: (err as Error).message });
}

supportRoutes.get("/support/config", (_req, res) => {
  const c = jiraConfig();
  res.json({ jira: Boolean(c), project: c?.projectKey, issueType: c?.issueType, supportTag: c?.supportTag ?? null, groupTag: c?.groupTag ?? null, doneTransition: c?.doneTransition, categories: CATEGORIES });
});

supportRoutes.post("/support/intake", async (req, res) => {
  const { email, dealer, group } = req.body ?? {};
  if (typeof email !== "string") return res.status(400).json({ error: "email (the pasted text) is required" });
  try { res.status(201).json(await intake(email, { dealer: typeof dealer === "string" && dealer.trim() ? dealer.trim() : undefined, group: typeof group === "string" && group.trim() ? group.trim() : undefined })); }
  catch (err) { fail(res, err); }
});

supportRoutes.get("/support/jobs", (req, res) => res.json(listJobs({ archived: req.query.archived === "1" })));

supportRoutes.get("/support/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "No such job" });
  res.json({ job, audit: auditFor(job.id) });
});

supportRoutes.patch("/support/jobs/:id", (req, res) => {
  try { res.json(correct(req.params.id, req.body ?? {})); } catch (err) { fail(res, err); }
});

supportRoutes.get("/support/jobs/:id/ticket-preview", (req, res) => {
  try { res.json(previewTicket(req.params.id)); } catch (err) { fail(res, err); }
});

// The approval step: this is the only route that creates anything in Jira.
supportRoutes.post("/support/jobs/:id/ticket", async (req, res) => {
  try { res.json(await createTicket(req.params.id)); } catch (err) { fail(res, err); }
});

supportRoutes.post("/support/jobs/:id/reply", async (req, res) => {
  try { res.json(await redraft(req.params.id, typeof req.body?.instruction === "string" ? req.body.instruction : undefined)); } catch (err) { fail(res, err); }
});

supportRoutes.post("/support/jobs/:id/complete", async (req, res) => {
  try { res.json(await complete(req.params.id, { note: typeof req.body?.note === "string" ? req.body.note : undefined })); } catch (err) { fail(res, err); }
});

supportRoutes.post("/support/jobs/:id/archive", (req, res) => {
  try { res.json(archive(req.params.id, req.body?.archived !== false)); } catch (err) { fail(res, err); }
});
