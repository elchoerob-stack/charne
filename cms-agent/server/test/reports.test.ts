import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { computeWorkshopReport, displayName, parseWorkshopWorkbook, renderWorkshopHtml } from "../src/reports/workshop.js";
import { computeCampaignReport, parseContactsWorkbook, renderCampaignHtml, renderCampaignWorkbook, validateEmail, validateMobile } from "../src/reports/campaign.js";

function workbook(sheets: Record<string, Record<string, unknown>[]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name);
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer);
}

const W = "Salamax 900 (PTY) Ltd ta Morgan Isuzu Ermelo";
const K = "Morgan Kimberley (PTY) LTD";
const bookings = [
  { "Workshop / Franchise": W, "Job ID": 1, "DMS Booking ID": "D1", "Created By": "anna", "Booking Date": "2026-06-02", "Original Booking Date": "2026-06-02", "Client Full Name": "T Nkosi", "Vehicle Reg": "KJ45GPGP", "Vehicle Make/Model": "Isuzu D-Max", "Progress": "Closed", "Service Advisor": "Sipho", "SMS Count": 2, "Kms In": 60000, "Total Stations Checked": 4, "Tracking Complete %": 80, "Track: Car in": "Yes", "Track: Invoiced": "Yes" },
  { "Workshop / Franchise": W, "Job ID": 2, "DMS Booking ID": null, "Created By": "anna", "Booking Date": "2026-06-03", "Original Booking Date": "2026-06-01", "Client Full Name": "B Botha", "Vehicle Reg": "CA123456", "Vehicle Make/Model": "Isuzu MU-X", "Progress": "Carried-Over", "Service Advisor": "Sipho", "SMS Count": 0, "Kms In": 0, "Total Stations Checked": 0, "Tracking Complete %": 0, "Track: Car in": "No", "Track: Invoiced": "No" },
  { "Workshop / Franchise": W, "Job ID": 3, "DMS Booking ID": null, "Created By": "anna", "Booking Date": "2026-06-04", "Original Booking Date": "2026-06-01", "Client Full Name": "B Botha", "Vehicle Reg": "CA 123 456", "Vehicle Make/Model": "Isuzu MU-X", "Progress": "Carried-Over", "Service Advisor": "Sipho", "SMS Count": 0, "Kms In": 0, "Total Stations Checked": 0, "Tracking Complete %": 0, "Track: Car in": "No", "Track: Invoiced": "No" },
  { "Workshop / Franchise": W, "Job ID": 4, "DMS Booking ID": null, "Created By": "anna", "Booking Date": "2026-06-05", "Original Booking Date": "2026-06-01", "Client Full Name": "B Botha", "Vehicle Reg": "CA123456", "Vehicle Make/Model": "Isuzu MU-X", "Progress": "InProgress", "Service Advisor": "Sipho", "SMS Count": 0, "Kms In": 0, "Total Stations Checked": 1, "Tracking Complete %": 20, "Track: Car in": "Yes", "Track: Invoiced": "No" },
  { "Workshop / Franchise": K, "Job ID": 5, "DMS Booking ID": "D5", "Created By": "ben", "Booking Date": "2026-06-09", "Original Booking Date": "2026-06-09", "Client Full Name": "C Coetzee", "Vehicle Reg": "NC1", "Vehicle Make/Model": "Renault Kwid", "Progress": "Closed", "Service Advisor": "Lerato", "SMS Count": 1, "Kms In": 1000, "Total Stations Checked": 5, "Tracking Complete %": 100, "Track: Car in": "Yes", "Track: Invoiced": "Yes" },
  { "Workshop / Franchise": K, "Job ID": 6, "DMS Booking ID": "D6", "Created By": "ben", "Booking Date": "2026-06-10", "Original Booking Date": "2026-06-10", "Client Full Name": "D Dlamini", "Vehicle Reg": "NC2", "Vehicle Make/Model": "Renault Kiger", "Progress": "Delayed", "Service Advisor": "Lerato", "SMS Count": 1, "Kms In": 1000, "Total Stations Checked": 2, "Tracking Complete %": 40, "Track: Car in": "Yes", "Track: Invoiced": "No" },
  { "Workshop / Franchise": K, "Job ID": 6, "DMS Booking ID": "D6", "Created By": "ben", "Booking Date": "2026-06-10", "Original Booking Date": "2026-06-10", "Client Full Name": "D Dlamini", "Vehicle Reg": "NC2", "Vehicle Make/Model": "Renault Kiger", "Progress": "Delayed", "Service Advisor": "Lerato", "SMS Count": 1, "Kms In": 1000, "Total Stations Checked": 2, "Tracking Complete %": 40, "Track: Car in": "Yes", "Track: Invoiced": "No" },
  { "Workshop / Franchise": K, "Job ID": 7, "DMS Booking ID": "D7", "Created By": "anna", "Booking Date": "2026-06-11", "Original Booking Date": "2026-06-11", "Client Full Name": "E Els", "Vehicle Reg": "NC3", "Vehicle Make/Model": "Renault Duster", "Progress": "Confirmed", "Service Advisor": "Lerato", "SMS Count": 0, "Kms In": 0, "Total Stations Checked": 0, "Tracking Complete %": 0, "Track: Car in": "No", "Track: Invoiced": "No" },
];

