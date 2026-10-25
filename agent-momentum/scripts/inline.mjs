// Folds dist-single/ into one self-contained HTML file: dist-single/agent-momentum.html
import { readFile, writeFile } from 'node:fs/promises';

const dir = new URL('../dist-single/', import.meta.url);
let html = await readFile(new URL('index.html', dir), 'utf8');

html = html.replace(/<link rel="stylesheet"[^>]*href="\/?([^"]+)"[^>]*>/g, (_, href) => `<style>__CSS:${href}__</style>`);
html = html.replace(/<script type="module" crossorigin src="\/?([^"]+)"><\/script>/g, (_, src) => `<script type="module">__JS:${src}__</script>`);
for (const [, kind, file] of [...html.matchAll(/__(CSS|JS):([^_]+)__/g)]) {
  const body = await readFile(new URL(file, dir), 'utf8');
  html = html.replace(`__${kind}:${file}__`, () => body.replace(/<\/script/g, '<\\/script'));
}
const svg = await readFile(new URL('../public/icon.svg', import.meta.url), 'utf8');
html = html
  .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(svg)}">`)
  .replace(/<link rel="apple-touch-icon"[^>]*>\n?/, '');
await writeFile(new URL('agent-momentum.html', dir), html);

// Fragment form (no doctype/html/head/body) for hosts that supply their own skeleton.
const fragment = html
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<\/?(html|head|body)[^>]*>\s*/g, '')
  .replace(/<meta charset[^>]*>\s*/, '')
  .replace(/<meta name="viewport"[^>]*>\s*/, '');
const t = fragment.match(/<title>.*?<\/title>\s*/)[0];
await writeFile(new URL('agent-momentum.fragment.html', dir), t + fragment.replace(t, ''));
console.log(`dist-single/agent-momentum.html  ${(html.length / 1024).toFixed(0)} kB`);
