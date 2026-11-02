import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Where Foreman puts things it produces.
 *
 * Work happens on the web, but the output has to land somewhere real —
 * a folder on the desktop, a synced drive, a network share. Everything a run
 * downloads or writes goes here, under a folder per task, so a morning's work
 * is a folder you can open rather than something trapped in a database.
 */

export function workspaceDir(): string {
  const configured = process.env.WORKSPACE_DIR?.trim();
  const base = configured && configured.length ? configured : path.join(os.homedir(), "Foreman");
  fs.mkdirSync(base, { recursive: true });
  return base;
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9 ._-]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 60) || "task";

/** Folder for one run: <workspace>/<Task name>/<date> run <id>. */
export function runFolder(taskTitle: string, runId: string, at = new Date()): string {
  const day = at.toISOString().slice(0, 10);
  const p = path.join(workspaceDir(), safe(taskTitle), `${day} ${runId}`);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

export interface SavedFile { name: string; path: string; bytes: number; savedAt: string }

export function recordFile(folder: string, name: string): SavedFile {
  const p = path.join(folder, name);
  const bytes = fs.existsSync(p) ? fs.statSync(p).size : 0;
  return { name, path: p, bytes, savedAt: new Date().toISOString() };
}

/** Write text (a note, a CSV a task scraped) next to the downloads. */
export function writeFile(folder: string, name: string, contents: string): SavedFile {
  const target = path.join(folder, safe(name));
  fs.writeFileSync(target, contents);
  return recordFile(folder, path.basename(target));
}

/** Remove the folder if the run produced nothing, so the workspace stays tidy. */
export function pruneIfEmpty(folder: string): void {
  try { if (fs.existsSync(folder) && fs.readdirSync(folder).length === 0) fs.rmdirSync(folder); } catch { /* leave it */ }
}
