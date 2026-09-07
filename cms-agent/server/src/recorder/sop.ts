import type { Recording, RecordingEvent, Target } from "./schema.js";
import type { Evidence } from "../problem-solving/types.js";

/* ── Step model ────────────────────────────────────────────────────────── */

export interface SopStep {
  n: number;
  t: number;
  action: "navigate" | "click" | "type" | "select" | "press" | "submit" | "note";
  text: string;               // human sentence
  url?: string;
  screen?: string;            // page title / section
  target?: Target;
  value?: string;
  screenshotId?: string;
  anomalies?: string[];       // errors / failed requests that happened right after this step
}

export interface Sop {
  title: string;
  purpose: "sop" | "problem";
  dealer?: string;
  recordedBy?: string;
  startedAt: string;
  durationMs: number;
  sections: { screen: string; url?: string; steps: SopStep[] }[];
  steps: SopStep[];
  anomalies: { t: number; kind: "console" | "network" | "offline"; text: string; afterStep?: number }[];
  stats: { events: number; steps: number; screens: number; errors: number; failedRequests: number };
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

const clean = (s?: string) => (s ?? "").replace(/\s+/g, " ").trim();

export function describeTarget(t?: Target): string {
  if (!t) return "the element";
  const label = clean(t.name) || clean(t.text) || clean(t.placeholder) || t.testId || t.id;
  const kind = (() => {
    const tag = t.tag.toLowerCase();
    const role = t.role?.toLowerCase();
    if (role === "button" || tag === "button" || (tag === "input" && ["submit", "button"].includes(t.inputType ?? ""))) return "button";
    if (role === "link" || tag === "a") return "link";
    if (role === "tab") return "tab";
    if (role === "menuitem") return "menu item";
    if (role === "checkbox" || t.inputType === "checkbox") return "checkbox";
    if (role === "radio" || t.inputType === "radio") return "option";
    if (tag === "select" || role === "combobox" || role === "listbox") return "dropdown";
    if (tag === "input" || tag === "textarea" || role === "textbox") return "field";
    if (role === "row" || tag === "tr" || tag === "td") return "row";
    return tag;
  })();
  return label ? `the **${label}** ${kind}` : `a ${kind}`;
}

function pathLabel(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean);
    return seg.length ? seg.map((s) => s.replace(/[-_]/g, " ")).join(" › ") : u.host;
  } catch {
    return url;
  }
}

/* ── Compilation ───────────────────────────────────────────────────────── */

/**
 * Turn a raw event stream into an SOP:
 *  - drops scroll/visibility noise
 *  - collapses successive input events on the same field into one "type" step
 *  - drops the click that merely focused a field which was then typed into
 *  - attaches console errors / failed requests to the step they followed
 *  - splits the steps into sections per screen
 */
