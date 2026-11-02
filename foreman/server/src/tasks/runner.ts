import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import type { Target } from "../recorder/schema.js";
import { resolveInputs } from "./compile.js";
import { anySiteSaved, hostOf, mergedState, saveSite, type StorageState } from "./sites.js";
import { pruneIfEmpty, recordFile, runFolder, type SavedFile } from "./workspace.js";
import { DEFAULT_RUNNER_OPTIONS, type RunLogEntry, type RunnerOptions, type Task, type TaskRun, type TaskStep } from "./types.js";

/**
 * Runs a learned task in a browser of its own.
 *
 * Three ideas carry the design:
 *
 *  1. **It is not your browser.** Every run launches its own browser with its
 *     own input. Nothing here moves the operating system's pointer, so a run
 *     cannot interfere with whatever you are doing at the same time.
 *  2. **Never trust one selector.** A recorded CSS path breaks the moment a
 *     page re-renders, so each step carries several ways to find its element,
 *     tried most-durable first.
 *  3. **When the page has moved on, work it out.** If none of them match, the
 *     step is handed to Claude as an *intent* — "enter the registration",
 *     "open the job card" — with the page in front of it. It may take several
 *     actions to get there: dismiss a banner, open a menu, search for the
 *     record. That is the difference between a macro and something that copes.
 */

const dataDir = path.dirname(config.dbPath);
const shotsDir = path.join(dataDir, "run-shots");
fs.mkdirSync(shotsDir, { recursive: true });
export const runShotsDir = shotsDir;

/* ── Browser ──────────────────────────────────────────────────────────── */

type Chromium = typeof import("playwright")["chromium"];
let chromiumCache: Chromium | undefined;

export async function loadChromium(): Promise<Chromium> {
  if (chromiumCache) return chromiumCache;
  try {
    const pw = await import("playwright");
    chromiumCache = pw.chromium;
    return chromiumCache;
  } catch {
    throw new Error("Playwright is not installed. Run `npm install`, then `npm run browser` in the server folder.");
  }
}

/**
 * Which browser to drive. Most machines already have Chrome, so
 * BROWSER_CHANNEL=chrome avoids downloading a second one.
 */
export function browserLaunchOptions(): { executablePath?: string; channel?: string } {
  const explicit = process.env.BROWSER_PATH?.trim();
  if (explicit) return { executablePath: explicit };
  const channel = process.env.BROWSER_CHANNEL?.trim();
  if (channel && channel !== "chromium") return { channel };
  return {};
}

/* ── Finding things ───────────────────────────────────────────────────── */

export interface Strategy { how: string; run: (page: any) => any }

/** Ordered most-durable first: a test id survives a redesign, a CSS path barely survives a re-sort. */
export function strategiesFor(t: Target | undefined, healed?: string): Strategy[] {
  const out: Strategy[] = [];
  if (!t) return out;
  if (healed) out.push({ how: `learned:${healed}`, run: (p) => p.locator(healed) });
  if (t.testId) out.push({ how: `testId=${t.testId}`, run: (p) => p.getByTestId(t.testId!) });

  const roleFromTag: Record<string, string> = { button: "button", a: "link", select: "combobox", textarea: "textbox" };
  const role = t.role || roleFromTag[t.tag.toLowerCase()] || (t.tag.toLowerCase() === "input" ? inputRole(t) : undefined);
  if (role && t.name) out.push({ how: `role=${role} name=${t.name}`, run: (p) => p.getByRole(role, { name: t.name, exact: false }) });
  if (t.name) out.push({ how: `label=${t.name}`, run: (p) => p.getByLabel(t.name!, { exact: false }) });
  if (t.placeholder) out.push({ how: `placeholder=${t.placeholder}`, run: (p) => p.getByPlaceholder(t.placeholder!) });
  if (t.id) out.push({ how: `#${t.id}`, run: (p) => p.locator(`#${cssEscape(t.id!)}`) });
  if (t.text && t.text.length <= 60) out.push({ how: `text=${t.text}`, run: (p) => p.getByText(t.text!, { exact: false }) });
  if (t.selector) out.push({ how: `css=${t.selector}`, run: (p) => p.locator(t.selector) });
  return out;
}

