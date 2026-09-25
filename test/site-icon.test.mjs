// sow-397: the Worker's name + icon lookup for a quick-launch destination of the member's own
// (POST /membership/og-preview with icon:true). Fake fetch, no network, no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteNameFrom, iconCandidates, resolveSiteIcon, ICON_MAX_BYTES } from '../workers/signup/site-icon.mjs';
import { handleOgPreview, safeFetchTarget } from '../workers/signup/membership-og.mjs';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const res = ({ status = 200, type = 'text/html', body = '', bytes = null, length = null, url = '' } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  url,
  headers: { get: (h) => (h.toLowerCase() === 'content-type' ? type : h.toLowerCase() === 'content-length' ? (length == null ? null : String(length)) : null) },
  text: async () => body,
  arrayBuffer: async () => (bytes || new TextEncoder().encode(body)).buffer,
});
/** A fake fetch serving a map of url -> response, recording every request. */
function site(map) {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); const r = map[url]; if (r instanceof Error) throw r; return r || res({ status: 404 }); };
  return { fetchImpl, calls };
}

test('the name: og:site_name, then application-name, then the title, decoded and capped', () => {
  assert.equal(siteNameFrom('<title>Home | Acme</title><meta property="og:site_name" content="Acme &amp; Co">'), 'Acme & Co');
  assert.equal(siteNameFrom('<meta name="application-name" content="Hacker News"><title>HN front page</title>'), 'Hacker News');
  assert.equal(siteNameFrom('<title>\n  Hacker   News </title>'), 'Hacker News');
  assert.equal(siteNameFrom(`<title>${'Long '.repeat(20)}</title>`).length <= 40, true);
  assert.equal(siteNameFrom(''), '');
});

test('the icon candidates: apple-touch-icon first, then by size, resolved, with /favicon.ico last', () => {
  const html = `<link rel="icon" href="/small.png" sizes="16x16"><link rel="icon" type="image/png" sizes="192x192" href="big.png">
    <link rel="apple-touch-icon" href="https://cdn.example.com/touch.png"><link rel="icon" href="data:image/png;base64,AAAA">
    <link rel="stylesheet" href="/x.css"><link rel="shortcut icon" href="/small.png">`;
  assert.deepEqual(iconCandidates(html, 'https://example.com/app/'), [
    'https://cdn.example.com/touch.png', 'https://example.com/app/big.png', 'https://example.com/small.png', 'https://example.com/favicon.ico',
  ]);
  assert.deepEqual(iconCandidates('', 'https://example.com/a/b'), ['https://example.com/favicon.ico']);
});

test('it returns the declared icon as a data URL, with the site name', async () => {
  const { fetchImpl, calls } = site({
    'https://news.example.com/': res({ body: '<title>News</title><link rel="apple-touch-icon" href="/touch.png">' }),
    'https://news.example.com/touch.png': res({ type: 'image/png', bytes: PNG }),
  });
  const r = await resolveSiteIcon('https://news.example.com/', { fetchImpl, safeTarget: safeFetchTarget });
  assert.deepEqual(r, { ok: true, title: 'News', icon: `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`, reason: null });
  assert.deepEqual(calls, ['https://news.example.com/', 'https://news.example.com/touch.png']);
});

test('a candidate that is not an image, or is too big, is skipped for the next one', async () => {
  const big = new Uint8Array(ICON_MAX_BYTES + 1);
  const { fetchImpl, calls } = site({
    'https://a.example/': res({ body: '<link rel="apple-touch-icon" href="/t.png"><link rel="icon" sizes="64x64" href="/i.png">' }),
    'https://a.example/t.png': res({ type: 'text/html', body: '<html>login</html>' }),
    'https://a.example/i.png': res({ type: 'image/png', bytes: big }),
    'https://a.example/favicon.ico': res({ type: 'image/x-icon', bytes: PNG }),
  });
  const r = await resolveSiteIcon('https://a.example/', { fetchImpl, safeTarget: safeFetchTarget });
  assert.match(r.icon, /^data:image\/x-icon;base64,/);
  assert.equal(calls.length, 4);
  const declaredBig = site({ 'https://b.example/': res({ body: '' }), 'https://b.example/favicon.ico': res({ type: 'image/png', bytes: PNG, length: ICON_MAX_BYTES + 5 }) });
  assert.equal((await resolveSiteIcon('https://b.example/', { fetchImpl: declaredBig.fetchImpl, safeTarget: safeFetchTarget })).icon, null, 'a declared size over the cap is refused before reading');
});

test('an icon on a private or loopback host is never fetched, whatever the page declares', async () => {
  const { fetchImpl, calls } = site({
    'https://c.example/': res({ body: '<link rel="apple-touch-icon" href="http://169.254.169.254/latest/meta-data/"><link rel="icon" href="http://127.0.0.1/x.png">' }),
    'https://c.example/favicon.ico': res({ status: 404 }),
  });
  const r = await resolveSiteIcon('https://c.example/', { fetchImpl, safeTarget: safeFetchTarget });
  assert.deepEqual(r, { ok: true, title: null, icon: null, reason: 'no-icon' });
  assert.deepEqual(calls, ['https://c.example/', 'https://c.example/favicon.ico']);
});

test('an unreachable page still tries /favicon.ico, and nothing found is a clean answer, never a throw', async () => {
  const { fetchImpl } = site({ 'https://d.example/': new Error('refused'), 'https://d.example/favicon.ico': res({ type: 'image/vnd.microsoft.icon', bytes: PNG }) });
  assert.match((await resolveSiteIcon('https://d.example/', { fetchImpl, safeTarget: safeFetchTarget })).icon, /^data:image\/vnd\.microsoft\.icon;base64,/);
  const none = site({});
  assert.deepEqual(await resolveSiteIcon('https://e.example/', { fetchImpl: none.fetchImpl, safeTarget: safeFetchTarget }), { ok: true, title: null, icon: null, reason: 'no-icon' });
});

const req = (body, token = 'tok') => ({ method: 'POST', headers: { get: (h) => (h === 'Authorization' && token ? `Bearer ${token}` : null) }, async json() { return body; } });
const fetchUser = async () => ({ githubId: '42', githubLogin: 'me' });

test('the route: icon:true answers name + icon only, skips the topic suggestion, and still needs a signed-in member', async () => {
  const { fetchImpl } = site({
    'https://news.example.com/': res({ body: '<title>News</title>' }),
    'https://news.example.com/favicon.ico': res({ type: 'image/png', bytes: PNG }),
  });
  let suggested = 0;
  const suggest = async () => { suggested++; return 'ai'; };
  const r = await handleOgPreview(req({ url: 'https://news.example.com/', icon: true }), {}, { fetchImpl, fetchUser, suggest, suggestTagsImpl: suggest });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ['icon', 'ok', 'reason', 'title']);
  assert.equal(r.body.title, 'News');
  assert.equal(suggested, 0, 'no model call for an icon lookup');
  const anon = await handleOgPreview(req({ url: 'https://news.example.com/', icon: true }, ''), {}, { fetchImpl, fetchUser });
  assert.equal(anon.status, 401);
  const bad = await handleOgPreview(req({ url: 'http://127.0.0.1/', icon: true }), {}, { fetchImpl, fetchUser });
  assert.equal(bad.status, 400, 'the page address is SSRF-checked first');
  const plain = await handleOgPreview(req({ url: 'https://news.example.com/', icon: 'yes' }), {}, { fetchImpl, fetchUser, suggest, suggestTagsImpl: suggest });
  assert.ok('suggestedCategory' in plain.body, 'only a literal true takes the icon path');
});
