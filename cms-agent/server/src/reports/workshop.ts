import { asDate, esc, findCol, fmtDate, htmlShell, isoWeek, num, pct, readWorkbook, sheetRows, str, STATUS_COLOURS, type Row } from "./shared.js";

/* ── Canonical schema ─────────────────────────────────────────────────── */

export interface Booking {
  dealer: string; job: string; dms: string; created?: Date; createdBy: string; booked?: Date; original?: Date;
  customer: string; reg: string; vehicle: string; description: string; status: string; advisor: string; technician: string;
  duration: number; smsCount: number; kmsIn: number; stationsChecked: number; trackingPct: number; tracks: Record<string, boolean>;
}

const COLS: Record<keyof Omit<Booking, "tracks">, string[]> = {
  dealer: ["workshop / franchise", "workshop/franchise", "franchise", "dealer", "workshop", "lane", "brand"],
  job: ["job id", "job #", "job#", "job no", "job number", "booking id", "booking #"],
  dms: ["dms booking id", "dms #", "dms no", "dms"],
  created: ["date created", "created date", "created on"],
  createdBy: ["created by", "user"],
  booked: ["booking date", "booked for", "appointment date", "booked"],
  original: ["original booking date"],
  customer: ["client full name", "client name", "customer", "client"],
  reg: ["vehicle reg", "vehicle registration", "reg no", "registration", "reg"],
  vehicle: ["vehicle make/model", "make/model", "vehicle"],
  description: ["job description", "description"],
  status: ["progress", "status"],
  advisor: ["service advisor", "advisor"],
  technician: ["technician"],
  duration: ["duration"],
  smsCount: ["sms count", "sms"],
  kmsIn: ["kms in", "km in", "odometer"],
  stationsChecked: ["total stations checked", "stations checked"],
  trackingPct: ["tracking complete %", "tracking %", "tracking complete"],
};

const STATUS_MAP: Record<string, string> = {
  closed: "Closed", confirmed: "Confirmed", inprogress: "In Progress", "in progress": "In Progress", "in-progress": "In Progress",
  "carried-over": "Carried-Over", carriedover: "Carried-Over", "carried over": "Carried-Over", delayed: "Delayed",
};
export const STATUSES = ["Closed", "Confirmed", "In Progress", "Carried-Over", "Delayed"] as const;

export const TRACK_PHASE: Record<string, string[]> = {
  "Check-In": ["Car in", "Vehicle on Premises", "Pre Inspection"],
  "Job Work": ["Job Start", "Work Started", "Job Complete", "Job Finish", "Job Finnished", "Work Finished", "Completed"],
  Wash: ["Pre Wash", "Wash Bay", "Washbay", "Wash", "Que Washbay"],
  Admin: ["Quote", "Quoting", "Awaiting Authorization", "Authorization", "Awaiting approval", "Parts Booked Out", "Continue Work"],
  Handover: ["Tested", "Test Drive", "Invoiced", "Ready to collect", "Ready for collection", "Ready for Collection", "Carry Over", "Collected"],
};

/** Shorten the long legal-entity franchise names that appear in CMS exports. */
export function displayName(ws: string): string {
  const m = /\bta\s+(.+)$/i.exec(ws);
  let s = m ? m[1] : ws;
  s = s.replace(/\s*\((pty|proprietary)\)\s*(ltd|limited)?\.?/gi, "").replace(/\s+ltd\.?$/i, "").replace(/\s+/g, " ").trim();
  return s || ws;
}

/* ── Parsing ──────────────────────────────────────────────────────────── */

export interface ParsedWorkshop {
  bookings: Booking[];
  sheet: string;
  sheets: string[];
  mapping: Record<string, string>;
  unmapped: string[];
  preInspection: { workshop: Record<string, { done: number; pct: number }>; advisor: Record<string, { done: number; pct: number }> };
}

