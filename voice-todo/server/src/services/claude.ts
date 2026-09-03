import Anthropic from "@anthropic-ai/sdk";
import type { Intent } from "../db.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";

export interface ClassifiedNote {
  title: string;
  intent: Intent;
  extracted: Record<string, unknown>;
}

const CLASSIFY_TOOL: Anthropic.Tool = {
  name: "classify_note",
  description:
    "Record the structured interpretation of a dictated voice note so it can be turned into a task, a calendar event, or an email draft.",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Short (<10 word) human-readable title for the task/todo list row.",
      },
      intent: {
        type: "string",
        enum: ["todo", "calendar_event", "email_draft"],
        description:
          "'calendar_event' only if a specific time/date is mentioned (meeting, call, appointment). " +
          "'email_draft' only if the note explicitly says to email/message someone. Otherwise 'todo'.",
      },
      calendar_event: {
        type: "object",
        description: "Required when intent is calendar_event.",
        properties: {
          summary: { type: "string" },
          start: { type: "string", description: "ISO 8601 datetime, resolved from relative time using the provided 'now'." },
          end: { type: "string", description: "ISO 8601 datetime. Default to start + 30min if no duration was given." },
          location: { type: "string" },
          description: { type: "string" },
        },
        required: ["summary", "start", "end"],
      },
      email_draft: {
        type: "object",
        description: "Required when intent is email_draft.",
        properties: {
          to: { type: "string", description: "Recipient name or email if mentioned; empty string if unknown." },
          subject: { type: "string" },
          body: { type: "string" },
        },
        required: ["subject", "body"],
      },
    },
    required: ["title", "intent"],
  },
};

export async function classifyNote(transcript: string): Promise<ClassifiedNote> {
  const now = new Date();
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system:
      "You turn a rough, spoken-aloud voice note (often dictated while driving, with filler words and false " +
      "starts) into a structured task. Be conservative: only pick calendar_event or email_draft when the " +
      "note clearly asks for one; default to a plain todo otherwise. Strip filler words ('um', 'uh', 'like') " +
      `from the title. The current date/time is ${now.toISOString()} (use it to resolve relative dates like ` +
      "'tomorrow' or 'Friday').",
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: "tool", name: "classify_note" },
    messages: [{ role: "user", content: transcript }],
  });

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );
  if (!toolUse) {
    throw new Error("Claude did not return a classification");
  }

  const input = toolUse.input as {
    title: string;
    intent: Intent;
    calendar_event?: Record<string, unknown>;
    email_draft?: Record<string, unknown>;
  };

  const extracted =
    input.intent === "calendar_event"
      ? input.calendar_event ?? {}
      : input.intent === "email_draft"
        ? input.email_draft ?? {}
        : {};

  return { title: input.title, intent: input.intent, extracted };
}
