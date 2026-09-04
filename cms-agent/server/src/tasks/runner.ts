import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import type { Target } from "../recorder/schema.js";
import { resolveInputs } from "./compile.js";
import { DEFAULT_RUNNER_OPTIONS, type RunLogEntry, type RunnerOptions, type Task, type TaskRun, type TaskStep } from "./types.js";

/**
 * Executes a Task in a real browser, separately from whatever Jacques is doing
 * in his own Chrome. Two ideas carry the whole design:
 *
 *  1. Never trust one selector. A recorded CSS path breaks the moment CMS
 *     re-renders a table. Each step carries several ways to find its element
 *     and they are tried cheapest-first.
 *  2. When they all fail, ask rather than die. Claude gets the page's
 *     interactive elements and picks the intended one; the repair is written
 *     back onto the task so the next run goes straight there.
 */

const dataDir = path.dirname(config.dbPath);
const sessionPath = path.join(dataDir, "cms-session.json");
const shotsDir = path.join(dataDir, "run-shots");
fs.mkdirSync(shotsDir, { recursive: true });

export const hasSavedSession = () => fs.existsSync(sessionPath);
export const savedSessionPath = () => sessionPath;

/* ── Playwright is loaded on demand ───────────────────────────────────── */

type Chromium = typeof import("playwright")["chromium"];
let chromiumCache: Chromium | undefined;

export async function loadChromium(): Promise<Chromium> {
  if (chromiumCache) return chromiumCache;
  try {
    const pw = await import("playwright");
    chromiumCache = pw.chromium;
    return chromiumCache;
  } catch {
    throw new Error("Playwright is not installed. Run `npm install` then `npx playwright install chromium` in cms-agent/server.");
  }
}

/**
 * Which browser to drive. Most people running this already have Chrome or Edge
 * installed, so BROWSER_CHANNEL=chrome avoids downloading a second copy of a
 * browser onto the machine. BROWSER_PATH points at an executable directly.
 */
export function browserLaunchOptions(): { executablePath?: string; channel?: string } {
  const explicit = process.env.BROWSER_PATH?.trim();
  if (explicit) return { executablePath: explicit };
  const channel = process.env.BROWSER_CHANNEL?.trim();
  if (channel && channel !== "chromium") return { channel };
  return {};
}

/* ── Locator strategies ───────────────────────────────────────────────── */

export interface Strategy { how: string; run: (page: any) => any }

/**
 * Ordered cheapest and most stable first. A test id survives a redesign; a
 * generated CSS path barely survives a sort order change, so it goes last.
 */
export function strategiesFor(t: Target | undefined, healed?: string): Strategy[] {
  const out: Strategy[] = [];
  if (!t) return out;
  if (healed) out.push({ how: `healed:${healed}`, run: (p) => p.locator(healed) });
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

/** Try each strategy until one matches exactly one visible element. */
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

/* ── Self-healing ─────────────────────────────────────────────────────── */

interface Candidate { i: number; tag: string; role: string; name: string; text: string; testId: string; placeholder: string; selector: string }

/** A compact inventory of what a person could actually click or type into. */
async function interactiveElements(page: any): Promise<Candidate[]> {
  return page.evaluate(() => {
    const sel = "button, a[href], input, select, textarea, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=radio], [role=combobox], [role=textbox]";
    const nodes = Array.from(document.querySelectorAll(sel)).slice(0, 120);
    const clean = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim().slice(0, 80);
    const path = (el: Element) => {
      const parts: string[] = [];
      let n: Element | null = el;
      while (n && n.nodeType === 1 && parts.length < 5) {
        if ((n as HTMLElement).id) { parts.unshift(`#${(n as HTMLElement).id}`); break; }
        let p = n.tagName.toLowerCase();
        const parent: Element | null = n.parentElement;
        if (parent) {
          const same = Array.from(parent.children).filter((c) => c.tagName === n!.tagName);
          if (same.length > 1) p += `:nth-of-type(${same.indexOf(n) + 1})`;
        }
        parts.unshift(p);
        n = parent;
      }
      return parts.join(" > ");
    };
    return nodes.map((el, i) => {
      const he = el as HTMLElement & { placeholder?: string; labels?: NodeListOf<HTMLLabelElement> };
      const visible = !!(he.offsetWidth || he.offsetHeight || he.getClientRects().length);
      return {
        i, visible,
        tag: el.tagName.toLowerCase(),
        role: clean(el.getAttribute("role")),
        name: clean(el.getAttribute("aria-label") || (he.labels && he.labels[0] && he.labels[0].textContent) || ""),
        text: clean(el.textContent),
        testId: clean(el.getAttribute("data-testid") || el.getAttribute("data-test") || el.getAttribute("data-cy")),
        placeholder: clean(he.placeholder),
        selector: path(el),
      };
    }).filter((c: any) => c.visible);
  });
}

const client = new Anthropic();

/** Ask Claude which element on the page is the one the step meant. */
async function healStep(page: any, step: TaskStep): Promise<{ selector: string; why: string } | undefined> {
  let candidates: Candidate[];
  try { candidates = await interactiveElements(page); } catch { return undefined; }
  if (!candidates.length) return undefined;
  const t = step.target;
  const wanted = [t?.name && `name "${t.name}"`, t?.text && `text "${t.text}"`, t?.testId && `test id "${t.testId}"`, t?.placeholder && `placeholder "${t.placeholder}"`, t?.role && `role ${t.role}`, t?.tag && `tag <${t.tag}>`].filter(Boolean).join(", ");

  const res = await client.messages.create({
    model: config.model,
    max_tokens: 900,
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            index: { type: "integer", description: "Index of the matching element, or -1 if none of them is a safe match." },
            confidence: { type: "number" },
            why: { type: "string" },
          },
          required: ["index", "confidence", "why"],
          additionalProperties: false,
        },
      },
    },
    system:
      "You repair a broken step in a recorded browser workflow for a car-dealership workshop system. " +
      "The recorded element could not be found, probably because the page changed. Choose the element on the current page that the step clearly intended. " +
      "Be conservative: if nothing is an obvious match, return index -1. A wrong click in a live dealership system creates real bookings and real invoices, so a refusal is far better than a guess.",
    messages: [{
      role: "user",
      content:
        `Step to perform: ${step.action} — "${step.text}"\n` +
        `Recorded element had: ${wanted || "no distinguishing attributes"}\n` +
        (step.value ? `Value involved: ${step.value}\n` : "") +
        `\nElements currently on the page:\n` +
        candidates.map((c) => `[${c.i}] <${c.tag}${c.role ? ` role=${c.role}` : ""}> name="${c.name}" text="${c.text}" testid="${c.testId}" placeholder="${c.placeholder}"`).join("\n"),
    }],
  });

  if (res.stop_reason === "refusal") return undefined;
  const block = res.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!block) return undefined;
  let parsed: { index: number; confidence: number; why: string };
  try { parsed = JSON.parse(block.text); } catch { return undefined; }
  if (parsed.index < 0 || parsed.confidence < 0.6) return undefined;
  const chosen = candidates.find((c) => c.i === parsed.index);
  return chosen ? { selector: chosen.selector, why: parsed.why } : undefined;
}

