import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { packDir } from "../src/pack/tar.js";
import {
  clearRunning, compareVersions, ensureInstalled, ensureSettings, formatEnvFile, installedVersion,
  layout, noteRunning, parseEnvFile, pruneOldVersions, readRunning, versionDir,
} from "../src/launcher/install.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "foreman-install-"));

/** A payload with just enough in it to look like the real thing. */
function payload(version: string, marker = "ok"): Buffer {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "web"), { recursive: true });
  fs.writeFileSync(path.join(dir, "server.cjs"), `// ${marker}`);
  fs.writeFileSync(path.join(dir, "web", "index.html"), "<h1>Foreman</h1>");
  fs.writeFileSync(path.join(dir, "foreman.json"), JSON.stringify({ version }));
  return packDir(dir);
}

test("a first run creates the folders and a strong access token", () => {
  const l = layout(tmp());
  const settings = ensureSettings(l);
  assert.ok(fs.existsSync(l.data) && fs.existsSync(l.logs) && fs.existsSync(l.browsers));
  assert.ok(settings.CMS_AGENT_TOKEN.length >= 20, "token must clear the length the tunnel guard demands");
  assert.equal(settings.PORT, "8787");
});

test("the token is generated once and kept", () => {
  const l = layout(tmp());
  const first = ensureSettings(l).CMS_AGENT_TOKEN;
  assert.equal(ensureSettings(l).CMS_AGENT_TOKEN, first);
});

test("a token too weak for the tunnel guard is replaced", () => {
  const l = layout(tmp());
  ensureSettings(l);
  fs.writeFileSync(l.settings, "CMS_AGENT_TOKEN=short\n");
  assert.ok(ensureSettings(l).CMS_AGENT_TOKEN.length >= 20);
});

test("settings written by hand survive a restart", () => {
  const l = layout(tmp());
  ensureSettings(l);
  fs.appendFileSync(l.settings, 'ANTHROPIC_API_KEY="sk-ant-typed-by-hand"\nPORT=9000\n');
  const again = ensureSettings(l);
  assert.equal(again.ANTHROPIC_API_KEY, "sk-ant-typed-by-hand");
  assert.equal(again.PORT, "9000");
});

test("env files round-trip", () => {
  const values = { CMS_AGENT_TOKEN: "abc", WORKSPACE_DIR: "C:\\Users\\Jacques\\Foreman" };
  assert.deepEqual(parseEnvFile(formatEnvFile(values, ["a comment"])), values);
});

test("installing puts the program on disk and records the version", () => {
  const l = layout(tmp());
  const first = ensureInstalled(l, payload("1.0.0"), "1.0.0");
  assert.equal(first.installed, true);
  assert.equal(installedVersion(l), "1.0.0");
  assert.ok(fs.existsSync(path.join(first.dir, "server.cjs")));
});

test("a second run of the same version does not reinstall", () => {
  const l = layout(tmp());
  ensureInstalled(l, payload("1.0.0"), "1.0.0");
  assert.equal(ensureInstalled(l, payload("1.0.0"), "1.0.0").installed, false);
});

test("an update replaces the program but never the data", () => {
  const l = layout(tmp());
  ensureInstalled(l, payload("1.0.0", "old"), "1.0.0");
  fs.writeFileSync(path.join(l.data, "cms-agent.db"), "Jacques's tasks");
  ensureInstalled(l, payload("1.1.0", "new"), "1.1.0");
  assert.equal(installedVersion(l), "1.1.0");
  assert.match(fs.readFileSync(path.join(versionDir(l, "1.1.0"), "server.cjs"), "utf8"), /new/);
  assert.equal(fs.readFileSync(path.join(l.data, "cms-agent.db"), "utf8"), "Jacques's tasks");
});

test("a payload that is not Foreman is refused, leaving the old version in place", () => {
  const l = layout(tmp());
  ensureInstalled(l, payload("1.0.0"), "1.0.0");
  const junk = tmp();
  fs.writeFileSync(path.join(junk, "readme.txt"), "not a program");
  assert.throws(() => ensureInstalled(l, packDir(junk), "9.9.9"), /server\.cjs/);
  assert.equal(installedVersion(l), "1.0.0");
});

test("half-written installs are not run", () => {
  const l = layout(tmp());
  ensureInstalled(l, payload("1.0.0"), "1.0.0");
  fs.rmSync(path.join(versionDir(l, "1.0.0"), "server.cjs"));
  assert.equal(installedVersion(l), undefined, "a version without a server is not installed");
});

test("older versions are cleaned up, the previous one kept", () => {
  const l = layout(tmp());
  for (const v of ["1.0.0", "1.1.0", "1.2.0", "1.10.0"]) ensureInstalled(l, payload(v), v);
  pruneOldVersions(l);
  assert.deepEqual(fs.readdirSync(l.versions).sort(), ["1.10.0", "1.2.0"]);
});

test("versions compare numerically, not alphabetically", () => {
  assert.ok(compareVersions("1.10.0", "1.9.0") > 0);
  assert.ok(compareVersions("2.0.0", "1.99.99") > 0);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
});

test("the running note is how a second double-click finds the first copy", () => {
  const l = layout(tmp());
  ensureSettings(l);
  assert.equal(readRunning(l), undefined);
  noteRunning(l, { port: 8791, pid: 42, version: "1.0.0", startedAt: new Date().toISOString() });
  assert.equal(readRunning(l)?.port, 8791);
  clearRunning(l);
  assert.equal(readRunning(l), undefined);
});

test("a corrupt running note is ignored rather than crashing the launcher", () => {
  const l = layout(tmp());
  ensureSettings(l);
  fs.writeFileSync(l.running, "{ not json");
  assert.equal(readRunning(l), undefined);
});
