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

  // ---- What agents actually send: the books themselves, a saved client copy and the client PDF ----
  const report = (name, problems) => { console.log(`${problems.length ? '✗' : '✓'} ${name}${problems.map(p => '\n    - ' + p).join('')}`); failed += problems.length ? 1 : 0; };
  const fileUrl = f => 'file://' + encodeURI(path.join(OUT, f));
  const readable = async (page, want) => page.evaluate(want => {   // every page visible and on screen, no book controls
    const pages = [...document.querySelectorAll('#book .page')];
    const shown = pages.filter(p => getComputedStyle(p).visibility === 'visible' && p.getBoundingClientRect().height > 0);
    const widest = Math.max(...pages.map(p => p.getBoundingClientRect().right));
    const p = [];
    if (shown.length !== want) p.push(`${shown.length} of ${want} pages readable`);
    if (widest > innerWidth + 1) p.push('pages are wider than the screen');
    if (document.documentElement.scrollWidth > innerWidth + 1) p.push('scrolls sideways');
    if (getComputedStyle(document.getElementById('intro')).display !== 'none') p.push('opening screen covers the pages');
    return p;
  }, want);
  {
    const problems = [];
    const ctx = await browser.newContext({ ...pw.devices['iPhone 15 Pro'], javaScriptEnabled: false });
    for (const sfx of ['', '.af']) for (const [book, count] of Object.entries(BOOKS)) {
      const page = await ctx.newPage();
      await page.goto(fileUrl(`${book}${sfx}.html`), { waitUntil: 'load' });
      (await readable(page, count)).forEach(x => problems.push(`${book}${sfx}.html: ${x}`));
      if (book === 'buyer-guide' && sfx === '') await page.screenshot({ path: path.join(SHOTS, 'iphone-preview-book.png') });
      await page.close();
    }
    await ctx.close();
    report('Each book file in the iPhone preview (both languages)', problems);
  }
  {
    const problems = [];
    // an agent personalises the Listing Presentation and saves a client copy
    const agent = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    const a = await agent.newPage();
    a.on('dialog', d => d.accept());
    await a.goto(fileUrl('listing-presentation.html'));
    await a.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await a.reload(); await a.click('#quietOpen'); await a.click('#editBtn');
    await a.$eval('.who', e => { e.textContent = 'Device Check Seller'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await a.click('#editBtn');
    const [dl] = await Promise.all([a.waitForEvent('download'), a.click('#saveBtn')]);
    const copy = path.join(SHOTS, 'client-copy.html'); await dl.saveAs(copy);
    // the client PDF: buttons must stay tappable links
    await a.emulateMedia({ media: 'print' });
    const pdf = path.join(SHOTS, 'client.pdf');
    await a.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true });
    await a.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await agent.close();
    const links = require('child_process').execFileSync('python3', ['-c', `
import sys; from pypdf import PdfReader
uris = [a.get_object()['/A'].get('/URI', '') for p in PdfReader(sys.argv[1]).pages for a in p.get('/Annots', []) if '/A' in a.get_object()]
print(len(PdfReader(sys.argv[1]).pages), sum('wa.me' in u for u in uris), sum(u.startswith('tel:') for u in uris))`, pdf]).toString().trim().split(' ').map(Number);
    if (links[0] !== 12) problems.push(`client PDF has ${links[0]} pages, expected 12`);
    if (!links[1]) problems.push('client PDF: WhatsApp button is not a link');
    if (!links[2]) problems.push('client PDF: call button is not a link');
    // the client opens the saved copy on an iPhone (no scripts) and on Android (scripts)
    const ip = await browser.newContext({ ...pw.devices['iPhone 15 Pro'], javaScriptEnabled: false });
    const c = await ip.newPage(); await c.goto('file://' + encodeURI(copy));
    (await readable(c, 12)).forEach(x => problems.push('client copy on iPhone: ' + x));
    if (!(await c.textContent('.who')).includes('Device Check Seller')) problems.push('client copy on iPhone: personalised name missing');
    if (!/R [1-9]/.test(await c.textContent('[data-out="net"]'))) problems.push('client copy on iPhone: walk-away figure empty');
    await c.screenshot({ path: path.join(SHOTS, 'iphone-preview-client-copy.png') });
    await ip.close();
    const an = await browser.newContext({ ...pw.devices['Pixel 7'] });
    const d = await an.newPage(); d.on('pageerror', e => problems.push('client copy on Android: script error: ' + e.message));
    await d.goto('file://' + encodeURI(copy)); await d.click('#quietOpen');
    const shown = await d.evaluate(() => document.querySelectorAll('#book .page.show').length);
    if (shown !== 1) problems.push(`client copy on Android: ${shown} pages shown at once, expected book mode`);
    if (await d.isVisible('#editBtn')) problems.push('client copy on Android: Edit button visible to the client');
    await an.close();
    report('Client copy and client PDF (saved by an agent, opened by a client)', problems);
  }
  await browser.close();
  console.log(failed ? `\n${failed} device check(s) failed: fix before sending.` : `\nAll device checks passed. Screenshots: ${path.relative(OUT, SHOTS)}/`);
  process.exit(failed ? 1 : 0);
})();
