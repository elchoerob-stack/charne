import * as XLSX from "xlsx";
import { asDate, esc, findCol, fmtDate, htmlShell, readWorkbook, sheetRows, str, CI, type Row } from "./shared.js";

/* ── Blacklists (from the campaign-contact-validation rule set) ────────── */

export const PLACEHOLDER_LOCALS = new Set(["no", "none", "na", "n/a", "test", "noemail", "nomail", "nil", "xxx", "abc", "unknown", "dummy", "tbc", "tba", "notgiven", "nothing", "blank", "empty", "declined", "refused", "donotcontact", "noreply", "noemailaddress", "email", "info@", "x", "xx", "aaa", "asd", "qwerty", "nomail", "no-email", "no_email"]);
export const JUNK_DOMAINS = new Set([
  "no.com", "abc.com", "example.com", "test.com", "none.com", "na.com", "email.com", "mail.com.", "xxx.com", "noemail.com", "nomail.com", "aaa.com",
  "gamil.com", "gmial.com", "gmaill.com", "gmail.co", "gmail.con", "gmail.cm", "gmal.com", "gmail.om", "gmai.com", "gimail.com", "gnail.com", "gmail.coma",
  "hotmail.con", "hotmial.com", "hotmal.com", "hotmail.co", "hotmai.com", "hotmaill.com", "yahoo.con", "yaho.com", "yahooo.com", "yahoo.co", "outlook.con", "outlok.com", "icloud.con", "icoud.com",
  "telkomsa.ne", "telkomsa.nt", "vodamail.co.z", "vodamail.com", "mweb.co.z", "mweb.com", "webmail.co.z",
]);
export const MISTYPED_TLDS = new Set(["con", "comm", "cmo", "ocm", "cim", "cpm", "coom", "ccom", "c0m", "cm", "om", "vom", "xom", "dom", "coma", "zaa", "zar", "ne", "nt", "nte", "cop", "copm", "ccm", "cok", "col", "cmm", "cpom"]);
export const NAME_PLACEHOLDERS = new Set(["-no surname-", "(pty)", "ltd", "(pty) ltd", "no name", "n/a", "unknown", "xxx", ".", "-", "na", "none", "test", "no surname", "nosurname", "customer", "client"]);
export const TLD_WHITELIST = new Set(("com net org za co.za org.za net.za gov.za ac.za edu.za web.za nom.za mil.za school.za law.za info biz io me tv mobi name pro co uk de fr nl be it es pt se no dk fi ie ch at pl cz gr ru ua tr il ae sa qa in pk lk bd cn jp kr hk sg my th vn ph id au nz ca us mx br ar cl pe ve na bw zw zm mz mw ls sz ao ke ug tz rw ng gh sn ci cm eg ma tn dz ly mu sc mg re io app dev cloud online site website store shop tech digital email live news blog xyz club africa global int eu asia travel media agency group ltd co.uk com.au co.nz com.br co.in co.ke co.bw co.zw com.na co.mz co.ug co.tz ac.uk gov.uk org.uk").split(/\s+/));

/* ── Validation ───────────────────────────────────────────────────────── */

export interface MobileCheck { digits: string; msisdn: string; valid: boolean; reason: string }
export function validateMobile(raw: unknown): MobileCheck {
  const s = str(raw);
  if (!s) return { digits: "", msisdn: "", valid: false, reason: "Blank" };
  const digits = s.replace(/[+\s\-().]/g, "");
  if (!/^\d+$/.test(digits)) return { digits, msisdn: "", valid: false, reason: "Not RSA format" };
  let msisdn = "";
  if (digits.length === 10 && digits.startsWith("0")) msisdn = "27" + digits.slice(1);
  else if (digits.length === 11 && digits.startsWith("27")) msisdn = digits;
  else if (digits.length === 12 && digits.startsWith("027")) msisdn = "27" + digits.slice(3);
  else if (digits.length === 9 && /^[678]/.test(digits)) msisdn = "27" + digits;
  else return { digits, msisdn: "", valid: false, reason: "Wrong length" };
  const third = msisdn[2];
  if (!"678".includes(third)) return { digits, msisdn, valid: false, reason: /^[1-5]/.test(third) ? "Landline" : "Not a mobile prefix" };
  if (/^27(\d)\1{8}$/.test(msisdn)) return { digits, msisdn, valid: false, reason: "Repeated-digit number" };
  return { digits, msisdn, valid: true, reason: "" };
}

