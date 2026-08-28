#!/usr/bin/env node
// sow-215 Check B: does the WorkBench preview APPLY the article shell contract, or merely import it?
//
//   npm run check:preview-shell
//
// WHY THIS EXISTS. sow-215 defect 5 was "the WorkBench preview silently diverged from the published article
// layout", found by the owner putting two pages side by side. sow-214 fixed the root cause by making both
// read one contract (src/lib/article-page.mjs). The only guard on that is
// test/article-page.test.mjs:245, which greps preview-shells.mjs for six identifiers. It is TOKEN PRESENCE:
// it passes on a preview that imports the contract and then renders something else, which is this SOW's own
// failure class one layer over. This check asserts the APPLIED DOM instead.
//
// WHY A BROWSER. applyPreviewShell mutates a live Document (className, hidden, insertBefore, appendChild,
// insertAdjacentHTML). The repo has no DOM implementation in the node suite and no DOM-test convention, and
// the preview's own output never reaches dist: dist/workbench/preview/index.html contains zero art-j-,
// art-e- or art-c- strings because the reshape runs client-side, behind a ?slug= param and a credentialed
// draft fetch. So there is nothing for a dist guard to read.
//
// WHY A COMPONENT HARNESS RATHER THAN THE REAL PAGE. Driving the real preview would need a served dist, a
// slug, a session and a stubbed membership endpoint. The harness serves the same skeleton preview.astro
// ships and calls the real applyPreviewShell against it, which is what the assertion is actually about. It
// also exercises ALL THREE layouts; the real page cannot, because every one of the 53 articles on disk is
// journal, so editorial and card have zero published subjects and are reachable only through the editor's
// layout picker. That is precisely where drift hides.
//
// NOT IN verify:dist, deliberately, per the SOW: do not force a browser comparison into the blocking path.
// It is standalone like check:overflow.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { ARTICLE_LAYOUTS, articleShell } from '../src/lib/article-page.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const SKELETON = path.join(ROOT, 'scripts/fixtures/preview-skeleton.html');

// A GUARD THAT SKIPS GREEN IN CI IS WORSE THAN NO GUARD (@QAmaster, 2026-08-28). There are TWO skip paths
// here, not one: the playwright import, and the Chromium launch below, which catches ANY exception, so a
// sandbox restriction or an OOM would come back green as readily as a missing browser. Wiring this into CI
// without closing that would buy a permanent silent skip reporting success forever, which is the exact
// vacuous-pass class sow-215 exists to catch. REQUIRE_BROWSER=1 turns every skip into a failure, and the
// workflow sets it. Locally the skip stays, so anyone without a browser installed can still run the check.
const REQUIRE_BROWSER = process.env.REQUIRE_BROWSER === '1';
function skip(msg) {
  if (REQUIRE_BROWSER) die(`REQUIRE_BROWSER is set, so a missing browser is a failure rather than a skip: ${msg}`);
  console.log('· check:preview-shell skipped: ' + msg);
  process.exit(0);
}
function die(msg) { console.error('✗ check:preview-shell: ' + msg); process.exit(1); }

// A MISSING FIXTURE IS A FAILURE, NOT A SKIP. A skip is only ever for a missing browser. If the skeleton is
// gone the check cannot do its job and saying so quietly would be the vacuous pass this SOW catalogues.
if (!fs.existsSync(SKELETON)) die(`skeleton fixture missing at ${path.relative(ROOT, SKELETON)}`);

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { skip('playwright is not installed'); }

const port = await new Promise((res) => {
  const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port: p } = s.address(); s.close(() => res(p)); });
});
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  // Two routes only: the skeleton, and any src/ module the page imports, so the harness runs the REAL
  // preview-shells.mjs and article-page.mjs rather than a copy that could drift from them.
  const file = url === '/' ? SKELETON : path.join(ROOT, url.replace(/^\/+/, ''));
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end('nf'); return; }
  const body = fs.readFileSync(file);
  res.writeHead(200, { 'content-type': url.endsWith('.mjs') ? 'text/javascript' : 'text/html' });
  res.end(body);
});
await new Promise((r) => server.listen(port, '127.0.0.1', r));

let browser;
try { browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }); }
catch (e) { server.close(); skip('could not launch Chromium (run `npx playwright install chromium`): ' + e.message.split('\n')[0]); }

