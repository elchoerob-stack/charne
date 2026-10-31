// Make the showcase PDFs, in English and Afrikaans, each page tagged "Concept demo":
//   pdf/RB-Brand-Books-Concept-Demo(-AF).pdf  overview page + all three books
//   pdf/<Book>(-AF).pdf                       each book on its own
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
  { suffix: '', file: '', tag: 'Concept demo', title: 'RB Brand Books - Concept Demo',
    books: [['listing-presentation', 'Listing-Presentation'], ['buyer-guide', 'Buyer-Guide'], ['moving-day-pack', 'Moving-Day-Pack']] },
  { suffix: '.af', file: '-AF', tag: 'Konsepdemo', title: 'RB Brand Boeke - Konsepdemo',
    books: [['listing-presentation', 'Verkopersaanbieding'], ['buyer-guide', 'Kopersgids'], ['moving-day-pack', 'Trekdagpakket']] },
];

const merge = (target, title, parts) => execFileSync('python3', ['-c', `
import sys; from pypdf import PdfWriter
w = PdfWriter()
for p in sys.argv[3:]: w.append(p)
w.add_metadata({'/Title': sys.argv[2]})
w.write(sys.argv[1])`, target, title, ...parts]);

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
      merge(single, `${name.replace(/-/g, ' ')} - ${L.tag}`, [one]);
      console.log('built', path.relative(OUT, single));
    }
    const all = path.join(DEST, `RB-Brand-Books-Concept-Demo${L.file}.pdf`);
    merge(all, L.title, parts);
    console.log('built', path.relative(OUT, all));
  }
  await browser.close();
})();
