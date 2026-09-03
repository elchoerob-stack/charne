import { z } from "zod";

/**
 * Recording schema shared by the browser extension and the server.
 * Keep in sync with recorder-extension/content.js.
 */

export const Target = z.object({
  tag: z.string(),
  role: z.string().optional(),
  name: z.string().optional(),        // accessible name (aria-label / label / text)
  text: z.string().optional(),        // visible text, trimmed
  testId: z.string().optional(),      // data-testid / data-test / data-cy
  id: z.string().optional(),
  placeholder: z.string().optional(),
  selector: z.string(),               // best-effort unique CSS selector
  inputType: z.string().optional(),
  sensitive: z.boolean().optional(),  // value was masked by the recorder
});

export const RecordingEvent = z.object({
  t: z.number(),                                   // ms since recording start
  type: z.enum(["click", "input", "change", "select", "submit", "keypress", "navigate", "scroll", "console", "network", "screenshot", "note", "online", "offline", "visibility"]),
  url: z.string().optional(),
  title: z.string().optional(),
  target: Target.optional(),
  value: z.string().optional(),                    // input/select value (masked if sensitive)
  key: z.string().optional(),
  level: z.enum(["error", "warn", "log"]).optional(),
  message: z.string().optional(),
  request: z.object({ method: z.string(), url: z.string(), status: z.number(), durationMs: z.number().optional(), ok: z.boolean().optional() }).optional(),
  screenshotId: z.string().optional(),
  scrollY: z.number().optional(),
  visible: z.boolean().optional(),
});

export const Recording = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  app: z.string().default("cms"),
  dealer: z.string().optional(),
  recordedBy: z.string().optional(),
  purpose: z.enum(["sop", "problem"]).default("sop"),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  startUrl: z.string().optional(),
  userAgent: z.string().optional(),
  viewport: z.object({ w: z.number(), h: z.number() }).optional(),
  events: z.array(RecordingEvent),
  screenshots: z.record(z.string()).optional(),   // screenshotId → data URL (jpeg)
  notes: z.string().optional(),
});

export type Target = z.infer<typeof Target>;
export type RecordingEvent = z.infer<typeof RecordingEvent>;
export type Recording = z.infer<typeof Recording>;