test("workshop export parses, maps columns, drops exact duplicates and shortens names", () => {
  const parsed = parseWorkshopWorkbook(workbook({ "Bookings MTD": bookings, "Summary by Workshop": [{ "Workshop Name": W, "Pre-Inspection Done": 3, "Pre-Insp %": 75 }], "Summary by Advisor": [{ Workshop: W, "Service Advisor": "Sipho", "Pre-Insp Done": 3, "Pre-Insp %": 75 }] }));
  assert.equal(parsed.sheet, "Bookings MTD");
  assert.equal(parsed.bookings.length, 7, "exact duplicate row dropped");
  assert.equal(parsed.mapping.dealer, "Workshop / Franchise");
  assert.equal(parsed.mapping.status, "Progress");
  assert.equal(displayName(W), "Morgan Isuzu Ermelo");
  assert.equal(displayName(K), "Morgan Kimberley");
  assert.equal(parsed.preInspection.workshop[W].pct, 75);
});

test("workshop KPIs: close rate, carry-over abuse, dealer score and insights", () => {
  const r = computeWorkshopReport(parseWorkshopWorkbook(workbook({ "Bookings MTD": bookings })), { refDate: new Date("2026-06-25T00:00:00Z") });
  assert.equal(r.totals.total, 7);
  assert.equal(r.totals.Closed, 2);
  assert.equal(r.totals["In Progress"], 1);
  assert.equal(r.totals.closeRate, 28.6);
  const ermelo = r.dealers.find((d) => d.name === "Morgan Isuzu Ermelo")!;
  assert.equal(ermelo.total, 4);
  assert.equal(ermelo.coaVehicles, 1, "CA123456 booked three times (reg normalised)");
  assert.equal(ermelo.coaExcess, 2);
  assert.equal(ermelo.oldestActiveDays, 24);
  assert.equal(ermelo.dmsPct, 25);
  assert.ok(ermelo.score >= 0 && ermelo.score <= 100);
  assert.ok(r.carryOver[0].reg === "CA123456" && r.carryOver[0].count === 3);
  assert.ok(r.insights.some((i) => i.text.includes("Carry-over abuse")));
  assert.ok(r.users.find((u) => u.user === "anna")!.dealers === 2);
  assert.equal(r.weeks.length, 2);
  assert.ok(r.tracking.some((t) => t.station === "Car in"));
});

test("workshop HTML is self-contained and carries the report data", () => {
  const html = renderWorkshopHtml(computeWorkshopReport(parseWorkshopWorkbook(workbook({ Sheet1: bookings }))));
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes("Dealer performance"));
  assert.ok(html.includes("Carry-over abuse"));
  assert.ok(html.includes('id="report-data"'));
  assert.ok(!/https?:\/\/cdn/.test(html), "no external dependencies");
});

test("RSA mobile validation follows the rule set", () => {
  assert.deepEqual(validateMobile("082 123 4567").msisdn, "27821234567");
  assert.equal(validateMobile("+27 71 234 5678").valid, true);
  assert.equal(validateMobile("0271234567").reason, "Landline");
  assert.equal(validateMobile("012 345 6789").reason, "Landline");
  assert.equal(validateMobile("27999999999").reason, "Not a mobile prefix");
  assert.equal(validateMobile("27777777777").reason, "Repeated-digit number");
  assert.equal(validateMobile("821234567").msisdn, "27821234567");
  assert.equal(validateMobile("12345").reason, "Wrong length");
  assert.equal(validateMobile("").reason, "Blank");
  assert.equal(validateMobile("08a1234567").reason, "Not RSA format");
});

test("e-mail validation rejects placeholders, junk domains and mistyped TLDs", () => {
  assert.equal(validateEmail(" Thabo.Nkosi@Gmail.com ").valid, true);
  assert.equal(validateEmail("no@no.com").reason, "Placeholder address");
  assert.equal(validateEmail("thabo@gmail.con").reason, "Mistyped TLD");
  assert.equal(validateEmail("thabo@gamil.com").reason, "Bad or mistyped domain");
  assert.equal(validateEmail("thabo@localhost").reason, "No valid domain or TLD");
  assert.equal(validateEmail("thabo@@x.com").reason, "Missing or multiple @");
  assert.equal(validateEmail("tha bo@x.com").reason, "Invalid characters");
  assert.equal(validateEmail("thabo@x.zz").warning, "TLD outside whitelist");
});

