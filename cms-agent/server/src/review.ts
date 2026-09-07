import { Router } from "express";
import { db, now } from "./db.js";
import { PLAYBOOKS } from "./problem-solving/playbooks.js";
import { playbookFromCase } from "./problem-solving/engine.js";
import { readCustomPlaybooks, saveCustomPlaybooks, type CustomPlaybook } from "./problem-solving/custom.js";

/**
 * Weekly playbook review: learned playbooks from resolved cases can be
 * edited, promoted into the permanent custom list, or archived.
 */
export const reviewRoutes = Router();

interface LearnedRow { id: string; case_id: string; title: string; symptoms: string; resolution: string; domain: string; confirmations: number; created_at: string }

reviewRoutes.get("/review", (_req, res) => {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const learned = (db.prepare("SELECT * FROM learned_playbooks ORDER BY confirmations DESC, created_at DESC").all() as unknown as LearnedRow[]).map((r) => {
    const c = db.prepare("SELECT dealer, symptom, resolution, updated_at FROM cases WHERE id = ?").get(r.case_id) as { dealer: string | null; symptom: string; resolution: string | null; updated_at: string } | undefined;
    return { id: r.id, caseId: r.case_id, title: r.title, symptoms: JSON.parse(r.symptoms) as string[], resolution: JSON.parse(r.resolution) as string[], confirmations: r.confirmations, created: r.created_at, dealer: c?.dealer, caseSymptom: c?.symptom, caseResolution: c?.resolution, lastSeen: c?.updated_at };
  });
  const resolved = db.prepare("SELECT id, dealer, title, symptom, resolution, updated_at FROM cases WHERE status = 'resolved' AND updated_at >= ? ORDER BY updated_at DESC").all(since);
  const escalated = db.prepare("SELECT id, dealer, title, symptom, updated_at FROM cases WHERE status = 'escalated' ORDER BY updated_at DESC LIMIT 20").all();
  res.json({ learned, custom: readCustomPlaybooks(), seeded: PLAYBOOKS.map((p) => ({ id: p.id, title: p.title, domain: p.domain, prior: p.prior, checks: p.checks.length })), resolvedThisWeek: resolved, escalated, since });
});

/** Edit a learned playbook before promotion. */
reviewRoutes.patch("/review/learned/:id", (req, res) => {
  const { title, symptoms, resolution } = req.body ?? {};
  const row = db.prepare("SELECT * FROM learned_playbooks WHERE id = ?").get(req.params.id) as LearnedRow | undefined;
  if (!row) return res.status(404).json({ error: "not found" });
  db.prepare("UPDATE learned_playbooks SET title = COALESCE(?, title), symptoms = COALESCE(?, symptoms), resolution = COALESCE(?, resolution) WHERE id = ?")
    .run(typeof title === "string" ? title : null, Array.isArray(symptoms) ? JSON.stringify(symptoms) : null, Array.isArray(resolution) ? JSON.stringify(resolution) : null, row.id);
  res.json({ ok: true });
});

/** Promote a learned playbook into the permanent custom list. */
reviewRoutes.post("/review/learned/:id/promote", (req, res) => {
  const row = db.prepare("SELECT * FROM learned_playbooks WHERE id = ?").get(req.params.id) as LearnedRow | undefined;
  if (!row) return res.status(404).json({ error: "not found" });
  const { domain, prior, verify, escalateTo, checks, promotedBy } = req.body ?? {};
  const base = playbookFromCase({ id: row.case_id, title: row.title, symptom: (JSON.parse(row.symptoms) as string[]).join(" "), resolution: (JSON.parse(row.resolution) as string[]).join("\n") });
  const list = readCustomPlaybooks().filter((c) => c.promotedFrom !== row.id);
  const custom: CustomPlaybook = {
    id: `custom-${row.case_id}`, title: row.title, domain: (domain ?? "learned") as CustomPlaybook["domain"], symptoms: JSON.parse(row.symptoms), prior: typeof prior === "number" ? prior : Math.min(0.1, 0.04 + 0.02 * row.confirmations),
    checks: Array.isArray(checks) && checks.length ? checks : base.checks.map((c) => ({ id: c.id, question: c.question, lrPass: c.lrPass, lrFail: c.lrFail })),
    resolution: JSON.parse(row.resolution), verify: verify ?? base.verify, escalate: { to: escalateTo ?? "CMS support desk", include: base.escalate?.include ?? [] },
    promotedFrom: row.id, promotedAt: now(), promotedBy: promotedBy ?? "review",
  };
  list.push(custom);
  saveCustomPlaybooks(list);
  db.prepare("DELETE FROM learned_playbooks WHERE id = ?").run(row.id);
  res.json({ ok: true, playbook: custom });
});

reviewRoutes.delete("/review/learned/:id", (req, res) => {
  res.json({ deleted: db.prepare("DELETE FROM learned_playbooks WHERE id = ?").run(req.params.id).changes });
});

reviewRoutes.patch("/review/custom/:id", (req, res) => {
  const list = readCustomPlaybooks();
  const i = list.findIndex((c) => c.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: "not found" });
  const allowed = ["title", "symptoms", "prior", "domain", "resolution", "verify", "checks", "escalate"] as const;
  for (const k of allowed) if (req.body?.[k] !== undefined) (list[i] as unknown as Record<string, unknown>)[k] = req.body[k];
  saveCustomPlaybooks(list);
  res.json({ ok: true, playbook: list[i] });
});

reviewRoutes.delete("/review/custom/:id", (req, res) => {
  const list = readCustomPlaybooks();
  const next = list.filter((c) => c.id !== req.params.id);
  saveCustomPlaybooks(next);
  res.json({ deleted: list.length - next.length });
});
