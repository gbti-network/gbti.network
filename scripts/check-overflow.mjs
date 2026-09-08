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
import { samplePages, coverageGaps, describeCoverage } from './lib/page-sample.mjs'; // sow-248: pages by content shape

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

// Page list: the standalone pages, then the content pages chosen BY SHAPE (scripts/lib/page-sample.mjs): per
// template the first page plus one page carrying each of a table, a code block, a carousel, an embed, a long
// inline code run and a wide image. sow-248: the previous list rendered the alphabetically-first page per
// template forever, so five articles with tables were never rendered and two overflowed a phone for weeks while
// this guard printed "45 page/viewport checks". Coverage is now a result: a present shape that was not sampled
// FAILS the guard below rather than being absent from a reassuring count.
const sample = samplePages(DIST);
const pages = [
  '/', '/articles/', '/projects/', '/prompts/', '/members/', '/membership/', '/revenue-model/', '/terms/', '/account/', '/utilities/',
  ...sample.pages,
  '/this-page-does-not-exist/', // the 404
];
// OVERFLOW_PAGES="/articles/x/,/articles/y/" adds specific pages to one run, for measuring a named page.
for (const extra of String(process.env.OVERFLOW_PAGES || '').split(',').map((s) => s.trim()).filter(Boolean)) if (!pages.includes(extra)) pages.push(extra);
const gaps = coverageGaps(sample.coverage);
if (gaps.length) {
  console.error('✗ overflow guard cannot claim coverage: a shape present on the site has no sampled page:');
  for (const g of gaps) console.error(`  - ${g.template}: ${g.shape} (${g.present} page${g.present === 1 ? '' : 's'} carry it)`);
  process.exit(1);
}

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
console.log(`✓ overflow guard passed: no horizontal overflow at ${VIEWPORTS.map(([, w]) => w).join('/')}px on ${pages.length} pages (${checked} renders). ${describeCoverage(sample)}`);
