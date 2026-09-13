#!/usr/bin/env node
// sow-330 guard: saves and collections started on the website stay on the website. DRIVES the built site.
//
//   npm run check:save-controls          # after `npm run build`
//
// WHY A BROWSER. sow-316 shipped the heart (<gbti-favorite>) and Save pill (<gbti-collection>) with unit tests and
// source audits, and every control on the site was still inert for anyone with the extension installed: the upgrade
// stood down for the extension marker, and the extension cannot upgrade page elements from its isolated world. No
// grep could see that. This guard clicks.
//
// WHAT IT DRIVES. One page per surface class, chosen from dist at run time (a content page, the feed, the projects
// directory, a member profile, a share page). Every signup Worker call is stubbed (credentialed CORS, as the real
// Worker answers) and any OTHER signup request is aborted and REPORTED, so a stub gap cannot pass as a clean run.
// The extension marker is stamped the way extension/src/content.mjs stamps it.
//
//   A  signed in + extension (every surface): the heart upgrades, a click POSTs a favorite, Save opens its picker,
//      nothing is handed to the extension, no sign-in dialog.
//   B  signed out + extension (every surface): a heart click opens the PLAIN website sign-in dialog, nothing is handed
//      to the extension, and the save the visitor started is remembered for after sign-in.
//   C  the upgrade window (content page + feed): signed in, the session answer delayed; a click on the still-inert
//      heart shows no sign-in dialog and completes exactly one favorite once the session resolves. Plus a slow
//      network (content page): the heart's own code arrives 12 seconds late, longer than a cut-off may give up; and
//      when that code fails to load, the held click is released promptly to the plain website sign-in.
//   D  return after sign-in (content page): a remembered save completes exactly once on load. Controls: a save
//      remembered for another page, an expired one, and a bare URL parameter each do nothing.
//   E  replay safety (content page): a remembered save for an item already favorited writes nothing, so a replay can
//      never turn a favorite off.
//
// Needs dist + a Chromium for Playwright. Skips (exit 0) without them locally; REQUIRE_BROWSER=1 makes a skip a
// failure, and zero checks is never a pass (scripts/lib/browser-guard.mjs). GUARD_DIST=<dir> drives another build.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { requireBrowser, skipOrDie, verdict } from './lib/browser-guard.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const DIST = process.env.GUARD_DIST ? path.resolve(process.env.GUARD_DIST) : path.join(ROOT, 'dist');
const GATE = requireBrowser();
const SIGNUP = 'https://signup.gbti.network';
const PENDING_KEY = 'gbti_pending_save_v1';

function skip(msg) { skipOrDie('check:save-controls', msg, { requireBrowser: GATE }); }

if (!fs.existsSync(DIST)) skip('dist/ not found (run `npm run build` first)');
let chromium;
try { ({ chromium } = await import('playwright')); } catch { skip('playwright is not installed'); }

// ---- pick one page per surface class that renders a heart ------------------------------------------------------

const hasHeart = (file) => { try { return /<gbti-favorite\b/.test(fs.readFileSync(file, 'utf8')); } catch { return false; } };
const urlOf = (file) => '/' + path.relative(DIST, file).split(path.sep).join('/').replace(/index\.html$/, '');

/** First index.html under dist/<dir> (at the given depth) that renders a heart, or null. */
function firstPage(dir, depth, extraTest = () => true) {
  const start = path.join(DIST, dir);
  if (!fs.existsSync(start)) return null;
  const walk = (d, level) => {
    let names;
    try { names = fs.readdirSync(d).sort(); } catch { return null; }
    if (level === depth) {
      const f = path.join(d, 'index.html');
      return fs.existsSync(f) && hasHeart(f) && extraTest(f) ? f : null;
    }
    for (const n of names) {
      const p = path.join(d, n);
      try { if (!fs.statSync(p).isDirectory()) continue; } catch { continue; }
      const hit = walk(p, level + 1);
      if (hit) return hit;
    }
    return null;
  };
  return walk(start, 0);
}

const CONTENT_ACTIONS = (f) => /data-gbti-region="actions"/.test(fs.readFileSync(f, 'utf8'));
const surfaces = [
  ['content page', firstPage('projects', 1, CONTENT_ACTIONS)],
  ['feed', firstPage('feeds', 0) ?? firstPage('', 0)],
  ['projects directory', firstPage('projects', 0)],
  ['member profile', firstPage('members', 1)],
  ['share page', firstPage('shares', 2)],
];

