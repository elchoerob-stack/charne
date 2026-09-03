import type { Evidence, Playbook, CheckOutcome } from "./types.js";

/* ── Evidence helpers ─────────────────────────────────────────────────── */

const hasErr = (e: Evidence, re: RegExp) => e.consoleErrors.some((m) => re.test(m));
const hasReq = (e: Evidence, re: RegExp, status?: (s: number) => boolean) =>
  e.failedRequests.some((r) => re.test(r.url) && (status ? status(r.status) : true));
const fact = (e: Evidence, re: RegExp) => e.facts.some((f) => re.test(f));

function ternary(condition: boolean | undefined, known: boolean): CheckOutcome {
  if (!known) return "unknown";
  return condition ? "pass" : "fail";
}

/** "pass" if a failing request matched; "fail" if requests were captured but none matched; else unknown. */
const reqCheck = (re: RegExp, status?: (s: number) => boolean) => (e: Evidence): CheckOutcome =>
  ternary(hasReq(e, re, status), e.failedRequests.length > 0);

const healthCheck = (system: keyof Evidence["health"], bad: Array<"degraded" | "down"> = ["down", "degraded"]) =>
  (e: Evidence): CheckOutcome => {
    const h = e.health[system];
    if (!h) return "unknown";
    return bad.includes(h as "down" | "degraded") ? "pass" : "fail";
  };

/* ── Playbooks ───────────────────────────────────────────────────────── */

/**
 * Seed playbooks for the CMS Workshop Module and its integration partners.
 * Priors are rough base rates from rollout/support experience; the engine
 * normalises them so only their relative sizes matter.
 */