export function compileSop(rec: Recording): Sop {
  const events = [...rec.events].sort((a, b) => a.t - b.t);
  const steps: SopStep[] = [];
  const anomalies: Sop["anomalies"] = [];
  let lastUrl: string | undefined = rec.startUrl;
  let lastTitle: string | undefined;
  let lastScreenshot: string | undefined;

  const push = (s: Omit<SopStep, "n">) => {
    steps.push({ n: steps.length + 1, ...s });
  };

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.url) lastUrl = e.url;
    if (e.title) lastTitle = e.title;
    if (e.type === "screenshot") { lastScreenshot = e.screenshotId; continue; }
    if (e.type === "scroll" || e.type === "visibility" || e.type === "online") continue;

    if (e.type === "offline") { anomalies.push({ t: e.t, kind: "offline", text: "Browser went offline", afterStep: steps.length || undefined }); continue; }
    if (e.type === "console") {
      if (e.level === "error") anomalies.push({ t: e.t, kind: "console", text: clean(e.message).slice(0, 300), afterStep: steps.length || undefined });
      continue;
    }
    if (e.type === "network") {
      const r = e.request!;
      const bad = r.ok === false || r.status === 0 || r.status >= 400;
      if (bad) anomalies.push({ t: e.t, kind: "network", text: `${r.method} ${r.url} → ${r.status}${r.durationMs ? ` (${r.durationMs} ms)` : ""}`, afterStep: steps.length || undefined });
      continue;
    }

    if (e.type === "navigate") {
      const prev = steps[steps.length - 1];
      // Skip navigation caused by the click we just recorded (same URL as the click's page changing) if identical.
      if (prev?.action === "navigate" && prev.url === e.url) continue;
      push({ t: e.t, action: "navigate", text: `Go to **${e.title ? clean(e.title) : pathLabel(e.url) ?? "the page"}**`, url: e.url, screen: e.title, screenshotId: lastScreenshot });
      continue;
    }

    if (e.type === "input" || e.type === "change") {
      // Collapse repeated inputs on the same selector: keep the final value.
      const next = events[i + 1];
      if (next && (next.type === "input" || next.type === "change") && next.target?.selector === e.target?.selector) continue;
      const prev = steps[steps.length - 1];
      if (prev?.action === "click" && prev.target?.selector === e.target?.selector) steps.pop(); // the focus click
      const isSelect = e.target?.tag?.toLowerCase() === "select" || e.target?.role === "combobox";
      const shown = e.target?.sensitive ? "•••• (masked)" : clean(e.value);
      push({
        t: e.t,
        action: isSelect ? "select" : "type",
        text: isSelect ? `Select **${shown}** in ${describeTarget(e.target)}` : `Enter **${shown}** in ${describeTarget(e.target)}`,
        url: lastUrl, screen: lastTitle, target: e.target, value: e.value, screenshotId: lastScreenshot,
      });
      continue;
    }

    if (e.type === "select") {
      push({ t: e.t, action: "select", text: `Select **${clean(e.value)}** in ${describeTarget(e.target)}`, url: lastUrl, screen: lastTitle, target: e.target, value: e.value, screenshotId: lastScreenshot });
      continue;
    }

    if (e.type === "click") {
      // Ignore clicks on inert containers that carry no label at all.
      if (!e.target || (!e.target.name && !e.target.text && !e.target.testId && !e.target.id && !e.target.placeholder && !["button", "a", "input", "select"].includes(e.target.tag.toLowerCase()))) continue;
      const prev = steps[steps.length - 1];
      if (prev?.action === "click" && prev.target?.selector === e.target.selector && e.t - prev.t < 700) continue; // double click
      push({ t: e.t, action: "click", text: `Click ${describeTarget(e.target)}`, url: lastUrl, screen: lastTitle, target: e.target, screenshotId: lastScreenshot });
      continue;
    }

    if (e.type === "keypress") {
      if (!e.key || !["Enter", "Tab", "Escape"].includes(e.key)) continue;
      push({ t: e.t, action: "press", text: `Press **${e.key}**`, url: lastUrl, screen: lastTitle, target: e.target, value: e.key, screenshotId: lastScreenshot });
      continue;
    }

    if (e.type === "submit") {
      const prev = steps[steps.length - 1];
      if (prev && (prev.action === "click" || prev.action === "press") && e.t - prev.t < 500) continue; // already captured
      push({ t: e.t, action: "submit", text: `Submit ${describeTarget(e.target) === "the element" ? "the form" : describeTarget(e.target)}`, url: lastUrl, screen: lastTitle, target: e.target, screenshotId: lastScreenshot });
      continue;
    }

    if (e.type === "note") {
      push({ t: e.t, action: "note", text: `Note: ${clean(e.message)}`, url: lastUrl, screen: lastTitle, screenshotId: lastScreenshot });
    }
  }

  // Attach anomalies to the step they followed.
  for (const a of anomalies) {
    if (!a.afterStep) continue;
    const step = steps[a.afterStep - 1];
    (step.anomalies ??= []).push(a.text);
  }

  // Sections per screen.
  const sections: Sop["sections"] = [];
  for (const s of steps) {
    const screen = clean(s.screen) || pathLabel(s.url) || "Start";
    const last = sections[sections.length - 1];
    if (last && last.screen === screen) last.steps.push(s);
    else sections.push({ screen, url: s.url, steps: [s] });
  }

  const end = rec.endedAt ? new Date(rec.endedAt).getTime() : NaN;
  const start = new Date(rec.startedAt).getTime();
  const durationMs = Number.isFinite(end) ? end - start : (events.at(-1)?.t ?? 0);

  return {
    title: rec.title, purpose: rec.purpose, dealer: rec.dealer, recordedBy: rec.recordedBy, startedAt: rec.startedAt, durationMs,
    sections, steps, anomalies,
    stats: {
      events: events.length, steps: steps.length, screens: sections.length,
      errors: anomalies.filter((a) => a.kind === "console").length,
      failedRequests: anomalies.filter((a) => a.kind === "network").length,
    },
  };
}

/* ── Renderers ─────────────────────────────────────────────────────────── */

