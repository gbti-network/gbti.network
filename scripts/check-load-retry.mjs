#!/usr/bin/env node
// sow-334 guard: an admin section whose load FAILS waits to be asked again. It never starts the next attempt at once.
//
//   npm run check:load-retry
//
// WHY THIS EXISTS. Admin sections load from render(), because they upgrade in static page markup before the host
// injects the client (memory client-ready-load-race). Two of them guarded that retry on "not loaded yet", which a
// failed load also satisfies, so every failure started the next attempt immediately and kept going while the tab
// was open. Measured on the shipped bundle: the Channels manager made 500 Worker reads in 2 seconds against a
// failing route; the publishing activity table made 100 on an empty reply, and 100 more when a background refresh
// failed with the old table still on screen, so nothing looked wrong. No unit test could see it: the defect is the
// interaction between render() and load() inside a live element.
//
// WHAT IT DRIVES. The client-ui SOURCE, bundled in memory with the options client-ui/build.mjs uses, so it tests
// this commit rather than a committed bundle. No dist, no network, no secrets.
//   A  census: every <gbti-*> on either admin page, plus the activity table nested in Channels, against a client
//      that fails, one that answers null, and one that answers {}. A section may make at most BOUND requests in
//      WINDOW_MS. The sections come from the pages at run time, so a new section is covered without editing this.
//   B  Channels: a failure shows Try again and makes no more requests; Try again makes exactly one attempt; a new
//      client earns exactly one; a client missing the methods lands on the message instead of overflowing the stack.
//   C  the activity table: a failed background refresh makes one request, keeps the table, says how old it is, and
//      waits CACHE_FRESH_MS before trying again; a later success removes the note. An empty first reply shows Retry.
//   D  controls and the first-load race: a healthy client loads each once, including when the element was on the
//      page before its client arrived.
//
// Skips (exit 0) without Playwright or Chromium locally; REQUIRE_BROWSER=1 makes a skip a failure, and zero checks
// is never a pass (scripts/lib/browser-guard.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { requireBrowser, skipOrDie, verdict } from './lib/browser-guard.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const NAME = 'check:load-retry';
const GATE = requireBrowser();
const WINDOW_MS = 2000;
// The largest healthy load today is 6 requests (Channels: five reads plus the nested activity table). A loop makes
// about 100 in the window, so the bound sits well clear of both.
const BOUND = 12;

function skip(msg) { skipOrDie(NAME, msg, { requireBrowser: GATE }); }
function die(msg) { console.error(`✗ ${NAME}: ${msg}`); process.exit(1); }

// ---- the sections under test -------------------------------------------------------------------------------------

const ADMIN_PAGES = ['src/pages/admin.astro', 'extension/admin.html'];
const NESTED = ['gbti-syndication-tracker']; // mounted inside <gbti-channel-map-manager>, so absent from page markup
const tags = new Set(NESTED);
for (const rel of ADMIN_PAGES) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) die(`admin page missing at ${rel}; the census cannot know which sections to drive`);
  for (const m of fs.readFileSync(file, 'utf8').matchAll(/<(gbti-[a-z0-9-]+)[\s>]/g)) tags.add(m[1]);
}
// A floor, so a markup change that hides the tags from the pattern fails here instead of passing on a short list.
for (const must of ['gbti-channel-map-manager', 'gbti-quote-manager', 'gbti-coupon-manager']) {
  if (!tags.has(must)) die(`expected <${must}> on an admin page and did not find it; the section census is broken`);
}
const TAGS = [...tags].sort();

// ---- bundle the source, then find a browser ------------------------------------------------------------------------

let BUNDLE;
try {
  const out = await build({
    entryPoints: [path.join(ROOT, 'client-ui/src/index.mjs')],
    bundle: true, write: false, format: 'iife', globalName: 'GbtiUI', target: 'es2022', charset: 'utf8',
    legalComments: 'none', preserveSymlinks: true, logLevel: 'silent',
  });
  BUNDLE = out.outputFiles[0].text;
} catch (e) { die(`the client-ui source did not bundle: ${String(e.message).split('\n')[0]}`); }

let chromium;
try { ({ chromium } = await import('playwright')); } catch { skip('playwright is not installed'); }
let browser;
try { browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }); }
catch (e) { skip('could not launch Chromium (run `npx playwright install chromium`): ' + e.message.split('\n')[0]); }

// ---- the page harness --------------------------------------------------------------------------------------------

