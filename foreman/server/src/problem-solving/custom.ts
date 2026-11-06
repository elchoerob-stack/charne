import fs from "node:fs";
import type { Playbook } from "./types.js";
import path from "node:path";
import { dataDir } from "../paths.js";

/**
 * Promoted playbooks live in the data folder, not next to the program, so they
 * survive restarts *and* updates: an update replaces Foreman's own files
 * wholesale, and anything Jacques promoted would go with them otherwise. They
 * are loaded alongside the seeded PLAYBOOKS on every diagnosis.
 */

export function customPlaybooksPath(): string {
  return path.join(dataDir(), "playbooks.custom.json");
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