const failures = [];
const unreachable = surfaces.filter(([, f]) => !f).map(([name]) => name);
for (const name of unreachable) failures.push(`${name}: no built page of this class renders a heart, so it cannot be driven (a guard that cannot reach a surface is not a pass)`);
const pages = Object.fromEntries(surfaces.filter(([, f]) => f).map(([name, f]) => [name, urlOf(f)]));

// ---- serve dist -------------------------------------------------------------------------------------------------

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain' };
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
    const body = fs.readFileSync(f);
    res.writeHead(status, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    res.end(body);
  } catch { if (!res.headersSent) res.writeHead(500); res.end('500'); }
});
const port = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
await new Promise((r) => server.listen(port, '127.0.0.1', r));
const base = `http://127.0.0.1:${port}`;

let browser;
try { browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }); }
catch (e) { server.close(); skip('could not launch Chromium (run `npx playwright install chromium`): ' + e.message.split('\n')[0]); }

// ---- one drive ---------------------------------------------------------------------------------------------------

const MEMBER = { ok: true, login: 'guard-member', github_id: 4242, effectiveStatus: 'paid', status: 'paid', role: 'member', paidTier: 'member' };
const cors = { 'access-control-allow-origin': base, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'content-type, x-gbti-csrf', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
const json = (status, body) => ({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });

/**
 * Open `url` in a fresh context and hand back the page plus what the stubs saw.
 * signedIn: set the gbti_csrf cookie and answer /membership/status as a member (else 401).
 * statusDelayMs: hold the status answer, to open the upgrade window. favorites: the member's existing favorites.
 * seed: a value written to the pending-save key before any page script runs.
 */
async function open(url, { signedIn = false, statusDelayMs = 0, slowElementsMs = 0, failElements = false, favorites = [], seed = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const seen = { posts: [], unstubbed: [], slowed: 0 };
  let activity = { favorites: [...favorites], collections: [] };
  if (signedIn) await context.addCookies([{ name: 'gbti_csrf', value: 'guard-csrf', url: base }]);
  // A slow phone network: the heart's and Save's own modules arrive late (or never) while the session answers at once.
  if (slowElementsMs || failElements) {
    await context.route(`${base}/_astro/**`, async (route) => {
      if (/^gbti-(favorite|collection)\.[\w-]+\.js$/.test(path.basename(new URL(route.request().url()).pathname))) {
        seen.slowed += 1;
        if (slowElementsMs) await new Promise((r) => setTimeout(r, slowElementsMs));
        if (failElements) return route.abort();
      }
      return route.continue();
    });
  }
  await context.route(`${SIGNUP}/**`, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (u.pathname === '/membership/status') {
      if (statusDelayMs) await new Promise((r) => setTimeout(r, statusDelayMs));
      return route.fulfill(signedIn ? json(200, MEMBER) : json(401, { ok: false, error: 'not-authenticated' }));
    }
    if (u.pathname === '/membership/activity') {
      if (req.method() === 'GET') return route.fulfill(json(200, { ok: true, activity }));
      let body = {};
      try { body = JSON.parse(req.postData() || '{}'); } catch { /* recorded as {} */ }
      seen.posts.push(body);
      if (body.action === 'favorite') {
        const rest = activity.favorites.filter((f) => !(f.type === body.type && f.slug === body.slug));
        activity = { ...activity, favorites: body.on ? [...rest, { type: body.type, slug: body.slug }] : rest };
      }
      return route.fulfill(json(200, { ok: true, activity }));
    }
    seen.unstubbed.push(`${req.method()} ${u.pathname}`);
    return route.abort();
  });
  await context.addInitScript(({ key, seed }) => {
    window.__guard = { opens: [], signins: 0 };
    document.addEventListener('gbti:open', (e) => window.__guard.opens.push(e.detail));
    document.addEventListener('gbti:request-signin', () => { window.__guard.signins += 1; });
    // The extension content script stamps the marker at document_idle and announces it.
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.dataset.gbtiExtension = '9.9.9-guard';
      document.dispatchEvent(new CustomEvent('gbti:extension-ready', { detail: { version: '9.9.9-guard' } }));
    });
    if (seed !== null && !sessionStorage.getItem('__guard_seeded')) {
      sessionStorage.setItem('__guard_seeded', '1');
      sessionStorage.setItem(key, typeof seed === 'string' ? seed : JSON.stringify(seed));
    }
  }, { key: PENDING_KEY, seed });
  const page = await context.newPage();
  await page.goto(base + url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  return { page, context, seen };
}