// A stub client that counts every call. Each answer waits 20 ms, as a network reply would, so a loop yields and is
// COUNTED rather than freezing the page. `st.mode` may change mid-run; `window.__shift` moves the clock.
const HARNESS = `
  window.__sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__shift = 0;
  { const realNow = Date.now; Date.now = () => realNow() + window.__shift; }
  const HEALTHY = {
    contentChannelPool: { channels: [] }, moderationFlagPool: { lists: { political: [] } },
    syndicationTemplatePool: { templates: {} }, newsEngagementSettings: { settings: null }, syndicationSettings: { settings: null },
    syndicationQueue: { pending: [{ id: 'a', title: 'An item', source: 'post', enqueuedAt: 1 }] },
  };
  window.__stub = (mode) => {
    const st = { calls: 0, by: {}, mode };
    const client = new Proxy({}, { get: (_, k) => (k === 'then' || typeof k === 'symbol') ? undefined : async () => {
      st.calls++; st.by[k] = (st.by[k] || 0) + 1;
      await window.__sleep(20);
      if (st.mode === 'reject') throw new Error('503 from the stub');
      if (st.mode === 'null') return null;
      if (st.mode === 'empty') return {};
      return HEALTHY[k] ?? {};
    } });
    return { st, client };
  };
  window.__mount = (tag) => { const el = document.createElement(tag); document.body.appendChild(el); return el; };
  window.__q = (el, sel) => el.shadowRoot && el.shadowRoot.querySelector(sel);
`;

const failures = [];
let checked = 0;
function expect(label, ok, detail) {
  checked++;
  if (!ok) failures.push(`${label}: ${detail}`);
}

async function withPage(fn) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).split('\n')[0]));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().split('\n')[0]); });
  try {
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({ content: HARNESS });
    await page.addScriptTag({ content: BUNDLE });
    let timer;
    const stall = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('the page stopped answering, which is a load loop that never yields')), 30000); });
    try { return await Promise.race([fn(page, errors), stall]); } finally { clearTimeout(timer); }
  } finally { await page.close().catch(() => {}); }
}

// ---- A: census -------------------------------------------------------------------------------------------------