export const PLAYBOOKS: Playbook[] = [
  {
    id: "evolve-post-fail",
    title: "Job card or invoice is not posting to Evolve DMS",
    domain: "evolve",
    symptoms: ["not posting", "evolve", "invoice stuck", "did not post", "sync", "financial", "posting error", "dms"],
    prior: 0.14,
    checks: [
      { id: "evolve-health", question: "Is the Evolve DMS integration reporting healthy? (run the Evolve integration check)", auto: healthCheck("evolve"), lrPass: 6, lrFail: 0.5 },
      { id: "evolve-request", question: "Did a request to the Evolve endpoint fail during the posting attempt?", auto: reqCheck(/evolve|dms|posting/i), lrPass: 5, lrFail: 0.4 },
      { id: "account-hold", question: "Is the customer or debtor account on hold / over credit limit in Evolve?", lrPass: 4, lrFail: 0.7 },
      { id: "gl-mapping", question: "Are the franchise's GL / VAT account codes mapped for this job type in CMS setup?", lrPass: 3, lrFail: 0.6 },
      { id: "open-period", question: "Is the accounting period for the invoice date still open in Evolve?", lrPass: 3, lrFail: 0.7 },
    ],
    resolution: [
      "Open the job card in CMS and read the exact posting error text under Financial → Posting log.",
      "If Evolve is down or degraded, wait for the Evolve status to recover, then use Financial → Retry posting. Do not re-invoice.",
      "If the debtor account is on hold, ask the dealership accounts department to release it in Evolve, then retry.",
      "If the error mentions an account, VAT or GL code, fix the mapping under Setup → Franchise → Financial mappings for that job type and retry.",
      "If the period is closed, have accounts re-open it or change the invoice date to the current open period per dealer policy.",
    ],
    verify: "The posting log shows a green 'Posted' entry with an Evolve document number, and the invoice appears in Evolve under the same number.",
    escalate: { to: "CMS support desk + Evolve DMS support", include: ["job card number", "posting log text", "time of attempt", "dealer code", "Evolve document number if any"] },
  },
  {
    id: "superservice-menu-empty",
    title: "Infomedia Superservice menus are empty or show no prices",
    domain: "infomedia",
    symptoms: ["superservice", "menus", "menu pricing", "no prices", "infomedia", "service menu", "quote empty", "menu not loading", "oem quote"],
    prior: 0.11,
    checks: [
      { id: "infomedia-health", question: "Is the Infomedia integration healthy? (run the Infomedia integration check)", auto: healthCheck("infomedia"), lrPass: 6, lrFail: 0.5 },
      { id: "infomedia-request", question: "Did a request to Infomedia / Superservice fail while loading the menu?", auto: reqCheck(/infomedia|superservice|menus|catalog/i), lrPass: 5, lrFail: 0.4 },
      { id: "vin-valid", question: "Is the vehicle VIN 17 characters and decoded correctly on the vehicle card?", lrPass: 4, lrFail: 0.6 },
      { id: "franchise-code", question: "Is the franchise's Infomedia dealer/brand code configured under Setup → Integrations?", lrPass: 4, lrFail: 0.6 },
      { id: "labour-rate", question: "Does the franchise have a labour rate and parts pricing rule configured for the vehicle's brand?", lrPass: 3, lrFail: 0.7 },
    ],
    resolution: [
      "Confirm the VIN on the vehicle card decodes (make/model/year populate). Correct the VIN if it was captured with O/0 or I/1 mistakes.",
      "If Infomedia is degraded or down, wait and retry; the menu cache refreshes automatically once the service recovers.",
      "Check Setup → Integrations → Infomedia for the franchise's brand code and credentials; re-save to refresh the token.",
      "Confirm the franchise labour rate and parts pricing rule exist; menus load without prices when either is missing.",
      "Reload the quote screen (not just the browser tab) so the menu request is re-issued.",
    ],
    verify: "Superservice menus list with labour and parts prices for the vehicle, and the OEM quote totals are non-zero.",
    escalate: { to: "CMS support desk (Infomedia liaison)", include: ["VIN", "franchise/brand", "screenshot of the empty menu", "time of attempt", "failed request URL and status if captured"] },
  },
  {
    id: "otp-not-received",
    title: "Customer did not receive the authorisation OTP or e-signature link",
    domain: "comms",
    symptoms: ["otp", "sms", "not received", "authorisation", "authorization", "e-signature", "signature link", "customer link", "whatsapp link", "did not get the code"],
    prior: 0.12,
    checks: [
      { id: "sms-health", question: "Is the SMS / messaging gateway healthy? (run the SMS integration check)", auto: healthCheck("sms"), lrPass: 6, lrFail: 0.5 },
      { id: "mobile-format", question: "Is the customer's mobile number a valid South African number (10 digits starting with 0, or +27 followed by 9 digits) with no spaces or letters?", lrPass: 4, lrFail: 0.5 },
      { id: "send-log", question: "Does the authorisation send log show the message as 'sent' / 'delivered' rather than 'failed'?", lrPass: 0.4, lrFail: 4 },
      { id: "resend-attempted", question: "Has 'Resend' been tried after at least 60 seconds?", lrPass: 0.8, lrFail: 1.5 },
    ],
    resolution: [
      "Open the customer record and correct the mobile number format (0821234567 or +27821234567, no spaces).",
      "Use Authorisation → Resend and wait 60 seconds; carriers can delay OTP delivery.",
      "If the send log says 'failed' and the gateway is down, capture a screenshot and use the phone/e-mail authorisation fallback so the workshop is not blocked.",
      "If the customer is roaming or on a number-porting carrier, switch the channel to e-mail or WhatsApp link for this authorisation.",
    ],
    verify: "The send log shows 'delivered' and the customer confirms the code or opens the e-signature link.",
    escalate: { to: "CMS support desk", include: ["customer mobile number", "job card number", "send log entries with timestamps", "gateway status"] },
  },
  {
    id: "booking-wizard-stuck",
    title: "Booking wizard cannot proceed or save",
    domain: "cms",
    symptoms: ["booking", "wizard", "cannot save", "can't save", "next button", "stuck", "won't proceed", "greyed out", "spinner", "booking not saving"],
    prior: 0.13,
    checks: [
      { id: "js-error", question: "Was a JavaScript error logged in the console when the Next/Save button was pressed?", auto: (e) => ternary(hasErr(e, /TypeError|ReferenceError|Uncaught|undefined/i), e.consoleErrors.length > 0 || e.failedRequests.length > 0), lrPass: 5, lrFail: 0.6 },
      { id: "session-401", question: "Did the save request return 401/403 (session expired)?", auto: reqCheck(/booking|appointments|save/i, (s) => s === 401 || s === 403), lrPass: 6, lrFail: 0.7 },
      { id: "validation-400", question: "Did the save request return 400/422 (a required field is missing or invalid)?", auto: reqCheck(/booking|appointments|save/i, (s) => s === 400 || s === 422), lrPass: 6, lrFail: 0.7 },
      { id: "required-fields", question: "Are all mandatory fields on the current step filled in (customer, vehicle registration, requested date, service advisor)?", lrPass: 0.5, lrFail: 4 },
      { id: "offline", question: "Did the browser go offline or hit a very slow connection during the booking?", auto: (e) => (e.wentOffline === undefined ? "unknown" : e.wentOffline ? "pass" : "fail"), lrPass: 4, lrFail: 0.8 },
    ],
    resolution: [
      "Look for a red validation message on the current step; fill in the highlighted mandatory field and press Next again.",
      "If the session expired (401), log out and back in, then reopen the booking from Bookings → Drafts; the wizard autosaves drafts every step.",
      "If a JavaScript error is captured, hard-refresh (Ctrl+F5) to clear a stale app bundle, then retry. If it recurs, attach the recording to a case.",
      "If the connection dropped, reconnect and press Save again; check the draft was not duplicated in Bookings → Drafts.",
    ],
    verify: "The booking saves with a booking number and appears on the dispatch board for the requested date.",
    escalate: { to: "CMS support desk (product)", include: ["recording ID", "console error text", "browser and version", "step of the wizard", "dealer code"] },
  },
  {
    id: "parts-price-mismatch",
    title: "Part price on the quote differs from the catalogue or Evolve stock price",
    domain: "cms",
    symptoms: ["price", "parts price", "wrong price", "mismatch", "microcat", "catalogue", "catalog", "supersession", "superseded", "price file", "different price"],
    prior: 0.08,
    checks: [
      { id: "supersession", question: "Has the part number been superseded (the catalogue shows a supersession chain)?", lrPass: 4, lrFail: 0.7 },
      { id: "price-file-date", question: "Is the Evolve parts price file older than the latest OEM price update?", lrPass: 4, lrFail: 0.6 },
      { id: "markup-matrix", question: "Does the franchise have a parts markup matrix / pricing rule that changes the retail price on quotes?", lrPass: 3, lrFail: 0.8 },
      { id: "vat", question: "Is one price shown including VAT and the other excluding VAT?", lrPass: 5, lrFail: 0.8 },
    ],
    resolution: [
      "Compare the two prices with VAT excluded on both; a 15% difference is almost always VAT display.",
      "If the part was superseded, re-add the part on the quote so the current part number and price are pulled through.",
      "Ask parts to confirm the Evolve price file date; if it is stale, import the latest OEM price file in Evolve, then refresh the quote.",
      "Check Setup → Parts pricing for a markup rule on this franchise; adjust or explain to the dealer that quote prices include markup.",
    ],
    verify: "The quote line price equals the Evolve stock price after the markup rule, VAT treated consistently.",
    escalate: { to: "CMS support desk + dealership parts manager", include: ["part number", "both prices", "quote number", "price file date"] },
  },
  {
    id: "dispatch-board-stale",
    title: "Dispatch board is not updating in real time",
    domain: "network",
    symptoms: ["dispatch", "board", "not updating", "refresh", "stale", "real time", "does not move", "status not changing", "technician clock"],
    prior: 0.07,
    checks: [
      { id: "ws-error", question: "Did the live-update (WebSocket/SSE) connection drop or log an error?", auto: (e) => ternary(hasErr(e, /websocket|socket|EventSource|reconnect/i) || hasReq(e, /ws|socket|events|stream/i), e.consoleErrors.length > 0 || e.failedRequests.length > 0), lrPass: 6, lrFail: 0.6 },
      { id: "background-tab", question: "Was the board left open in a background tab or on a screen that went to sleep?", lrPass: 3, lrFail: 0.8 },
      { id: "proxy-blocks", question: "Does the dealership network use a proxy/firewall that blocks long-lived connections?", lrPass: 4, lrFail: 0.8 },
    ],
    resolution: [
      "Press the board's Refresh control (not the browser refresh) to force a resync.",
      "If the board is on a wall screen, set the display to never sleep and keep the tab in the foreground; the browser throttles background tabs.",
      "If the WebSocket connection keeps dropping on the dealership network, ask IT to allow wss:// traffic to the CMS host and disable SSL inspection for it.",
    ],
    verify: "Clocking a technician on/off from a tablet appears on the board within a few seconds without manual refresh.",
    escalate: { to: "CMS support desk + dealership IT", include: ["dealer network details", "browser", "console errors", "time of last update"] },
  },
  {
    id: "session-expiry",
    title: "Users keep getting logged out",
    domain: "user",
    symptoms: ["logged out", "log out", "logs out", "logged out repeatedly", "login", "session expired", "keeps logging", "kicked out", "kicks me out", "sign in again", "signed out", "clock is wrong", "logged", "kicked", "clock"],
    prior: 0.06,
    checks: [
      { id: "many-401", question: "Are there repeated 401 responses across different screens?", auto: reqCheck(/./, (s) => s === 401), lrPass: 5, lrFail: 0.6 },
      { id: "shared-login", question: "Is the same user account being used on more than one device at the same time?", lrPass: 5, lrFail: 0.7 },
      { id: "clock-skew", question: "Is the device clock correct (within a minute of real time)?", lrPass: 0.5, lrFail: 5 },
    ],
    resolution: [
      "Give each service advisor and technician their own CMS login; a second login on the same account ends the first session.",
      "Correct the device date/time (enable automatic time); token validation fails when the clock is skewed.",
      "Clear site data for the CMS host and log in again to remove a corrupted token.",
    ],
    verify: "The user stays logged in for a full shift without re-authenticating.",
    escalate: { to: "CMS support desk", include: ["usernames affected", "device types", "time of log-outs"] },
  },
  {
    id: "evhc-upload-fail",
    title: "eVHC photos or videos will not upload from the tablet",
    domain: "device",
    symptoms: ["evhc", "photo", "photos", "video", "upload", "tablet", "inspection", "health check", "images not saving"],
    prior: 0.09,
    checks: [
      { id: "413", question: "Did the upload request fail with 413 (file too large)?", auto: reqCheck(/upload|media|photo|evhc/i, (s) => s === 413), lrPass: 8, lrFail: 0.7 },
      { id: "network-timeout", question: "Did the upload time out or fail with a network error (status 0 / 502 / 504)?", auto: reqCheck(/upload|media|photo|evhc/i, (s) => s === 0 || s >= 502), lrPass: 5, lrFail: 0.6 },
      { id: "wifi-coverage", question: "Was the technician in a workshop area with weak Wi-Fi coverage (pits, wash bay, far bays)?", lrPass: 4, lrFail: 0.7 },
      { id: "storage", question: "Is the tablet's storage nearly full or the camera set to maximum resolution/4K video?", lrPass: 3, lrFail: 0.8 },
    ],
    resolution: [
      "Set the tablet camera to a medium resolution and video to 1080p max; eVHC does not need 4K.",
      "Move to an area with good Wi-Fi and use the inspection's 'Retry uploads' action; queued media uploads in order.",
      "Free tablet storage (delete old downloads) and restart the tablet.",
      "If uploads fail with 413, split the video into shorter clips or take photos instead until the size limit is raised.",
    ],
    verify: "All media on the inspection show a green tick and open from the service advisor's desktop view.",
    escalate: { to: "CMS support desk + dealership IT (Wi-Fi survey)", include: ["tablet model", "file sizes", "bay/area", "failed request status"] },
  },
  {
    id: "print-jobcard",
    title: "Job card or invoice PDF does not print or opens blank",
    domain: "device",
    symptoms: ["print", "printing", "pdf", "blank", "job card print", "invoice print", "popup", "pop-up", "download"],
    prior: 0.06,
    checks: [
      { id: "popup-blocked", question: "Is the browser blocking pop-ups for the CMS site (icon in the address bar)?", lrPass: 5, lrFail: 0.6 },
      { id: "print-500", question: "Did the print/PDF request return a server error (500)?", auto: reqCheck(/print|pdf|report/i, (s) => s >= 500), lrPass: 7, lrFail: 0.7 },
      { id: "pdf-viewer", question: "Does the browser open other PDFs correctly (is a PDF viewer enabled)?", lrPass: 0.5, lrFail: 4 },
    ],
    resolution: [
      "Allow pop-ups for the CMS site in the browser's site settings and print again.",
      "Enable the browser's built-in PDF viewer (or set PDFs to download and open with Acrobat).",
      "If the server returned 500, the document template failed to render: capture the job card number and time, and raise a case; use 'Print without images' as a workaround.",
    ],
    verify: "The PDF opens with content and prints to the workshop printer.",
    escalate: { to: "CMS support desk (templates)", include: ["job card number", "time of attempt", "template name", "browser"] },
  },
  {
    id: "slow-performance",
    title: "CMS is slow or times out",
    domain: "network",
    symptoms: ["slow", "timeout", "timing out", "hangs", "takes long", "performance", "lag", "spinning"],
    prior: 0.08,
    checks: [
      { id: "latency", question: "Are requests to CMS taking longer than 3 seconds on average?", auto: (e) => (e.latencyMs === undefined ? "unknown" : e.latencyMs > 3000 ? "pass" : "fail"), lrPass: 4, lrFail: 0.5 },
      { id: "cms-health", question: "Is the CMS platform status healthy? (run the CMS health check)", auto: healthCheck("cms"), lrPass: 0.4, lrFail: 5 },
      { id: "other-sites-slow", question: "Are other websites also slow from the same PC (dealership line congested)?", lrPass: 5, lrFail: 0.5 },
      { id: "many-tabs", question: "Does the user have many CMS tabs or a very long date range open on the dispatch board?", lrPass: 3, lrFail: 0.8 },
    ],
    resolution: [
      "Run a speed test on the dealership line; if it is congested, ask IT to prioritise CMS traffic or move to the fibre line.",
      "Close duplicate CMS tabs and narrow the dispatch board to a single day.",
      "If CMS platform status is degraded, wait for the status page to clear; no local action will help.",
      "Clear browser cache for the CMS site if slowness started after an update.",
    ],
    verify: "Screens load in under 3 seconds and no timeouts occur for 30 minutes.",
    escalate: { to: "CMS support desk", include: ["speed test result", "time window", "dealer code", "screens affected"] },
  },
];

/** Words that commonly co-occur across many playbooks and carry little signal. */
export const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "to", "of", "and", "or", "in", "on", "it", "my", "our", "we", "i", "not", "can",
  "cannot", "does", "do", "with", "for", "at", "from", "this", "that", "when", "get", "getting", "have", "has",
  "customer", "customers", "user", "users", "dealer", "dealership", "workshop", "cms", "system", "please", "help",
]);

/** Fact-based checks usable by any playbook when the user states things plainly. */
export const factMatches = fact;
