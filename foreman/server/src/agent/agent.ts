import Anthropic from "@anthropic-ai/sdk";
import { config, type AgentMode } from "../config.js";
import { db, now } from "../db.js";
import { COUNCIL_SPECIALISTS, SYSTEM_PROMPT, dynamicContext } from "./prompts.js";
import { TOOLS, TOOL_MAP, summariseResult, type ToolContext } from "./tools.js";
import type { HealthResult, SystemName } from "./integrations.js";

const client = new Anthropic();


type Emit = (event: Record<string, unknown>) => void;

export interface TurnInput {
  sessionId: string;
  dealer?: string;
  mode: AgentMode;
  text: string;
  /** Base64 images (screenshots) attached by the user. */
  images?: { mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; data: string }[];
}

/** Per-session integration health, kept in memory so later turns reuse it. */
const sessionHealth = new Map<string, Partial<Record<SystemName, HealthResult>>>();

const EFFORT: Record<AgentMode, "low" | "medium" | "high" | "xhigh"> = { quick: "low", think: "high", deep: "xhigh", council: "high" };

function loadHistory(sessionId: string): Anthropic.Beta.BetaMessageParam[] {
  const rows = db.prepare("SELECT role, content FROM messages WHERE session_id = ? ORDER BY id").all(sessionId) as { role: "user" | "assistant"; content: string }[];
  return rows.map((r) => ({ role: r.role, content: JSON.parse(r.content) }));
}

function saveMessage(sessionId: string, role: "user" | "assistant", content: unknown) {
  db.prepare("INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)").run(sessionId, role, JSON.stringify(content), now());
  db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now(), sessionId);
}

function toolDefinitions(mode: AgentMode): Anthropic.Beta.BetaToolUnion[] {
  const defs: Anthropic.Beta.BetaToolUnion[] = TOOLS.map((t) => t.definition);
  if (mode !== "quick") defs.push({ type: "code_execution_20260120", name: "code_execution" });
  if (config.webSearch && (mode === "deep" || mode === "council")) {
    defs.push({ type: "web_search_20260209", name: "web_search", max_uses: mode === "deep" ? 8 : 3, user_location: { type: "approximate", country: "ZA", timezone: "Africa/Johannesburg" } });
  }
  return defs;
}

/** Grok-Heavy-style council: parallel specialist briefs that the main turn cross-checks. */
async function councilBriefs(text: string, emit: Emit): Promise<string> {
  const briefs = await Promise.all(
    COUNCIL_SPECIALISTS.map(async (s) => {
      try {
        const res = await client.beta.messages.create({
          model: config.model,
          max_tokens: 1024,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: "medium" },
          system: s.system,
          messages: [{ role: "user", content: text }],
        });
        const brief = res.stop_reason === "refusal" ? "(declined)" : res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n");
        emit({ type: "council", specialist: s.id, title: s.title, brief });
        return `### ${s.title}\n${brief}`;
      } catch (err) {
        const msg = err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : (err as Error).message;
        emit({ type: "council", specialist: s.id, title: s.title, brief: `(brief unavailable: ${msg})` });
        return `### ${s.title}\n(brief unavailable)`;
      }
    }),
  );
  return briefs.join("\n\n");
}

/**
 * Run one agent turn, streaming events through `emit`.
 * Events: text, thinking, tool_start, tool_result, council, health, diagnosis, case, evidence, done, error.
 */