function inputRole(t: Target): string | undefined {
  switch (t.inputType) {
    case "checkbox": return "checkbox";
    case "radio": return "radio";
    case "submit": case "button": return "button";
    default: return "textbox";
  }
}
const cssEscape = (s: string) => s.replace(/([^a-zA-Z0-9_-])/g, "\\$1");

async function resolve(page: any, step: TaskStep, timeoutMs: number): Promise<{ locator: any; how: string } | undefined> {
  const strategies = strategiesFor(step.target, step.healedSelector);
  const per = Math.max(1200, Math.floor(timeoutMs / Math.max(strategies.length, 1)));
  for (const s of strategies) {
    try {
      const loc = s.run(page).first();
      await loc.waitFor({ state: "visible", timeout: per });
      return { locator: loc, how: s.how };
    } catch { /* try the next way of finding it */ }
  }
  return undefined;
}

/* ── Seeing the page ──────────────────────────────────────────────────── */

interface Candidate { i: number; tag: string; role: string; name: string; text: string; testId: string; placeholder: string; value: string; selector: string }

/**
 * A compact inventory of everything a person could actually click or type into.
 *
 * Passed to the browser as a source string on purpose. Handing `page.evaluate`
 * a function means the *compiled* function is serialised, and the dev runner
 * (esbuild, via tsx) rewrites named inner functions to call a `__name` helper
 * that does not exist inside the page — so the snapshot throws there while
 * working fine in the built server. A string is immune to whatever the build
 * does to this file.
 */
const SNAPSHOT_JS = `(() => {
  const sel = "button, a[href], input, select, textarea, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=radio], [role=combobox], [role=textbox], [onclick]";
  const nodes = Array.prototype.slice.call(document.querySelectorAll(sel), 0, 140);
  const clean = function (s) { return (s || "").replace(/\\s+/g, " ").trim().slice(0, 80); };
  const cssPath = function (el) {
    const parts = [];
    let n = el;
    while (n && n.nodeType === 1 && parts.length < 5) {
      if (n.id) { parts.unshift("#" + n.id); break; }
      let p = n.tagName.toLowerCase();
      const parent = n.parentElement;
      if (parent) {
        const same = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === n.tagName; });
        if (same.length > 1) p += ":nth-of-type(" + (Array.prototype.indexOf.call(same, n) + 1) + ")";
      }
      parts.unshift(p);
      n = parent;
    }
    return parts.join(" > ");
  };
  const out = [];
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    if (!visible) continue;
    out.push({
      i: i,
      tag: el.tagName.toLowerCase(),
      role: clean(el.getAttribute("role")),
      name: clean(el.getAttribute("aria-label") || (el.labels && el.labels[0] && el.labels[0].textContent) || ""),
      text: clean(el.textContent),
      testId: clean(el.getAttribute("data-testid") || el.getAttribute("data-test") || el.getAttribute("data-cy")),
      placeholder: clean(el.placeholder),
      value: clean(typeof el.value === "string" ? el.value : ""),
      selector: cssPath(el)
    });
  }
  return out;
})()`;

async function interactiveElements(page: any): Promise<Candidate[]> {
  return page.evaluate(SNAPSHOT_JS) as Promise<Candidate[]>;
}

/* ── Working it out ───────────────────────────────────────────────────── */

const client = new Anthropic();

type AgentAction =
  | { action: "click"; index: number; why: string }
  | { action: "fill"; index: number; value: string; why: string }
  | { action: "select"; index: number; value: string; why: string }
  | { action: "press"; key: string; why: string }
  | { action: "scroll"; why: string }
  | { action: "done"; why: string }
  | { action: "give_up"; why: string };

const ACTION_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["click", "fill", "select", "press", "scroll", "done", "give_up"] },
    index: { type: "integer", description: "Index of the element from the list. Required for click, fill and select." },
    value: { type: "string", description: "Text to type or option to choose. Required for fill and select." },
    key: { type: "string", description: "Key name for press, e.g. Enter." },
    why: { type: "string", description: "One short sentence on why this action gets closer to the intent." },
  },
  required: ["action", "why"],
  additionalProperties: false,
} as const;

export interface FigureOutResult { satisfied: boolean; actions: string[] }

