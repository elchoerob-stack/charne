import { google } from "googleapis";
import { getOAuthClient } from "./googleAuth.js";

export interface CalendarEventInput {
  summary: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
}

export async function createCalendarEvent(input: CalendarEventInput): Promise<string> {
  const calendar = google.calendar({ version: "v3", auth: getOAuthClient() });
  const { data } = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: input.summary,
      location: input.location,
      description: input.description,
      start: { dateTime: input.start },
      end: { dateTime: input.end },
    },
  });
  if (!data.id) {
    throw new Error("Google Calendar did not return an event id");
  }
  return data.htmlLink ?? data.id;
}
