import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describeAddress, localAddresses } from "../net.js";
import { clearRunning, ensureInstalled, ensureSettings, installedVersion, layout, noteRunning, pruneOldVersions, readRunning, type Layout } from "./install.js";

/**
 * Foreman.exe.
 *
 * One file, double-clicked. It carries the whole program inside it, so the
 * machine it lands on needs no Node, no npm, no git and no terminal. What it
 * does, in order: unpack itself into a folder under the user's account, make
 * sure there is an access token, fetch Chromium once, start the server, open
 * the console, and stay alive to restart the server if it falls over.
 *
 * It re-runs itself for the jobs that need a Node process of their own: the
 * embedded runtime *is* the executable, so `spawn(process.execPath)` with a
 * role in the environment is how a child gets started.
 */

type Role = "launcher" | "server" | "browser-install";

const role = (process.env.FOREMAN_ROLE as Role) || "launcher";
// A packaged build gets its flags straight after the executable; a development
// run has a script path in between. Only flags matter here, so take those.
const flags = process.argv.slice(1).filter((a) => a.startsWith("-") || a.startsWith("/"));
const has = (...names: string[]) => flags.some((a) => names.includes(a.toLowerCase()));

/* ── The payload: this program, as an archive ──────────────────────────── */

interface Payload { bytes: Buffer; version: string }

/**
 * In a packaged build the payload is an asset inside the executable. In
 * development there is no executable, so FOREMAN_PAYLOAD points at the archive
 * the build script wrote — which is what makes all of this testable.
 */
async function payload(): Promise<Payload> {
  const fromFile = process.env.FOREMAN_PAYLOAD?.trim();
  if (fromFile) return { bytes: fs.readFileSync(fromFile), version: readVersion(fromFile) };
  const sea = await import("node:sea").catch(() => undefined);
  packaged = Boolean(sea?.isSea());
  if (!packaged || !sea) {
    throw new Error("No payload: run the packaged Foreman, or set FOREMAN_PAYLOAD to a payload.tar.gz.");
  }
  return { bytes: Buffer.from(sea.getRawAsset("payload.tar.gz") as ArrayBuffer), version: String(sea.getAsset("version.txt", "utf8")).trim() };
}

/** The build writes payload.sha256 and foreman.json; the version file sits beside the archive. */
function readVersion(archivePath: string): string {
  const beside = path.join(path.dirname(archivePath), "version.txt");
  if (fs.existsSync(beside)) return fs.readFileSync(beside, "utf8").trim();
  return process.env.FOREMAN_VERSION?.trim() || "0.0.0-dev";
}

/* ── Small helpers ─────────────────────────────────────────────────────── */

const log = (msg: string) => console.log(`[foreman] ${msg}`);

let packaged = false;

/**
 * How to re-run ourselves for a child process. A packaged build *is* the
 * program, so the executable needs no arguments. A development run is
 * `node launcher.cjs`, and node started with no script reads standard input
 * and exits immediately — which looks exactly like the server crashing.
 */
const selfArgs = (): string[] => (packaged ? [] : [process.argv[1]]);

function appendLog(l: Layout, line: string): void {
  try { fs.appendFileSync(path.join(l.logs, "launcher.log"), `${new Date().toISOString()} ${line}\n`); } catch { /* logging must never be fatal */ }
}

async function alive(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/alive`, { signal: AbortSignal.timeout(1500) });
    return res.ok && Boolean((await res.json() as { foreman?: boolean }).foreman);
  } catch { return false; }
}

/** Is anything at all listening here? A busy port is not necessarily Foreman. */
async function portFree(port: number): Promise<boolean> {
  const net = await import("node:net");
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });
}

/**
 * The configured port, or the first free one after it. Something else on 8787
 * — an old copy started from a terminal, another program — should move Foreman
 * aside rather than leave it crash-looping on a port it can never have.
 */
async function usablePort(preferred: number): Promise<number> {
  for (let port = preferred; port < preferred + 10; port++) {
    if (await portFree(port)) return port;
  }
  throw new Error(`Ports ${preferred}-${preferred + 9} are all busy. Close whatever is using them, or set PORT in the settings file.`);
}

async function waitUntilAlive(port: number, seconds = 90): Promise<boolean> {
  for (let i = 0; i < seconds * 2; i++) {
    if (await alive(port)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function openBrowser(url: string): void {
  const [cmd, cmdArgs] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin" ? ["open", [url]]
    : ["xdg-open", [url]];
  try {
    const child = spawn(cmd as string, cmdArgs as string[], { detached: true, stdio: "ignore" });
    // A missing browser opener reports itself asynchronously, so the listener
    // matters more than the try: without it the ENOENT is an unhandled event
    // and takes Foreman down with it.
    child.on("error", () => log(`Open this in your browser: ${url}`));
    child.unref();
  } catch { log(`Open this in your browser: ${url}`); }
}

/** Every address Foreman answers on, said plainly enough to pick one for the phone. */
function addresses(port: number): { label: string; url: string }[] {
  return [
    { label: "this computer", url: `http://127.0.0.1:${port}` },
    ...localAddresses().map((a) => ({ label: describeAddress(a), url: `http://${a}:${port}` })),
  ];
}