export function renderSopMarkdown(sop: Sop, opts: { screenshots?: boolean } = {}): string {
  const lines: string[] = [];
  lines.push(`# ${sop.title}`);
  lines.push("");
  const meta = [
    sop.dealer ? `**Dealer:** ${sop.dealer}` : null,
    sop.recordedBy ? `**Recorded by:** ${sop.recordedBy}` : null,
    `**Recorded:** ${new Date(sop.startedAt).toLocaleString("en-ZA")}`,
    `**Duration:** ${Math.round(sop.durationMs / 1000)} s`,
    `**Steps:** ${sop.stats.steps} across ${sop.stats.screens} screen(s)`,
  ].filter(Boolean);
  lines.push(meta.join(" · "));
  lines.push("");
  if (sop.purpose === "problem") {
    lines.push(`> Problem capture: ${sop.stats.errors} console error(s), ${sop.stats.failedRequests} failed request(s).`);
    lines.push("");
  }
  for (const sec of sop.sections) {
    lines.push(`## ${sec.screen}`);
    lines.push("");
    for (const s of sec.steps) {
      lines.push(`${s.n}. ${s.text}`);
      if (opts.screenshots && s.screenshotId) lines.push(`   ![step ${s.n}](screenshot:${s.screenshotId})`);
      for (const a of s.anomalies ?? []) lines.push(`   - ⚠ ${a}`);
    }
    lines.push("");
  }
  if (sop.anomalies.length) {
    lines.push("## Anomalies");
    lines.push("");
    for (const a of sop.anomalies) lines.push(`- [${(a.t / 1000).toFixed(1)} s] ${a.kind}: ${a.text}`);
    lines.push("");
  }
  return lines.join("\n");
}

/** Best Playwright locator for a target, preferring stable, user-facing attributes. */
export function playwrightLocator(t?: Target): string {
  if (!t) return "page.locator('body')";
  const q = (s: string) => JSON.stringify(s);
  if (t.testId) return `page.getByTestId(${q(t.testId)})`;
  const role = t.role || ({ button: "button", a: "link", select: "combobox", textarea: "textbox" } as Record<string, string>)[t.tag.toLowerCase()];
  if (role && t.name) return `page.getByRole(${q(role)}, { name: ${q(t.name)} })`;
  if (t.name && ["input", "select", "textarea"].includes(t.tag.toLowerCase())) return `page.getByLabel(${q(t.name)})`;
  if (t.placeholder) return `page.getByPlaceholder(${q(t.placeholder)})`;
  if (t.text && t.text.length <= 60) return `page.getByText(${q(t.text)}, { exact: true })`;
  if (t.id) return `page.locator(${q("#" + CSS_escape(t.id))})`;
  return `page.locator(${q(t.selector)})`;
}

function CSS_escape(s: string) {
  return s.replace(/([^a-zA-Z0-9_-])/g, "\\$1");
}

export function renderPlaywright(sop: Sop): string {
  const out: string[] = [];
  out.push(`// Generated from the CMS workflow recording "${sop.title}"`);
  out.push(`// Values marked as masked were removed by the recorder for POPIA compliance; fill them from test data.`);
  out.push(`import { test, expect } from "@playwright/test";`);
  out.push("");
  out.push(`test(${JSON.stringify(sop.title)}, async ({ page }) => {`);
  for (const s of sop.steps) {
    const loc = playwrightLocator(s.target);
    switch (s.action) {
      case "navigate": out.push(`  await page.goto(${JSON.stringify(s.url ?? "/")});`); break;
      case "click": out.push(`  await ${loc}.click();`); break;
      case "type": out.push(`  await ${loc}.fill(${JSON.stringify(s.target?.sensitive ? "<MASKED>" : s.value ?? "")});`); break;
      case "select": out.push(`  await ${loc}.selectOption({ label: ${JSON.stringify(s.value ?? "")} });`); break;
      case "press": out.push(`  await page.keyboard.press(${JSON.stringify(s.value ?? "Enter")});`); break;
      case "submit": out.push(`  await ${loc}.press("Enter");`); break;
      case "note": out.push(`  // ${s.text}`); break;
    }
  }
  out.push(`  await expect(page).toHaveURL(/./);`);
  out.push(`});`);
  return out.join("\n");
}

/** Evidence for the problem-solving engine, extracted from a recording. */
export function evidenceFromRecording(rec: Recording): Evidence {
  const events = rec.events;
  const consoleErrors = events.filter((e) => e.type === "console" && e.level === "error").map((e) => clean(e.message));
  const failedRequests = events
    .filter((e): e is RecordingEvent & { request: NonNullable<RecordingEvent["request"]> } => e.type === "network" && !!e.request)
    .filter((e) => e.request.ok === false || e.request.status === 0 || e.request.status >= 400)
    .map((e) => ({ method: e.request.method, url: e.request.url, status: e.request.status, durationMs: e.request.durationMs }));
  const durations = events.filter((e) => e.type === "network" && e.request?.durationMs).map((e) => e.request!.durationMs!).sort((a, b) => a - b);
  const latencyMs = durations.length ? durations[Math.floor(durations.length * 0.95)] : undefined;
  const lastUrl = [...events].reverse().find((e) => e.url)?.url ?? rec.startUrl;
  return {
    consoleErrors, failedRequests, lastUrl, health: {}, facts: rec.notes ? [rec.notes] : [],
    wentOffline: events.some((e) => e.type === "offline") ? true : events.some((e) => e.type === "network") ? false : undefined,
    latencyMs,
  };
}
