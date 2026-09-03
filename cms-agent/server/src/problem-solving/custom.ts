import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Playbook } from "./types.js";

/**
 * Promoted playbooks live in knowledge/playbooks.custom.json so they survive
 * restarts and can be edited by hand or through the review screen. They are
 * loaded alongside the seeded PLAYBOOKS on every diagnosis.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

export function customPlaybooksPath(): string {
  const candidates = [path.join(here, "../../knowledge/playbooks.custom.json"), path.join(here, "../knowledge/playbooks.custom.json"), path.resolve("knowledge/playbooks.custom.json")];
  return candidates.find((p) => fs.existsSync(path.dirname(p))) ?? candidates[0];
}

export interface CustomPlaybook {
  id: string; title: string; domain: Playbook["domain"]; symptoms: string[]; prior: number;
  checks: { id: string; question: string; lrPass: number; lrFail: number }[]; resolution: string[]; verify: string;
  escalate?: { to: string; include: string[] }; promotedFrom?: string; promotedAt?: string; promotedBy?: string;
}

export function loadCustomPlaybooks(): Playbook[] {
  const p = customPlaybooksPath();
  if (!fs.existsSync(p)) return [];
  try {
    const list = JSON.parse(fs.readFileSync(p, "utf8")) as CustomPlaybook[];
    return list.map((c) => ({ id: c.id, title: c.title, domain: c.domain ?? "learned", symptoms: c.symptoms, prior: c.prior, checks: c.checks.map((k) => ({ ...k })), resolution: c.resolution, verify: c.verify, escalate: c.escalate }));
  } catch {
    return [];
  }
}

export function saveCustomPlaybooks(list: CustomPlaybook[]): void {
  fs.writeFileSync(customPlaybooksPath(), JSON.stringify(list, null, 2));
}

export function readCustomPlaybooks(): CustomPlaybook[] {
  const p = customPlaybooksPath();
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, "utf8")) as CustomPlaybook[]; } catch { return []; }
}