/* ── Roles ─────────────────────────────────────────────────────────────── */

/**
 * Load a file from disk.
 *
 * Inside a packaged executable the ambient `require` resolves built-in modules
 * and nothing else, so it cannot load the unpacked program — it reports the
 * absolute path as an unknown built-in. `createRequire` anchored to the file
 * itself gives back an ordinary CommonJS loader, which is what both of the
 * child roles below need.
 */
function loadFromDisk(file: string): void {
  createRequire(file)(file);
}

/** Run the server itself. Reached by re-running the executable with FOREMAN_ROLE=server. */
function runServer(): void {
  const entry = process.env.FOREMAN_SERVER_ENTRY;
  if (!entry) throw new Error("FOREMAN_SERVER_ENTRY is not set");
  loadFromDisk(entry);
}

/** Download Chromium once. Playwright does the work; we only give it a home and wait. */
function runBrowserInstall(): void {
  const cli = process.env.FOREMAN_PLAYWRIGHT_CLI;
  if (!cli) throw new Error("FOREMAN_PLAYWRIGHT_CLI is not set");
  // Playwright's CLI reads process.argv, so set it up and hand over.
  process.argv = [process.argv[0], cli, "install", "chromium"];
  loadFromDisk(cli);
}

/**
 * Fetch Chromium in the background.
 *
 * It is a 150 MB download from someone else's CDN, so it must not stand
 * between a double-click and a working console. Everything except driving a
 * browser works without it, and on a slow or blocked connection waiting for it
 * would look exactly like Foreman failing to start.
 */
function ensureBrowser(l: Layout, dir: string): void {
  const marker = path.join(l.browsers, ".chromium-ok");
  if (fs.existsSync(marker)) return;
  const cli = path.join(dir, "node_modules", "playwright-core", "cli.js");
  if (!fs.existsSync(cli)) { log("Playwright is missing from this build; tasks that drive a browser will not run."); return; }

  log("Fetching the browser Foreman drives (about 150 MB, once). It downloads in the background.");
  const logFile = fs.openSync(path.join(l.logs, "browser-install.log"), "a");
  const child = spawn(process.execPath, selfArgs(), {
    env: { ...process.env, FOREMAN_ROLE: "browser-install", FOREMAN_PLAYWRIGHT_CLI: cli, PLAYWRIGHT_BROWSERS_PATH: l.browsers },
    stdio: ["ignore", logFile, logFile],
  });
  child.on("exit", (code) => {
    if (code === 0) {
      fs.writeFileSync(marker, new Date().toISOString());
      log("The browser is ready. Recorded tasks can run now.");
    } else {
      appendLog(l, `browser install exited with code ${code}`);
      log(`The browser download did not finish (code ${code}); see ${path.join(l.logs, "browser-install.log")}. Everything else works, and Foreman tries again next time it starts.`);
    }
  });
  child.on("error", (err) => log(`The browser download could not start: ${err.message}`));
}

/* ── The launcher ──────────────────────────────────────────────────────── */

let server: ChildProcess | undefined;
let stopping = false;

const restarts: number[] = [];