/**
 * The first visible heart (or Save pill) in the page's action region if it has one, else anywhere, scrolled into view
 * and measured. The site sets `scroll-behavior: smooth`, so a plain scrollIntoView is still animating when the next
 * line measures, and a control far down the page reads as off-screen: the first version of this guard clicked empty
 * space on a member profile and blamed the site. Scroll INSTANTLY, wait two frames, then measure, and confirm the
 * point under the cursor is the control itself. `covered` names what a real click would hit instead.
 */
async function control(page, tag) {
  return page.evaluate(async (tag) => {
    const inRegion = [...document.querySelectorAll(`[data-gbti-region="actions"] ${tag}`)];
    const all = [...document.querySelectorAll(tag)];
    const el = [...inRegion, ...all].find((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    if (!el) return null;
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    const reaches = !!hit && (hit === el || el.contains(hit));
    const covered = reaches ? null : (hit ? `${hit.tagName.toLowerCase()}${hit.id ? '#' + hit.id : ''}` : 'nothing (off-screen)');
    return { x, y, type: el.dataset.gbtiTargetType, slug: el.dataset.gbtiTargetSlug, covered };
  }, tag);
}

// Signup endpoints a signed-in page legitimately calls that are NOT part of saving (follow pills, the comment echo, a
// share's attached file). They are aborted and listed, not failed. Any OTHER unstubbed signup request is a finding,
// so a stub gap on the save path cannot pass as a clean run.
const UNRELATED_SIGNUP = new Set(['/membership/follows', '/membership/comment-echo', '/membership/file']);

async function state(page) {
  return page.evaluate((key) => {
    const d = document.querySelector('[data-signin-dialog]');
    const q = (s) => d?.querySelector(s);
    return {
      opens: window.__guard.opens,
      signins: window.__guard.signins,
      dialogOpen: !!d?.open,
      absentVisible: !!q('[data-state="absent"]') && !q('[data-state="absent"]').hidden,
      presentVisible: !!q('[data-state="present"]') && !q('[data-state="present"]').hidden,
      openInExtensionVisible: !!q('[data-open-in-extension]') && !q('[data-open-in-extension]').hidden,
      pending: sessionStorage.getItem(key),
      upgraded: !!customElements.get('gbti-favorite') && !!document.querySelector('gbti-favorite')?.shadowRoot,
    };
  }, PENDING_KEY);
}

const waitFor = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };
const waitUpgrade = (page) => page.waitForFunction(() => !!customElements.get('gbti-favorite') && !!document.querySelector('gbti-favorite')?.shadowRoot, null, { timeout: 10000 }).then(() => true, () => false);

let checked = 0;
const fail = (where, msg) => failures.push(`${where}: ${msg}`);
const unrelatedSeen = new Set();
const noLeaks = (where, seen) => {
  const unknown = [];
  for (const r of seen.unstubbed) {
    const p = r.split(' ')[1];
    if (UNRELATED_SIGNUP.has(p)) unrelatedSeen.add(p); else unknown.push(r);
  }
  if (unknown.length) fail(where, `unstubbed signup request(s) on an unrecognised endpoint, aborted: ${unknown.join(', ')}`);
};
const reachable = (where, c, what) => {
  if (!c) { fail(where, `no visible ${what} to click`); return false; }
  if (c.covered) { fail(where, `the ${what} cannot be clicked: the point under it is ${c.covered}`); return false; }
  return true;
};

async function scenarioA(name, url) {
  const where = `A signed in + extension, ${name} ${url}`;
  const { page, context, seen } = await open(url, { signedIn: true });
  try {
    if (!(await waitUpgrade(page))) { fail(where, 'the heart never upgraded (no custom element or shadow root) for a signed-in website member'); return; }
    await page.waitForTimeout(400); // let the shared activity read land
    const heart = await control(page, 'gbti-favorite');
    if (!reachable(where, heart, 'heart')) return;
    await page.mouse.click(heart.x, heart.y);
    const posted = await waitFor(async () => seen.posts.some((b) => b.action === 'favorite' && b.on === true), 5000);
    if (!posted) fail(where, 'clicking the upgraded heart did not POST a favorite to /membership/activity');
    const save = await control(page, 'gbti-collection');
    if (save && reachable(where, save, 'Save pill')) {
      await page.mouse.click(save.x, save.y);
      const opened = await waitFor(() => page.evaluate(() => [...document.querySelectorAll('gbti-collection')].some((c) => !!c.shadowRoot?.querySelector('.pop'))), 4000);
      if (!opened) fail(where, 'clicking Save did not open its collection picker');
    }
    const s = await state(page);
    if (s.opens.length) fail(where, `a save was handed to the extension (gbti:open ${JSON.stringify(s.opens)})`);
    if (s.dialogOpen) fail(where, 'the sign-in dialog opened for a signed-in member');
    noLeaks(where, seen);
    checked++;
  } finally { await context.close(); }
}

async function scenarioB(name, url) {
  const where = `B signed out + extension, ${name} ${url}`;
  const { page, context, seen } = await open(url, { signedIn: false });
  try {
    await page.waitForTimeout(600); // the marker and the (absent) session settle
    const heart = await control(page, 'gbti-favorite');
    if (!reachable(where, heart, 'heart')) return;
    await page.mouse.click(heart.x, heart.y);
    await page.waitForTimeout(500);
    const s = await state(page);
    if (s.opens.length) fail(where, `the click was handed to the extension (gbti:open ${JSON.stringify(s.opens)})`);
    if (!s.dialogOpen) fail(where, 'the website sign-in dialog did not open');
    else {
      if (!s.absentVisible || s.presentVisible) fail(where, 'the dialog did not show the plain website sign-in state');
      if (s.openInExtensionVisible) fail(where, 'the dialog offered "Open this page in the extension" for a save');
    }
    if (s.signins) fail(where, 'gbti:request-signin was fired into the extension');
    let pending = null;
    try { pending = JSON.parse(s.pending || 'null'); } catch { /* invalid */ }
    if (!pending || pending.kind !== 'favorite' || pending.type !== heart.type || pending.slug !== heart.slug) {
      fail(where, `the save the visitor started was not remembered for after sign-in (pending=${s.pending})`);
    }
    noLeaks(where, seen);
    checked++;
  } finally { await context.close(); }
}

async function scenarioC(name, url) {
  const where = `C upgrade window, ${name} ${url}`;
  const { page, context, seen } = await open(url, { signedIn: true, statusDelayMs: 1500 });
  try {
    const heart = await control(page, 'gbti-favorite');
    if (!reachable(where, heart, 'heart')) return;
    const early = await state(page);
    if (early.upgraded) fail(where, 'the heart had already upgraded, so the window was not exercised (raise the delay)');
    await page.mouse.click(heart.x, heart.y);
    await page.waitForTimeout(300);
    if ((await state(page)).dialogOpen) fail(where, 'a signed-in member who clicked during the upgrade was shown the sign-in dialog');
    const posted = await waitFor(async () => seen.posts.some((b) => b.action === 'favorite' && b.on === true), 9000);
    if (!posted) fail(where, 'the early click was not completed as a favorite once the session resolved');
    await page.waitForTimeout(600);
    const favPosts = seen.posts.filter((b) => b.action === 'favorite');
    if (favPosts.length > 1) fail(where, `the early click wrote ${favPosts.length} times, expected exactly once`);
    if ((await state(page)).dialogOpen) fail(where, 'the sign-in dialog opened after the session resolved signed in');
    noLeaks(where, seen);
    checked++;
  } finally { await context.close(); }
}

// Measured 2026-09-12 on a cold load: the heart stays inert for 0.4s on desktop, about 2s on Fast 4G, 6 to 7s on Slow
// 4G and 20 to 24s on 3G (both with a 4x CPU slowdown). A hold that gives up inside that window shows a signed-in
// member the sign-in dialog, so this drives a window longer than the 8 seconds the first draft of sow-330 gave up at
// (that draft failed here).
async function scenarioSlowNetwork(url) {
  const where = `C slow network (heart code 12s late), content page ${url}`;
  const { page, context, seen } = await open(url, { signedIn: true, slowElementsMs: 12000 });
  try {
    const heart = await control(page, 'gbti-favorite');
    if (!reachable(where, heart, 'heart')) return;
    if ((await state(page)).upgraded) { fail(where, 'the heart had already upgraded, so the long window was not exercised'); return; }
    await page.mouse.click(heart.x, heart.y);
    let dialogSeen = false;
    const posted = await waitFor(async () => {
      if ((await state(page)).dialogOpen) dialogSeen = true;
      return seen.posts.some((b) => b.action === 'favorite' && b.on === true);
    }, 25000);
    if (!seen.slowed) fail(where, 'no gbti-favorite or gbti-collection module was requested, so the long window was not exercised');
    if (dialogSeen) fail(where, 'a signed-in member on a slow connection was shown the sign-in dialog while the heart was still loading');
    if (!posted) fail(where, 'the click was not completed as a favorite once the heart finished loading');
    await page.waitForTimeout(600);
    if (seen.posts.filter((b) => b.action === 'favorite').length > 1) fail(where, 'the early click wrote more than once');
    noLeaks(where, seen);
    checked++;
  } finally { await context.close(); }
}

// The other end of the long hold: when the controls FAIL to load, the held click is released at once to the website
// sign-in path (the inert control's own fallback) with the save remembered, rather than sitting busy until the ceiling.
async function scenarioElementsFail(url, { clickAfterFailure }) {
  const where = `C heart code fails to load (clicked ${clickAfterFailure ? 'after the failure' : 'while it is still loading'}), content page ${url}`;
  // Both orders matter, and each is pinned: the held-first run fails the load 2 seconds after the request, so the click
  // is certainly waiting when it fails. A click that simply races the load lands on either side: the first version of
  // the fix handled only the held-first order and passed such a run once, then failed it on the next.
  const { page, context, seen } = await open(url, { signedIn: true, failElements: true, slowElementsMs: clickAfterFailure ? 0 : 2000 });
  try {
    const heart = await control(page, 'gbti-favorite');
    if (!reachable(where, heart, 'heart')) return;
    if ((await state(page)).upgraded) { fail(where, 'the heart had already upgraded, so the failure path was not exercised'); return; }
    if (clickAfterFailure) {
      if (!(await waitFor(async () => seen.slowed > 0, 8000))) { fail(where, 'the heart code was never requested, so the failure path was not exercised'); return; }
      await page.waitForTimeout(1000);
    }
    await page.mouse.click(heart.x, heart.y);
    const released = await waitFor(async () => (await state(page)).dialogOpen, 6000);
    if (!seen.slowed) fail(where, 'no gbti-favorite or gbti-collection module was requested, so the failure path was not exercised');
    if (!released) { fail(where, 'a held click was not released to the website sign-in within 6 seconds of the controls failing to load'); return; }
    const s = await state(page);
    if (!s.absentVisible || s.presentVisible || s.openInExtensionVisible) fail(where, 'the released click did not show the plain website sign-in state');
    if (s.opens.length || s.signins) fail(where, 'the released click was handed to the extension');
    let pending = null;
    try { pending = JSON.parse(s.pending || 'null'); } catch { /* invalid */ }
    if (!pending || pending.slug !== heart.slug) fail(where, `the save was not remembered when the hold was released (pending=${s.pending})`);
    noLeaks(where, seen);
    checked++;
  } finally { await context.close(); }
}

async function heartTarget(url) {
  const { page, context } = await open(url, { signedIn: false });
  try { return await control(page, 'gbti-favorite'); } finally { await context.close(); }
}

async function scenarioD(url) {
  const t = await heartTarget(url);
  if (!t) { fail(`D ${url}`, 'no visible heart to seed a remembered save for'); return; }
  const fresh = { kind: 'favorite', type: t.type, slug: t.slug, path: url, at: Date.now() };

  {
    const where = `D return after sign-in ${url}`;
    const { page, context, seen } = await open(url, { signedIn: true, seed: fresh });
    try {
      const posted = await waitFor(async () => seen.posts.some((b) => b.action === 'favorite' && b.on === true && b.slug === t.slug), 9000);
      if (!posted) fail(where, 'the save remembered before sign-in was not completed on return');
      await page.waitForTimeout(800);
      if (seen.posts.filter((b) => b.action === 'favorite').length > 1) fail(where, 'the remembered save completed more than once');
      if ((await state(page)).pending) fail(where, 'the remembered save was not cleared after completing');
      noLeaks(where, seen);
      checked++;
    } finally { await context.close(); }
  }
  const controls = [
    ['another page', { signedIn: true, seed: { ...fresh, path: '/somewhere-else/' } }, url],
    ['expired', { signedIn: true, seed: { ...fresh, at: Date.now() - 16 * 60 * 1000 } }, url],
    ['bare URL parameter, nothing remembered', { signedIn: true }, `${url}?save=favorite&type=${encodeURIComponent(t.type)}&slug=${encodeURIComponent(t.slug)}`],
  ];
  for (const [label, opts, target] of controls) {
    const where = `D control (${label}) ${target}`;
    const { page, context, seen } = await open(target, opts);
    try {
      if (!(await waitUpgrade(page))) { fail(where, 'the heart never upgraded, so the control could not be exercised'); continue; }
      await page.waitForTimeout(1500);
      if (seen.posts.length) fail(where, `a save was written without a valid remembered save for this page (${JSON.stringify(seen.posts)})`);
      noLeaks(where, seen);
      checked++;
    } finally { await context.close(); }
  }
}

async function scenarioE(url) {
  const t = await heartTarget(url);
  if (!t) { fail(`E ${url}`, 'no visible heart to seed'); return; }
  const where = `E replay safety ${url}`;
  const seed = { kind: 'favorite', type: t.type, slug: t.slug, path: url, at: Date.now() };
  const { page, context, seen } = await open(url, { signedIn: true, favorites: [{ type: t.type, slug: t.slug }], seed });
  try {
    if (!(await waitUpgrade(page))) { fail(where, 'the heart never upgraded, so replay safety could not be exercised'); return; }
    await page.waitForTimeout(2000);
    if (seen.posts.some((b) => b.action === 'favorite' && b.on === false)) fail(where, 'a replayed save turned an existing favorite OFF');
    if (seen.posts.length) fail(where, `a replayed save wrote for an item already favorited (${JSON.stringify(seen.posts)})`);
    noLeaks(where, seen);
    checked++;
  } finally { await context.close(); }
}

// ---- run ------------------------------------------------------------------------------------------------------------

const only = String(process.env.SAVE_GUARD_SCENARIOS || 'ABCDE').toUpperCase();
try {
  for (const [name, url] of Object.entries(pages)) {
    if (only.includes('A')) await scenarioA(name, url);
    if (only.includes('B')) await scenarioB(name, url);
  }
  for (const name of ['content page', 'feed']) if (pages[name] && only.includes('C')) await scenarioC(name, pages[name]);
  if (pages['content page'] && only.includes('C')) await scenarioSlowNetwork(pages['content page']);
  for (const clickAfterFailure of [false, true]) if (pages['content page'] && only.includes('C')) await scenarioElementsFail(pages['content page'], { clickAfterFailure });
  if (pages['content page'] && only.includes('D')) await scenarioD(pages['content page']);
  if (pages['content page'] && only.includes('E')) await scenarioE(pages['content page']);
} catch (e) {
  failures.push(`the harness itself threw: ${e.message.split('\n')[0]}`);
} finally {
  await browser.close();
  server.close();
}

console.log(`surfaces: ${Object.entries(pages).map(([n, u]) => `${n}=${u}`).join('  ')}`);
if (unrelatedSeen.size) console.log(`aborted and not part of saving (listed, not failed): ${[...unrelatedSeen].sort().join(', ')}`);
if (failures.length) {
  console.error(`✗ save-controls guard failed (${failures.length} finding${failures.length === 1 ? '' : 's'} across ${checked} completed scenario runs):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
const v = verdict({ checked, loadFailures: 0, failures: 0, requireBrowser: GATE });
if (!v.ok) { console.error(`✗ save-controls guard cannot claim a pass: ${v.reason}`); process.exit(1); }
console.log(`✓ save-controls guard passed: ${checked} scenario runs across ${Object.keys(pages).length} surfaces; saves stayed on the website.`);
