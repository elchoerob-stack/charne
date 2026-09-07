import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.CMS_AGENT_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foreman-sched-")), "t.db");
const { cronMatches, nextRun, partsIn, instantFor, tick, validateCron, describeSchedule } = await import("../src/tasks/scheduler.js");
import type { Task } from "../src/tasks/types.js";

const TZ = "Africa/Johannesburg"; // UTC+2, no DST

test("wall-clock parts respect the timezone", () => {
  const p = partsIn(new Date("2026-09-04T06:30:00Z"), TZ);
  assert.equal(p.hour, 8, "06:30 UTC is 08:30 in Centurion");
  assert.equal(p.minute, 30);
  assert.equal(p.weekday, 5, "Friday");
});

test("instantFor inverts partsIn", () => {
  const d = instantFor(TZ, 2026, 9, 4, 8, 0);
  assert.equal(d.toISOString(), "2026-09-04T06:00:00.000Z");
});

test("daily at 08:00 fires tomorrow when today's has passed", () => {
  const after = new Date("2026-09-04T07:00:00Z"); // 09:00 SAST
  const n = nextRun({ enabled: true, kind: "daily", atTime: "08:00", timezone: TZ }, after)!;
  assert.equal(n.toISOString(), "2026-09-05T06:00:00.000Z");
});

test("daily at 08:00 fires today when it is still ahead", () => {
  const after = new Date("2026-09-04T03:00:00Z"); // 05:00 SAST
  const n = nextRun({ enabled: true, kind: "daily", atTime: "08:00", timezone: TZ }, after)!;
  assert.equal(n.toISOString(), "2026-09-04T06:00:00.000Z");
});

test("weekly skips to the next listed weekday", () => {
  const after = new Date("2026-09-04T10:00:00Z"); // Friday afternoon
  const n = nextRun({ enabled: true, kind: "weekly", atTime: "07:30", weekdays: [1], timezone: TZ }, after)!; // Mondays
  assert.equal(n.toISOString(), "2026-09-07T05:30:00.000Z");
});

test("interval counts from the last run", () => {
  const after = new Date("2026-09-04T10:00:00Z");
  const n = nextRun({ enabled: true, kind: "interval", everyMinutes: 45, lastRunAt: "2026-09-04T09:30:00Z" }, after)!;
  assert.equal(n.toISOString(), "2026-09-04T10:15:00.000Z");
});

test("cron matching handles lists, ranges and steps", () => {
  const p = { year: 2026, month: 9, day: 4, hour: 8, minute: 30, weekday: 5 };
  assert.equal(cronMatches("30 8 * * 1-5", p), true);
  assert.equal(cronMatches("*/15 * * * *", p), true);
  assert.equal(cronMatches("0 8 * * *", p), false);
  assert.equal(cronMatches("30 8 * * 0,6", p), false, "weekends only");
  assert.equal(validateCron("30 8 * *"), "A cron expression has five fields: minute hour day month weekday");
  assert.equal(validateCron("30 8 * * 1-5"), undefined);
});

test("cron next run lands on the right minute in the zone", () => {
  const after = new Date("2026-09-04T10:00:00Z");
  const n = nextRun({ enabled: true, kind: "cron", cron: "0 17 * * 5", timezone: TZ }, after)!; // Fridays 17:00 SAST
  assert.equal(n.toISOString(), "2026-09-04T15:00:00.000Z");
});

test("tick fires due tasks once and rolls the schedule forward", () => {
  const task = { id: "t1", title: "x", startUrl: "about:blank", steps: [], variables: [], selfHeal: false, createdAt: "", updatedAt: "", runCount: 0,
    schedule: { enabled: true, kind: "daily", atTime: "08:00", timezone: TZ, nextRunAt: "2026-09-04T06:00:00.000Z" } } as unknown as Task;
  const fired: string[] = [];
  const at = new Date("2026-09-04T06:00:30Z");
  const first = tick({ listTasks: () => [task], now: () => at, fire: (t) => fired.push(t.id) });
  assert.deepEqual(first.map((t) => t.id), ["t1"]);
  assert.equal(task.schedule!.nextRunAt, "2026-09-05T06:00:00.000Z", "moved to tomorrow");
  const second = tick({ listTasks: () => [task], now: () => at, fire: (t) => fired.push(t.id) });
  assert.equal(second.length, 0, "does not fire twice for the same slot");
  assert.deepEqual(fired, ["t1"]);
});

test("describeSchedule reads naturally", () => {
  assert.equal(describeSchedule({ enabled: true, kind: "weekly", atTime: "07:30", weekdays: [1, 3, 5] }), "Mon Wed Fri at 07:30");
  assert.equal(describeSchedule({ enabled: false, kind: "daily" }), "Not scheduled");
});