async function census(tag, mode) {
  const r = await withPage((page) => page.evaluate(async ({ tag, mode, windowMs }) => {
    if (!customElements.get(tag)) return { defined: false };
    const { st, client } = window.__stub(mode);
    window.GbtiUI.setClient(client);
    window.__mount(tag);
    await window.__sleep(windowMs);
    const top = Object.entries(st.by).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}=${v}`).join(', ');
    return { defined: true, calls: st.calls, top };
  }, { tag, mode, windowMs: WINDOW_MS }));
  const label = `A <${tag}> with a client that ${mode === 'reject' ? 'fails' : mode === 'null' ? 'answers null' : 'answers {}'}`;
  if (!r.defined) { expect(label, false, 'the element is on an admin page but the client-ui bundle does not define it, so it cannot be driven'); return; }
  expect(label, r.calls <= BOUND, `${r.calls} requests in ${WINDOW_MS} ms (bound ${BOUND}): it retries a failed load at once (${r.top})`);
}

// ---- B: Channels -------------------------------------------------------------------------------------------------

async function channels() {
  const r = await withPage((page, errors) => page.evaluate(async () => {
    const { st, client } = window.__stub('reject');
    window.GbtiUI.setClient(client);
    const el = window.__mount('gbti-channel-map-manager');
    await window.__sleep(1200);
    const first = st.by.contentChannelPool || 0;
    const message = (window.__q(el, '.msg') || {}).textContent || '';
    const button = window.__q(el, '[data-retry-load]');
    button && button.click();
    await window.__sleep(1200);
    const afterRetry = st.by.contentChannelPool || 0;
    const second = window.__stub('reject');
    window.GbtiUI.setClient(second.client);
    await window.__sleep(1200);
    const newClient = second.st.by.contentChannelPool || 0;
    window.GbtiUI.setClient(second.client); // a re-broadcast of the SAME client is not a new one
    await window.__sleep(800);
    const sameAgain = second.st.by.contentChannelPool || 0;
    second.st.mode = 'healthy';
    const again = window.__q(el, '[data-retry-load]');
    again && again.click();
    await window.__sleep(1200);
    return { first, message, hadButton: !!button, afterRetry, newClient, sameAgain, recovered: !!window.__q(el, '.subnav') };
  }).then((v) => ({ ...v, errors })));
  expect('B Channels: a failed load makes one attempt', r.first === 1, `${r.first} attempts before any click`);
  expect('B Channels: a failed load says so and offers Try again', r.hadButton && /Could not load the channel settings/.test(r.message), `button=${r.hadButton} message="${r.message}"`);
  expect('B Channels: Try again makes exactly one more attempt', r.afterRetry === 2, `${r.afterRetry} attempts after one click (expected 2)`);
  expect('B Channels: a new client earns exactly one attempt', r.newClient === 1, `${r.newClient} attempts with the new client`);
  expect('B Channels: re-broadcasting the same client does not retry', r.sameAgain === 1, `${r.sameAgain} attempts after a re-broadcast`);
  expect('B Channels: Try again recovers once the Worker answers', r.recovered, 'the loaded view never rendered');

  const s = await withPage((page, errors) => page.evaluate(async () => {
    window.GbtiUI.setClient({ status: async () => null }); // a client without the Channels methods (a sync throw)
    const el = window.__mount('gbti-channel-map-manager');
    await window.__sleep(600);
    return { hadButton: !!window.__q(el, '[data-retry-load]') };
  }).then((v) => ({ ...v, errors })));
  const overflow = s.errors.find((e) => /call stack/i.test(e));
  expect('B Channels: a client missing the methods shows the message instead of recursing', s.hadButton && !overflow, overflow ? `page error: ${overflow}` : 'no Try again button rendered');
}

// ---- C: the publishing activity table ------------------------------------------------------------------------------

async function tracker() {
  const r = await withPage((page) => page.evaluate(async () => {
    const { st, client } = window.__stub('healthy');
    window.GbtiUI.setClient(client);
    const el = window.__mount('gbti-syndication-tracker');
    await window.__sleep(600);
    const first = st.calls;
    st.mode = 'reject'; window.__shift = 31000; // the cache is now stale and the Worker is failing
    window.GbtiUI.setClient(client);            // anything that redraws the table (a filter, a reconnect)
    await window.__sleep(1000);
    const afterFail = st.calls - first;
    const table = !!window.__q(el, 'table');
    const note = (window.__q(el, '[data-stale]') || {}).textContent || '';
    window.GbtiUI.setClient(client); window.GbtiUI.setClient(client);
    await window.__sleep(800);
    const afterRedraws = st.calls - first;
    st.mode = 'healthy'; window.__shift = 62000;
    window.GbtiUI.setClient(client);
    await window.__sleep(800);
    return { first, afterFail, table, note, afterRedraws, recovered: st.calls - first, noteGone: !window.__q(el, '[data-stale]') };
  }));
  expect('C activity table: a healthy first load makes one request', r.first === 1, `${r.first} requests`);
  expect('C activity table: a failed background refresh makes one request', r.afterFail === 1, `${r.afterFail} requests in 1 s after the refresh failed`);
  expect('C activity table: the table stays up and says how old it is', r.table && /Could not refresh\. Showing results from /.test(r.note), `table=${r.table} note="${r.note}"`);
  expect('C activity table: redraws inside the wait do not retry', r.afterRedraws === 1, `${r.afterRedraws} requests after two more redraws`);
  expect('C activity table: the next refresh after the wait recovers and clears the note', r.recovered === 2 && r.noteGone, `requests=${r.recovered} noteGone=${r.noteGone}`);

  const e = await withPage((page) => page.evaluate(async () => {
    const { st, client } = window.__stub('null');
    window.GbtiUI.setClient(client);
    const el = window.__mount('gbti-syndication-tracker');
    await window.__sleep(800);
    return { calls: st.calls, retry: !!window.__q(el, '[data-reload]') };
  }));
  expect('C activity table: an empty first reply makes one request and offers Retry', e.calls === 1 && e.retry, `requests=${e.calls} retry=${e.retry}`);
}

// ---- D: controls and the first-load race ---------------------------------------------------------------------------

async function controls() {
  for (const [tag, method, loadedSel] of [['gbti-channel-map-manager', 'contentChannelPool', '.subnav'], ['gbti-syndication-tracker', 'syndicationQueue', 'table']]) {
    for (const lateClient of [false, true]) {
      const r = await withPage((page) => page.evaluate(async ({ tag, method, loadedSel, lateClient }) => {
        const { st, client } = window.__stub('healthy');
        if (!lateClient) window.GbtiUI.setClient(client);
        const el = window.__mount(tag);
        if (lateClient) { await window.__sleep(300); window.GbtiUI.setClient(client); }
        await window.__sleep(1000);
        return { calls: st.by[method] || 0, loaded: !!window.__q(el, loadedSel) };
      }, { tag, method, loadedSel, lateClient }));
      const label = `D <${tag}> healthy${lateClient ? ', client arriving after the element' : ''}`;
      expect(label, r.calls === 1 && r.loaded, `${method} called ${r.calls} times, loaded=${r.loaded} (expected once and loaded)`);
    }
  }
}

// ---- run ---------------------------------------------------------------------------------------------------------

try {
  const jobs = [];
  for (const tag of TAGS) for (const mode of ['reject', 'null', 'empty']) jobs.push(() => census(tag, mode));
  for (let i = 0; i < jobs.length; i += 4) await Promise.all(jobs.slice(i, i + 4).map((j) => j()));
  await channels();
  await tracker();
  await controls();
} catch (e) {
  failures.push(`the harness itself threw: ${String(e.message).split('\n')[0]}`);
} finally {
  await browser.close();
}

console.log(`sections: ${TAGS.join(' ')}`);
if (failures.length) {
  console.error(`✗ ${NAME} failed (${failures.length} finding${failures.length === 1 ? '' : 's'} across ${checked} checks):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
const v = verdict({ checked, loadFailures: 0, failures: 0, requireBrowser: GATE });
if (!v.ok) { console.error(`✗ ${NAME} cannot claim a pass: ${v.reason}`); process.exit(1); }
console.log(`✓ ${NAME} passed: ${checked} checks across ${TAGS.length} sections; no failed load retries itself.`);
