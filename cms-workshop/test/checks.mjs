/* End-to-end checks for the three surfaces.
 *
 *   npx http-server . -p 8899 -s &
 *   node test/checks.mjs
 *
 * Needs Playwright. It drives a real browser through the flows that matter
 * and fails loudly on any console or page error, because a silent error in
 * one of these is a dealership ringing support.
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); }
catch { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }

const base = process.env.BASE || "http://127.0.0.1:8899";
const errs = [];
const results = [];
const check = (name, got, want) => {
  const ok = want === undefined ? !!got : String(got) === String(want);
  results.push((ok ? "  ok   " : "  FAIL ") + name + " — " + got);
  return ok;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const watch = (pg, tag) => {
  pg.on("pageerror", e => errs.push(tag + " pageerror: " + e.message));
  pg.on("console", m => { if (m.type() === "error") errs.push(tag + " console: " + m.text()); });
};

const signIn = async (pg, name, pin) => {
  await pg.getByText(name).click();
  await pg.waitForTimeout(200);
  for (const d of pin) await pg.getByRole("button", { name: d, exact: true }).first().click();
  await pg.waitForTimeout(500);
};

/* ---- the web version ---- */
const web = await ctx.newPage();
watch(web, "web");
await web.goto(base + "/index.html");
await web.waitForTimeout(400);
await signIn(web, "Thandi Mokoena", "1111");
check("signs in and lands on a screen", await web.locator(".topbar h1").textContent());

await web.locator(".touch-item").first().click();
await web.waitForTimeout(400);
check("opens a job card", await web.locator(".drawer-head h2").count());
for (const tab of ["Work & quote", "eVHC", "Authorisation", "Parts", "Financial", "History"]) {
  const t = web.locator(".tab", { hasText: tab }).first();
  if (await t.count()) { await t.click(); await web.waitForTimeout(120); }
}
await web.keyboard.press("Escape");

for (const nav of ["Diary", "New booking", "Job cards", "Authorisations", "Customers", "Reports"]) {
  await web.locator(".nav-item", { hasText: nav }).first().click();
  await web.waitForTimeout(250);
}
check("every screen on the advisor's menu draws", errs.length, 0);

/* booking, end to end */
await web.locator(".nav-item", { hasText: "New booking" }).first().click();
await web.waitForTimeout(300);
await web.locator(".content .field input[type=text]").first().fill("Test Buyer");
await web.locator("input[type=tel]").fill("0821234567");
await web.waitForTimeout(200);
await web.locator(".wizard-foot .btn-primary").click();
await web.waitForTimeout(300);
await web.locator(".content .grid-2 input").first().fill("TST 123 GP");
await web.waitForTimeout(200);
await web.locator(".wizard-foot .btn-primary").click();
await web.waitForTimeout(300);
await web.locator(".content .touch-item").first().click();
await web.waitForTimeout(250);
await web.locator(".wizard-foot .btn-primary").click();
await web.waitForTimeout(300);
await web.locator(".content .grid-2 select").nth(1).selectOption({ index: 1 });
await web.waitForTimeout(250);
await web.locator(".wizard-foot .btn-primary").click();
await web.waitForTimeout(300);
await web.locator(".wizard-foot .btn-primary").click();
await web.waitForTimeout(600);
check("booking wizard creates a job card", await web.locator(".drawer-head h2").textContent());
await web.keyboard.press("Escape");

/* admin: setup and the board */
await web.locator(".sidebar-foot .btn").click();
await web.waitForTimeout(300);
await signIn(web, "Jacques R", "9999");
await web.locator(".nav-item", { hasText: "Dispatch board" }).first().click();
await web.waitForTimeout(400);
check("dispatch board has columns", await web.locator(".board .bhead").count());
await web.locator(".nav-item", { hasText: "Setup" }).first().click();
await web.waitForTimeout(300);
const setupTabs = await web.locator(".tabs .tab").allTextContents();
for (const t of setupTabs) { await web.locator(".tabs .tab", { hasText: t }).first().click(); await web.waitForTimeout(140); }
check("every Setup tab draws", setupTabs.length, 14);

