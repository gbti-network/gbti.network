// sow-339: a Turnstile token is single use, and every page that spends one on /signup/start must drop it in the
// same tap and force a fresh check when the browser restores the page from its back/forward cache. The sign-in
// page did this since sow-158 Phase 2; the two invite landers did not, and on 2026-09-15 a colleague's second tap
// on the invite button sent a spent token and read as a broken signup. These pins keep the three copies together.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import worker from '../workers/signup/index.mjs';
import { verifyTurnstile, verifyTurnstileDetailed } from '../workers/signup/abuse.mjs';
import { wlog } from '../workers/signup/wlog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const PAGES = [
  'src/components/invite/InviteLander.astro',
  'src/pages/codeable-invite/v1.astro',
  'src/pages/login.astro',
];

test('every page that navigates to /signup/start spends its Turnstile token in the same tap', () => {
  for (const p of PAGES) {
    const src = read(p);
    const click = src.indexOf("addEventListener('click'");
    const nav = src.indexOf("'/signup/start'", click);
    assert.ok(click >= 0 && nav > click, `${p}: the click handler navigates to /signup/start`);
    const handler = src.slice(click, nav);
    assert.ok(handler.includes('window.gbtiTurnstileReset();'), `${p}: the token is dropped BEFORE the navigation is built`);
    assert.ok(/var token = btn\.dataset\.token;\s*\n\s*if \(!token\) return;\s*\n\s*window\.gbtiTurnstileReset\(\);/.test(handler), `${p}: read the token, refuse without one, then drop it`);
  }
});

test('every such page forces a fresh check when the browser restores it from the back/forward cache', () => {
  for (const p of PAGES) {
    const src = read(p);
    const at = src.indexOf("addEventListener('pageshow'");
    assert.ok(at >= 0, `${p}: listens for pageshow`);
    const handler = src.slice(at, at + 400);
    assert.ok(handler.includes('if (!e.persisted) return;'), `${p}: only a cache restore, never a normal load`);
    assert.ok(handler.includes('window.gbtiTurnstileReset();'), `${p}: the button is disabled and the token dropped`);
    assert.ok(handler.includes('try { if (window.turnstile) window.turnstile.reset(); }'), `${p}: the widget issues a new token whenever it is mounted`);
  }
});

test('the reset the pages rely on disables the button and forgets the token', () => {
  for (const p of PAGES) {
    const src = read(p);
    assert.ok(src.includes('window.gbtiTurnstileReset = function () { if (btn) { btn.disabled = true; delete btn.dataset.token; } };'), p);
  }
});

test('the page a browser gets for a spent token follows the writing conventions and escapes its one input', () => {
  const src = read('workers/signup/turnstile-page.mjs');
  assert.ok(!/[—–]/.test(src), 'no em or en dashes in shipped copy');
  assert.ok(!/\b(don't|can't|isn't|won't|it's|you're|we're|didn't|doesn't)\b/i.test(src), 'no contractions in shipped copy');
  assert.ok(src.includes('href="${back}"') && src.includes('const back = esc(backLinkFor(request, env));'), 'the back link is escaped before it reaches the markup');
});

// ---- The Worker side: the reason in the log, a page for a browser ------------------------------------------------
// Local fixtures rather than the ones inside test/worker.test.mjs (1,700 lines and not exporting them): a fetch stub
// shaped like the Worker's callers use it (.ok, .status, .text()), a minimal env for the rejection path (the token
// check runs before the rate limit, the coupon lookup and OAuth, so nothing else is touched), and a request builder.
function recorder(responses) {
  const calls = [];
  let i = 0;
  const fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method, headers: opts.headers, body: opts.body });
    const r = responses[i] ?? responses[responses.length - 1];
    i++;
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, text: async () => (r.body === undefined ? '' : typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
  };
  return { fetch, calls };
}
async function withFetch(router, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const r = router(String(url), opts) ?? { status: 200, body: '' };
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, text: async () => (r.body === undefined ? '' : typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
  };
  try { return await fn(); } finally { globalThis.fetch = original; }
}
const fakeEnv = () => ({ SESSION_SECRET: 'test-secret', PUBLIC_BASE_URL: 'https://gbti.test', SITE_BASE_URL: 'https://gbti.test', TURNSTILE_SECRET_KEY: 'turnstile-secret' });
const req = (method, path, { headers = {} } = {}) => new Request(`https://gbti.test${path}`, { method, headers });