export interface EmailCheck { clean: string; local: string; domain: string; tld: string; valid: boolean; reason: string; warning: string }
export function validateEmail(raw: unknown): EmailCheck {
  const clean = str(raw).toLowerCase();
  const out: EmailCheck = { clean, local: "", domain: "", tld: "", valid: false, reason: "", warning: "" };
  if (!clean) return { ...out, reason: "Blank" };
  const ats = clean.split("@").length - 1;
  if (ats !== 1) return { ...out, reason: "Missing or multiple @" };
  const [local, domain] = clean.split("@");
  out.local = local; out.domain = domain;
  if (!local) return { ...out, reason: "Missing or multiple @" };
  if (!domain.includes(".")) return { ...out, reason: "No valid domain or TLD" };
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  out.tld = tld;
  if (tld.length < 2 || /^\d+$/.test(tld)) return { ...out, reason: "No valid domain or TLD" };
  if (/[\s,;]/.test(clean) || clean.includes("..") || /^[.-]/.test(local) || /^[.-]/.test(domain) || !/^[a-z0-9._%+'-]+$/.test(local) || !/^[a-z0-9.-]+$/.test(domain)) return { ...out, reason: "Invalid characters" };
  if (MISTYPED_TLDS.has(tld)) return { ...out, reason: "Mistyped TLD" };
  if (PLACEHOLDER_LOCALS.has(local) || /^(no|none|na|test|xxx|abc)\d*$/.test(local)) return { ...out, reason: "Placeholder address" };
  if (JUNK_DOMAINS.has(domain)) return { ...out, reason: "Bad or mistyped domain" };
  out.valid = true;
  const suffix2 = domain.split(".").slice(-2).join(".");
  if (!TLD_WHITELIST.has(tld) && !TLD_WHITELIST.has(suffix2)) out.warning = "TLD outside whitelist";
  return out;
}

export function dataWarnings(name: string, surname: string, email: EmailCheck): string[] {
  const w: string[] = [];
  const n = name.toLowerCase().trim(), s = surname.toLowerCase().trim();
  if (!n || NAME_PLACEHOLDERS.has(n)) w.push("Placeholder name");
  if (!s || NAME_PLACEHOLDERS.has(s) || s.length < 2) w.push("No usable surname");
  if (/\b(pty|ltd|cc|npc|inc)\b/i.test(`${name} ${surname}`)) w.push("Company/business record");
  if (email.warning) w.push(email.warning);
  return w;
}

/* ── Parsing ──────────────────────────────────────────────────────────── */

export interface Contact {
  sourceRow: number; dealer: string; dealerCode: string; prospectId: string; guid: string; name: string; surname: string; cell: string; email: string; language: string;
  newUsed: string; make: string; model: string; range: string; created?: Date; updated?: Date; status: string; lostReason: string; method: string; salesPerson: string; referral: string;
  mobile: MobileCheck; emailCheck: EmailCheck; warnings: string[]; campaignReady: boolean;
}

const CCOLS = {
  dealer: ["dealer name", "dealer"], dealerCode: ["cms dealer code", "dealer code"], prospectId: ["prospect id", "prospectid"], guid: ["contact guid", "guid"],
  name: ["first name", "name"], surname: ["surname", "last name"], cell: ["cell number", "cell", "mobile", "cellphone", "phone"], email: ["email address", "email", "e-mail"],
  language: ["language"], newUsed: ["prospect new/used", "new/used", "new used"], make: ["prospect make", "make"], model: ["prospect model", "model"], range: ["model range"],
  created: ["date prospect created", "created"], updated: ["date prospect updated", "updated"], status: ["prospect status", "status"], lostReason: ["lost reason"],
  method: ["method of contact", "method"], salesPerson: ["sales person", "salesperson"], referral: ["referral source", "referral"],
};

export interface ParsedContacts { contacts: Contact[]; sheet: string; sheets: string[]; distinctTabs: string[]; mapping: Record<string, string>; unmapped: string[] }

export function parseContactsWorkbook(buf: Buffer): ParsedContacts {
  const wb = readWorkbook(buf);
  const sheets = wb.SheetNames;
  // The main sheet is the widest one; "distinct" tabs (SELECT DISTINCT pulls) are narrow and must never be used for validation.
  let best = sheets[0], bestCols = -1;
  const distinctTabs: string[] = [];
  for (const s of sheets) {
    const ws = wb.Sheets[s];
    const ref = ws?.["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : undefined;
    const cols = ref ? ref.e.c - ref.s.c + 1 : 0;
    if (cols > bestCols) { best = s; bestCols = cols; }
    if (cols <= 2 && /distinct|unique|cell|email|mobile/i.test(s)) distinctTabs.push(s);
  }
  const rows = sheetRows(wb, best);
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const mapping: Record<string, string> = {};
  for (const [k, cands] of Object.entries(CCOLS)) { const h = findCol(headers, cands); if (h) mapping[k] = h; }
  // "name" must not accidentally map to "Dealer Name" or "Full Name"
  if (mapping.name && /dealer/i.test(mapping.name)) { const h = findCol(headers.filter((x) => !/dealer/i.test(x)), ["first name", "name"]); if (h) mapping.name = h; else delete mapping.name; }
  const get = (r: Row, k: keyof typeof CCOLS) => (mapping[k] ? r[mapping[k]] : null);
  const contacts: Contact[] = rows.map((r, i) => {
    const name = str(get(r, "name")), surname = str(get(r, "surname"));
    const mobile = validateMobile(get(r, "cell"));
    const emailCheck = validateEmail(get(r, "email"));
    return {
      sourceRow: i + 2, dealer: str(get(r, "dealer")), dealerCode: str(get(r, "dealerCode")), prospectId: str(get(r, "prospectId")), guid: str(get(r, "guid")), name, surname,
      cell: str(get(r, "cell")), email: str(get(r, "email")), language: str(get(r, "language")), newUsed: str(get(r, "newUsed")), make: str(get(r, "make")), model: str(get(r, "model")), range: str(get(r, "range")),
      created: asDate(get(r, "created")), updated: asDate(get(r, "updated")), status: str(get(r, "status")) || "Unknown", lostReason: str(get(r, "lostReason")), method: str(get(r, "method")), salesPerson: str(get(r, "salesPerson")), referral: str(get(r, "referral")),
      mobile, emailCheck, warnings: dataWarnings(name, surname, emailCheck), campaignReady: mobile.valid && emailCheck.valid,
    };
  });
  return { contacts, sheet: best, sheets, distinctTabs, mapping, unmapped: Object.keys(CCOLS).filter((k) => !mapping[k]) };
}

/* ── Computation ──────────────────────────────────────────────────────── */

export interface CampaignReport {
  title: string; generatedAt: string;
  totals: { records: number; validMobile: number; validEmail: number; campaignReady: number; rejectedMobile: number; rejectedEmail: number; cleaned: number; smsList: number; emailList: number };
  mobileRejects: Record<string, number>; emailRejects: Record<string, number>; warnings: Record<string, number>;
  statuses: { status: string; total: number; validMobile: number; validEmail: number; campaignReady: number; inCleaned: number }[];
  dealers: { dealer: string; total: number; validMobile: number; validEmail: number; campaignReady: number }[];
  cleaned: Contact[]; sms: { msisdn: string; name: string; surname: string; status: string; dealer: string; sourceRow: number }[]; emails: { email: string; name: string; surname: string; status: string; dealer: string; sourceRow: number }[];
  dateRange: { from?: string; to?: string };
  reconcile: { check: string; ok: boolean; detail: string }[];
  meta: { sheet: string; sheets: string[]; distinctTabs: string[]; mapping: Record<string, string>; unmapped: string[] };
}

const tally = (items: string[]) => items.reduce<Record<string, number>>((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {});

export function computeCampaignReport(p: ParsedContacts, opts: { title?: string } = {}): CampaignReport {
  const c = p.contacts;
  const byUpdatedDesc = (a: Contact, b: Contact) => (b.updated?.getTime() ?? 0) - (a.updated?.getTime() ?? 0);

  // Cleaned Data: campaign-ready, unique per MSISDN keeping most recently updated, then drop repeat e-mails.
  const ready = c.filter((x) => x.campaignReady).sort(byUpdatedDesc);
  const seenM = new Set<string>(), seenE = new Set<string>();
  const cleaned: Contact[] = [];
  for (const x of ready) {
    if (seenM.has(x.mobile.msisdn) || seenE.has(x.emailCheck.clean)) continue;
    seenM.add(x.mobile.msisdn); seenE.add(x.emailCheck.clean); cleaned.push(x);
  }
  // Send list: each channel deduped independently (wider than the both-channel set).
  const smsSeen = new Set<string>(); const sms: CampaignReport["sms"] = [];
  for (const x of [...c].filter((y) => y.mobile.valid).sort(byUpdatedDesc)) if (!smsSeen.has(x.mobile.msisdn)) { smsSeen.add(x.mobile.msisdn); sms.push({ msisdn: x.mobile.msisdn, name: x.name, surname: x.surname, status: x.status, dealer: x.dealer, sourceRow: x.sourceRow }); }
  const emSeen = new Set<string>(); const emails: CampaignReport["emails"] = [];
  for (const x of [...c].filter((y) => y.emailCheck.valid).sort(byUpdatedDesc)) if (!emSeen.has(x.emailCheck.clean)) { emSeen.add(x.emailCheck.clean); emails.push({ email: x.emailCheck.clean, name: x.name, surname: x.surname, status: x.status, dealer: x.dealer, sourceRow: x.sourceRow }); }

  const cleanedRows = new Set(cleaned.map((x) => x.sourceRow));
  const statuses = Object.entries(tally(c.map((x) => x.status))).map(([status, total]) => {
    const g = c.filter((x) => x.status === status);
    return { status, total, validMobile: g.filter((x) => x.mobile.valid).length, validEmail: g.filter((x) => x.emailCheck.valid).length, campaignReady: g.filter((x) => x.campaignReady).length, inCleaned: g.filter((x) => cleanedRows.has(x.sourceRow)).length };
  }).sort((a, b) => b.total - a.total);
  const dealers = Object.entries(tally(c.map((x) => x.dealer || "—"))).map(([dealer, total]) => {
    const g = c.filter((x) => (x.dealer || "—") === dealer);
    return { dealer, total, validMobile: g.filter((x) => x.mobile.valid).length, validEmail: g.filter((x) => x.emailCheck.valid).length, campaignReady: g.filter((x) => x.campaignReady).length };
  }).sort((a, b) => b.total - a.total);

  const totals = {
    records: c.length, validMobile: c.filter((x) => x.mobile.valid).length, validEmail: c.filter((x) => x.emailCheck.valid).length, campaignReady: ready.length,
    rejectedMobile: c.filter((x) => !x.mobile.valid).length, rejectedEmail: c.filter((x) => !x.emailCheck.valid).length, cleaned: cleaned.length, smsList: sms.length, emailList: emails.length,
  };
  const mobileRejects = tally(c.filter((x) => !x.mobile.valid).map((x) => x.mobile.reason));
  const emailRejects = tally(c.filter((x) => !x.emailCheck.valid).map((x) => x.emailCheck.reason));
  const warnings = tally(c.flatMap((x) => x.warnings));

  const reconcile: CampaignReport["reconcile"] = [
    { check: "valid + rejected mobile = records", ok: totals.validMobile + totals.rejectedMobile === totals.records, detail: `${totals.validMobile} + ${totals.rejectedMobile} = ${totals.records}` },
    { check: "valid + rejected email = records", ok: totals.validEmail + totals.rejectedEmail === totals.records, detail: `${totals.validEmail} + ${totals.rejectedEmail} = ${totals.records}` },
    { check: "status table totals = records", ok: statuses.reduce((s, x) => s + x.total, 0) === totals.records, detail: `${statuses.reduce((s, x) => s + x.total, 0)} = ${totals.records}` },
    { check: "mobile reject reasons sum = rejected", ok: Object.values(mobileRejects).reduce((a, b) => a + b, 0) === totals.rejectedMobile, detail: `${Object.values(mobileRejects).reduce((a, b) => a + b, 0)} = ${totals.rejectedMobile}` },
    { check: "every SMS number is 27 + mobile prefix, 11 digits", ok: sms.every((s) => /^27[678]\d{8}$/.test(s.msisdn)), detail: `${sms.length} numbers` },
    { check: "every e-mail has one @ and a dotted domain", ok: emails.every((e) => /^[^@]+@[^@]+\.[^@]+$/.test(e.email)), detail: `${emails.length} addresses` },
    { check: "no duplicates in SMS list", ok: new Set(sms.map((s) => s.msisdn)).size === sms.length, detail: "" },
    { check: "no duplicates in e-mail list", ok: new Set(emails.map((e) => e.email)).size === emails.length, detail: "" },
    { check: "cleaned ≤ campaign-ready", ok: cleaned.length <= ready.length, detail: `${cleaned.length} ≤ ${ready.length}` },
  ];

  const dates = c.map((x) => x.updated).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime());
  return {
    title: opts.title ?? "Campaign Contact Validation", generatedAt: new Date().toISOString(), totals, mobileRejects, emailRejects, warnings, statuses, dealers, cleaned, sms, emails,
    dateRange: { from: fmtDate(dates[0]), to: fmtDate(dates.at(-1)) }, reconcile,
    meta: { sheet: p.sheet, sheets: p.sheets, distinctTabs: p.distinctTabs, mapping: p.mapping, unmapped: p.unmapped },
  };
}

/* ── Outputs ──────────────────────────────────────────────────────────── */

export function renderCampaignHtml(r: CampaignReport): string {
  const t = r.totals;
  const cards = [["Records", t.records, "in source"], ["Valid mobiles", t.validMobile, `${t.rejectedMobile} rejected`], ["Valid e-mails", t.validEmail, `${t.rejectedEmail} rejected`], ["Campaign ready", t.campaignReady, "valid mobile AND e-mail"], ["Cleaned data", t.cleaned, "deduped both-channel"], ["SMS list", t.smsList, "unique valid mobiles"], ["E-mail list", t.emailList, "unique valid e-mails"]]
    .map(([k, v, s]) => `<div class="card"><small>${k}</small><b>${v}</b><span>${s}</span></div>`).join("");
  const statusRows = r.statuses.map((s) => `<tr><td>${esc(s.status)}</td><td class="n">${s.total}</td><td class="n">${s.validMobile}</td><td class="n">${s.validEmail}</td><td class="n">${s.campaignReady}</td><td class="n">${s.inCleaned}</td></tr>`).join("");
  const dealerRows = r.dealers.map((d) => `<tr><td>${esc(d.dealer)}</td><td class="n">${d.total}</td><td class="n">${d.validMobile}</td><td class="n">${d.validEmail}</td><td class="n">${d.campaignReady}</td></tr>`).join("");
  const rej = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${v}</td></tr>`).join("");
  const rec = r.reconcile.map((x) => `<div class="insight${x.ok ? "" : " warn"}"><b>${x.ok ? "✔" : "✖"}</b> ${esc(x.check)} ${esc(x.detail)}</div>`).join("");
  const body = `
<h2>Summary</h2><div class="cards">${cards}</div>
${r.meta.distinctTabs.length ? `<div class="insight warn" style="margin-top:12px"><b>Note:</b> the workbook contains ${esc(r.meta.distinctTabs.join(", "))} tab(s). These are SELECT DISTINCT pulls, not validated lists, and were ignored. Validation is by format rules only.</div>` : ""}
<h2>Prospect status breakdown</h2><div class="wrap"><table data-sort><thead><tr><th>Prospect status</th><th class="n">Records</th><th class="n">Valid mobile</th><th class="n">Valid e-mail</th><th class="n">Campaign ready</th><th class="n">In cleaned data</th></tr></thead><tbody>${statusRows}</tbody></table></div>
${r.dealers.length > 1 ? `<h2>By dealer</h2><div class="wrap"><table data-sort><thead><tr><th>Dealer</th><th class="n">Records</th><th class="n">Valid mobile</th><th class="n">Valid e-mail</th><th class="n">Campaign ready</th></tr></thead><tbody>${dealerRows}</tbody></table></div>` : ""}
<h2>Rejection reasons</h2><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px"><div class="wrap"><table><thead><tr><th>Mobile</th><th class="n">Count</th></tr></thead><tbody>${rej(r.mobileRejects) || "<tr><td colspan=2>None</td></tr>"}</tbody></table></div><div class="wrap"><table><thead><tr><th>E-mail</th><th class="n">Count</th></tr></thead><tbody>${rej(r.emailRejects) || "<tr><td colspan=2>None</td></tr>"}</tbody></table></div><div class="wrap"><table><thead><tr><th>Data warnings (flag only)</th><th class="n">Count</th></tr></thead><tbody>${rej(r.warnings) || "<tr><td colspan=2>None</td></tr>"}</tbody></table></div></div>
<h2>Reconciliation</h2><div class="insights">${rec}</div>
<p class="pill">Source sheet: ${esc(r.meta.sheet)} · updated ${r.dateRange.from} → ${r.dateRange.to}${r.meta.unmapped.length ? ` · columns not found: ${esc(r.meta.unmapped.join(", "))}` : ""}</p>`;
  return htmlShell(r.title, `CMS Marketing Contacts · ${r.totals.records} records · generated ${new Date(r.generatedAt).toLocaleString("en-ZA")}`, body);
}

/** Five-sheet workbook: Prospect Summary, Original Data (+ helper columns), Cleaned Data, Validation, Send List. */
export function renderCampaignWorkbook(r: CampaignReport, original: Contact[]): Buffer {
  const wb = XLSX.utils.book_new();
  const aoa = (rows: unknown[][]) => XLSX.utils.aoa_to_sheet(rows);

  const summary: unknown[][] = [
    ["CMS Systems — Campaign Contact Validation"], [r.title], [`Generated ${new Date(r.generatedAt).toLocaleString("en-ZA")}`], [],
    ["Records", r.totals.records], ["Valid mobiles", r.totals.validMobile], ["Valid e-mails", r.totals.validEmail], ["Campaign ready (both)", r.totals.campaignReady], ["Cleaned data rows", r.totals.cleaned], ["SMS list", r.totals.smsList], ["E-mail list", r.totals.emailList], [],
    ["Prospect status", "Records", "Valid mobile", "Valid e-mail", "Campaign ready", "In cleaned data"],
    ...r.statuses.map((s) => [s.status, s.total, s.validMobile, s.validEmail, s.campaignReady, s.inCleaned]),
    ["Total", r.totals.records, r.totals.validMobile, r.totals.validEmail, r.totals.campaignReady, r.totals.cleaned], [],
    ["Method: format-rule validation only (no list membership). SMS and e-mail lists are deduped per channel and are wider than the both-channel Cleaned Data set."],
  ];
  XLSX.utils.book_append_sheet(wb, aoa(summary), "Prospect Summary");

  const srcHead = ["Source Row", "Dealer", "CMS Dealer Code", "Prospect ID", "Contact GUID", "Name", "Surname", "Cell Number", "Email", "Language", "New/Used", "Make", "Model", "Model Range", "Date Created", "Date Updated", "Prospect Status", "Lost Reason", "Method Of Contact", "Sales Person", "Referral Source",
    "Cell Digits", "Cell MSISDN (27)", "Valid RSA Mobile", "Cell Reject Reason", "Email Clean", "Email Local", "Email Domain", "Email TLD", "Valid Email", "Email Reject Reason", "Campaign Ready", "Data Warnings"];
  const srcRows = original.map((x) => [x.sourceRow, x.dealer, x.dealerCode, x.prospectId, x.guid, x.name, x.surname, x.cell, x.email, x.language, x.newUsed, x.make, x.model, x.range, fmtDate(x.created), fmtDate(x.updated), x.status, x.lostReason, x.method, x.salesPerson, x.referral,
    x.mobile.digits, x.mobile.msisdn, x.mobile.valid ? "Yes" : "No", x.mobile.reason, x.emailCheck.clean, x.emailCheck.local, x.emailCheck.domain, x.emailCheck.tld, x.emailCheck.valid ? "Yes" : "No", x.emailCheck.reason, x.campaignReady ? "Yes" : "No", x.warnings.join("; ")]);
  const ws2 = aoa([srcHead, ...srcRows]); ws2["!freeze"] = { xSplit: 0, ySplit: 1 } as never;
  XLSX.utils.book_append_sheet(wb, ws2, "Original Data");

  const clHead = ["Source Row", "Dealer", "Prospect ID", "Name", "Surname", "Mobile (27)", "Mobile (0)", "Email", "Prospect Status", "Make", "Model", "Date Updated", "Data Warnings"];
  const clRows = r.cleaned.map((x) => [x.sourceRow, x.dealer, x.prospectId, x.name, x.surname, x.mobile.msisdn, "0" + x.mobile.msisdn.slice(2), x.emailCheck.clean, x.status, x.make, x.model, fmtDate(x.updated), x.warnings.join("; ")]);
  XLSX.utils.book_append_sheet(wb, aoa([clHead, ...clRows]), "Cleaned Data");

  const list = (s: Set<string>) => [...s];
  const val: unknown[][] = [
    ["Validation rules"],
    ["Mobile: strip + - ( ) . and spaces; accept 0XXXXXXXXX, 27XXXXXXXXX, 027XXXXXXXXX or 9 digits starting 6/7/8; valid only if 11 digits, starts 27, third digit 6/7/8, not a repeated-digit number."],
    ["Email: trim + lower-case; exactly one @; non-empty local part; dotted domain with a TLD of ≥2 non-numeric characters; no spaces , ; or ..; local/domain not starting with . or -; local not in the placeholder list; domain not in the junk list; TLD not in the mistyped list. TLD outside the whitelist is a warning only."],
    ["Campaign Ready = valid mobile AND valid e-mail. Warnings never reject."], [],
    ["Mobile reject reasons", "Count", "", "E-mail reject reasons", "Count", "", "Data warnings", "Count"],
  ];
  const mr = Object.entries(r.mobileRejects), er = Object.entries(r.emailRejects), wr = Object.entries(r.warnings);
  for (let i = 0; i < Math.max(mr.length, er.length, wr.length); i++) val.push([mr[i]?.[0] ?? "", mr[i]?.[1] ?? "", "", er[i]?.[0] ?? "", er[i]?.[1] ?? "", "", wr[i]?.[0] ?? "", wr[i]?.[1] ?? ""]);
  val.push([], ["Placeholder local parts", "Junk / mistyped domains", "Mistyped TLDs", "Name placeholders", "Recognised TLDs"]);
  const L = [list(PLACEHOLDER_LOCALS), list(JUNK_DOMAINS), list(MISTYPED_TLDS), list(NAME_PLACEHOLDERS), list(TLD_WHITELIST)];
  for (let i = 0; i < Math.max(...L.map((l) => l.length)); i++) val.push(L.map((l) => l[i] ?? ""));
  val.push([], ["Reconciliation", "OK", "Detail"], ...r.reconcile.map((x) => [x.check, x.ok ? "Yes" : "NO", x.detail]));
  XLSX.utils.book_append_sheet(wb, aoa(val), "Validation");

  const n = Math.max(r.sms.length, r.emails.length);
  const send: unknown[][] = [["SMS — Mobile (27)", "Name", "Surname", "Prospect Status", "Dealer", "", "E-mail", "Name", "Surname", "Prospect Status", "Dealer"]];
  for (let i = 0; i < n; i++) { const s = r.sms[i], e = r.emails[i]; send.push([s?.msisdn ?? "", s?.name ?? "", s?.surname ?? "", s?.status ?? "", s?.dealer ?? "", "", e?.email ?? "", e?.name ?? "", e?.surname ?? "", e?.status ?? "", e?.dealer ?? ""]); }
  XLSX.utils.book_append_sheet(wb, aoa(send), "Send List");

  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer);
}

export function renderSendCsv(r: CampaignReport, channel: "sms" | "email"): string {
  const q = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  if (channel === "sms") return ["msisdn,name,surname,status,dealer", ...r.sms.map((s) => [s.msisdn, s.name, s.surname, s.status, s.dealer].map(q).join(","))].join("\n");
  return ["email,name,surname,status,dealer", ...r.emails.map((e) => [e.email, e.name, e.surname, e.status, e.dealer].map(q).join(","))].join("\n");
}

export function summariseCampaign(r: CampaignReport) {
  return { title: r.title, totals: r.totals, statuses: r.statuses, dealers: r.dealers.slice(0, 20), mobileRejects: r.mobileRejects, emailRejects: r.emailRejects, warnings: r.warnings, reconcile: r.reconcile, dateRange: r.dateRange, meta: r.meta, ci: CI.blue };
}