/* ---- the workshop app ---- */
const tech = await ctx.newPage();
watch(tech, "workshop");
await tech.setViewportSize({ width: 420, height: 880 });
await tech.goto(base + "/workshop.html");
await tech.waitForTimeout(400);
await signIn(tech, "Johan Pretorius", "4444");
check("technician signs in", await tech.locator(".mobile-top h1").textContent());
await tech.locator(".touch-item").first().click();
await tech.waitForTimeout(400);
const vhcBtn = tech.locator("button", { hasText: "health check" }).first();
if (await vhcBtn.count()) { await vhcBtn.click(); await tech.waitForTimeout(500); }
check("health check opens with its groups", await tech.locator(".chip").count());

/* ---- the customer link ---- */
const cust = await ctx.newPage();
watch(cust, "customer");
await cust.setViewportSize({ width: 420, height: 880 });
await cust.goto(base + "/customer.html#demo1234");
await cust.waitForTimeout(400);
await cust.locator(".field input").fill("4417");
await cust.locator(".btn-primary").click();
await cust.waitForTimeout(500);
const lines = await cust.locator(".authline").count();
check("customer sees the items awaiting a decision", lines);
for (let i = 0; i < lines; i++) {
  await cust.locator(".authline").nth(i).locator("button").nth(i === 1 ? 1 : 0).click();
  await cust.waitForTimeout(90);
}
await cust.locator("#sign input[type=text]").fill("P van Wyk");
await cust.locator("canvas.sigpad").scrollIntoViewIfNeeded();
await cust.waitForTimeout(200);
const bx = await cust.locator("canvas.sigpad").boundingBox();
await cust.mouse.move(bx.x + 20, bx.y + 80);
await cust.mouse.down();
await cust.mouse.move(bx.x + 130, bx.y + 45, { steps: 8 });
await cust.mouse.move(bx.x + 210, bx.y + 115, { steps: 8 });
await cust.mouse.up();
check("signature registers", await cust.evaluate(() => document.querySelector("canvas.sigpad").classList.contains("signed")), "true");
await cust.locator("#sign .btn-primary").click();
await cust.waitForTimeout(600);
check("approval reaches the job card", await cust.evaluate(() => {
  const j = CMS.jobByToken("demo1234");
  return j.status + " approved=" + j.lines.filter(l => l.authStatus === "approved").length +
    " declined=" + j.lines.filter(l => l.authStatus === "declined").length + " signed=" + !!j.auth.signature;
}));

/* ---- the rules underneath ---- */
check("measurements colour themselves", await web.evaluate(() => {
  const it = { amberBelow: 3, redBelow: 1.6 };
  return [CMS.ragFromMeasure(it, "5"), CMS.ragFromMeasure(it, "2.5"), CMS.ragFromMeasure(it, "1.4")].join("");
}), "gar");
check("a failed Evolve post can be retried", await web.evaluate(() => {
  const j = CMS.jobs()[0];
  CMS.store.patch(s => { s.simulate.postingFailure = true; });
  const bad = CMS.postToEvolve(j.id, "jobcard", "u-adm1").status;
  CMS.store.patch(s => { s.simulate.postingFailure = false; });
  return bad + "->" + CMS.postToEvolve(j.id, "jobcard", "u-adm1").status;
}), "failed->posted");
check("a dealer profile survives a round trip", await web.evaluate(() => {
  const p = JSON.parse(CMS.exportProfile());
  p.config.dealer.name = "Kimberley Motors";
  CMS.importProfile(JSON.stringify(p));
  return CMS.cfg().dealer.name;
}), "Kimberley Motors");
check("terminology reaches every surface", await web.evaluate(() => {
  CMS.store.patch(s => { s.config.terms.jobs = "Repair orders"; });
  return CMS.t("jobs");
}), "Repair orders");

console.log(results.join("\n"));
const failed = results.filter(r => r.indexOf("FAIL") === 2).length;
console.log("\n" + (results.length - failed) + "/" + results.length + " checks passed, " + errs.length + " browser errors");
errs.slice(0, 20).forEach(e => console.log("  " + e));
await browser.close();
process.exit(failed || errs.length ? 1 : 0);