export interface DecisionContext {
  step: TaskStep; task: Task; value: string; url: string;
  elements: { i: number; tag: string; role: string; name: string; text: string; testId: string; placeholder: string; value: string }[];
  tried: string[];
}
/** Chooses the next action towards a step's intent. Claude, unless overridden. */
export type Decider = (ctx: DecisionContext) => Promise<AgentAction | undefined>;

export const askClaude: Decider = async (ctx) => {
  const t = ctx.step.target;
  const recorded = [t?.name && `name "${t.name}"`, t?.text && `text "${t.text}"`, t?.testId && `test id "${t.testId}"`, t?.placeholder && `placeholder "${t.placeholder}"`, t?.role && `role ${t.role}`, t?.tag && `tag <${t.tag}>`].filter(Boolean).join(", ");
  const neighbours = ctx.task.steps.filter((s) => Math.abs(s.n - ctx.step.n) <= 2 && s.n !== ctx.step.n).map((s) => `${s.n}. ${s.text}`).join("\n");
  const res = await client.messages.create({
    model: config.model,
    max_tokens: 900,
    output_config: { effort: "low", format: { type: "json_schema", schema: ACTION_SCHEMA } },
    system:
      "You are driving a web page to carry out one step of a task a person recorded earlier. The page has changed since it was recorded, so the original element cannot be found.\n\n" +
      "Work out what to do next to carry out the step's intent. You may need more than one action: dismiss a cookie banner or dialog that is in the way, open a menu or tab, search for a record, scroll. Reply with a single next action each time.\n\n" +
      "Reply `done` once you have actually carried out the step (for example you clicked the right button, or typed into the right field) — not merely when the page looks ready.\n" +
      "Reply `give_up` if the intended thing is genuinely not on this page, or if doing it would be a guess.\n\n" +
      "Be careful. This is a live business system: a wrong click can create a real record, send a real message or delete real work. Prefer reversible, obviously-correct actions. If two elements could plausibly be the one meant, give up rather than pick.",
    messages: [{
      role: "user",
      content:
        `Task: ${ctx.task.title}\n` +
        `Step ${ctx.step.n} of ${ctx.task.steps.length} — intent: ${ctx.step.text}\n` +
        (ctx.value ? `Value to use: "${ctx.value}"\n` : "") +
        (recorded ? `The recorded element had: ${recorded}\n` : "") +
        (neighbours ? `\nSurrounding steps:\n${neighbours}\n` : "") +
        `\nPage: ${ctx.url}\n` +
        (ctx.tried.length ? `\nAlready tried:\n${ctx.tried.map((x) => `- ${x}`).join("\n")}\n` : "") +
        `\nElements on the page now:\n` +
        ctx.elements.map((c) => `[${c.i}] <${c.tag}${c.role ? ` role=${c.role}` : ""}> name="${c.name}" text="${c.text}" testid="${c.testId}" placeholder="${c.placeholder}"${c.value ? ` value="${c.value}"` : ""}`).join("\n"),
    }],
  });
  if (res.stop_reason === "refusal") return undefined;
  const block = res.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!block) return undefined;
  try { return JSON.parse(block.text) as AgentAction; } catch { return undefined; }
};

/**
 * Achieve a step's intent on a page that no longer matches the recording.
 * Bounded: a handful of actions, then it stops rather than flailing.
 */
