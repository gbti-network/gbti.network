#!/usr/bin/env node
// Responsive guard: loads a representative built page of each template at mobile/tablet/desktop and fails if
// the document is wider than the viewport (horizontal overflow). Catches the CSS grid-blowout class of bug
// (a `1fr` track that should be `minmax(0,1fr)`, a grid that does not collapse) that static checks cannot see.
//
//   npm run check:overflow          # after `npm run build`
//
// Needs the dist/ build + a Chromium for Playwright. If Playwright or its browser is unavailable, the check
// SKIPS (exit 0) with a note, so it is safe to run anywhere; install with `npx playwright install chromium`.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const DIST = path.join(ROOT, 'dist');
const VIEWPORTS = [['mobile', 390], ['tablet', 768], ['desktop', 1440]];
// px slack. Horizontal-scroll carousels (the "Recently created" / "Editor's pick" sliders) clip their
// children but their own scroll container can spill 1-3 sub-pixel-rounded px from scroll-snap + gaps. 4px
// ignores that invisible noise while still catching every real break (the bugs this guards against were
// +16px to +398px). Raise only if a genuine sub-4px regression is ever confirmed harmless.
const TOLERANCE = 4;

function skip(msg) { console.log('· check:overflow skipped: ' + msg); process.exit(0); }

if (!fs.existsSync(DIST)) skip('dist/ not found (run `npm run build` first)');

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { skip('playwright is not installed'); }

// Representative page list: the standalone pages + the first slug found under each content template, so the
// guard adapts as content changes instead of hard-coding slugs.
function firstSlug(seg) {
  const dir = path.join(DIST, seg);
  if (!fs.existsSync(dir)) return null;
  for (const name of fs.readdirSync(dir).sort()) {
    if (fs.existsSync(path.join(dir, name, 'index.html'))) return `/${seg}/${name}/`;
  }
  return null;
}
const pages = [
  '/', '/articles/', '/products/', '/prompts/', '/members/', '/membership/', '/revenue-model/', '/terms/', '/account/', '/utilities/',
  firstSlug('articles'), firstSlug('products'), firstSlug('prompts'), firstSlug('members'),
  '/this-page-does-not-exist/', // the 404
].filter(Boolean);

// Minimal static server for dist (clean-URL + directory-index), free port.
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain' };
function resolveFile(urlPath) {
  const p = decodeURIComponent(urlPath.split('?')[0]);
  const cands = p.endsWith('/') ? [path.join(DIST, p, 'index.html')] : [path.join(DIST, p), path.join(DIST, p + '.html'), path.join(DIST, p, 'index.html')];
  for (const c of cands) { try { if (fs.statSync(c).isFile()) return c; } catch { /* next */ } }
  return null;
}
const server = http.createServer((req, res) => {
  let f = resolveFile(req.url); let status = 200;
  if (!f) { f = path.join(DIST, '404.html'); status = 404; }
  try {
    const body = fs.readFileSync(f); // read BEFORE writeHead so a read error never double-sends headers
    res.writeHead(status, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    if (!res.headersSent) res.writeHead(500);
    res.end('500');
  }
});
const port = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
await new Promise((r) => server.listen(port, '127.0.0.1', r));
const base = `http://127.0.0.1:${port}`;

let browser;
try { browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }); }
catch (e) { server.close(); skip('could not launch Chromium (run `npx playwright install chromium`): ' + e.message.split('\n')[0]); }

const failures = [];
let checked = 0;
const page = await browser.newPage();
for (const [, vw] of VIEWPORTS) {
  await page.setViewportSize({ width: vw, height: 900 });
  for (const url of pages) {
    try {
      await page.goto(base + url, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(120);
      const dw = await page.evaluate(() => document.documentElement.scrollWidth);
      checked++;
      if (dw > vw + TOLERANCE) failures.push(`${url} at ${vw}px: content is ${dw}px (overflows by ${dw - vw}px)`);
    } catch (e) {
      failures.push(`${url} at ${vw}px: load error ${e.message.split('\n')[0]}`);
    }
  }
}
await browser.close();
server.close();

if (failures.length) {
  console.error(`✗ overflow guard failed (${failures.length} of ${checked} checks):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(`✓ overflow guard passed (${checked} page/viewport checks, no horizontal overflow)`);