/* ── Execution ────────────────────────────────────────────────────────── */

export interface RunHooks {
  onLog: (entry: RunLogEntry) => void;
  isCancelled: () => boolean;
  /** Persist a healed locator so the repair sticks for future runs. */
  onHeal?: (stepN: number, selector: string) => void;
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
    throw new Error(`Could not start the browser: ${(err as Error).message}. If this mentions a missing executable, run: npx playwright install chromium`);
  }

  const context = await browser.newContext({
    storageState: hasSavedSession() ? sessionPath : undefined,
    viewport: { width: 1440, height: 900 },
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

    // A login screen means the saved session is gone; stop rather than typing
    // a booking into a password box.
    if (await looksLikeLogin(page)) {
      const s = await shot("login");
      throw Object.assign(new Error("CMS is asking for a login. Reconnect the saved session from the Tasks panel, then run again."), { attention: true, screenshot: s });
    }

    for (const step of task.steps) {
      if (hooks.isCancelled()) { log("warn", "Cancelled"); return; }
      run.currentStep = step.n;
      if (step.delayMs) await sleep(step.delayMs);

      const value = step.variable ? (values[step.variable] ?? step.value ?? "") : (step.value ?? "");
      const label = step.variable ? `${step.text} → "${value}"` : step.text;

      if (opts.dryRun) { log("step", `[dry run] ${label}`, step.n); continue; }

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
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
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

  let found = await resolve(page, step, timeoutMs);

  if (!found && task.selfHeal) {
    log("heal", `Could not find the element for step ${step.n}; asking Claude to identify it`, step.n);
    const healed = await healStep(page, step);
    if (healed) {
      try {
        const loc = page.locator(healed.selector).first();
        await loc.waitFor({ state: "visible", timeout: 4000 });
        found = { locator: loc, how: `healed:${healed.selector}` };
        step.healedSelector = healed.selector;
        hooks.onHeal?.(step.n, healed.selector);
        log("heal", `Repaired step ${step.n}: ${healed.why}`, step.n);
      } catch { /* the repair did not hold either */ }
    }
  }

  if (!found) throw new Error("element not found on the page");
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
  try {
    const pw = await page.locator('input[type="password"]').count();
    return pw > 0;
  } catch { return false; }
}

/* ── One-time session capture ─────────────────────────────────────────── */

/**
 * Opens a visible browser so a human can log into CMS once. Only the resulting
 * cookies are saved — the password never touches Foreman.
 */
export async function captureSession(startUrl: string, waitMs = 180000): Promise<{ saved: boolean; url: string }> {
  const chromium = await loadChromium();
  const browser = await chromium.launch({ headless: false, ...browserLaunchOptions() });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  await page.goto(startUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
  const deadline = Date.now() + waitMs;
  // Wait until the password box is gone, i.e. the login went through.
  while (Date.now() < deadline) {
    await sleep(2000);
    if (page.isClosed()) break;
    try { if ((await page.locator('input[type="password"]').count()) === 0) break; } catch { break; }
  }
  const url = page.isClosed() ? startUrl : page.url();
  await context.storageState({ path: sessionPath });
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  return { saved: fs.existsSync(sessionPath), url };
}

export const runShotsDir = shotsDir;
