import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

/**
 * A minimal tar reader and writer.
 *
 * Foreman ships its own program files inside the executable and unpacks them on
 * first run, so it needs one archive format it can both write at build time and
 * read at install time. Node has gzip built in but no archiver, and pulling in
 * a package would mean the launcher — the one component that must work on a
 * machine with nothing installed — had dependencies of its own.
 *
 * This handles what a program payload contains: regular files and directories,
 * long names via the GNU `L` extension. Symlinks, devices and sparse files are
 * skipped rather than half-supported; nothing in the payload uses them.
 */

const BLOCK = 512;
const zeros = (n: number) => Buffer.alloc(n, 0);

function checksum(header: Buffer): number {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : header[i];
  return sum;
}

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width - 1, "0") + "\0";
}

function header(name: string, size: number, mode: number, type: "0" | "5" | "L", mtime: number): Buffer {
  const h = zeros(BLOCK);
  h.write(name.slice(0, 100), 0, "utf8");
  h.write(octal(mode & 0o7777, 8), 100);
  h.write(octal(0, 8), 108); // uid
  h.write(octal(0, 8), 116); // gid
  h.write(octal(size, 12), 124);
  h.write(octal(Math.floor(mtime / 1000), 12), 136);
  h.write("        ", 148); // checksum placeholder: eight spaces
  h.write(type, 156);
  h.write("ustar\0" + "00", 257);
  h.write(octal(checksum(h), 8).slice(0, 7) + "\0", 148);
  return h;
}

const pad = (size: number) => (size % BLOCK === 0 ? 0 : BLOCK - (size % BLOCK));

function entry(name: string, body: Buffer, mode: number, type: "0" | "5", mtime: number): Buffer[] {
  const parts: Buffer[] = [];
  const encoded = Buffer.from(name, "utf8");
  if (encoded.length > 99) {
    // GNU long name: a pseudo-entry whose body is the real path.
    const withNul = Buffer.concat([encoded, zeros(1)]);
    parts.push(header("././@LongLink", withNul.length, 0o644, "L", mtime), withNul, zeros(pad(withNul.length)));
  }
  parts.push(header(name, body.length, mode, type, mtime));
  if (body.length) parts.push(body, zeros(pad(body.length)));
  return parts;
}

/** Every path in the directory, relative and posix-separated, files and dirs, sorted for a reproducible archive. */
export function walk(dir: string, prefix = ""): { rel: string; abs: string; dir: boolean }[] {
  const out: { rel: string; abs: string; dir: boolean }[] = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      out.push({ rel, abs, dir: true });
      out.push(...walk(abs, rel));
    } else if (st.isFile()) {
      out.push({ rel, abs, dir: false });
    }
  }
  return out;
}

/** Pack a directory into a gzipped tar. Mtimes are fixed so two builds of the same tree match. */
export function packDir(dir: string, mtime = 0): Buffer {
  const parts: Buffer[] = [];
  for (const item of walk(dir)) {
    if (item.dir) parts.push(...entry(`${item.rel}/`, Buffer.alloc(0), 0o755, "5", mtime));
    else {
      const body = fs.readFileSync(item.abs);
      const exec = (fs.statSync(item.abs).mode & 0o111) !== 0;
      parts.push(...entry(item.rel, body, exec ? 0o755 : 0o644, "0", mtime));
    }
  }
  parts.push(zeros(BLOCK * 2)); // end-of-archive
  return zlib.gzipSync(Buffer.concat(parts), { level: 9 });
}

/** Reject anything that would write outside the destination: absolute paths, drive letters, `..`. */
export function safeJoin(dest: string, rel: string): string {
  const cleaned = rel.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
  if (!cleaned || cleaned.startsWith("/") || /^[A-Za-z]:/.test(cleaned) || cleaned.split("/").includes("..")) {
    throw new Error(`refusing to unpack unsafe path: ${rel}`);
  }
  return path.join(dest, ...cleaned.split("/"));
}

/** Unpack a gzipped tar into a directory, creating it if needed. */
export function unpack(archive: Buffer, dest: string): string[] {
  const buf = zlib.gunzipSync(archive);
  const written: string[] = [];
  let offset = 0;
  let longName: string | undefined;
  fs.mkdirSync(dest, { recursive: true });
  while (offset + BLOCK <= buf.length) {
    const head = buf.subarray(offset, offset + BLOCK);
    offset += BLOCK;
    if (head.every((b) => b === 0)) break;
    const rawName = head.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const size = parseInt(head.subarray(124, 136).toString("utf8").replace(/[^0-7]/g, "") || "0", 8);
    const mode = parseInt(head.subarray(100, 108).toString("utf8").replace(/[^0-7]/g, "") || "644", 8);
    const type = String.fromCharCode(head[156]) || "0";
    const body = buf.subarray(offset, offset + size);
    offset += size + pad(size);

    if (type === "L") { longName = body.toString("utf8").replace(/\0+$/, ""); continue; }
    const name = longName ?? rawName;
    longName = undefined;
    if (!name) continue;

    const target = safeJoin(dest, name);
    if (type === "5" || name.endsWith("/")) {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }
    if (type !== "0" && type !== "\0") continue; // not a regular file: skip
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
    if (process.platform !== "win32" && (mode & 0o111) !== 0) fs.chmodSync(target, 0o755);
    written.push(name);
  }
  return written;
}
