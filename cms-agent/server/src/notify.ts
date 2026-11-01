import nodemailer from "nodemailer";

const DEFAULT_TZ = "Africa/Johannesburg";

/** Minutes past midnight, wall-clock, in tz. Standalone so this module stays light. */
function minuteOfDay(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", hour: "numeric", minute: "numeric" }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

/**
 * The notifier: when an agent finishes, tell Jacques wherever he is.
 *
 * Without this, a 07:00 agent reports into a console nobody has open. Any mix
 * of channels can be on at once (NOTIFY_CHANNELS=ntfy,webhook,email):
 *
 *   ntfy     Push to the ntfy app on the phone (ntfy.sh or a self-hosted server).
 *            NTFY_TOPIC, optional NTFY_SERVER and NTFY_TOKEN. The same app the
 *            Trade Desk already uses, so nothing new to install.
 *   webhook  POST JSON to NOTIFY_WEBHOOK_URL. A Zapier "Catch Hook" on the other
 *            end can turn it into WhatsApp, SMS, Slack or anything Zapier reaches.
 *   email    Through SMTP_URL (shared with the ticket bridge) to NOTIFY_EMAIL_TO.
 *
 * NOTIFY_ON=problems sends only partial and failed runs. NOTIFY_QUIET=21:30-06:00
 * makes good news silent overnight; problems still make a sound.
 *
 * A channel that fails never takes the others down, and nothing here can fail
 * an agent run: every error is caught and returned.
 */

export type NotifyChannel = "ntfy" | "webhook" | "email";
export type NotifyStatus = "succeeded" | "partial" | "failed" | "info";

export interface Notice {
  title: string;
  message: string;
  status: NotifyStatus;
  /** Where tapping the notification should go. */
  link?: string;
  /** Extra fields passed through to the webhook. */
  meta?: Record<string, unknown>;
}

export interface ChannelResult { channel: NotifyChannel; ok: boolean; error?: string }
export interface NotifyResult { sent: boolean; skipped?: string; results: ChannelResult[] }

export function channels(env = process.env): NotifyChannel[] {
  return (env.NOTIFY_CHANNELS ?? "")
    .split(/[,\s]+/)
    .map((c) => c.trim().toLowerCase())
    .filter((c): c is NotifyChannel => c === "ntfy" || c === "webhook" || c === "email");
}

/** Is this instant inside the quiet window, e.g. "21:30-06:00" (wraps midnight)? */
export function inQuietHours(spec: string | undefined, at: Date, tz = DEFAULT_TZ): boolean {
  const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec((spec ?? "").trim());
  if (!m) return false;
  const start = +m[1] * 60 + +m[2];
  const end = +m[3] * 60 + +m[4];
  const t = minuteOfDay(at, tz);
  return start <= end ? t >= start && t < end : t >= start || t < end;
}

const TAGS: Record<NotifyStatus, string[]> = {
  succeeded: ["white_check_mark"],
  partial: ["warning"],
  failed: ["rotating_light"],
  info: ["information_source"],
};

/** ntfy priority: 1 min … 5 max. Problems are loud; good news is quiet at night. */
export function priorityFor(status: NotifyStatus, quiet: boolean): number {
  if (status === "failed") return 5;
  if (status === "partial") return 4;
  return quiet ? 2 : 3;
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}, timeoutMs = 10_000): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 120)}`.trim());
}

export async function notify(n: Notice, opts: { env?: NodeJS.ProcessEnv; now?: Date } = {}): Promise<NotifyResult> {
  const env = opts.env ?? process.env;
  const list = channels(env);
  if (!list.length) return { sent: false, skipped: "NOTIFY_CHANNELS is not set", results: [] };
  if ((env.NOTIFY_ON ?? "all").toLowerCase() === "problems" && (n.status === "succeeded" || n.status === "info")) {
    return { sent: false, skipped: "NOTIFY_ON=problems and this run succeeded", results: [] };
  }
  const quiet = inQuietHours(env.NOTIFY_QUIET, opts.now ?? new Date());

  const send = async (ch: NotifyChannel): Promise<ChannelResult> => {
    try {
      if (ch === "ntfy") {
        const topic = env.NTFY_TOPIC;
        if (!topic) throw new Error("NTFY_TOPIC is not set");
        const server = (env.NTFY_SERVER || "https://ntfy.sh").replace(/\/$/, "");
        // JSON publishing to the server root keeps emoji and accents intact,
        // which plain ntfy headers would mangle.
        await postJson(server, {
          topic, title: n.title, message: n.message.slice(0, 3800),
          tags: TAGS[n.status], priority: priorityFor(n.status, quiet),
          ...(n.link ? { click: n.link } : {}),
        }, env.NTFY_TOKEN ? { Authorization: `Bearer ${env.NTFY_TOKEN}` } : {});
      } else if (ch === "webhook") {
        const url = env.NOTIFY_WEBHOOK_URL;
        if (!url) throw new Error("NOTIFY_WEBHOOK_URL is not set");
        await postJson(url, { source: "foreman", title: n.title, message: n.message, status: n.status, link: n.link, quiet, at: (opts.now ?? new Date()).toISOString(), ...n.meta });
      } else {
        const { SMTP_URL, NOTIFY_EMAIL_TO, NOTIFY_EMAIL_FROM, TICKET_EMAIL_FROM } = env;
        if (!SMTP_URL || !NOTIFY_EMAIL_TO) throw new Error("SMTP_URL and NOTIFY_EMAIL_TO are required");
        await nodemailer.createTransport(SMTP_URL).sendMail({
          from: NOTIFY_EMAIL_FROM || TICKET_EMAIL_FROM || NOTIFY_EMAIL_TO,
          to: NOTIFY_EMAIL_TO,
          subject: `[Foreman] ${n.title}`,
          text: n.message + (n.link ? `\n\n${n.link}` : ""),
        });
      }
      return { channel: ch, ok: true };
    } catch (err) {
      return { channel: ch, ok: false, error: (err as Error).message };
    }
  };

  const results = await Promise.all(list.map(send));
  return { sent: results.some((r) => r.ok), results };
}

/** Shape an agent report into a notice. */
export function agentNotice(r: { agentId: string; name: string; status: string; summary?: string; runId?: string }, env = process.env): Notice {
  const status: NotifyStatus = r.status === "succeeded" || r.status === "partial" || r.status === "failed" ? r.status : "info";
  const word = { succeeded: "done", partial: "partly done", failed: "failed", info: "update" }[status];
  const base = (env.PUBLIC_URL || "").replace(/\/$/, "");
  return {
    title: `${r.name}: ${word}`,
    message: (r.summary || "No report was written.").trim(),
    status,
    link: base ? `${base}/board.html` : undefined,
    meta: { agentId: r.agentId, agentName: r.name, runId: r.runId },
  };
}

/** Wire the notifier to the agent event stream. Call once at start-up. */
export function startNotifier(events: NodeJS.EventEmitter): void {
  events.on("report", (r: { agentId: string; name: string; status: string; summary?: string; runId?: string }) => {
    void notify(agentNotice(r)).then((res) => {
      for (const c of res.results.filter((x) => !x.ok)) console.warn(`notify via ${c.channel} failed: ${c.error}`);
    });
  });
}