async function figureOut(
  page: any, step: TaskStep, value: string, task: Task,
  log: (level: RunLogEntry["level"], message: string, stepN?: number) => void,
  decide: Decider = askClaude,
  maxActions = 6,
): Promise<FigureOutResult> {
  const tried: string[] = [];

  for (let i = 0; i < maxActions; i++) {
    let elements: Candidate[];
    try { elements = await interactiveElements(page); } catch { return { satisfied: false, actions: tried }; }
    if (!elements.length) return { satisfied: false, actions: tried };

    let act: AgentAction | undefined;
    try {
      act = await decide({ step, task, value, url: page.url(), elements, tried });
    } catch (err) {
      log("warn", `Could not work out step ${step.n}: ${(err as Error).message}`, step.n);
      return { satisfied: false, actions: tried };
    }
    if (!act) return { satisfied: false, actions: tried };

    if (act.action === "done") { log("heal", `Worked out step ${step.n}: ${act.why}`, step.n); return { satisfied: true, actions: tried }; }
    if (act.action === "give_up") { log("warn", `Could not work out step ${step.n}: ${act.why}`, step.n); return { satisfied: false, actions: tried }; }

    const target = "index" in act && typeof act.index === "number" ? elements.find((c) => c.i === act.index) : undefined;
    const describe = target ? `${act.action} [${target.i}] ${target.name || target.text || target.placeholder || target.tag}` : `${act.action}`;
    try {
      if (act.action === "press") await page.keyboard.press(act.key || "Enter");
      else if (act.action === "scroll") await page.mouse.wheel(0, 600);
      else {
        if (!target) return { satisfied: false, actions: tried };
        const loc = page.locator(target.selector).first();
        await loc.waitFor({ state: "visible", timeout: 4000 });
        if (act.action === "click") await loc.click({ timeout: 8000 });
        else if (act.action === "fill") await loc.fill(act.value ?? value, { timeout: 8000 });
        else if (act.action === "select") {
          try { await loc.selectOption({ label: act.value ?? value }, { timeout: 4000 }); }
          catch { await loc.selectOption(act.value ?? value, { timeout: 4000 }); }
        }
        // Remember where the thing actually was, so next run goes straight there.
        if (act.action === step.action || (act.action === "fill" && step.action === "type")) step.healedSelector = target.selector;
      }
      tried.push(`${describe} — ${act.why}`);
      log("heal", `Step ${step.n}: ${describe} (${act.why})`, step.n);
      await page.waitForTimeout(400);
    } catch (err) {
      tried.push(`${describe} failed: ${(err as Error).message}`);
    }
  }
  return { satisfied: false, actions: tried };
}

/* ── Execution ────────────────────────────────────────────────────────── */