const contacts = [
  { Dealer: "Morgan Nissan Upington", "CMS Dealer Code": "UPN01", "Prospect ID": 1, Name: "Thabo", Surname: "Nkosi", "Cell Number": "082 123 4567", Email: "thabo@gmail.com", "Prospect Status": "Active", "Date Prospect Updated": "2026-08-01" },
  { Dealer: "Morgan Nissan Upington", "CMS Dealer Code": "UPN01", "Prospect ID": 2, Name: "Thabo", Surname: "Nkosi", "Cell Number": "+27821234567", Email: "thabo@gmail.com", "Prospect Status": "Sold", "Date Prospect Updated": "2026-08-20" },
  { Dealer: "Morgan Nissan Upington", "CMS Dealer Code": "UPN01", "Prospect ID": 3, Name: "Anna", Surname: "-No Surname-", "Cell Number": "0123456789", Email: "anna@yahoo.com", "Prospect Status": "Active", "Date Prospect Updated": "2026-08-05" },
  { Dealer: "Morgan Kimberley", "CMS Dealer Code": "KIM01", "Prospect ID": 4, Name: "Ben", Surname: "Botha", "Cell Number": "0731234567", Email: "no@no.com", "Prospect Status": "Lost", "Date Prospect Updated": "2026-08-06" },
  { Dealer: "Morgan Kimberley", "CMS Dealer Code": "KIM01", "Prospect ID": 5, Name: "Cindy", Surname: "Coetzee", "Cell Number": "", Email: "cindy@outlook.com", "Prospect Status": "Active", "Date Prospect Updated": "2026-08-07" },
  { Dealer: "Morgan Kimberley", "CMS Dealer Code": "KIM01", "Prospect ID": 6, Name: "Dan", Surname: "Dlamini", "Cell Number": "0611234567", Email: "dan@gmail.con", "Prospect Status": "Active", "Date Prospect Updated": "2026-08-08" },
];

test("campaign list validates, dedupes per channel and reconciles", () => {
  const parsed = parseContactsWorkbook(workbook({ Contacts: contacts, "Distinct Cell": [{ Cell: "0821234567" }, { Cell: "0123456789" }] }));
  assert.equal(parsed.sheet, "Contacts");
  assert.deepEqual(parsed.distinctTabs, ["Distinct Cell"]);
  const r = computeCampaignReport(parsed);
  assert.equal(r.totals.records, 6);
  assert.equal(r.totals.validMobile, 4);      // rows 1,2,4,6 (row 3 landline, row 5 blank)
  assert.equal(r.totals.validEmail, 4);       // rows 1,2,3,5 (row 4 placeholder, row 6 mistyped tld)
  assert.equal(r.totals.campaignReady, 2);    // rows 1 and 2 (same person)
  assert.equal(r.totals.cleaned, 1, "duplicate MSISDN collapsed, most recent kept");
  assert.equal(r.cleaned[0].prospectId, "2");
  assert.equal(r.totals.smsList, 3);          // 27821234567, 27731234567, 27611234567
  assert.equal(r.totals.emailList, 3);        // thabo, anna, cindy
  assert.ok(r.reconcile.every((c) => c.ok), r.reconcile.filter((c) => !c.ok).map((c) => c.check).join("; "));
  assert.equal(r.mobileRejects["Landline"], 1);
  assert.equal(r.emailRejects["Mistyped TLD"], 1);
  assert.equal(r.warnings["No usable surname"], 1);
  assert.equal(r.statuses.find((s) => s.status === "Active")!.total, 4);
});

test("campaign outputs: workbook has five sheets and html summarises", () => {
  const parsed = parseContactsWorkbook(workbook({ Contacts: contacts }));
  const r = computeCampaignReport(parsed);
  const wb = XLSX.read(renderCampaignWorkbook(r, parsed.contacts), { type: "buffer" });
  assert.deepEqual(wb.SheetNames, ["Prospect Summary", "Original Data", "Cleaned Data", "Validation", "Send List"]);
  const send = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Send List"]);
  assert.equal(send.length, 3);
  assert.equal(String(send[0]["SMS — Mobile (27)"]).length, 11);
  const html = renderCampaignHtml(r);
  assert.ok(html.includes("Prospect status breakdown") && html.includes("Reconciliation"));
});
