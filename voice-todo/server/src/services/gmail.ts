import { google } from "googleapis";
import { getOAuthClient } from "./googleAuth.js";

export interface EmailDraftInput {
  to?: string;
  subject: string;
  body: string;
}

function encodeMessage(input: EmailDraftInput): string {
  const headers = [`Subject: ${input.subject}`];
  if (input.to) headers.push(`To: ${input.to}`);
  const raw = `${headers.join("\r\n")}\r\n\r\n${input.body}`;
  return Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Creates a Gmail draft only — never sends. Sending stays a deliberate,
 * separate action the user takes from within Gmail.
 */
export async function createEmailDraft(input: EmailDraftInput): Promise<string> {
  const gmail = google.gmail({ version: "v1", auth: getOAuthClient() });
  const { data } = await gmail.users.drafts.create({
    userId: "me",
    requestBody: { message: { raw: encodeMessage(input) } },
  });
  if (!data.id) {
    throw new Error("Gmail did not return a draft id");
  }
  return data.id;
}