export interface RunHooks {
  onLog: (entry: RunLogEntry) => void;
  isCancelled: () => boolean;
  onHeal?: (stepN: number, selector: string) => void;
  onFile?: (file: SavedFile) => void;
  /** Overrides how the next recovery action is chosen. Claude by default. */
  decide?: Decider;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function executeTask(task: Task, run: TaskRun, hooks: RunHooks, options: Partial<RunnerOptions> = {}): Promise<void> {
  const opts: RunnerOptions = { ...DEFAULT_RUNNER_OPTIONS, ...options };
  const values = resolveInputs(task, run.inputs);
  const log = (level: RunLogEntry["level"], message: string, stepN?: number, screenshot?: string) =>
    hooks.onLog({ at: new Date().toISOString(), level, message, stepN, screenshot });

  const chromium = await loadChromium();
  let browser: any;
  try {
    browser = await chromium.launch({ headless: opts.headless, slowMo: opts.slowMoMs, ...browserLaunchOptions() });
  } catch (err) {
    throw new Error(`Could not start the browser: ${(err as Error).message}. If it mentions a missing executable, run: npm run browser`);
  }

  const folder = runFolder(task.title, run.id);
  const context = await browser.newContext({
    storageState: mergedState() as any,
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });

  // Anything the task downloads lands in this run's folder on disk.
  context.on("download", async (download: any) => {
    try {
      const name = download.suggestedFilename() || `download-${Date.now()}`;
      await download.saveAs(path.join(folder, name));
      const file = recordFile(folder, name);
      hooks.onFile?.(file);
      log("info", `Saved ${file.name} (${Math.max(1, Math.round(file.bytes / 1024))} KB) to ${folder}`);
    } catch (err) {
      log("warn", `A download could not be saved: ${(err as Error).message}`);
    }
  });

  const page = await context.newPage();
  const shot = async (name: string): Promise<string | undefined> => {
    try {
      const file = `${run.id}_${name}.jpg`;
      await page.screenshot({ path: path.join(shotsDir, file), type: "jpeg", quality: 50 });
      return file;
    } catch { return undefined; }
  };

  try {
    log("info", `Opening ${task.startUrl}`);
    await page.goto(task.startUrl, { waitUntil: "domcontentloaded", timeout: opts.stepTimeoutMs });

    if (await looksLikeLogin(page)) {
      const s = await shot("login");
      const host = hostOf(page.url()) || hostOf(task.startUrl);
      throw Object.assign(new Error(`${host || "The site"} is asking for a login — its saved sign-in has expired. Reconnect it under Sites, then run again.`), { attention: true, screenshot: s });
    }

    for (const step of task.steps) {
      if (hooks.isCancelled()) { log("warn", "Cancelled"); return; }
      run.currentStep = step.n;
      if (step.delayMs) await sleep(step.delayMs);

      const value = step.variable ? (values[step.variable] ?? step.value ?? "") : (step.value ?? "");
      const label = step.variable ? `${step.text} → "${value}"` : step.text;

      if (opts.dryRun) { log("step", `[practice] ${label}`, step.n); continue; }

      try {
        await runStep(page, step, value, opts.stepTimeoutMs, hooks, task, log);
        log("step", label, step.n);
      } catch (err) {
        const message = (err as Error).message;
        if (step.optional) { log("warn", `Skipped optional step: ${label} (${message})`, step.n); continue; }
        const s = await shot(`fail_step${step.n}`);
        log("error", `Step ${step.n} failed: ${label} — ${message}`, step.n, s);
        throw Object.assign(new Error(`Step ${step.n} (${label}): ${message}`), { screenshot: s });
      }
    }

    const s = await shot("done");
    log("info", "Finished", undefined, s);
  } finally {
    // Give a download that started on the last click a moment to land.
    await sleep(600);
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    pruneIfEmpty(folder);
  }
}

async function runStep(
  page: any, step: TaskStep, value: string, timeoutMs: number,
  hooks: RunHooks, task: Task, log: (l: RunLogEntry["level"], m: string, n?: number) => void,
): Promise<void> {
  if (step.action === "navigate") {
    await page.goto(step.url ?? task.startUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    return;
  }
  if (step.action === "wait") { await sleep(Number(step.value ?? 1000)); return; }
  if (step.action === "press") { await page.keyboard.press(step.value || "Enter"); return; }

  const found = await resolve(page, step, timeoutMs);

  if (!found) {
    if (!task.selfHeal) throw new Error("element not found on the page");
    log("heal", `Step ${step.n}: the recorded element is gone — working out how to do it instead`, step.n);
    const outcome = await figureOut(page, step, value, task, log, hooks.decide ?? askClaude);
    if (outcome.satisfied) {
      if (step.healedSelector) hooks.onHeal?.(step.n, step.healedSelector);
      return; // carried out by working it out
    }
    throw new Error(outcome.actions.length ? `could not work it out after ${outcome.actions.length} attempt(s)` : "element not found and nothing on the page matched the intent");
  }

  const loc = found.locator;
  switch (step.action) {
    case "click": await loc.click({ timeout: timeoutMs }); break;
    case "type": await loc.fill(value, { timeout: timeoutMs }); break;
    case "select":
      try { await loc.selectOption({ label: value }, { timeout: 4000 }); }
      catch { await loc.selectOption(value, { timeout: 4000 }); }
      break;
    case "submit": await loc.press("Enter", { timeout: timeoutMs }); break;
    case "expect": await loc.waitFor({ state: "visible", timeout: timeoutMs }); break;
    default: throw new Error(`unsupported action ${step.action}`);
  }
}

async function looksLikeLogin(page: any): Promise<boolean> {
  try { return (await page.locator('input[type="password"]').count()) > 0; } catch { return false; }
}

/* ── Signing in to a site, once ───────────────────────────────────────── */

/**
 * Opens a visible browser so a person can sign in. Only the resulting cookies
 * are kept — the password is typed into a real browser and never seen here.
 */
export async function connectSite(startUrl: string, waitMs = 300000): Promise<{ saved: boolean; host: string; url: string }> {
  const chromium = await loadChromium();
  const browser = await chromium.launch({ headless: false, ...browserLaunchOptions() });
  const context = await browser.newContext({ storageState: mergedState() as any, viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  await page.goto(startUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
  const deadline = Date.now() + waitMs;
  // Wait until the password box is gone — that is the sign-in going through —
  // or until the person closes the window.
  while (Date.now() < deadline) {
    await sleep(2000);
    if (page.isClosed()) break;
    try { if ((await page.locator('input[type="password"]').count()) === 0) break; } catch { break; }
  }
  const url = page.isClosed() ? startUrl : page.url();
  const state = (await context.storageState()) as StorageState;
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  const site = saveSite(url || startUrl, state);
  return { saved: true, host: site.host, url: site.url };
}

/** Anything signed in at all? A run with nothing would only hit a login wall. */
export const hasSavedSession = anySiteSaved;
