/**
 * Build Foreman's payload: everything the program is, as one archive.
 *
 * The launcher carries this inside the executable and unpacks it on first run,
 * so the machine it lands on needs no Node, no npm, no git and no network. The
 * one thing not in here is Chromium — it is platform-specific and large, and
 * Playwright fetches it once on first run.
 *
 *   npm run payload            build for this platform
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { packDir } from "../src/pack/tar.js";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = path.resolve(serverDir, "..");
const outDir = path.join(serverDir, "build");
const payloadDir = path.join(outDir, "payload");

const pkg = JSON.parse(fs.readFileSync(path.join(serverDir, "package.json"), "utf8"));
const playwrightVersion: string = pkg.dependencies.playwright;

function copyDir(from: string, to: string): void {
  fs.cpSync(from, to, { recursive: true, dereference: true });
}

async function main(): Promise<void> {
  fs.rmSync(payloadDir, { recursive: true, force: true });
  fs.mkdirSync(payloadDir, { recursive: true });

  // 1. The server, as a single CommonJS file. Playwright stays external: its
  //    browser registry resolves `browsers.json` and the browser binaries
  //    relative to its own package directory, so it has to stay a real package.
  const result = await build({
    entryPoints: [path.join(serverDir, "src", "index.ts")],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    outfile: path.join(payloadDir, "server.cjs"),
    external: ["playwright", "node:sqlite"],
    define: { "import.meta.url": '""' },
    logLevel: "warning",
    metafile: true,
    legalComments: "none",
  });
  void result;

  // 2. The console and the knowledge base, laid out exactly as `resource()` expects.
  copyDir(path.join(repoDir, "web"), path.join(payloadDir, "web"));
  copyDir(path.join(repoDir, "knowledge"), path.join(payloadDir, "knowledge"));
  fs.rmSync(path.join(payloadDir, "web", "node_modules"), { recursive: true, force: true });

  // 3. Playwright as a real package, without its postinstall: the browser is
  //    fetched on the machine that will actually run it, not on the builder.
  fs.writeFileSync(
    path.join(payloadDir, "package.json"),
    JSON.stringify({ name: "foreman-payload", private: true, version: pkg.version, dependencies: { playwright: playwrightVersion } }, null, 2),
  );
  execFileSync("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], {
    cwd: payloadDir,
    stdio: "inherit",
  });
  fs.rmSync(path.join(payloadDir, "node_modules", ".bin"), { recursive: true, force: true });
  fs.rmSync(path.join(payloadDir, "package-lock.json"), { force: true });

  // 4. What this build is, so the launcher can tell whether the copy on disk is current.
  fs.writeFileSync(
    path.join(payloadDir, "foreman.json"),
    JSON.stringify({ version: pkg.version, builtAt: new Date().toISOString(), node: process.version, playwright: playwrightVersion }, null, 2),
  );

  const archive = packDir(payloadDir);
  const archivePath = path.join(outDir, "payload.tar.gz");
  fs.writeFileSync(archivePath, archive);
  const sha = crypto.createHash("sha256").update(archive).digest("hex");
  fs.writeFileSync(path.join(outDir, "payload.sha256"), `${sha}  payload.tar.gz\n`);

  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  console.log(`payload ${pkg.version}: ${archivePath} (${mb(archive.length)}, sha256 ${sha.slice(0, 16)}…)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
