import fs from "node:fs";
import path from "node:path";

/**
 * Where Foreman's own files live.
 *
 * Foreman runs in three shapes and each puts its files somewhere different:
 *
 *   from source   `npm run dev` in server/, assets two levels up in cms-agent/
 *   built         `node dist/index.js`, same tree, one level deeper
 *   packaged      Foreman.exe unpacked a payload into %LOCALAPPDATA%\Foreman
 *
 * Nothing here uses `import.meta.url`: the packaged build is a CommonJS bundle
 * and esbuild empties `import.meta` in that format, which silently resolves
 * every asset path to the filesystem root. Locating the tree from the process
 * instead (an explicit env var, then argv, then cwd) behaves the same in all
 * three shapes and can be tested without building anything.
 */

/** A directory is Foreman's resource root if the console lives in it. */
const isRoot = (dir: string): boolean => fs.existsSync(path.join(dir, "web", "index.html"));

function searchUp(from: string, levels = 5): string | undefined {
  let dir = path.resolve(from);
  for (let i = 0; i <= levels; i++) {
    if (isRoot(dir)) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return undefined;
}

let cached: string | undefined;

/**
 * The directory holding `web/` and `knowledge/`. The launcher sets
 * FOREMAN_HOME; from source we find it by walking up from the entry point.
 */
export function resourceDir(): string {
  if (cached) return cached;
  const declared = process.env.FOREMAN_HOME?.trim();
  if (declared && isRoot(declared)) return (cached = path.resolve(declared));
  const entry = process.argv[1] ? path.dirname(path.resolve(process.argv[1])) : undefined;
  const found = (entry && searchUp(entry)) ?? searchUp(process.cwd());
  // Last resort: the repo layout, so a mis-set FOREMAN_HOME degrades to a
  // missing-asset warning rather than reading from "/web".
  return (cached = found ?? path.resolve(process.cwd(), ".."));
}

/** An asset shipped with Foreman, e.g. `knowledge/cms-kb.json`. */
export function resource(...parts: string[]): string {
  return path.join(resourceDir(), ...parts);
}

/**
 * Writable state: the database, cookie jars, logs. Kept apart from resources
 * so an update can replace the program without touching anything Jacques owns.
 */
export function dataDir(): string {
  const declared = process.env.FOREMAN_DATA?.trim();
  const dir = declared && declared.length ? path.resolve(declared) : path.resolve("data");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Only for tests: forget the resolved root. */
export function resetPathCache(): void {
  cached = undefined;
}