export function parseWorkshopWorkbook(buf: Buffer): ParsedWorkshop {
  const wb = readWorkbook(buf);
  const sheets = wb.SheetNames;
  const preferred = sheets.find((s) => /bookings/i.test(s)) ?? sheets.find((s) => !/summary|dashboard|sheet1/i.test(s)) ?? sheets[0];
  const rows = sheetRows(wb, preferred);
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const mapping: Record<string, string> = {};
  for (const [canon, cands] of Object.entries(COLS)) {
    const h = findCol(headers, cands);
    if (h) mapping[canon] = h;
  }
  const trackCols = headers.filter((h) => /^track:/i.test(h) && !/track by/i.test(h));
  const get = (r: Row, k: keyof typeof COLS) => (mapping[k] ? r[mapping[k]] : null);

  const seen = new Set<string>();
  const bookings: Booking[] = [];
  for (const r of rows) {
    const key = JSON.stringify(Object.values(r));
    if (seen.has(key)) continue; // exact duplicate rows
    seen.add(key);
    const rawStatus = str(get(r, "status"));
    const tracks: Record<string, boolean> = {};
    for (const c of trackCols) tracks[c.replace(/^track:\s*/i, "").trim()] = /^yes|^true|^1/i.test(str(r[c]));
    bookings.push({
      dealer: str(get(r, "dealer")) || "All", job: str(get(r, "job")), dms: str(get(r, "dms")), created: asDate(get(r, "created")),
      createdBy: str(get(r, "createdBy")) || "Unknown", booked: asDate(get(r, "booked")), original: asDate(get(r, "original")),
      customer: str(get(r, "customer")), reg: str(get(r, "reg")).toUpperCase().replace(/\s+/g, ""), vehicle: str(get(r, "vehicle")),
      description: str(get(r, "description")), status: STATUS_MAP[rawStatus.toLowerCase()] ?? (rawStatus ? rawStatus : "Unknown"),
      advisor: str(get(r, "advisor")), technician: str(get(r, "technician")), duration: num(get(r, "duration")),
      smsCount: num(get(r, "smsCount")), kmsIn: num(get(r, "kmsIn")), stationsChecked: num(get(r, "stationsChecked")), trackingPct: num(get(r, "trackingPct")), tracks,
    });
  }

  const preInspection: ParsedWorkshop["preInspection"] = { workshop: {}, advisor: {} };
  const wsSheet = sheets.find((s) => /summary by workshop/i.test(s));
  if (wsSheet) for (const r of sheetRows(wb, wsSheet)) {
    const h = Object.keys(r);
    const name = str(r[findCol(h, ["workshop name", "workshop"]) ?? ""]);
    if (name) preInspection.workshop[name] = { done: num(r[findCol(h, ["pre-inspection done", "pre-insp done"]) ?? ""]), pct: num(r[findCol(h, ["pre-insp %", "pre-inspection %"]) ?? ""]) };
  }
  const saSheet = sheets.find((s) => /summary by advisor/i.test(s));
  if (saSheet) for (const r of sheetRows(wb, saSheet)) {
    const h = Object.keys(r);
    const ws = str(r[findCol(h, ["workshop"]) ?? ""]);
    const adv = str(r[findCol(h, ["service advisor", "advisor"]) ?? ""]);
    if (ws && adv) preInspection.advisor[`${ws}|${adv}`] = { done: num(r[findCol(h, ["pre-insp done", "pre-inspection done"]) ?? ""]), pct: num(r[findCol(h, ["pre-insp %"]) ?? ""]) };
  }

  return { bookings, sheet: preferred, sheets, mapping, unmapped: Object.keys(COLS).filter((k) => !mapping[k]), preInspection };
}

/* ── KPIs ─────────────────────────────────────────────────────────────── */

export interface StatusCounts { Closed: number; Confirmed: number; "In Progress": number; "Carried-Over": number; Delayed: number; Unknown: number; total: number; closeRate: number }

export interface DealerStats extends StatusCounts {
  dealer: string; name: string; share: number; smsPct: number; dmsPct: number; kmsPct: number; trackPct: number; avgTracking: number;
  preInspDone: number; preInspPct: number; coaVehicles: number; coaExcess: number; coaMax: number; oldestActiveDays: number; score: number;
}
export interface AdvisorStats extends StatusCounts {
  advisor: string; dealer: string; name: string; rank: number; smsPct: number; dmsPct: number; kmsPct: number; trackPct: number; preInspDone: number; preInspPct: number; coaExcess: number;
}
export interface UserStats extends StatusCounts { user: string; primaryDealer: string; rank: number; dealers: number }

