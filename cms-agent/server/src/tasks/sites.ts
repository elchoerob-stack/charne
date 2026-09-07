import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

/**
 * Signed-in sites.
 *
 * Most of the work Jacques wants automated lives across several web systems,
 * not one. Each site keeps its own cookie jar under data/sessions/<host>.json,
 * and a run is given the merged state of every site it might touch — so a task
 * can start in one system, pull a number out of a second, and file the result
 * in a third without anyone logging in again.
 *
 * Only session cookies and local storage are kept. Passwords are typed by a
 * human into a real browser and never reach Foreman.
 */

const dir = path.join(path.dirname(config.dbPath), "sessions");
fs.mkdirSync(dir, { recursive: true });

export interface SiteSession {
  host: string;
  url: string;
  savedAt: string;
  /** Rough age signal: cookie jars go stale and runs then stop at a login screen. */
  ageDays: number;
  cookies: number;
}

export interface StorageState {
  cookies: unknown[];
  origins: { origin: string; localStorage?: { name: string; value: string }[] }[];
}

export const hostOf = (url: string): string => {
  try { return new URL(url).host.toLowerCase(); } catch { return ""; }
};

const fileFor = (host: string) => path.join(dir, `${host.replace(/[^a-z0-9.-]/gi, "_")}.json`);

export function saveSite(url: string, state: StorageState): SiteSession {
  const host = hostOf(url);
  if (!host) throw new Error(`Not a usable address: ${url}`);
  const payload = { host, url, savedAt: new Date().toISOString(), state };
  fs.writeFileSync(fileFor(host), JSON.stringify(payload));
  return describe(payload);
}

interface Stored { host: string; url: string; savedAt: string; state: StorageState }

function readAll(): Stored[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).flatMap((f) => {
    try { return [JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Stored]; } catch { return []; }
  });
}

const describe = (s: Stored): SiteSession => ({
  host: s.host, url: s.url, savedAt: s.savedAt,
  ageDays: Math.floor((Date.now() - new Date(s.savedAt).getTime()) / 86_400_000),
  cookies: Array.isArray(s.state?.cookies) ? s.state.cookies.length : 0,
});

export const listSites = (): SiteSession[] => readAll().map(describe).sort((a, b) => a.host.localeCompare(b.host));
export const hasSite = (host: string): boolean => fs.existsSync(fileFor(host));
export const forgetSite = (host: string): boolean => {
  const f = fileFor(host);
  if (!fs.existsSync(f)) return false;
  fs.unlinkSync(f);
  return true;
};

/** Every saved site combined into one Playwright storage state. */
export function mergedState(): StorageState | undefined {
  const all = readAll();
  if (!all.length) return undefined;
  const cookies: unknown[] = [];
  const origins: StorageState["origins"] = [];
  const seenCookie = new Set<string>();
  const seenOrigin = new Set<string>();
  for (const s of all) {
    for (const c of s.state?.cookies ?? []) {
      const k = JSON.stringify([(c as { name?: string }).name, (c as { domain?: string }).domain, (c as { path?: string }).path]);
      if (seenCookie.has(k)) continue;
      seenCookie.add(k);
      cookies.push(c);
    }
    for (const o of s.state?.origins ?? []) {
      if (seenOrigin.has(o.origin)) continue;
      seenOrigin.add(o.origin);
      origins.push(o);
    }
  }
  return { cookies, origins };
}

/** True when nothing at all is signed in, so a run would only hit a login wall. */
export const anySiteSaved = (): boolean => readAll().length > 0;

/** Sites older than this are worth re-connecting before they cause a silent skip. */
export const staleSites = (days = 14): SiteSession[] => listSites().filter((s) => s.ageDays >= days);
