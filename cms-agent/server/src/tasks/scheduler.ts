import { newRun, saveTask } from "./store.js";
import { queue } from "./queue.js";
import { resolveInputs } from "./compile.js";
import type { Task, TaskSchedule } from "./types.js";
import { hasSavedSession } from "./runner.js";

/**
 * Time-based triggers for tasks.
 *
 * Everything is computed in the schedule's timezone using Intl, so a "daily at
 * 08:00" task fires at 08:00 in Centurion even if the laptop is set to UTC.
 * No dependency: the cron matcher below is small enough to own.
 */

export const DEFAULT_TZ = "Africa/Johannesburg";

/* ── Timezone helpers ──────────────────────────────────────────────────── */

interface Parts { year: number; month: number; day: number; hour: number; minute: number; weekday: number }

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Wall-clock parts of an instant in a timezone. */
export function partsIn(date: Date, tz: string): Parts {
  const get: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(date)) get[p.type] = p.value;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get.weekday);
  return { year: +get.year, month: +get.month, day: +get.day, hour: +get.hour, minute: +get.minute, weekday };
}

/** The instant at which the given wall-clock time occurs in tz. */
export function instantFor(tz: string, year: number, month: number, day: number, hour: number, minute: number): Date {
  // Guess in UTC, then correct by the offset the zone actually applies there.
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const p = partsIn(new Date(guess), tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return new Date(guess - (asUtc - guess));
}

/* ── Cron (5 fields: minute hour day-of-month month day-of-week) ───────── */

function fieldMatches(spec: string, value: number, min: number, max: number): boolean {
  return spec.split(",").some((part) => {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart ? Number(stepPart) : 1;
    let lo = min, hi = max;
    if (rangePart !== "*") {
      const [a, b] = rangePart.split("-").map(Number);
      lo = a; hi = b ?? a;
    }
    if (Number.isNaN(step) || Number.isNaN(lo) || Number.isNaN(hi)) return false;
    return value >= lo && value <= hi && (value - lo) % step === 0;
  });
}

export function cronMatches(cron: string, p: Parts): boolean {
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) return false;
  return fieldMatches(f[0], p.minute, 0, 59) && fieldMatches(f[1], p.hour, 0, 23) && fieldMatches(f[2], p.day, 1, 31) && fieldMatches(f[3], p.month, 1, 12) && fieldMatches(f[4], p.weekday, 0, 6);
}

export function validateCron(cron: string): string | undefined {
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) return "A cron expression has five fields: minute hour day month weekday";
  if (!/^[\d*,\-/]+$/.test(f.join(""))) return "Only digits, * , - and / are allowed";
  return undefined;
}

/* ── Next run ──────────────────────────────────────────────────────────── */

/** Compute the next time a schedule should fire, strictly after `after`. */
export function nextRun(s: TaskSchedule, after: Date = new Date()): Date | undefined {
  if (!s.enabled) return undefined;
  const tz = s.timezone || DEFAULT_TZ;

  if (s.kind === "interval") {
    const mins = Math.max(1, Math.floor(s.everyMinutes ?? 60));
    const base = s.lastRunAt ? new Date(s.lastRunAt) : after;
    const next = new Date(base.getTime() + mins * 60_000);
    return next > after ? next : new Date(after.getTime() + 60_000);
  }

  if (s.kind === "daily" || s.kind === "weekly") {
    const [hh, mm] = (s.atTime ?? "08:00").split(":").map(Number);
    const days = s.kind === "weekly" ? (s.weekdays?.length ? s.weekdays : [1, 2, 3, 4, 5]) : [0, 1, 2, 3, 4, 5, 6];
    const p = partsIn(after, tz);
    for (let offset = 0; offset <= 8; offset++) {
      // Walk forward a day at a time in the zone's own calendar.
      const probe = new Date(instantFor(tz, p.year, p.month, p.day, 12, 0).getTime() + offset * 86_400_000);
      const pp = partsIn(probe, tz);
      if (!days.includes(pp.weekday)) continue;
      const candidate = instantFor(tz, pp.year, pp.month, pp.day, hh, mm);
      if (candidate > after) return candidate;
    }
    return undefined;
  }

  if (s.kind === "cron" && s.cron && !validateCron(s.cron)) {
    // Scan minute by minute, up to a year; cron schedules are sparse but bounded.
    const start = new Date(Math.floor(after.getTime() / 60_000) * 60_000 + 60_000);
    for (let i = 0; i < 366 * 24 * 60; i++) {
      const t = new Date(start.getTime() + i * 60_000);
      if (cronMatches(s.cron, partsIn(t, tz))) return t;
    }
  }
  return undefined;
}

export function describeSchedule(s?: TaskSchedule): string {
  if (!s || !s.enabled) return "Not scheduled";
  const tz = s.timezone && s.timezone !== DEFAULT_TZ ? ` (${s.timezone})` : "";
  switch (s.kind) {
    case "interval": return `Every ${s.everyMinutes ?? 60} min`;
    case "daily": return `Daily at ${s.atTime ?? "08:00"}${tz}`;
    case "weekly": {
      const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const d = (s.weekdays?.length ? s.weekdays : [1, 2, 3, 4, 5]).map((x) => names[x]).join(" ");
      return `${d} at ${s.atTime ?? "08:00"}${tz}`;
    }
    case "cron": return `cron ${s.cron}${tz}`;
  }
}

/* ── The tick ──────────────────────────────────────────────────────────── */

export interface SchedulerDeps {
  listTasks: () => Task[];
  now?: () => Date;
  /** Injected so tests can observe without a browser. */
  fire?: (task: Task) => void;
}

/** Enqueue every task whose time has come. Returns the ones fired. */
export function tick(deps: SchedulerDeps): Task[] {
  const now = deps.now?.() ?? new Date();
  const fired: Task[] = [];
  for (const task of deps.listTasks()) {
    const s = task.schedule;
    if (!s?.enabled) continue;
    if (!s.nextRunAt) {
      const n = nextRun(s, now);
      if (n) { s.nextRunAt = n.toISOString(); saveTask(task); }
      continue;
    }
    if (new Date(s.nextRunAt) > now) continue;
    // Due. Fire, then move on to the next occurrence.
    s.lastRunAt = now.toISOString();
    const n = nextRun(s, now);
    s.nextRunAt = n?.toISOString();
    saveTask(task);
    (deps.fire ?? defaultFire)(task);
    fired.push(task);
  }
  return fired;
}

function defaultFire(task: Task): void {
  if (!hasSavedSession()) {
    // Nothing sensible to do without a login; the run would only stop at the
    // password box. Leave it for the next tick after someone reconnects.
    return;
  }
  queue.enqueue(newRun(task.id, task.steps.length, resolveInputs(task, task.schedule?.inputs ?? {})), { headless: true });
}

let timer: NodeJS.Timeout | undefined;
export function startScheduler(listTasks: () => Task[], everyMs = 30_000): void {
  if (timer) return;
  const run = () => { try { tick({ listTasks }); } catch (err) { console.error("scheduler tick failed:", (err as Error).message); } };
  timer = setInterval(run, everyMs);
  timer.unref?.();
  run();
}
export function stopScheduler(): void { if (timer) clearInterval(timer); timer = undefined; }