export interface WorkshopReport {
  title: string; generatedAt: string; dateRange: { from?: string; to?: string }; refDate: string;
  totals: StatusCounts & { dealers: number; users: number; advisors: number };
  dealers: DealerStats[]; advisors: AdvisorStats[]; users: UserStats[];
  crosstab: { users: string[]; dealers: string[]; counts: number[][] };
  weeks: { week: number; total: number; closed: number; carried: number; inProgress: number; confirmed: number; delayed: number }[];
  carryOver: { dealer: string; reg: string; vehicle: string; customer: string; advisor: string; count: number; excess: number; statuses: string[] }[];
  tracking: { dealer: string; phase: string; station: string; count: number; pct: number }[];
  insights: { text: string; warn?: boolean }[];
  meta: { sheet: string; sheets: string[]; mapping: Record<string, string>; unmapped: string[]; rows: number };
}

function countStatuses(rows: Booking[]): StatusCounts {
  const c: StatusCounts = { Closed: 0, Confirmed: 0, "In Progress": 0, "Carried-Over": 0, Delayed: 0, Unknown: 0, total: rows.length, closeRate: 0 };
  for (const r of rows) {
    if ((STATUSES as readonly string[]).includes(r.status)) c[r.status as (typeof STATUSES)[number]] += 1;
    else c.Unknown += 1;
  }
  const known = c.total - c.Unknown;
  c.closeRate = pct(c.Closed, known);
  return c;
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) { const k = key(r); (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
  return m;
}

function dealerScore(d: Omit<DealerStats, "score">): number {
  let s = Math.min(d.closeRate, 100) * 0.3 + Math.min(d.trackPct, 100) * 0.2 + Math.min(d.preInspPct, 100) * 0.15 + Math.min(d.dmsPct, 100) * 0.15 + Math.min(d.smsPct, 100) * 0.1 + Math.min(d.kmsPct, 100) * 0.05;
  const pen = Math.min((d.coaExcess / Math.max(d.total, 1)) * 100, 50) * 0.3;
  return Math.max(0, Math.round(s - pen));
}

export function computeWorkshopReport(parsed: ParsedWorkshop, opts: { title?: string; refDate?: Date } = {}): WorkshopReport {
  const rows = parsed.bookings;
  const dates = rows.map((r) => r.booked ?? r.created).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime());
  const refDate = opts.refDate ?? dates.at(-1) ?? new Date();
  const hasDealerCol = Boolean(parsed.mapping.dealer);

  // Carry-over abuse: same dealer + reg booked ≥ 2 times in the period.
  const carryOver: WorkshopReport["carryOver"] = [];
  for (const [, g] of groupBy(rows.filter((r) => r.reg), (r) => `${r.dealer}|${r.reg}`)) {
    if (g.length < 2) continue;
    const advisors = [...new Set(g.map((r) => r.advisor).filter(Boolean))];
    carryOver.push({ dealer: g[0].dealer, reg: g[0].reg, vehicle: g[0].vehicle.slice(0, 45), customer: g[0].customer.slice(0, 35), advisor: advisors[0] ?? "—", count: g.length, excess: g.length - 1, statuses: g.map((r) => r.status) });
  }
  carryOver.sort((a, b) => b.count - a.count);
  const coaByDealer = groupBy(carryOver, (c) => c.dealer);

  const dealers: DealerStats[] = [];
  const tracking: WorkshopReport["tracking"] = [];
  for (const [dealer, g] of groupBy(rows, (r) => r.dealer)) {
    const c = countStatuses(g);
    const active = g.filter((r) => ["Carried-Over", "In Progress", "Confirmed", "Delayed"].includes(r.status)).map((r) => r.original ?? r.booked).filter((d): d is Date => !!d);
    const oldest = active.length ? Math.min(...active.map((d) => d.getTime())) : undefined;
    const pre = parsed.preInspection.workshop[dealer] ?? parsed.preInspection.workshop[displayName(dealer)];
    const coa = coaByDealer.get(dealer) ?? [];
    const base = {
      ...c, dealer, name: displayName(dealer), share: pct(g.length, rows.length),
      smsPct: pct(g.filter((r) => r.smsCount > 0).length, g.length), dmsPct: pct(g.filter((r) => r.dms).length, g.length),
      kmsPct: pct(g.filter((r) => r.kmsIn > 0).length, g.length), trackPct: pct(g.filter((r) => r.stationsChecked > 0).length, g.length),
      avgTracking: Math.round((g.reduce((s, r) => s + r.trackingPct, 0) / Math.max(g.length, 1)) * 10) / 10,
      preInspDone: pre?.done ?? 0, preInspPct: pre?.pct ?? 0,
      coaVehicles: coa.length, coaExcess: coa.reduce((s, x) => s + x.excess, 0), coaMax: coa.reduce((m, x) => Math.max(m, x.count), 0),
      oldestActiveDays: oldest ? Math.max(0, Math.round((refDate.getTime() - oldest) / 86400000)) : 0,
    };
    dealers.push({ ...base, score: dealerScore(base) });
    for (const [phase, stations] of Object.entries(TRACK_PHASE)) for (const st of stations) {
      const n = g.filter((r) => r.tracks[st]).length;
      if (n) tracking.push({ dealer: displayName(dealer), phase, station: st, count: n, pct: pct(n, g.length) });
    }
  }
  dealers.sort((a, b) => b.total - a.total);
  tracking.sort((a, b) => b.count - a.count);

  const advisors: AdvisorStats[] = [];
  for (const [, g] of groupBy(rows.filter((r) => r.advisor), (r) => `${r.dealer}|${r.advisor}`)) {
    const c = countStatuses(g);
    const pre = parsed.preInspection.advisor[`${g[0].dealer}|${g[0].advisor}`];
    const coa = (coaByDealer.get(g[0].dealer) ?? []).filter((x) => x.advisor === g[0].advisor);
    advisors.push({
      ...c, advisor: g[0].advisor, dealer: g[0].dealer, name: displayName(g[0].dealer), rank: 0,
      smsPct: pct(g.filter((r) => r.smsCount > 0).length, g.length), dmsPct: pct(g.filter((r) => r.dms).length, g.length),
      kmsPct: pct(g.filter((r) => r.kmsIn > 0).length, g.length), trackPct: pct(g.filter((r) => r.stationsChecked > 0).length, g.length),
      preInspDone: pre?.done ?? 0, preInspPct: pre?.pct ?? 0, coaExcess: coa.reduce((s, x) => s + x.excess, 0),
    });
  }
  advisors.sort((a, b) => b.total - a.total || b.closeRate - a.closeRate).forEach((a, i) => (a.rank = i + 1));

  const users: UserStats[] = [];
  for (const [user, g] of groupBy(rows, (r) => r.createdBy)) {
    const byDealer = [...groupBy(g, (r) => r.dealer)].sort((a, b) => b[1].length - a[1].length);
    users.push({ ...countStatuses(g), user, primaryDealer: displayName(byDealer[0][0]), rank: 0, dealers: byDealer.length });
  }
  users.sort((a, b) => b.total - a.total).forEach((u, i) => (u.rank = i + 1));

  const ctUsers = users.map((u) => u.user);
  const ctDealers = dealers.map((d) => d.dealer);
  const crosstab = { users: ctUsers, dealers: ctDealers.map(displayName), counts: ctUsers.map((u) => ctDealers.map((d) => rows.filter((r) => r.createdBy === u && r.dealer === d).length)) };

  const weeks: WorkshopReport["weeks"] = [];
  for (const [w, g] of [...groupBy(rows.filter((r) => r.booked), (r) => String(isoWeek(r.booked!)))].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const c = countStatuses(g);
    weeks.push({ week: Number(w), total: c.total, closed: c.Closed, carried: c["Carried-Over"], inProgress: c["In Progress"], confirmed: c.Confirmed, delayed: c.Delayed });
  }

  const totals = { ...countStatuses(rows), dealers: dealers.length, users: users.length, advisors: advisors.length };

  const insights: WorkshopReport["insights"] = [];
  if (users[0]) insights.push({ text: `Top performer by volume: **${users[0].user}** with ${users[0].total} bookings (${users[0].closeRate}% closed).` });
  const eligible = advisors.filter((a) => a.total >= 5);
  const best = [...eligible].sort((a, b) => b.closeRate - a.closeRate)[0];
  if (best) insights.push({ text: `Best close rate (≥5 jobs): **${best.advisor}** at ${best.name}, ${best.closeRate}% of ${best.total}.` });
  if (dealers[0] && hasDealerCol) insights.push({ text: `Top dealer by volume: **${dealers[0].name}** with ${dealers[0].total} bookings (${dealers[0].share}% of total), close rate ${dealers[0].closeRate}%.` });
  const cross = users.filter((u) => u.dealers > 1).length;
  if (cross) insights.push({ text: `${cross} user(s) create bookings across more than one dealer.` });
  const worstCoa = [...dealers].sort((a, b) => b.coaExcess - a.coaExcess)[0];
  if (worstCoa && worstCoa.coaExcess > 0) insights.push({ warn: true, text: `Carry-over abuse: **${worstCoa.name}** re-booked ${worstCoa.coaVehicles} vehicle(s) ${worstCoa.coaExcess} extra time(s); worst vehicle booked ${worstCoa.coaMax}× (should be Delayed, not daily carry-over).` });
  const zero = advisors.filter((a) => a.total >= 3 && a.Closed === 0);
  if (zero.length) insights.push({ warn: true, text: `${zero.length} advisor(s) with zero closes on ≥3 jobs: ${zero.slice(0, 5).map((a) => `${a.advisor} (${a.name})`).join(", ")}${zero.length > 5 ? "…" : ""}.` });
  const lowDms = dealers.filter((d) => parsed.mapping.dms && d.total >= 10 && d.dmsPct < 50);
  if (lowDms.length) insights.push({ warn: true, text: `Low DMS linkage (<50%): ${lowDms.map((d) => `${d.name} ${d.dmsPct}%`).join(", ")}. Bookings without a DMS ID will not reconcile to Evolve.` });
  const stale = dealers.filter((d) => d.oldestActiveDays > 14);
  if (stale.length) insights.push({ warn: true, text: `Stale active jobs older than 14 days at: ${stale.map((d) => `${d.name} (${d.oldestActiveDays} d)`).join(", ")}.` });
  if (totals.Delayed + totals["Carried-Over"] > 0) insights.push({ text: `${totals["Carried-Over"]} carried-over and ${totals.Delayed} delayed bookings are still open; overall close rate ${totals.closeRate}%.` });

  return {
    title: opts.title ?? (hasDealerCol && dealers.length === 1 ? `${dealers[0].name} Workshop Performance` : "Workshop Performance Dashboard"),
    generatedAt: new Date().toISOString(), dateRange: { from: fmtDate(dates[0]), to: fmtDate(dates.at(-1)) }, refDate: fmtDate(refDate),
    totals, dealers, advisors, users, crosstab, weeks, carryOver, tracking, insights,
    meta: { sheet: parsed.sheet, sheets: parsed.sheets, mapping: parsed.mapping, unmapped: parsed.unmapped, rows: rows.length },
  };
}

