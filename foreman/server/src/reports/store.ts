import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { db, newId, now } from "../db.js";
import { computeWorkshopReport, parseWorkshopWorkbook, renderWorkshopHtml, summariseWorkshop, type WorkshopReport } from "./workshop.js";
import { computeCampaignReport, parseContactsWorkbook, renderCampaignHtml, renderCampaignWorkbook, renderSendCsv, summariseCampaign, type CampaignReport } from "./campaign.js";

const dataDir = path.dirname(config.dbPath);
const filesDir = path.join(dataDir, "files");
const reportsDir = path.join(dataDir, "reports");
fs.mkdirSync(filesDir, { recursive: true });
fs.mkdirSync(reportsDir, { recursive: true });

export type ReportKind = "workshop" | "campaign";

export interface FileRow { id: string; name: string; kind: string | null; mime: string | null; size: number; path: string; dealer: string | null; created_at: string }
export interface ReportRow { id: string; kind: ReportKind; title: string; file_id: string | null; dealer: string | null; summary: string; html_path: string | null; xlsx_path: string | null; created_at: string }

const safeName = (n: string) => n.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "file";

/** Guess what an uploaded workbook is from its name and sheet names. */
export function guessKind(name: string, buf: Buffer): "workshop" | "contacts" | "other" {
  if (/contact|prospect|marketing|campaign/i.test(name)) return "contacts";
  if (/workshop|booking|dashboard|mtd/i.test(name)) return "workshop";
  try {
    const parsed = parseWorkshopWorkbook(buf);
    if (parsed.mapping.status && (parsed.mapping.job || parsed.mapping.advisor || parsed.mapping.dealer)) return "workshop";
    const contacts = parseContactsWorkbook(buf);
    if (contacts.mapping.cell || contacts.mapping.email) return "contacts";
  } catch { /* fall through */ }
  return "other";
}

export function storeFile(name: string, buf: Buffer, opts: { mime?: string; dealer?: string; kind?: string } = {}): FileRow {
  const id = newId("file");
  const p = path.join(filesDir, `${id}_${safeName(name)}`);
  fs.writeFileSync(p, buf);
  const row: FileRow = { id, name, kind: opts.kind ?? guessKind(name, buf), mime: opts.mime ?? null, size: buf.length, path: p, dealer: opts.dealer ?? null, created_at: now() };
  db.prepare("INSERT INTO files (id, name, kind, mime, size, path, dealer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(row.id, row.name, row.kind, row.mime, row.size, row.path, row.dealer, row.created_at);
  return row;
}

export function listFiles(): FileRow[] {
  return db.prepare("SELECT * FROM files ORDER BY created_at DESC LIMIT 100").all() as unknown as FileRow[];
}
export function getFile(id: string): FileRow | undefined {
  return db.prepare("SELECT * FROM files WHERE id = ?").get(id) as FileRow | undefined;
}

export interface BuildResult { report: ReportRow; summary: unknown; warnings: string[] }

/** Build a report from a stored file. Kind defaults to the file's guessed kind. */
export function buildReport(fileId: string, kind?: ReportKind, opts: { title?: string; dealer?: string } = {}): BuildResult {
  const file = getFile(fileId);
  if (!file) throw new Error(`No file ${fileId}`);
  const buf = fs.readFileSync(file.path);
  const k: ReportKind = kind ?? (file.kind === "contacts" ? "campaign" : "workshop");
  const id = newId("rep");
  const warnings: string[] = [];
  let title: string, summary: unknown, html: string, xlsx: Buffer | undefined;

  if (k === "workshop") {
    const parsed = parseWorkshopWorkbook(buf);
    if (!parsed.bookings.length) throw new Error(`No booking rows found in sheet "${parsed.sheet}" (sheets: ${parsed.sheets.join(", ")})`);
    if (parsed.unmapped.includes("status")) warnings.push("No status/progress column found: close rates will be 0.");
    if (parsed.unmapped.length) warnings.push(`Columns not found: ${parsed.unmapped.join(", ")}.`);
    const report: WorkshopReport = computeWorkshopReport(parsed, { title: opts.title });
    title = report.title; summary = summariseWorkshop(report); html = renderWorkshopHtml(report);
  } else {
    const parsed = parseContactsWorkbook(buf);
    if (!parsed.contacts.length) throw new Error(`No contact rows found in sheet "${parsed.sheet}"`);
    if (!parsed.mapping.cell && !parsed.mapping.email) throw new Error("Neither a cell number nor an e-mail column was found.");
    if (parsed.distinctTabs.length) warnings.push(`Ignored distinct-value tabs (not validated lists): ${parsed.distinctTabs.join(", ")}.`);
    if (parsed.unmapped.length) warnings.push(`Columns not found: ${parsed.unmapped.join(", ")}.`);
    const report: CampaignReport = computeCampaignReport(parsed, { title: opts.title ?? `Campaign list · ${file.name.replace(/\.[^.]+$/, "")}` });
    title = report.title; summary = summariseCampaign(report); html = renderCampaignHtml(report); xlsx = renderCampaignWorkbook(report, parsed.contacts);
    fs.writeFileSync(path.join(reportsDir, `${id}_sms.csv`), renderSendCsv(report, "sms"));
    fs.writeFileSync(path.join(reportsDir, `${id}_email.csv`), renderSendCsv(report, "email"));
    for (const c of report.reconcile) if (!c.ok) warnings.push(`Reconciliation failed: ${c.check} (${c.detail})`);
  }

  const htmlPath = path.join(reportsDir, `${id}.html`);
  fs.writeFileSync(htmlPath, html);
  let xlsxPath: string | null = null;
  if (xlsx) { xlsxPath = path.join(reportsDir, `${id}.xlsx`); fs.writeFileSync(xlsxPath, xlsx); }
  const row: ReportRow = { id, kind: k, title, file_id: file.id, dealer: opts.dealer ?? file.dealer, summary: JSON.stringify({ ...(summary as object), warnings }), html_path: htmlPath, xlsx_path: xlsxPath, created_at: now() };
  db.prepare("INSERT INTO reports (id, kind, title, file_id, dealer, summary, html_path, xlsx_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(row.id, row.kind, row.title, row.file_id, row.dealer, row.summary, row.html_path, row.xlsx_path, row.created_at);
  return { report: row, summary: JSON.parse(row.summary), warnings };
}

export function listReports(kind?: ReportKind): Omit<ReportRow, "summary">[] {
  const rows = (kind ? db.prepare("SELECT * FROM reports WHERE kind = ? ORDER BY created_at DESC LIMIT 100").all(kind) : db.prepare("SELECT * FROM reports ORDER BY created_at DESC LIMIT 100").all()) as unknown as ReportRow[];
  return rows.map(({ summary: _s, ...r }) => r);
}
export function getReport(id: string): ReportRow | undefined {
  return db.prepare("SELECT * FROM reports WHERE id = ?").get(id) as ReportRow | undefined;
}
export function reportArtifact(id: string, kind: "html" | "xlsx" | "sms.csv" | "email.csv"): string | undefined {
  const r = getReport(id);
  if (!r) return undefined;
  if (kind === "html") return r.html_path ?? undefined;
  if (kind === "xlsx") return r.xlsx_path ?? undefined;
  const p = path.join(reportsDir, `${id}_${kind === "sms.csv" ? "sms" : "email"}.csv`);
  return fs.existsSync(p) ? p : undefined;
}
