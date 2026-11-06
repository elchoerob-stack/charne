import fs from "node:fs";
import path from "node:path";
import { runShotsDir } from "../tasks/runner.js";
import type { Step } from "./types.js";

/** Where a step's preview screenshot is on disk, if it has one. File names are checked so a step can never point outside the screenshots folder. */
export function previewFile(step: Pick<Step, "preview">): string | undefined {
  const name = step.preview?.image;
  if (!name || !/^[A-Za-z0-9_.-]+$/.test(name)) return undefined;
  const p = path.join(runShotsDir, name);
  return fs.existsSync(p) ? p : undefined;
}

const MAX_IMAGE_BYTES = 900_000;

/** Screenshots of what is waiting for approval, as MCP image blocks, so Claude can see the form it is about to ask you to approve. */
export function previewImages(steps: Step[]): { type: "image"; data: string; mimeType: string }[] {
  const out: { type: "image"; data: string; mimeType: string }[] = [];
  for (const s of steps) {
    if (s.status !== "awaiting_approval" || s.previewState !== "ready") continue;
    const f = previewFile(s);
    if (!f) continue;
    const buf = fs.readFileSync(f);
    if (buf.length <= MAX_IMAGE_BYTES) out.push({ type: "image", data: buf.toString("base64"), mimeType: /\.png$/i.test(f) ? "image/png" : "image/jpeg" });
  }
  return out;
}
