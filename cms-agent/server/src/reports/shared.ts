import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

/** CMS Systems corporate identity (CMS eco, 2026 guide). */
export const CI = {
  blue: "#31459C", turquoise: "#00AEED", red: "#FD4545", black: "#2E2E2E", grey: "#585858", cool: "#B2B2B2", light: "#D8D8D8", white: "#FFFFFF",
  lightBlue: "#98A2CD", lightTurquoise: "#7FD6F6", lightRed: "#FEA2A2",
  font: `Roboto, "Arial Nova", Arial, "Helvetica Neue", sans-serif`,
};

/** Status colours from the workshop dashboard convention. */
export const STATUS_COLOURS: Record<string, string> = {
  Closed: "#27ae60", Confirmed: "#2980b9", "In Progress": "#e67e22", "Carried-Over": "#8e44ad", Delayed: "#e74c3c", Unknown: "#95a5a6",
};

const here = path.dirname(fileURLToPath(import.meta.url));

let logoCache: string | undefined;
/** CMS eco full-colour logo as a data URL (embedded so reports work offline). */
export function logoDataUrl(): string {
  if (logoCache !== undefined) return logoCache;
  const candidates = [path.join(here, "../../../web/assets/cms-eco-logo-full-colour.png"), path.join(here, "../../web/assets/cms-eco-logo-full-colour.png"), path.resolve("../web/assets/cms-eco-logo-full-colour.png")];
  const p = candidates.find((c) => fs.existsSync(c));
  logoCache = p ? `data:image/png;base64,${fs.readFileSync(p).toString("base64")}` : "";
  return logoCache;
}

export type Row = Record<string, unknown>;

export function readWorkbook(buf: Buffer): XLSX.WorkBook {
  return XLSX.read(buf, { type: "buffer", cellDates: true });
}

export function sheetRows(wb: XLSX.WorkBook, name: string): Row[] {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json<Row>(ws, { defval: null, raw: true });
}

/** Find the column whose lower-cased header contains one of the candidates (in priority order). */
export function findCol(headers: string[], candidates: string[]): string | undefined {
  const lower = headers.map((h) => [h, String(h).toLowerCase().trim()] as const);
  for (const c of candidates) {
    const exact = lower.find(([, l]) => l === c);
    if (exact) return exact[0];
  }
  for (const c of candidates) {
    const partial = lower.find(([, l]) => l.includes(c));
    if (partial) return partial[0];
  }
  return undefined;
}

export function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

export function num(v: unknown): number {
  if (typeof v === "number") return v;
  const n = parseFloat(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function asDate(v: unknown): Date | undefined {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d, d.H, d.M, d.S));
  }
  const s = str(v);
  if (!s) return undefined;
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s) || /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(s);
  if (m) {
    const [a, b, c] = m.slice(1).map(Number);
    const d = m[0].startsWith(String(a).padStart(4, "0")) && String(a).length === 4 ? new Date(Date.UTC(a, b - 1, c)) : new Date(Date.UTC(c, b - 1, a));
    if (!isNaN(d.getTime())) return d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
export const fmtDate = (d?: Date) => (d ? d.toISOString().slice(0, 10) : "");

/** Common HTML shell with CMS CI, embedded logo and a tiny sortable-table helper. */
export function htmlShell(title: string, subtitle: string, body: string, extraCss = ""): string {
  const logo = logoDataUrl();
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
:root{--blue:${CI.blue};--turq:${CI.turquoise};--red:${CI.red};--ink:${CI.black};--grey:${CI.grey};--line:${CI.light};--soft:#F4F6FB}
*{box-sizing:border-box}body{margin:0;background:#fff;color:var(--ink);font:14px/1.5 ${CI.font}}
header{display:flex;align-items:center;gap:18px;padding:16px 24px;border-bottom:3px solid var(--blue)}
header img{height:44px}header h1{font-size:20px;margin:0;color:var(--blue)}header p{margin:0;color:var(--grey);font-size:12.5px}
main{padding:18px 24px;max-width:1400px;margin:0 auto}
h2{color:var(--blue);font-size:15px;letter-spacing:.04em;text-transform:uppercase;margin:26px 0 10px;border-left:4px solid var(--turq);padding-left:10px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.card{border:1px solid var(--line);border-radius:8px;padding:12px 14px;background:#fff}.card small{display:block;color:var(--grey);font-size:11px;letter-spacing:.08em;text-transform:uppercase}
.card b{font-size:26px;color:var(--blue)}.card span{display:block;font-size:12px;color:var(--grey)}
.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px}th{background:var(--blue);color:#fff;text-align:left;padding:8px 10px;position:sticky;top:0;cursor:pointer;white-space:nowrap}
th.n,td.n{text-align:right;font-variant-numeric:tabular-nums}td{padding:7px 10px;border-bottom:1px solid var(--line)}tr:nth-child(even) td{background:#FAFBFD}
.bar{display:inline-block;height:8px;border-radius:4px;background:var(--turq);vertical-align:middle;margin-right:6px}
.tag{display:inline-block;padding:1px 8px;border-radius:999px;color:#fff;font-size:11px}
.heat td.h{text-align:center;color:#fff;font-weight:600}
.insights{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px}.insight{border-left:4px solid var(--turq);background:var(--soft);padding:10px 12px;border-radius:0 8px 8px 0}
.insight.warn{border-color:var(--red)}.insight b{color:var(--blue)}
footer{padding:16px 24px;color:var(--grey);font-size:11px;border-top:1px solid var(--line);margin-top:28px}
.pill{font-size:11px;padding:1px 7px;border-radius:999px;background:var(--soft);color:var(--blue)}
@media print{th{position:static}}
${extraCss}
</style></head><body>
<header>${logo ? `<img src="${logo}" alt="CMS eco">` : `<b style="color:var(--blue);font-size:22px">CMS eco</b>`}<div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div></header>
<main>${body}</main>
<footer>Generated by Foreman · ${new Date().toLocaleString("en-ZA")} · CMS Systems</footer>
<script>
document.querySelectorAll("table[data-sort]").forEach(t=>{t.querySelectorAll("th").forEach((th,i)=>th.onclick=()=>{const tb=t.tBodies[0];const rows=[...tb.rows];const asc=th.dataset.asc!=="1";th.dataset.asc=asc?"1":"0";
rows.sort((a,b)=>{const x=a.cells[i].dataset.v??a.cells[i].textContent,y=b.cells[i].dataset.v??b.cells[i].textContent;const nx=parseFloat(x),ny=parseFloat(y);const c=(!isNaN(nx)&&!isNaN(ny))?nx-ny:String(x).localeCompare(String(y));return asc?c:-c});rows.forEach(r=>tb.appendChild(r))}))});
</script></body></html>`;
}
