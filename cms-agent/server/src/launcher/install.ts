import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { unpack } from "../pack/tar.js";

/**
 * Everything the launcher needs to put Foreman on a machine that has nothing.
 *
 * The one rule this file exists to enforce: what Foreman *is* and what Jacques
 * *owns* live in different folders. Program files go in `versions/<version>`
 * and are replaced wholesale by an update; the database, the signed-in sites,
 * the settings and the logs sit beside them and are never touched.
 */

export interface Layout {
  /** Everything below lives here. */
  home: string;
  /** One folder per installed version of the program. */
  versions: string;
  /** Records which version `home` should run — a file, not a symlink, because Windows needs a privilege for those. */
  pointer: string;
  /** The database, cookie jars, promoted playbooks. Survives updates. */
  data: string;
  /** Chromium, downloaded once by Playwright. */
  browsers: string;
  logs: string;
  /** Settings: access token, API key, port. Survives updates. */
  settings: string;
  /** Which port the copy that is actually running ended up on. */
  running: string;
}

export function layout(homeOverride?: string): Layout {
  const home = path.resolve(
    homeOverride?.trim() ||
      process.env.FOREMAN_INSTALL_DIR?.trim() ||
      (process.platform === "win32"
        ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Foreman")
        : path.join(os.homedir(), ".foreman")),
  );
  return {
    home,
    versions: path.join(home, "versions"),
    pointer: path.join(home, "installed.txt"),
    data: path.join(home, "data"),
    browsers: path.join(home, "browsers"),
    logs: path.join(home, "logs"),
    settings: path.join(home, "foreman.env"),
    running: path.join(home, "running.json"),
  };
}

export function ensureDirs(l: Layout): void {
  for (const dir of [l.home, l.versions, l.data, l.browsers, l.logs]) fs.mkdirSync(dir, { recursive: true });
}

/* ── Settings ──────────────────────────────────────────────────────────── */

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    out[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
  return out;
}

export function formatEnvFile(values: Record<string, string>, header: string[] = []): string {
  const lines = header.map((h) => `# ${h}`);
  for (const [k, v] of Object.entries(values)) lines.push(`${k}=${v}`);
  return lines.join("\n") + "\n";
}

/** 32 hex characters: long enough that the tunnel guard accepts it and guessing is hopeless. */
export const newToken = (): string => crypto.randomBytes(16).toString("hex");

/**
 * Read the settings file, creating it with a fresh access token the first time.
 * Foreman is never left open without one — not even on loopback, because the
 * whole point is that the phone can reach it.
 */
export function ensureSettings(l: Layout): Record<string, string> {
  ensureDirs(l);
  const existing = fs.existsSync(l.settings) ? parseEnvFile(fs.readFileSync(l.settings, "utf8")) : {};
  const before = JSON.stringify(existing);
  if (!existing.CMS_AGENT_TOKEN || existing.CMS_AGENT_TOKEN.length < 20) existing.CMS_AGENT_TOKEN = newToken();
  existing.PORT ??= "8787";
  existing.WORKSPACE_DIR ??= path.join(os.homedir(), "Foreman");
  if (JSON.stringify(existing) !== before) {
    fs.writeFileSync(
      l.settings,
      formatEnvFile(existing, [
        "Foreman settings. Edit with Notepad, then restart Foreman.",
        "CMS_AGENT_TOKEN  the access code the phone and browser need. Keep it private.",
        "ANTHROPIC_API_KEY  paste your Claude API key here to enable chat and step recovery.",
        "WORKSPACE_DIR  where finished work is saved.",
      ]),
      { mode: 0o600 },
    );
  }
  return existing;
}

/* ── Versions ──────────────────────────────────────────────────────────── */

/** Compare two dotted versions. Returns >0 when `a` is newer. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split(/[.+-]/).map((n) => (/^\d+$/.test(n) ? Number(n) : 0));
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  }
  return 0;
}

export function installedVersion(l: Layout): string | undefined {
  if (!fs.existsSync(l.pointer)) return undefined;
  const v = fs.readFileSync(l.pointer, "utf8").trim();
  return v && fs.existsSync(path.join(l.versions, v, "server.cjs")) ? v : undefined;
}

export const versionDir = (l: Layout, version: string): string => path.join(l.versions, version);

/**
 * Put the program on disk if this version is not already there.
 *
 * Unpacking goes to a `.partial` folder that is renamed into place at the end,
 * so a machine that loses power halfway through starts up on the old version
 * rather than on half of the new one.
 */
export function ensureInstalled(l: Layout, payload: Buffer, version: string): { installed: boolean; dir: string } {
  ensureDirs(l);
  const dir = versionDir(l, version);
  if (installedVersion(l) === version && fs.existsSync(path.join(dir, "server.cjs"))) return { installed: false, dir };

  const staging = `${dir}.partial`;
  fs.rmSync(staging, { recursive: true, force: true });
  unpack(payload, staging);
  if (!fs.existsSync(path.join(staging, "server.cjs"))) throw new Error("payload has no server.cjs — refusing to install it");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(staging, dir);
  fs.writeFileSync(l.pointer, version);
  return { installed: true, dir };
}

/** Old versions left behind by updates; the current one and the previous one are kept. */
export function stalePrevious(l: Layout, keep = 2): string[] {
  if (!fs.existsSync(l.versions)) return [];
  const all = fs.readdirSync(l.versions).filter((n) => !n.endsWith(".partial")).sort(compareVersions).reverse();
  return all.slice(keep);
}

export function pruneOldVersions(l: Layout, keep = 2): string[] {
  const removed: string[] = [];
  for (const v of stalePrevious(l, keep)) {
    try { fs.rmSync(path.join(l.versions, v), { recursive: true, force: true }); removed.push(v); } catch { /* in use; next time */ }
  }
  return removed;
}

/* ── Which copy is running ─────────────────────────────────────────────── */

export interface RunningNote { port: number; pid: number; version: string; startedAt: string }

/**
 * Foreman writes down the port it actually got, because it does not always get
 * the one in the settings — something else may hold 8787. Without this a second
 * double-click starts a *second* Foreman against the same database, which then
 * runs every scheduled task twice.
 */
export function noteRunning(l: Layout, note: RunningNote): void {
  fs.writeFileSync(l.running, JSON.stringify(note, null, 2));
}

export function readRunning(l: Layout): RunningNote | undefined {
  try {
    const note = JSON.parse(fs.readFileSync(l.running, "utf8")) as RunningNote;
    return typeof note.port === "number" ? note : undefined;
  } catch { return undefined; }
}

export function clearRunning(l: Layout): void {
  try { fs.rmSync(l.running, { force: true }); } catch { /* nothing to clear */ }
}
