/**
 * Turn the Foreman app icon into a Windows .ico for the executable.
 *
 * An .ico is a tiny header plus image data, and since Vista that data may be a
 * PNG as-is — so no image library is needed to make one, and the icon on the
 * taskbar is the same mark as the icon on his phone.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = path.resolve(serverDir, "..");

/** A dimension of 256 or more is written as 0 in the directory entry. */
const dim = (n: number) => (n >= 256 ? 0 : n);

export function ico(images: { png: Buffer; size: number }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries: Buffer[] = [];
  for (const { png, size } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(dim(size), 0);
    e.writeUInt8(dim(size), 1);
    e.writeUInt8(0, 2); // colours in palette: 0 for true colour
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

function main(): void {
  const sources = [
    { file: path.join(repoDir, "web", "assets", "icon-192.png"), size: 192 },
    { file: path.join(repoDir, "web", "assets", "icon-512.png"), size: 256 },
  ].filter((s) => fs.existsSync(s.file));
  if (!sources.length) throw new Error("no app icons found in web/assets");
  const out = path.join(serverDir, "build", "foreman.ico");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, ico(sources.map((s) => ({ png: fs.readFileSync(s.file), size: s.size }))));
  console.log(`icon: ${out} (${sources.length} sizes)`);
}

if (process.argv[1] && path.resolve(process.argv[1]).includes("build-icon")) main();
