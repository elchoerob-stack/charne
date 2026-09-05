/**
 * Build the launcher — the part that becomes Foreman.exe.
 *
 * It is bundled on its own, with no dependencies at all, because it is the one
 * component that runs before anything is installed. The payload built by
 * build-payload.ts is embedded into the executable alongside it by the
 * packaging step (Node's single-executable support), or pointed at with
 * FOREMAN_PAYLOAD when testing without building an executable.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(serverDir, "build");
const pkg = JSON.parse(fs.readFileSync(path.join(serverDir, "package.json"), "utf8"));

async function main(): Promise<void> {
  fs.mkdirSync(outDir, { recursive: true });
  await build({
    entryPoints: [path.join(serverDir, "src", "launcher", "main.ts")],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    outfile: path.join(outDir, "launcher.cjs"),
    logLevel: "warning",
    legalComments: "none",
  });
  fs.writeFileSync(path.join(outDir, "version.txt"), `${pkg.version}\n`);

  // Node's single-executable configuration. `useSnapshot` stays off: the
  // launcher opens files and sockets at startup, which a snapshot cannot carry.
  fs.writeFileSync(
    path.join(outDir, "sea-config.json"),
    JSON.stringify(
      {
        main: "launcher.cjs",
        output: "sea-prep.blob",
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: false,
        assets: { "payload.tar.gz": "payload.tar.gz", "version.txt": "version.txt" },
      },
      null,
      2,
    ),
  );
  const size = fs.statSync(path.join(outDir, "launcher.cjs")).size;
  console.log(`launcher ${pkg.version}: ${path.join(outDir, "launcher.cjs")} (${(size / 1024).toFixed(0)} kB)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
