// Device check: opens the built demo the way each kind of device would and fails if anything
// is broken. Run after build.py:  node src/check_devices.js   (exit code 1 = do not send)
// Screenshots go to .pdf-work/device-check/ so the result can be looked at, not just trusted.
// Limits: this runs Chromium. "iPhone" here means an iPhone-sized screen and Safari's user agent,
// not Safari's own engine, so a real iPhone and a real Android must still be checked by hand.
const pw = require('playwright');
const fs = require('fs'), path = require('path');

const OUT = path.join(__dirname, '..');
const SHOTS = path.join(OUT, '.pdf-work', 'device-check');
const DEMO = 'file://' + encodeURI(path.join(OUT, 'RB Brand Client Books - Interactive.html'));
const DEVICES = [
  { name: 'iPhone preview (WhatsApp / Files, no scripts)', device: 'iPhone 15 Pro', js: false },
  { name: 'iPhone Safari', device: 'iPhone 15 Pro', js: true },
  { name: 'Android Chrome', device: 'Pixel 7', js: true },
  { name: 'Laptop', viewport: { width: 1440, height: 900 }, js: true },
];
const BOOKS = { 'listing-presentation': 12, 'buyer-guide': 9, 'moving-day-pack': 4 };

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await pw.chromium.launch();
  let failed = 0;
  for (const D of DEVICES) {
    const problems = [];
    const ctx = await browser.newContext({ ...(D.device ? pw.devices[D.device] : { viewport: D.viewport }), javaScriptEnabled: D.js });
    const page = await ctx.newPage();
    page.on('pageerror', e => problems.push('script error: ' + e.message));
    await page.goto(DEMO, { waitUntil: 'load' });
    const slug = D.name.split(' ')[0].toLowerCase() + (D.js ? '' : '-preview');
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    if (!(await fits())) problems.push('home page scrolls sideways');

    if (!D.js) { // the reading view must show every page, with photos and calculator results
      const r = await page.evaluate(() => ({
        pages: document.querySelectorAll('.reader .page').length,
        noPhoto: [...document.querySelectorAll('.reader .ph[data-img]')].filter(e => !/url\(["']?data:image\//.test(getComputedStyle(e).backgroundImage)).length,
        emptyCalc: [...document.querySelectorAll('.reader [data-out]')].filter(e => !e.textContent.trim() || e.textContent.trim() === 'R 0').length,
        widest: Math.max(...[...document.querySelectorAll('.reader .page')].map(e => e.getBoundingClientRect().right)),
        vw: innerWidth }));
      const want = 2 * Object.values(BOOKS).reduce((a, b) => a + b);
      if (r.pages !== want) problems.push(`reading view shows ${r.pages} pages, expected ${want}`);
      if (r.noPhoto) problems.push(`${r.noPhoto} photo(s) missing in the reading view`);
      if (r.emptyCalc) problems.push(`${r.emptyCalc} calculator result(s) empty`);
      if (r.widest > r.vw + 1) problems.push('reading view pages are wider than the screen');
      await page.screenshot({ path: path.join(SHOTS, `${slug}.png`) });
    } else { // every book must open in both languages, show its pages and come back
      for (const lang of ['en', 'af']) {
        await page.evaluate(l => setLang(l), lang);
        for (const [book, count] of Object.entries(BOOKS)) {
          await page.click(`[data-hub="${lang}"] a[data-book="${book}"]`);
          const frame = page.frameLocator('#frame');
          await frame.locator('#quietOpen').click();
          const f = page.frames().find(x => x !== page.mainFrame());
          const r = await f.evaluate(() => ({
            lang: document.documentElement.lang,
            pages: document.querySelectorAll('#book .page').length,
            shown: document.querySelectorAll('#book .page.show').length,
            noPhoto: [...document.querySelectorAll('#book .ph[data-img]')].filter(e => !/url\(["']?data:image\//.test(getComputedStyle(e).getPropertyValue('--img'))).length,
            fits: document.documentElement.scrollWidth <= innerWidth + 1 }));
          if (r.lang !== lang) problems.push(`${book} opened in "${r.lang}", expected "${lang}"`);
          if (r.pages !== count) problems.push(`${book} (${lang}) has ${r.pages} pages, expected ${count}`);
          if (r.shown !== 1) problems.push(`${book} (${lang}) shows ${r.shown} pages at once, expected 1`);
          if (r.noPhoto) problems.push(`${book} (${lang}): ${r.noPhoto} photo(s) missing`);
          if (!r.fits) problems.push(`${book} (${lang}) scrolls sideways`);
          await frame.locator('#next').click(); await page.waitForTimeout(950);
          if (lang === 'en' && book === 'listing-presentation') await page.screenshot({ path: path.join(SHOTS, `${slug}.png`) });
          await page.goBack(); await page.waitForTimeout(150);
          if (!(await page.evaluate(() => document.getElementById('viewer').hidden))) problems.push(`Back did not return from ${book}`);
        }
      }
    }
    await ctx.close();
    console.log(`${problems.length ? '✗' : '✓'} ${D.name}${problems.map(p => '\n    - ' + p).join('')}`);
    failed += problems.length ? 1 : 0;
  }
  await browser.close();
  console.log(failed ? `\n${failed} device check(s) failed: fix before sending.` : `\nAll device checks passed. Screenshots: ${path.relative(OUT, SHOTS)}/`);
  process.exit(failed ? 1 : 0);
})();