test('verifyTurnstileDetailed says why: Cloudflare codes when it answered, a code of ours when it did not', async () => {
  const dup = recorder([{ body: { success: false, 'error-codes': ['timeout-or-duplicate'] } }]);
  assert.deepEqual(await verifyTurnstileDetailed({ token: 't', secret: 's' }, dup.fetch), { ok: false, codes: ['timeout-or-duplicate'] });
  const good = recorder([{ body: { success: true, 'error-codes': [] } }]);
  assert.deepEqual(await verifyTurnstileDetailed({ token: 't', secret: 's' }, good.fetch), { ok: true, codes: [] });
  const bare = recorder([{ body: { success: false } }]);
  assert.deepEqual(await verifyTurnstileDetailed({ token: 't', secret: 's' }, bare.fetch), { ok: false, codes: ['success-false'] });
  const http = recorder([{ status: 500, body: 'err' }]);
  assert.deepEqual(await verifyTurnstileDetailed({ token: 't', secret: 's' }, http.fetch), { ok: false, codes: ['siteverify-http-500'] });
  const down = { fetch: async () => { throw new Error('network'); } };
  assert.deepEqual(await verifyTurnstileDetailed({ token: 't', secret: 's' }, down.fetch), { ok: false, codes: ['siteverify-unreachable'] });
  const none = recorder([{ body: { success: true } }]);
  assert.deepEqual(await verifyTurnstileDetailed({ token: '', secret: 's' }, none.fetch), { ok: false, codes: ['missing-input-response'] });
  assert.deepEqual(await verifyTurnstileDetailed({ token: 't', secret: '' }, none.fetch), { ok: false, codes: ['missing-input-secret'] });
  assert.equal(none.calls.length, 0, 'a missing input never reaches Cloudflare');
  // The boolean face agrees with the detailed one.
  assert.equal(await verifyTurnstile({ token: 't', secret: 's' }, recorder([{ body: { success: false, 'error-codes': ['invalid-input-response'] } }]).fetch), false);
});

test('GET /signup/start rejection: a browser gets a page that says the link was spent, a script keeps the JSON, the log carries the code', async () => {
  const env = fakeEnv();
  const router = (url) => (url.includes('siteverify') ? { status: 200, body: { success: false, 'error-codes': ['timeout-or-duplicate'] } } : { status: 200, body: '' });
  await withFetch(router, async () => {
    wlog.clear();
    // A phone browser that tapped the invite button twice: the second navigation carries the spent token.
    const nav = await worker.fetch(
      req('GET', '/signup/start?cf-turnstile-response=spent&coupon=CODEABLEYEAR', { headers: { 'CF-Connecting-IP': '1.1.1.1', Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', Referer: 'https://gbti.test/codeable-invite/' } }),
      env,
      {},
    );
    assert.equal(nav.status, 403);
    assert.match(nav.headers.get('Content-Type'), /text\/html/);
    assert.equal(nav.headers.get('Cache-Control'), 'no-store');
    const html = await nav.text();
    assert.ok(html.includes('That sign-in link was already used'), 'says what happened');
    assert.ok(html.includes('tap the button once'), 'and what to do');
    assert.ok(html.includes('href="https://gbti.test/codeable-invite/"'), 'the way back is the page they came from');
    const [entry] = wlog.recent().filter((e) => e.area === 'signup-funnel' && e.msg === 'start rejected');
    assert.ok(entry, 'the rejection is logged');
    assert.deepEqual(entry.data, { reason: 'turnstile', hadResponse: true, codes: ['timeout-or-duplicate'] }, 'with the reason Cloudflare gave');

    // A referrer off the site never becomes the link; the membership page does.
    const foreign = await worker.fetch(
      req('GET', '/signup/start?cf-turnstile-response=spent', { headers: { 'CF-Connecting-IP': '1.1.1.1', Accept: 'text/html', Referer: 'https://evil.example/"><script>' } }),
      env,
      {},
    );
    const foreignHtml = await foreign.text();
    assert.ok(foreignHtml.includes('href="https://gbti.test/membership/"'), 'the fallback link');
    assert.ok(!foreignHtml.includes('evil.example'), 'the foreign referrer does not reach the page at all');

    // A script caller (no HTML accept) keeps the JSON contract exactly.
    const api = await worker.fetch(
      req('GET', '/signup/start?cf-turnstile-response=spent', { headers: { 'CF-Connecting-IP': '1.1.1.1' } }),
      env,
      {},
    );
    assert.equal(api.status, 403);
    assert.deepEqual(await api.json(), { error: 'turnstile_failed' });
  });
});