function startServer(l: Layout, dir: string, version: string, settings: Record<string, string>, port: number): void {
  const logFile = fs.openSync(path.join(l.logs, "foreman.log"), "a");
  server = spawn(process.execPath, selfArgs(), {
    env: {
      ...process.env,
      ...settings,
      FOREMAN_ROLE: "server",
      FOREMAN_SERVER_ENTRY: path.join(dir, "server.cjs"),
      FOREMAN_HOME: dir,
      FOREMAN_DATA: l.data,
      FOREMAN_VERSION: version,
      PLAYWRIGHT_BROWSERS_PATH: l.browsers,
      PORT: String(port),
    },
    stdio: ["ignore", logFile, logFile],
  });
  server.on("exit", (code) => {
    if (stopping) return;
    const now = Date.now();
    restarts.push(now);
    while (restarts.length && now - restarts[0] > 120_000) restarts.shift();
    // Five failures in two minutes is not a hiccup: something is wrong that
    // restarting will not fix, and a loop only buries the reason in the log.
    if (restarts.length >= 5) {
      clearRunning(l);
      appendLog(l, `server exited with code ${code} five times; giving up`);
      log(`Foreman keeps stopping (code ${code}). The last error is at the end of ${path.join(l.logs, "foreman.log")}`);
      process.exitCode = 1;
      return;
    }
    const wait = Math.min(30_000, 2000 * 2 ** (restarts.length - 1));
    appendLog(l, `server exited with code ${code}; restarting in ${wait}ms`);
    log(`Foreman stopped unexpectedly (code ${code}). Restarting in ${Math.round(wait / 1000)}s…`);
    setTimeout(() => startServer(l, dir, version, settings, port), wait).unref?.();
  });
}

async function launch(): Promise<void> {
  const l = layout();
  const settings = ensureSettings(l);
  const preferred = Number(settings.PORT || 8787);
  const token = settings.CMS_AGENT_TOKEN;

  // Already running? Check the port it wrote down, then the configured one.
  for (const candidate of [readRunning(l)?.port, preferred]) {
    if (candidate && (await alive(candidate))) {
      log(`Foreman is already running on port ${candidate}. Opening the console.`);
      openBrowser(`http://127.0.0.1:${candidate}/?token=${encodeURIComponent(token)}`);
      return;
    }
  }
  const port = await usablePort(preferred);
  if (port !== preferred) log(`Port ${preferred} is taken by something else, so this copy is on ${port}.`);

  const { bytes, version } = await payload();
  const { installed, dir } = ensureInstalled(l, bytes, version);
  appendLog(l, installed ? `installed ${version}` : `running ${version}`);
  if (installed) log(`Installed Foreman ${version} in ${l.home}`);
  pruneOldVersions(l);

  startServer(l, dir, version, settings, port);
  const up = await waitUntilAlive(port);
  if (!up) {
    log(`Foreman did not come up within 90 seconds. The log is ${path.join(l.logs, "foreman.log")}`);
    return;
  }

  noteRunning(l, { port, pid: process.pid, version, startedAt: new Date().toISOString() });
  ensureBrowser(l, dir);
  const url = `http://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`;
  log(`Foreman ${version} is running.`);
  for (const a of addresses(port)) log(`  ${a.label.padEnd(24)} ${a.url}`);
  log(`  access code             ${token}`);
  log("Close this window to stop Foreman.");
  openBrowser(url);

  const stop = () => { stopping = true; clearRunning(l); server?.kill(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

async function showWhere(): Promise<void> {
  const l = layout();
  const settings = ensureSettings(l);
  const running = readRunning(l);
  const port = running && (await alive(running.port)) ? running.port : Number(settings.PORT || 8787);
  console.log(`Foreman folder : ${l.home}`);
  console.log(`Running now    : ${running && (await alive(running.port)) ? `yes, on port ${running.port}` : "no"}`);
  console.log(`Settings file  : ${l.settings}`);
  console.log(`Installed      : ${installedVersion(l) ?? "not yet"}`);
  console.log(`Saved work     : ${settings.WORKSPACE_DIR}`);
  console.log(`Access code    : ${settings.CMS_AGENT_TOKEN}`);
  for (const a of addresses(port)) console.log(`Address (${a.label}): ${a.url}/?token=${settings.CMS_AGENT_TOKEN}`);
}

async function main(): Promise<void> {
  if (role === "server") return runServer();
  if (role === "browser-install") return runBrowserInstall();
  if (has("--where", "--info", "/info")) return showWhere();
  if (has("--version", "-v")) {
    console.log((await payload().catch(() => ({ version: "unknown" }))).version);
    return;
  }
  if (has("--help", "-h", "/?")) {
    console.log([
      "Foreman — records a job once, then does it for you.",
      "",
      "  Foreman.exe            install if needed, start, and open the console",
      "  Foreman.exe --where    show the folders, the address and the access code",
      "  Foreman.exe --version  which version this is",
    ].join("\n"));
    return;
  }
  await launch();
}

main().catch((err) => {
  console.error(`[foreman] ${(err as Error).message}`);
  process.exitCode = 1;
});
