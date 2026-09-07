import { Router } from "express";
import { db, newId, now } from "../db.js";
import { Recording } from "./schema.js";
import { compileSop, evidenceFromRecording, renderPlaywright, renderSopMarkdown } from "./sop.js";
import { diagnose } from "../problem-solving/engine.js";
import { learnedPlaybooks, loadRecording } from "../agent/tools.js";

export const recorderRoutes = Router();

/** Upload a recording from the browser extension (or an exported JSON file). */
recorderRoutes.post("/recordings", (req, res) => {
  const parsed = Recording.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid recording", issues: parsed.error.issues.slice(0, 10) });
  const rec = parsed.data;
  const id = rec.id && /^rec_[A-Za-z0-9_-]+$/.test(rec.id) ? rec.id : newId("rec");
  const { screenshots, ...data } = rec;
  db.prepare(
    "INSERT OR REPLACE INTO recordings (id, title, dealer, purpose, recorded_by, started_at, ended_at, event_count, data, screenshots, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, rec.title, rec.dealer ?? null, rec.purpose, rec.recordedBy ?? null, rec.startedAt, rec.endedAt ?? null, rec.events.length, JSON.stringify({ ...data, id }), screenshots ? JSON.stringify(screenshots) : null, now());
  const sop = compileSop({ ...rec, id });
  res.status(201).json({ id, stats: sop.stats });
});

recorderRoutes.get("/recordings", (req, res) => {
  const rows = db.prepare("SELECT id, title, dealer, purpose, recorded_by, started_at, ended_at, event_count, created_at FROM recordings ORDER BY created_at DESC LIMIT 100").all();
  res.json(rows);
});

recorderRoutes.get("/recordings/:id", (req, res) => {
  const rec = loadRecording(req.params.id);
  if (!rec) return res.status(404).json({ error: "not found" });
  res.json(rec);
});

recorderRoutes.delete("/recordings/:id", (req, res) => {
  const r = db.prepare("DELETE FROM recordings WHERE id = ?").run(req.params.id);
  res.json({ deleted: r.changes });
});

recorderRoutes.get("/recordings/:id/screenshots/:sid", (req, res) => {
  const row = db.prepare("SELECT screenshots FROM recordings WHERE id = ?").get(req.params.id) as { screenshots: string | null } | undefined;
  const shots = row?.screenshots ? (JSON.parse(row.screenshots) as Record<string, string>) : {};
  const dataUrl = shots[req.params.sid];
  if (!dataUrl) return res.status(404).end();
  const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return res.status(415).end();
  res.type(m[1]).send(Buffer.from(m[2], "base64"));
});

recorderRoutes.get("/recordings/:id/sop", (req, res) => {
  const rec = loadRecording(req.params.id);
  if (!rec) return res.status(404).json({ error: "not found" });
  const sop = compileSop(rec);
  const format = String(req.query.format ?? "json");
  if (format === "md") return res.type("text/markdown").send(renderSopMarkdown(sop, { screenshots: true }));
  if (format === "playwright") return res.type("text/plain").send(renderPlaywright(sop));
  res.json(sop);
});

/** Direct diagnostic run for the console (no model involved). */
recorderRoutes.post("/diagnose", (req, res) => {
  const { symptom, recording_id, answers, facts } = req.body ?? {};
  if (!symptom || typeof symptom !== "string") return res.status(400).json({ error: "symptom required" });
  let evidence = {};
  if (recording_id) {
    const rec = loadRecording(String(recording_id));
    if (rec) evidence = evidenceFromRecording(rec);
  }
  const d = diagnose({ symptom, evidence: { ...evidence, facts: Array.isArray(facts) ? facts : [] }, answers: answers ?? {}, learned: learnedPlaybooks() });
  res.json(d);
});
