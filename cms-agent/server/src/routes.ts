import { Router } from "express";
import { db, getOrCreateSession } from "./db.js";
import { config, isAgentMode } from "./config.js";
import { runTurn } from "./agent/agent.js";
import { PLAYBOOKS } from "./problem-solving/engine.js";
import { learnedPlaybooks } from "./agent/tools.js";

export const apiRoutes = Router();

apiRoutes.get("/health", (_req, res) => {
  res.json({ ok: true, model: config.model, webSearch: config.webSearch, hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) });
});

/** Streaming chat turn (Server-Sent Events over a POST). */
apiRoutes.post("/chat", async (req, res) => {
  const { sessionId, dealer, mode, text, images } = req.body ?? {};
  if (!text || typeof text !== "string") return res.status(400).json({ error: "text required" });
  const agentMode = isAgentMode(mode) ? mode : "think";
  const session = getOrCreateSession(typeof sessionId === "string" ? sessionId : undefined, typeof dealer === "string" && dealer ? dealer : undefined);

  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  const emit = (event: Record<string, unknown>) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  emit({ type: "session", sessionId: session.id, mode: agentMode });
  const keepAlive = setInterval(() => res.write(": ping\n\n"), 15000);
  try {
    await runTurn({ sessionId: session.id, dealer: session.dealer ?? undefined, mode: agentMode, text, images: Array.isArray(images) ? images : undefined }, emit);
  } catch (err) {
    emit({ type: "error", message: (err as Error).message });
  } finally {
    clearInterval(keepAlive);
    res.end();
  }
});

apiRoutes.get("/sessions", (_req, res) => {
  res.json(db.prepare("SELECT id, dealer, title, created_at, updated_at FROM sessions ORDER BY updated_at DESC LIMIT 50").all());
});

apiRoutes.get("/sessions/:id/messages", (req, res) => {
  const rows = db.prepare("SELECT role, content, created_at FROM messages WHERE session_id = ? ORDER BY id").all(req.params.id) as { role: string; content: string; created_at: string }[];
  // Return only displayable text (drop tool plumbing and images) for the console.
  const out = rows.flatMap((r) => {
    const content = JSON.parse(r.content) as Array<{ type: string; text?: string }>;
    const text = content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    return text ? [{ role: r.role, text, at: r.created_at }] : [];
  });
  res.json(out);
});

apiRoutes.get("/cases", (req, res) => {
  const dealer = typeof req.query.dealer === "string" ? req.query.dealer : undefined;
  const rows = dealer
    ? db.prepare("SELECT * FROM cases WHERE dealer = ? ORDER BY updated_at DESC LIMIT 100").all(dealer)
    : db.prepare("SELECT * FROM cases ORDER BY updated_at DESC LIMIT 100").all();
  res.json(rows);
});

apiRoutes.get("/memory/:scope", (req, res) => {
  res.json(db.prepare("SELECT id, fact, created_at FROM memory WHERE scope = ? ORDER BY created_at DESC").all(req.params.scope));
});

apiRoutes.delete("/memory/:id", (req, res) => {
  res.json({ deleted: db.prepare("DELETE FROM memory WHERE id = ?").run(req.params.id).changes });
});

apiRoutes.get("/playbooks", (_req, res) => {
  const all = [...PLAYBOOKS, ...learnedPlaybooks()];
  res.json(all.map((p) => ({ id: p.id, title: p.title, domain: p.domain, prior: p.prior, checks: p.checks.length, symptoms: p.symptoms })));
});

apiRoutes.get("/followups", (_req, res) => {
  res.json(db.prepare("SELECT * FROM followups WHERE done = 0 ORDER BY due_at").all());
});