export async function runTurn(input: TurnInput, emit: Emit): Promise<void> {
  const health = sessionHealth.get(input.sessionId) ?? {};
  sessionHealth.set(input.sessionId, health);
  const ctx: ToolContext = { sessionId: input.sessionId, dealer: input.dealer, health, emit };

  const history = loadHistory(input.sessionId);
  const userContent: Anthropic.Beta.BetaContentBlockParam[] = [
    ...(input.images ?? []).map((img): Anthropic.Beta.BetaImageBlockParam => ({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } })),
    { type: "text", text: input.text },
  ];
  saveMessage(input.sessionId, "user", userContent);
  const messages: Anthropic.Beta.BetaMessageParam[] = [...history, { role: "user", content: userContent }];

  // Dynamic context as a mid-conversation system message keeps the cached prefix intact.
  const dealerFacts = input.dealer ? (db.prepare("SELECT fact FROM memory WHERE scope IN (?, 'global') ORDER BY created_at DESC LIMIT 15").all(input.dealer) as { fact: string }[]).map((r) => r.fact) : [];
  const openCases = (db.prepare("SELECT id, title, status FROM cases WHERE (dealer = ? OR ? IS NULL) AND status != 'resolved' ORDER BY updated_at DESC LIMIT 5").all(input.dealer ?? null, input.dealer ?? null) as { id: string; title: string; status: string }[]);
  let dynamic = dynamicContext({ dealer: input.dealer, mode: input.mode, dealerFacts, openCases });

  if (input.mode === "council") {
    emit({ type: "status", text: "Convening council: three specialists are drafting briefs in parallel." });
    dynamic += `\n\nCouncil briefs for the latest message:\n\n${await councilBriefs(input.text, emit)}`;
  }

  const tools = toolDefinitions(input.mode);
  const maxIterations = config.maxIterations[input.mode];
  let iterations = 0;
  let totalIn = 0;
  let totalOut = 0;

  while (iterations < maxIterations) {
    iterations += 1;
    const stream = client.beta.messages.stream({
      model: config.model,
      max_tokens: 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: EFFORT[input.mode] },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools,
      messages: [...messages, { role: "system", content: dynamic }],
    });

    stream.on("text", (delta) => emit({ type: "text", delta }));
    stream.on("thinking", (delta) => emit({ type: "thinking", delta }));

    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await stream.finalMessage();
    } catch (err) {
      const msg = err instanceof Anthropic.RateLimitError ? "Rate limited by the Claude API; try again in a moment."
        : err instanceof Anthropic.AuthenticationError ? "Claude API authentication failed; check ANTHROPIC_API_KEY."
        : err instanceof Anthropic.APIError ? `Claude API error ${err.status}: ${err.message}`
        : (err as Error).message;
      emit({ type: "error", message: msg });
      return;
    }

    totalIn += message.usage.input_tokens;
    totalOut += message.usage.output_tokens;
    messages.push({ role: "assistant", content: message.content });
    saveMessage(input.sessionId, "assistant", message.content);

    if (message.stop_reason === "refusal") {
      emit({ type: "error", message: `The model declined this request (${message.stop_details?.category ?? "policy"}).` });
      break;
    }
    if (message.stop_reason === "pause_turn") continue; // server tool loop paused; resend to resume
    if (message.stop_reason !== "tool_use") break;

    const uses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (uses.length === 0) break;

    const results = await Promise.all(
      uses.map(async (use): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        const t = TOOL_MAP.get(use.name);
        emit({ type: "tool_start", id: use.id, name: use.name, input: use.input });
        if (!t) return { type: "tool_result", tool_use_id: use.id, content: `Unknown tool ${use.name}`, is_error: true };
        try {
          const result = await t.run((use.input ?? {}) as Record<string, unknown>, ctx);
          emit({ type: "tool_result", id: use.id, name: use.name, summary: summariseResult(use.name, result) });
          return { type: "tool_result", tool_use_id: use.id, content: typeof result === "string" ? result : JSON.stringify(result) };
        } catch (err) {
          const msg = (err as Error).message;
          emit({ type: "tool_result", id: use.id, name: use.name, summary: `error: ${msg}`, error: true });
          return { type: "tool_result", tool_use_id: use.id, content: `Tool failed: ${msg}`, is_error: true };
        }
      }),
    );
    messages.push({ role: "user", content: results });
    saveMessage(input.sessionId, "user", results);
  }

  if (iterations >= maxIterations) emit({ type: "status", text: `Stopped after ${maxIterations} tool iterations for this mode.` });

  const due = db.prepare("SELECT id, note, due_at, case_id FROM followups WHERE session_id = ? AND done = 0 AND due_at <= ?").all(input.sessionId, now()) as { id: string; note: string; due_at: string; case_id: string | null }[];
  for (const f of due) {
    emit({ type: "followup", id: f.id, note: f.note, caseId: f.case_id, dueAt: f.due_at });
    db.prepare("UPDATE followups SET done = 1 WHERE id = ?").run(f.id);
  }

  emit({ type: "done", sessionId: input.sessionId, usage: { input: totalIn, output: totalOut, iterations } });
}