/* ── HTML ─────────────────────────────────────────────────────────────── */

const md = (s: string) => esc(s).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
const tag = (status: string) => `<span class="tag" style="background:${STATUS_COLOURS[status] ?? STATUS_COLOURS.Unknown}">${esc(status)}</span>`;
const bar = (p: number) => `<span class="bar" style="width:${Math.max(2, Math.min(100, p))}px"></span>${p}%`;

export function renderWorkshopHtml(r: WorkshopReport): string {
  const t = r.totals;
  const cards = [
    ["Total bookings", t.total, `${r.dateRange.from} → ${r.dateRange.to}`], ["Dealers", t.dealers, ""], ["Users", t.users, `${t.advisors} advisors`],
    ["Closed", t.Closed, `${t.closeRate}% close rate`], ["Confirmed", t.Confirmed, ""], ["In progress", t["In Progress"], ""], ["Carried-over", t["Carried-Over"], ""], ["Delayed", t.Delayed, ""],
  ].map(([k, v, s]) => `<div class="card"><small>${k}</small><b>${v}</b><span>${s}</span></div>`).join("");

  const dealerRows = r.dealers.map((d) => `<tr><td>${esc(d.name)}</td><td class="n">${d.total}</td><td class="n">${d.share}%</td><td class="n">${d.Closed}</td><td class="n">${d.Confirmed}</td><td class="n">${d["In Progress"]}</td><td class="n">${d["Carried-Over"]}</td><td class="n">${d.Delayed}</td><td class="n" data-v="${d.closeRate}">${bar(d.closeRate)}</td><td class="n">${d.dmsPct}%</td><td class="n">${d.smsPct}%</td><td class="n">${d.trackPct}%</td><td class="n">${d.preInspPct}%</td><td class="n">${d.coaExcess}</td><td class="n">${d.oldestActiveDays}</td><td class="n"><b>${d.score}</b></td></tr>`).join("");
  const advisorRows = r.advisors.map((a) => `<tr><td class="n">${a.rank}</td><td>${esc(a.advisor)}</td><td>${esc(a.name)}</td><td class="n">${a.total}</td><td class="n">${a.Closed}</td><td class="n">${a["Carried-Over"]}</td><td class="n">${a.Delayed}</td><td class="n" data-v="${a.closeRate}">${bar(a.closeRate)}</td><td class="n">${a.dmsPct}%</td><td class="n">${a.trackPct}%</td><td class="n">${a.preInspPct}%</td><td class="n">${a.coaExcess}</td></tr>`).join("");
  const userRows = r.users.map((u) => `<tr><td class="n">${u.rank}</td><td>${esc(u.user)}</td><td>${esc(u.primaryDealer)}</td><td class="n">${u.total}</td><td class="n">${u.Closed}</td><td class="n">${u.Confirmed}</td><td class="n">${u["In Progress"]}</td><td class="n">${u["Carried-Over"]}</td><td class="n">${u.Delayed}</td><td class="n" data-v="${u.closeRate}">${bar(u.closeRate)}</td></tr>`).join("");
  const max = Math.max(1, ...r.crosstab.counts.flat());
  const heat = r.crosstab.users.map((u, i) => `<tr><td>${esc(u)}</td>${r.crosstab.counts[i].map((n) => `<td class="h" style="background:rgba(49,69,156,${n ? 0.15 + 0.85 * (n / max) : 0});color:${n / max > 0.5 ? "#fff" : "#2E2E2E"}">${n || ""}</td>`).join("")}</tr>`).join("");
  const coaRows = r.carryOver.slice(0, 60).map((c) => `<tr><td>${esc(displayName(c.dealer))}</td><td>${esc(c.reg)}</td><td>${esc(c.vehicle)}</td><td>${esc(c.customer)}</td><td>${esc(c.advisor)}</td><td class="n">${c.count}</td><td class="n">${c.excess}</td><td>${c.statuses.map(tag).join(" ")}</td></tr>`).join("");
  const weekRows = r.weeks.map((w) => `<tr><td>W${w.week}</td><td class="n">${w.total}</td><td class="n">${w.closed}</td><td class="n">${w.confirmed}</td><td class="n">${w.inProgress}</td><td class="n">${w.carried}</td><td class="n">${w.delayed}</td><td class="n" data-v="${pct(w.closed, w.total)}">${bar(pct(w.closed, w.total))}</td></tr>`).join("");
  const trackRows = r.tracking.slice(0, 80).map((s) => `<tr><td>${esc(s.dealer)}</td><td>${esc(s.phase)}</td><td>${esc(s.station)}</td><td class="n">${s.count}</td><td class="n">${s.pct}%</td></tr>`).join("");

  const body = `
<h2>Key metrics</h2><div class="cards">${cards}</div>
<h2>Quick insights</h2><div class="insights">${r.insights.map((i) => `<div class="insight${i.warn ? " warn" : ""}">${md(i.text)}</div>`).join("") || "<div class='insight'>No insights.</div>"}</div>
${r.meta.mapping.dealer ? `<h2>Dealer performance</h2><div class="wrap"><table data-sort><thead><tr><th>Dealer</th><th class="n">Total</th><th class="n">Share</th><th class="n">Closed</th><th class="n">Conf.</th><th class="n">In prog.</th><th class="n">C/O</th><th class="n">Delayed</th><th class="n">Close rate</th><th class="n">DMS</th><th class="n">SMS</th><th class="n">Tracked</th><th class="n">Pre-insp</th><th class="n">C/O excess</th><th class="n">Oldest active (d)</th><th class="n">Score</th></tr></thead><tbody>${dealerRows}</tbody></table></div>` : ""}
${r.advisors.length ? `<h2>Service advisor performance</h2><div class="wrap"><table data-sort><thead><tr><th class="n">#</th><th>Advisor</th><th>Dealer</th><th class="n">Jobs</th><th class="n">Closed</th><th class="n">C/O</th><th class="n">Delayed</th><th class="n">Close rate</th><th class="n">DMS</th><th class="n">Tracked</th><th class="n">Pre-insp</th><th class="n">C/O excess</th></tr></thead><tbody>${advisorRows}</tbody></table></div>` : ""}
<h2>User performance (created by)</h2><div class="wrap"><table data-sort><thead><tr><th class="n">#</th><th>User</th><th>Primary dealer</th><th class="n">Total</th><th class="n">Closed</th><th class="n">Conf.</th><th class="n">In prog.</th><th class="n">C/O</th><th class="n">Delayed</th><th class="n">Close rate</th></tr></thead><tbody>${userRows}</tbody></table></div>
${r.crosstab.dealers.length > 1 ? `<h2>User × dealer</h2><div class="wrap"><table class="heat"><thead><tr><th>User</th>${r.crosstab.dealers.map((d) => `<th>${esc(d)}</th>`).join("")}</tr></thead><tbody>${heat}</tbody></table></div>` : ""}
${r.carryOver.length ? `<h2>Carry-over abuse (vehicles booked more than once)</h2><div class="wrap"><table data-sort><thead><tr><th>Dealer</th><th>Reg</th><th>Vehicle</th><th>Customer</th><th>Advisor</th><th class="n">Bookings</th><th class="n">Excess</th><th>Statuses</th></tr></thead><tbody>${coaRows}</tbody></table></div>` : ""}
${r.weeks.length > 1 ? `<h2>Weekly breakdown</h2><div class="wrap"><table data-sort><thead><tr><th>Week</th><th class="n">Total</th><th class="n">Closed</th><th class="n">Conf.</th><th class="n">In prog.</th><th class="n">C/O</th><th class="n">Delayed</th><th class="n">Close rate</th></tr></thead><tbody>${weekRows}</tbody></table></div>` : ""}
${r.tracking.length ? `<h2>Tracking stations</h2><div class="wrap"><table data-sort><thead><tr><th>Dealer</th><th>Phase</th><th>Station</th><th class="n">Count</th><th class="n">% of jobs</th></tr></thead><tbody>${trackRows}</tbody></table></div>` : ""}
<p class="pill">Source sheet: ${esc(r.meta.sheet)} · ${r.meta.rows} rows${r.meta.unmapped.length ? ` · columns not found: ${esc(r.meta.unmapped.join(", "))}` : ""}</p>
<script type="application/json" id="report-data">${JSON.stringify({ totals: r.totals, dealers: r.dealers, advisors: r.advisors, weeks: r.weeks }).replace(/</g, "\\u003c")}</script>`;
  return htmlShell(r.title, `CMS Workshop Module · ${r.dateRange.from} to ${r.dateRange.to} · generated ${new Date(r.generatedAt).toLocaleString("en-ZA")}`, body);
}

/** Compact, model-friendly summary for the agent. */
export function summariseWorkshop(r: WorkshopReport) {
  return {
    title: r.title, dateRange: r.dateRange, totals: r.totals,
    dealers: r.dealers.map((d) => ({ name: d.name, total: d.total, closeRate: d.closeRate, carriedOver: d["Carried-Over"], delayed: d.Delayed, dmsPct: d.dmsPct, trackPct: d.trackPct, preInspPct: d.preInspPct, coaExcess: d.coaExcess, oldestActiveDays: d.oldestActiveDays, score: d.score })),
    topAdvisors: r.advisors.slice(0, 10).map((a) => ({ advisor: a.advisor, dealer: a.name, jobs: a.total, closeRate: a.closeRate, coaExcess: a.coaExcess })),
    zeroCloseAdvisors: r.advisors.filter((a) => a.total >= 3 && a.Closed === 0).map((a) => `${a.advisor} (${a.name}, ${a.total} jobs)`),
    weeks: r.weeks, carryOverTop: r.carryOver.slice(0, 10), insights: r.insights.map((i) => i.text), meta: r.meta,
  };
}
