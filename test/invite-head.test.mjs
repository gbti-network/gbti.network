// sow-437: the claim page head gets a live invitation's personal title at the edge (functions/claim/index.js), and
// falls back to the static page on every failure. The pure helper is tested directly; the function is driven with a
// fake Pages context and a stubbed fetch, so each failure path is shown to hand back the static page unchanged.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { personalizeHead, escapeHtml, claimCodeFrom } from '../src/lib/invite-head.mjs';
import { onRequest } from '../functions/claim/index.js';

const HEAD = '<!doctype html><html><head><meta charset="utf-8"><title>An invitation | GBTI Network</title>'
  + '<meta property="og:title" content="An invitation | GBTI Network"><meta property="og:description" content="An invitation."></head>'
  + '<body><h1>Invitation</h1></body></html>';
const TITLE = 'Rob, your Devote listing on GBTI Network';
const STATIC_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy': "default-src 'self'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'cache-control': 'public, max-age=0, must-revalidate',
  etag: '"abc"',
};

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function ctx(url, { method = 'GET', html = HEAD, status = 200, headers = STATIC_HEADERS } = {}) {
  return {
    request: new Request(url, { method }),
    next: async () => new Response(html, { status, headers }),
  };
}
function stubTitle(answer) {
  const calls = [];
  globalThis.fetch = async (u, init) => {
    calls.push(String(u));
    if (answer instanceof Error) throw answer;
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
  return calls;
}
const LIVE = 'https://gbti.network/claim/?code=cdeabeyear75cfhj7p5s';

test('personalizeHead replaces the title and og:title, escaped, and nothing else', () => {
  const { html, changed } = personalizeHead(HEAD, TITLE);
  assert.equal(changed, true);
  assert.match(html, /<title>Rob, your Devote listing on GBTI Network<\/title>/);
  assert.match(html, /<meta property="og:title" content="Rob, your Devote listing on GBTI Network">/);
  assert.match(html, /<meta property="og:description" content="An invitation.">/, 'the description stays generic');
  assert.equal(html.replace(/<title>[^<]*<\/title>/, '').replace(/og:title" content="[^"]*"/, ''),
    HEAD.replace(/<title>[^<]*<\/title>/, '').replace(/og:title" content="[^"]*"/, ''), 'nothing outside the two tags changes');
});

test('a hostile name cannot break out of the title or the attribute', () => {
  const evil = 'Rob"><script>alert(1)</script>, your <b>X</b> listing on GBTI Network';
  const { html } = personalizeHead(HEAD, evil);
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<b>X<\/b>/);
  assert.match(html, /content="Rob&quot;&gt;&lt;script&gt;/);
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});

test('a head missing either tag is left untouched, never half personalized', () => {
  const noOg = HEAD.replace(/<meta property="og:title"[^>]*>/, '');
  assert.deepEqual(personalizeHead(noOg, TITLE), { html: noOg, changed: false });
  const noTitle = HEAD.replace(/<title>[^<]*<\/title>/, '');
  assert.deepEqual(personalizeHead(noTitle, TITLE), { html: noTitle, changed: false });
  assert.deepEqual(personalizeHead(HEAD, '   '), { html: HEAD, changed: false });
});

test('claimCodeFrom upper-cases a code-shaped value and refuses anything else', () => {
  assert.equal(claimCodeFrom(LIVE), 'CDEABEYEAR75CFHJ7P5S');
  assert.equal(claimCodeFrom('https://gbti.network/claim/'), '');
  assert.equal(claimCodeFrom('https://gbti.network/claim/?code=ab'), '');
  assert.equal(claimCodeFrom('https://gbti.network/claim/?code=has%20space'), '');
  assert.equal(claimCodeFrom('https://gbti.network/claim/?code=' + 'A'.repeat(33)), '');
  assert.equal(claimCodeFrom('not a url'), '');
});

test('the edge function serves the personal title for a live link, keeps every static header, and is not cached', async () => {
  const calls = stubTitle({ body: { ok: true, title: TITLE } });
  const res = await onRequest(ctx(LIVE));
  const html = await res.text();
  assert.equal(calls.length, 1);
  assert.equal(calls[0], 'https://signup.gbti.network/invite/title?code=CDEABEYEAR75CFHJ7P5S');
  assert.match(html, /<title>Rob, your Devote listing on GBTI Network<\/title>/);
  assert.equal(res.headers.get('content-security-policy'), STATIC_HEADERS['content-security-policy']);
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('etag'), null, 'the static etag no longer describes the body');
});

test('every failure hands back the static page unchanged', async () => {
  const cases = {
    deadLink: () => stubTitle({ status: 404, body: { ok: false, error: 'inactive' } }),
    rateLimited: () => stubTitle({ status: 429, body: { ok: false, error: 'rate_limited' } }),
    lookupThrows: () => stubTitle(new Error('network down')),
    wrongShape: () => stubTitle({ body: { ok: true, title: 42 } }),
  };
  for (const [label, arrange] of Object.entries(cases)) {
    arrange();
    const res = await onRequest(ctx(LIVE));
    assert.equal(await res.text(), HEAD, label);
    assert.equal(res.headers.get('cache-control'), STATIC_HEADERS['cache-control'], `${label} keeps the static cache policy`);
  }
});

test('no code, a bad code, a non-GET, a non-HTML or a failed static response never calls the lookup', async () => {
  const cases = {
    noCode: ctx('https://gbti.network/claim/'),
    badCode: ctx('https://gbti.network/claim/?code=<x>'),
    head: ctx(LIVE, { method: 'HEAD', html: null }),
    notHtml: ctx(LIVE, { headers: { ...STATIC_HEADERS, 'content-type': 'application/json' }, html: '{}' }),
    notFound: ctx(LIVE, { status: 404, html: 'missing' }),
  };
  for (const [label, c] of Object.entries(cases)) {
    const calls = stubTitle({ body: { ok: true, title: TITLE } });
    const res = await onRequest(c);
    assert.equal(calls.length, 0, `${label} must not call the lookup`);
    if (label !== 'head') assert.doesNotMatch(await res.text(), /Rob, your Devote/, label);
  }
});

test('the function never logs, and stays small', () => {
  for (const f of ['functions/claim/index.js', 'src/lib/invite-head.mjs']) {
    const src = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /\bconsole\./, `${f} must not log`);
    assert.ok(src.split('\n').length <= 900, f);
  }
});
