# Workshop reports and campaign lists

Two of Jacques's existing report skills are now native tools inside Foreman,
so they run on any uploaded export without a Python sandbox and the agent can
discuss the results.

## Workshop Performance Dashboard (`kind: workshop`)

Input: a CMS Workshop Module bookings export (`Bookings MTD` style, or any
sheet with booking rows). Columns are mapped by keyword, so both the simple
export (Dealer / Job # / Status / Service Advisor…) and the CMS eco MTD export
(Workshop / Franchise, Progress, DMS Booking ID, SMS Count, Kms In, Total
Stations Checked, Tracking Complete %, `Track: …` columns) work. `Summary by
Workshop` and `Summary by Advisor` sheets supply pre-inspection figures when
present.

Computed:

- key metrics: total, dealers, users, Closed / Confirmed / In Progress /
  Carried-Over / Delayed, close rate (Unknown statuses excluded)
- dealer table: share, status split, close rate, DMS / SMS / tracking / pre-
  inspection percentages, carry-over excess, oldest active job age, and the
  weighted dealer score from the dealer-report skill (close 30%, tracking 20%,
  pre-insp 15%, DMS 15%, SMS 10%, kms 5%, minus a carry-over penalty)
- service advisor table with rank, and user (created-by) table with primary
  dealer and cross-dealer count
- user × dealer heat map, ISO-week breakdown, tracking stations by phase
- carry-over abuse: vehicles booked more than once at the same dealer
  (registrations normalised), with the sequence of statuses
- quick insights: top performer, best close rate (≥5 jobs), top dealer,
  cross-dealer users, worst carry-over abuse, zero-close advisors, low DMS
  linkage, stale active jobs

Output: one self-contained HTML file in CMS eco branding with sortable
tables and an embedded JSON block, plus a model-friendly summary the agent
reads through `get_report`.

## Campaign contact validation (`kind: campaign`)

Input: a CMS Marketing Contacts export. The widest sheet is the source;
narrow "distinct" tabs are ignored and reported, because they are
`SELECT DISTINCT` pulls rather than validated lists. Validation is by
**format rules only**, exactly as the skill specifies:

- mobile: strip separators; accept `0XXXXXXXXX`, `27XXXXXXXXX`,
  `027XXXXXXXXX` or 9 digits starting 6/7/8; valid only if `27` + mobile
  prefix (6/7/8) + 8 digits and not a repeated-digit number; reject reasons
  Blank / Wrong length / Not RSA format / Landline / Not a mobile prefix /
  Repeated-digit number
- e-mail: trim + lower-case; one `@`; dotted domain; TLD ≥2 non-numeric
  characters; no spaces, commas, semicolons or `..`; local/domain not starting
  with `.` or `-`; placeholder locals, junk/mistyped domains and mistyped TLDs
  rejected; TLD outside the whitelist is a warning only
- warnings (never reject): placeholder name, no usable surname,
  company/business record, TLD outside whitelist
- Cleaned Data: campaign-ready rows (valid mobile AND e-mail), unique per
  MSISDN keeping the most recently updated prospect, then unique e-mail
- Send List: SMS and e-mail blocks deduped independently on their own
  channel, so each is wider than the both-channel set
- reconciliation: valid + rejected = records per channel, status table totals,
  reject-reason sums, every output number `27[678]` + 8 digits, every output
  e-mail well-formed, no duplicates in either list

Output: a five-sheet workbook (Prospect Summary, Original Data with helper
columns, Cleaned Data with a `Mobile (0)` column, Validation with the rule
text, blacklists and reconciliation, Send List), SMS and e-mail CSVs, and an
HTML summary in CMS eco branding. Helper columns are written as values rather
than formulas so a 60k-row export stays fast; the rule text on the Validation
sheet is the audit trail.

## Using them

Console: the Reports panel has two upload buttons; the report builds on
upload and the composer is pre-filled with "Read report … and give me the
headline numbers and the three things to act on."

Agent tools: `list_files`, `build_report`, `list_reports`, `get_report`.

API:

| Method | Path |
|---|---|
| POST | `/api/files?build=1&kind=workshop|campaign` (raw body, `X-File-Name`, `X-Dealer`) |
| POST | `/api/reports/build` `{file_id, kind?, title?}` |
| GET | `/api/reports`, `/api/reports/:id` |
| GET | `/api/reports/:id/html`, `/xlsx`, `/sms.csv`, `/email.csv` |
