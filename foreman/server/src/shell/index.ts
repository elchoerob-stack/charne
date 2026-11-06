import { notify } from "../notify.js";
import { Shell } from "./engine.js";
import { Registry } from "./registry.js";
import { supportCapabilities } from "./workers/support.js";
import { plannedCapabilities } from "./workers/planned.js";
import { cmsUserCapability } from "./workers/cms.js";
import type { JobView } from "./types.js";

/** Every worker Foreman has, built or planned. New workers are added here. */
export const registry = new Registry().register(...supportCapabilities, cmsUserCapability, ...plannedCapabilities);

export const shell = new Shell({ registry, concurrency: Number(process.env.SHELL_CONCURRENCY ?? 3) });

const link = (id: string) => `${(process.env.PUBLIC_URL || "").replace(/\/$/, "")}/shell.html#${id}`;

/**
 * Tell the phone when a job needs a decision or has finished: the point is to
 * stop watching the screen. A failure never blocks or fails the job itself.
 */
shell.on("status", (job: JobView, prev: string) => {
  const title = (s: string) => `${s}: ${job.summary}`.slice(0, 100);
  const base = process.env.PUBLIC_URL ? link(job.id) : undefined;
  let n: Parameters<typeof notify>[0] | undefined;
  if (job.status === "awaiting_approval" && prev !== "awaiting_approval") n = { title: title("Needs your OK"), message: job.steps.filter((s) => s.status === "awaiting_approval").map((s) => `• ${s.title}`).join("\n"), status: "info", link: base };
  else if (job.status === "done") n = { title: title("Done"), message: job.steps.map((s) => `✓ ${s.title}`).join("\n"), status: "succeeded", link: base };
  else if (job.status === "failed") n = { title: title("Needs attention"), message: job.steps.filter((s) => s.error).map((s) => `✗ ${s.title}: ${s.error}`).join("\n").slice(0, 600) || "A step failed.", status: "failed", link: base };
  if (n) notify(n).catch((err) => console.error("shell notify failed:", (err as Error).message));
});

/** Start-up: mark whatever was mid-step, then watch the clock for scheduled jobs. */
export function startShell(): void {
  const stuck = shell.recover();
  if (stuck) console.log(`Shell: ${stuck} step(s) were running when Foreman stopped; marked failed, not re-run.`);
  shell.pump();
  setInterval(() => { try { shell.pump(); } catch (err) { console.error("shell tick failed:", (err as Error).message); } }, 5_000).unref();
}
