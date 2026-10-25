// Renders public/icon.svg to the PNG sizes the PWA manifest and iOS need.
// Run with: npm run icons  (uses the Playwright Chromium already installed)
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const svg = await readFile(new URL('../public/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();

async function render(file, size, { padding = 0, rounded = true } = {}) {
  const inner = size - padding * 2;
  const body = rounded ? svg : svg.replace('rx="112"', 'rx="0"');
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:#14284B;display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px">
      <div style="width:${inner}px;height:${inner}px">${body.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div>
    </body></html>`,
  );
  await page.screenshot({ path: new URL(`../public/${file}`, import.meta.url).pathname, omitBackground: false });
}

await render('icon-192.png', 192, { rounded: false });
await render('icon-512.png', 512, { rounded: false });
await render('icon-maskable-512.png', 512, { padding: 56, rounded: false });
await render('apple-touch-icon.png', 180, { rounded: false });
await browser.close();
console.log('icons written');