const failures = [];
let asserted = 0;
const check = (ok, layout, what) => { asserted++; if (!ok) failures.push(`${layout}: ${what}`); };

const page = await browser.newPage();
for (const layout of ARTICLE_LAYOUTS) {
  const shell = articleShell(layout);
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load', timeout: 30000 });
  const got = await page.evaluate(async (lay) => {
    const { applyPreviewShell } = await import('/src/lib/preview-shells.mjs');
    applyPreviewShell(document, {
      type: 'post', fm: { layout: lay, title: 'T' }, slug: 's', cats: [], labels: {}, catPath: 'Cat',
      hero: { image: 'cover.png', alt: 'A' }, esc: (v) => String(v ?? ''), asset: (v) => String(v ?? ''), itemPath: 'members/x/posts/s/index.md',
    });
    const grid = document.querySelector('[data-h-grid]');
    const rail = document.querySelector('[data-h-rail]');
    const col = document.querySelector('[data-h-col]');
    const wrap = grid?.parentElement ?? null;
    return {
      grid: grid?.className ?? null,
      column: col?.className ?? null,
      rail: rail?.className ?? null,
      railHidden: rail?.hidden ?? null,
      wrap: wrap?.className ?? null,
      // Index of the rail among the grid's element children, for railLast.
      railIndex: grid && rail ? [...grid.children].indexOf(rail) : -1,
      childCount: grid ? grid.children.length : 0,
      firstChildClass: grid?.firstElementChild?.className ?? null,
      // Where the lead landed: a sibling before the grid, or inside the column.
      leadBeforeGrid: Boolean(wrap && [...wrap.children].some((n, i) => i < [...wrap.children].indexOf(grid) && /art-|h1|eyebrow/.test(n.className || ''))),
      heroHidden: document.querySelector('.pd-hero')?.hasAttribute('hidden') ?? null,
      barHidden: document.querySelector('.pd-bar')?.hasAttribute('hidden') ?? null,
    };
  }, layout);

  check(got.grid === shell.grid, layout, `grid class is "${got.grid}", contract says "${shell.grid}"`);
  check(got.column === shell.column, layout, `column class is "${got.column}", contract says "${shell.column}"`);
  check(got.heroHidden === true, layout, 'the product hero is not hidden');
  check(got.barHidden === true, layout, 'the product spec bar is not hidden');

  if (shell.rail) {
    check(got.rail === shell.rail, layout, `rail class is "${got.rail}", contract says "${shell.rail}"`);
    check(got.railHidden === false, layout, 'the rail is hidden but the contract defines one');
  } else {
    check(got.railHidden === true, layout, 'the contract has no rail but the preview shows one');
  }

  // THE DOUBLED MEASURE. The published page wraps the grid in shell.section ("art-shell band"); the preview
  // ships .pd-wrap, a 1000px measure, and the grid then carries art-wrap at 1140px. Nesting them renders the
  // preview 140px narrower with doubled side padding than the page it previews. The PROMPT branch already
  // found and fixed exactly this (see its own comment about the reading column being ~20% narrower); the
  // article branch was left behind, which is the partial-fix hole this SOW is about.
  check(got.wrap === shell.section, layout, `the grid's wrapper is "${got.wrap}", contract section is "${shell.section}" (a leftover .pd-wrap nests a second, narrower measure inside art-wrap)`);

  if (shell.spacer) {
    check(got.firstChildClass === shell.spacer, layout, `first grid child is "${got.firstChildClass}", contract spacer is "${shell.spacer}"`);
  }
  if (shell.railLast && shell.rail) {
    check(got.railIndex === got.childCount - 1, layout, `rail is at index ${got.railIndex} of ${got.childCount}, contract says it is last`);
  }
}

await browser.close();
server.close();

// A RUN THAT ASSERTED NOTHING IS A FAILURE. Exit zero here would report success for a check that never ran.
if (asserted === 0) die('zero assertions ran, so this result is not evidence');

if (failures.length) {
  console.error(`✗ preview shell drift: ${failures.length} of ${asserted} assertions failed across ${ARTICLE_LAYOUTS.length} layouts`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(`✓ preview applies the article shell contract (${asserted} assertions, ${ARTICLE_LAYOUTS.length} layouts)`);
