// Make the concept-demo PDF: overview page + all three books, each page tagged "Concept demo".
// Run after build.py:  node src/make_pdf.js   (needs Playwright; merges with Python's pypdf)
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');

const OUT = path.join(__dirname, '..');
const WORK = path.join(OUT, '.pdf-work');
const TAG = `.page::after{content:"Concept demo";position:absolute;top:20px;right:24px;z-index:9;font:600 9px 'Noto Sans',sans-serif;
  letter-spacing:.28em;text-transform:uppercase;color:#E0A458;background:rgba(36,46,67,.88);padding:5px 10px;border-radius:20px}`;

(async () => {
  const browser = await chromium.launch();
  const parts = [];
  const print = async (file, out, tag) => {
    const page = await browser.newPage();
    await page.goto('file://' + file, { waitUntil: 'load' });
    if (tag) await page.addStyleTag({ content: TAG });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({ path: out, preferCSSPageSize: true, printBackground: true });
    await page.close(); parts.push(out);
  };
  await print(path.join(WORK, 'overview.html'), path.join(WORK, '0-overview.pdf'), false);
  for (const [i, b] of ['listing-presentation', 'buyer-guide', 'moving-day-pack'].entries())
    await print(path.join(OUT, b + '.html'), path.join(WORK, `${i + 1}-${b}.pdf`), true);
  await browser.close();
  const target = path.join(OUT, 'RB-Brand-Books-Concept-Demo.pdf');
  execFileSync('python3', ['-c', `
import sys; from pypdf import PdfWriter
w = PdfWriter()
for p in sys.argv[2:]: w.append(p)
w.add_metadata({'/Title': 'RB Brand Books - Concept Demo'})
w.write(sys.argv[1])`, target, ...parts]);
  console.log('built', path.basename(target));
})();
