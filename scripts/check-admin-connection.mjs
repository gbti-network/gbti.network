#!/usr/bin/env node
// sow-334 guard: the built /admin/ page keeps the superadmin client it set. DRIVES the built site.
//
//   npm run check:admin-connection          # after `npm run build`
//
// WHY A BROWSER. Every client-ui element reads ONE shared client, and whichever setClient() lands last wins. The site
// header sets one on every page for the notification bell; /admin/ sets a richer one (isSuperadmin attaches the
// Channels methods). Both wait on the same sign-in answer, so the order is a race. Measured on the built page before
// the fix: the header's client replaced the admin page's in 19 of 30 runs, and each time the Channels manager threw
// "Maximum call stack size exceeded" and showed "Could not load the channel settings." No source read shows a race.
//
// WHAT IT DRIVES. /admin/ from dist, signed in as a superadmin with every signup Worker call stubbed (credentialed
// CORS, as the real Worker answers), RUNS times in each of three situations that move the timing: a cold load, a
// warm status cache (a second visit inside its two minutes), and the extension's member signal already on the page.
// Each run must end with the Channels manager holding a client that carries its methods, and no stack overflow. A
// run where the manager never received a client is a failure, not a skip, so a harness that mounts nothing cannot
// pass.
//
// Needs dist + a Chromium for Playwright. Skips (exit 0) without them locally; REQUIRE_BROWSER=1 makes a skip a
// failure, and zero checks is never a pass (scripts/lib/browser-guard.mjs). GUARD_DIST=<dir> drives another build.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireBrowser, skipOrDie, verdict } from './lib/browser-guard.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const DIST = process.env.GUARD_DIST ? path.resolve(process.env.GUARD_DIST) : path.join(ROOT, 'dist');
const NAME = 'check:admin-connection';
const GATE = requireBrowser();
const RUNS = Number(process.env.ADMIN_CONNECTION_RUNS || 10);
const SIGNUP = 'https://signup.gbti.network';
const STATUS = { ok: true, login: 'guard-superadmin', github_id: 1, role: 'superadmin', effectiveStatus: 'paid', status: 'paid', paidTier: 'creator' };

function skip(msg) { skipOrDie(NAME, msg, { requireBrowser: GATE }); }

if (!fs.existsSync(DIST)) skip('dist/ not found (run `npm run build` first)');
if (!fs.existsSync(path.join(DIST, 'admin', 'index.html'))) {
  console.error(`✗ ${NAME}: dist has no admin/index.html, so there is nothing to drive`);
  process.exit(1);
}
let chromium;
try { ({ chromium } = await import('playwright')); } catch { skip('playwright is not installed'); }

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let f = path.join(DIST, decodeURIComponent((req.url || '/').split('?')[0]));
  try { if (fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); } catch { /* 404 below */ }
  if (!f.startsWith(DIST) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

let browser;
try { browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }); }
catch (e) { server.close(); skip('could not launch Chromium (run `npx playwright install chromium`): ' + e.message.split('\n')[0]); }

async function run(situation) {
  const ctx = await browser.newContext();
  try {
    await ctx.addCookies([{ name: 'gbti_csrf', value: 'guard-csrf', url: ORIGIN }]);
    await ctx.route(`${SIGNUP}/**`, (route) => {
      const req = route.request();
      const cors = { 'access-control-allow-origin': ORIGIN, 'access-control-allow-credentials': 'true', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': req.headers()['access-control-request-headers'] || 'content-type', 'cache-control': 'no-store' };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const body = new URL(req.url()).pathname.endsWith('/membership/status') ? STATUS : {};
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    if (situation === 'extension signal') {
      await page.addInitScript((s) => { document.documentElement.dataset.gbtiMember = JSON.stringify({ authenticated: true, login: s.login, githubId: '1', role: 'superadmin', membership: 'paid', paidTier: 'creator' }); }, STATUS);
    }
    if (situation === 'warm status cache') {
      await page.goto(`${ORIGIN}/admin/`, { waitUntil: 'load' });
      await page.waitForTimeout(1500);
      errors.length = 0;
    }
    await page.goto(`${ORIGIN}/admin/`, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    const r = await page.evaluate(() => {
      const el = document.querySelector('gbti-channel-map-manager');
      const c = el && el.client;
      return { hasClient: !!c, superadminClient: !!(c && typeof c.contentChannelPool === 'function') };
    });
    return { ...r, overflow: errors.some((e) => /call stack/i.test(e)) };
  } finally { await ctx.close(); }
}

const failures = [];
let checked = 0;
try {
  for (const situation of ['cold load', 'warm status cache', 'extension signal']) {
    let replaced = 0; let overflow = 0; let noClient = 0;
    for (let i = 0; i < RUNS; i++) {
      const r = await run(situation);
      if (!r.hasClient) { noClient++; continue; }
      checked++;
      if (!r.superadminClient) replaced++;
      if (r.overflow) overflow++;
    }
    console.log(`${situation}: ${RUNS} runs, replaced ${replaced}, stack overflow ${overflow}, never connected ${noClient}`);
    if (replaced) failures.push(`${situation}: another client replaced the admin page's superadmin client in ${replaced} of ${RUNS} runs, so the Channels manager lost its methods`);
    if (overflow) failures.push(`${situation}: the Channels manager overflowed the stack in ${overflow} of ${RUNS} runs`);
    if (noClient) failures.push(`${situation}: the Channels manager never received a client in ${noClient} of ${RUNS} runs, so those runs prove nothing (a stub or sign-in gap in this harness)`);
  }
} catch (e) {
  failures.push(`the harness itself threw: ${String(e.message).split('\n')[0]}`);
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.error(`✗ ${NAME} failed:`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
const v = verdict({ checked, loadFailures: 0, failures: 0, requireBrowser: GATE });
if (!v.ok) { console.error(`✗ ${NAME} cannot claim a pass: ${v.reason}`); process.exit(1); }
console.log(`✓ ${NAME} passed: ${checked} runs of the built admin page kept the superadmin client.`);
