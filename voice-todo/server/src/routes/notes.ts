import { Router } from "express";
import type { Intent } from "../db.js";
import { createEmailDraft } from "../services/gmail.js";
import { createCalendarEvent } from "../services/googleCalendar.js";
import { classifyNote } from "../services/claude.js";
import {
  createNote,
  deleteNote,
  getNote,
  listNotes,
  setStatus,
  updateClassification,
} from "../notesRepo.js";

export const notesRouter = Router();

function parseExtracted(raw: string | null): Record<string, unknown> {
  return raw ? JSON.parse(raw) : {};
}

notesRouter.get("/", (_req, res) => {
  const notes = listNotes().map((n) => ({ ...n, extracted: parseExtracted(n.extracted) }));
  res.json(notes);
});

notesRouter.post("/", (req, res) => {
  const { transcript } = req.body as { transcript?: string };
  if (!transcript || !transcript.trim()) {
    return res.status(400).json({ error: "transcript is required" });
  }
  const note = createNote(transcript.trim());
  res.status(201).json(note);
});

notesRouter.post("/:id/process", async (req, res) => {
  const note = getNote(req.params.id);
  if (!note) return res.status(404).json({ error: "not found" });

  try {
    const classified = await classifyNote(note.transcript);
    updateClassification(note.id, classified);
    const updated = getNote(note.id)!;
    res.json({ ...updated, extracted: parseExtracted(updated.extracted) });
  } catch (err) {
    console.error("classify failed", err);
    res.status(502).json({ error: "classification failed" });
  }
});

// User-edited fields before confirming (e.g. fixing a mis-transcribed name/time).
notesRouter.patch("/:id", (req, res) => {
  const note = getNote(req.params.id);
  if (!note) return res.status(404).json({ error: "not found" });

  const { title, intent, extracted } = req.body as {
    title?: string;
    intent?: Intent;
    extracted?: Record<string, unknown>;
  };
  updateClassification(note.id, {
    title: title ?? note.title ?? note.transcript.slice(0, 60),
    intent: intent ?? note.intent,
    extracted: extracted ?? parseExtracted(note.extracted),
  });
  const updated = getNote(note.id)!;
  res.json({ ...updated, extracted: parseExtracted(updated.extracted) });
});

// Executes the prepared action: books the calendar event or creates the Gmail
// draft. Plain todos have nothing to execute — call /complete for those instead.
notesRouter.post("/:id/confirm", async (req, res) => {
  const note = getNote(req.params.id);
  if (!note) return res.status(404).json({ error: "not found" });

  const extracted = parseExtracted(note.extracted);
  try {
    if (note.intent === "calendar_event") {
      const link = await createCalendarEvent(extracted as any);
      setStatus(note.id, "confirmed");
      return res.json({ ok: true, link });
    }
    if (note.intent === "email_draft") {
      const draftId = await createEmailDraft(extracted as any);
      setStatus(note.id, "confirmed");
      return res.json({ ok: true, draftId });
    }
    return res.status(400).json({ error: "plain todos have no action to confirm" });
  } catch (err) {
    console.error("confirm failed", err);
    res.status(502).json({ error: "action failed", detail: (err as Error).message });
  }
});

notesRouter.post("/:id/complete", (req, res) => {
  const note = getNote(req.params.id);
  if (!note) return res.status(404).json({ error: "not found" });
  setStatus(note.id, "done");
  res.json(getNote(note.id));
});

notesRouter.delete("/:id", (req, res) => {
  deleteNote(req.params.id);
  res.status(204).end();
});
