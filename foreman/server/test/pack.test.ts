import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { packDir, safeJoin, unpack, walk } from "../src/pack/tar.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "foreman-pack-"));

function tree(root: string) {
  fs.mkdirSync(path.join(root, "web", "assets"), { recursive: true });
  fs.mkdirSync(path.join(root, "node_modules", "playwright", "lib"), { recursive: true });
  fs.writeFileSync(path.join(root, "server.cjs"), "console.log('hi')");
  fs.writeFileSync(path.join(root, "web", "index.html"), "<h1>Foreman</h1>");
  fs.writeFileSync(path.join(root, "web", "assets", "logo.svg"), "<svg/>");
  fs.writeFileSync(path.join(root, "node_modules", "playwright", "lib", "index.js"), "module.exports = {}");
}

test("a packed directory unpacks byte-for-byte", () => {
  const src = tmp(), dest = tmp();
  tree(src);
  unpack(packDir(src), dest);
  for (const item of walk(src)) {
    const to = path.join(dest, item.rel);
    assert.ok(fs.existsSync(to), `${item.rel} is missing`);
    if (!item.dir) assert.deepEqual(fs.readFileSync(to), fs.readFileSync(item.abs));
  }
});

test("paths longer than a tar name field survive", () => {
  const src = tmp(), dest = tmp();
  const deep = path.join(src, "node_modules", "playwright-core", "lib", "server", "registry", "very", "deeply", "nested", "directory", "chain");
  fs.mkdirSync(deep, { recursive: true });
  const long = path.join(deep, "a-file-with-a-genuinely-long-name-to-push-past-one-hundred-characters.js");
  fs.writeFileSync(long, "payload");
  unpack(packDir(src), dest);
  assert.equal(fs.readFileSync(path.join(dest, path.relative(src, long)), "utf8"), "payload");
});

test("packing the same tree twice gives the same bytes", () => {
  const src = tmp();
  tree(src);
  assert.deepEqual(packDir(src), packDir(src));
});

test("an archive cannot write outside its destination", () => {
  assert.throws(() => safeJoin("/install", "../../etc/passwd"), /unsafe path/);
  assert.throws(() => safeJoin("/install", "/etc/passwd"), /unsafe path/);
  assert.throws(() => safeJoin("/install", "C:\\Windows\\System32\\x.dll"), /unsafe path/);
  assert.equal(safeJoin("/install", "./web/index.html"), path.join("/install", "web", "index.html"));
});

test("symlinks are left out rather than followed", () => {
  const src = tmp(), dest = tmp();
  tree(src);
  fs.symlinkSync(path.join(src, "server.cjs"), path.join(src, "node_modules", ".bin-link"));
  unpack(packDir(src), dest);
  assert.ok(!fs.existsSync(path.join(dest, "node_modules", ".bin-link")));
  assert.ok(fs.existsSync(path.join(dest, "server.cjs")));
});
