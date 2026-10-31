// Make the showcase PDFs, in English and Afrikaans, each page tagged "Concept demo":
//   pdf/RB Brand Client Books - Preview.pdf (and the Afrikaans Voorskou)  overview page + all three books
//   pdf/RB Brand <Book>.pdf                                                each book on its own
// Run after build.py:  node src/make_pdf.js   (needs Playwright; merges with Python's pypdf)
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');

const OUT = path.join(__dirname, '..');
const WORK = path.join(OUT, '.pdf-work');
const DEST = path.join(OUT, 'pdf');
const tag = text => `.page::after{content:"${text}";position:absolute;top:20px;right:24px;z-index:9;font:600 9px 'Noto Sans',sans-serif;
  letter-spacing:.28em;text-transform:uppercase;color:#E0A458;background:rgba(36,46,67,.88);padding:5px 10px;border-radius:20px}`;
const LANGS = [
  { suffix: '', all: 'RB Brand Client Books - Preview', tag: 'Concept demo',
    books: [['listing-presentation', 'RB Brand Listing Presentation'], ['buyer-guide', 'RB Brand Buyer Guide'], ['moving-day-pack', 'RB Brand Moving Day Pack']] },
  { suffix: '.af', all: 'RB Brand Kliëntboeke - Voorskou', tag: 'Konsepdemo',
    books: [['listing-presentation', 'RB Brand Verkopersaanbieding'], ['buyer-guide', 'RB Brand Kopersgids'], ['moving-day-pack', 'RB Brand Trekdagpakket']] },
];

const merge = (target, title, parts, author = 'Charné Robilliard') => execFileSync('python3', ['-c', `
import sys; from pypdf import PdfWriter
w = PdfWriter()
for p in sys.argv[4:]: w.append(p)
w.add_metadata({'/Title': sys.argv[2], '/Author': sys.argv[3], '/Creator': 'StallFlow', '/Producer': 'StallFlow'})
w.write(sys.argv[1])`, target, title, author, ...parts]);

(async () => {
  fs.mkdirSync(DEST, { recursive: true });
  const browser = await chromium.launch();
  const print = async (file, out, css) => {
    const page = await browser.newPage();
    await page.goto('file://' + file, { waitUntil: 'load' });
    if (css) await page.addStyleTag({ content: css });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({ path: out, preferCSSPageSize: true, printBackground: true });
    await page.close();
    return out;
  };
  for (const L of LANGS) {
    const overview = await print(path.join(WORK, `overview${L.suffix}.html`), path.join(WORK, `overview${L.suffix}.pdf`));
    const parts = [overview];
    for (const [stem, name] of L.books) {
      const one = await print(path.join(OUT, `${stem}${L.suffix}.html`), path.join(WORK, `${stem}${L.suffix}.pdf`), tag(L.tag));
      parts.push(one);
      const single = path.join(DEST, `${name}.pdf`);
      merge(single, name, [one]);
      console.log('built', path.relative(OUT, single));
    }
    const all = path.join(DEST, `${L.all}.pdf`);
    merge(all, L.all, parts);
    console.log('built', path.relative(OUT, all));
  }
  // the one-page pricing proposal, from StallFlow
  const prop = await print(path.join(__dirname, 'proposal.html'), path.join(WORK, 'proposal.pdf'));
  const propOut = path.join(OUT, 'StallFlow Proposal - RB Brand Client Books.pdf');
  merge(propOut, 'StallFlow Proposal - RB Brand Client Books', [prop], 'Jacques Robilliard');
  console.log('built', path.relative(OUT, propOut));
  await browser.close();
})();
