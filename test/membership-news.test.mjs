// SOW-043 P2: the members-only news proxy (workers/signup/membership-news.mjs). Effective-paid gated; holds the
// NEWS_API_KEY server-side and proxies the news worker's /feed. Pure over injected authorize/fetch -> no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { membershipNews, membershipNewsCategories, membershipNewsSources, findNewsItemByGuid } from '../workers/signup/membership-news.mjs';

const ENV = { NEWS_API_BASE: 'https://gbti-news.example.workers.dev', NEWS_API_KEY: 'secret-key' };
const req = (url = 'https://signup.gbti.network/membership/news') => new Request(url, { headers: { Authorization: 'Bearer tok' } });
const paid = () => ({ ok: true, githubId: '1' });
const denied = () => ({ ok: false, status: 403, body: { error: 'forbidden', message: 'an active paid membership is required' } });

test('news: a non-paid caller is denied (the proxy never calls the news worker / never exposes the key)', async () => {
  let called = false;
  const r = await membershipNews(req(), ENV, { authorize: denied, fetch: async () => { called = true; return new Response('{}'); } });
  assert.equal(r.status, 403);
  assert.equal(called, false, 'the upstream news worker must not be called for a denied member');
});

// SOW-077: news READ is open to any signed-in account INCLUDING banned (the default gate is now authorizeSignedIn).
// The handler must serve a banned reader (it is a non-KV read); the analytics tier carries through as 'banned'.
test('news: a BANNED reader is served (read-only, non-KV); the news_view is recorded as the banned tier', async () => {
  const bannedOk = () => ({ ok: true, githubId: '1', status: 'banned' });
  let recordedTier = null;
  const env = { ...ENV, EXT_ANALYTICS: { writeDataPoint: (p) => { recordedTier = p?.blobs?.[0]; } } };
  const fetch = async () => new Response(JSON.stringify({ updatedAt: 1, items: [{ guid: 'g1', title: 'A' }] }), { status: 200 });
  const r = await membershipNews(req(), env, { authorize: bannedOk, fetch });
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 1);
  assert.equal(recordedTier, 'banned', 'the news_view analytics event is bucketed as banned, not dropped');
});

test('news: a paid caller gets the proxied items + the bearer key is sent upstream (never to the client)', async () => {
  let sentAuth = null; let sentUrl = null;
  const fetch = async (url, init) => { sentUrl = url; sentAuth = init?.headers?.Authorization; return new Response(JSON.stringify({ updatedAt: 123, items: [{ guid: 'g1', title: 'A' }] }), { status: 200 }); };
  const r = await membershipNews(req('https://x/membership/news?limit=5&category=ai'), ENV, { authorize: paid, fetch });
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 1);
  assert.equal(r.body.count, 1);
  assert.equal(sentAuth, 'Bearer secret-key'); // the server-held NEWS_API_KEY, not the member token
  assert.match(sentUrl, /\/feed\?/);
  assert.match(sentUrl, /category=ai/);
  assert.match(sentUrl, /limit=5/);
});

test('news: 502 when the news service is not configured (no key/base leaks, no crash)', async () => {
  let called = false;
  const r = await membershipNews(req(), { NEWS_API_BASE: '', NEWS_API_KEY: '' }, { authorize: paid, fetch: async () => { called = true; return new Response('{}'); } });
  assert.equal(r.status, 502);
  assert.equal(called, false);
});

test('news: an upstream failure / unreachable service -> 502 (fail-soft, no key leak in the body)', async () => {
  const r1 = await membershipNews(req(), ENV, { authorize: paid, fetch: async () => new Response('nope', { status: 500 }) });
  assert.equal(r1.status, 502);
  const r2 = await membershipNews(req(), ENV, { authorize: paid, fetch: async () => { throw new Error('network'); } });
  assert.equal(r2.status, 502);
  assert.ok(!JSON.stringify(r2.body).includes('secret-key'));
});

test('news: a junk/oversized category or limit is sanitized, not proxied verbatim', async () => {
  let sentUrl = null;
  const fetch = async (url) => { sentUrl = url; return new Response(JSON.stringify({ items: [] }), { status: 200 }); };
  await membershipNews(req('https://x/membership/news?category=' + encodeURIComponent('../evil?x=1') + '&limit=99999'), ENV, { authorize: paid, fetch });
  assert.ok(!/evil/.test(sentUrl), 'an unsafe category is dropped, not forwarded');
  assert.match(sentUrl, /limit=100/, 'limit is clamped to 100');
});

test('news-sources (SOW-046): paid passes through the followable channels; non-paid denied; unconfigured 502', async () => {
  const ok = await membershipNewsSources(req(), ENV, { authorize: paid, fetch: async () => new Response(JSON.stringify({ sources: [{ id: 'bleeping-computer', name: 'BleepingComputer', count: 12 }] }), { status: 200 }) });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.sources[0].id, 'bleeping-computer');
  let called = false;
  assert.equal((await membershipNewsSources(req(), ENV, { authorize: denied, fetch: async () => { called = true; return new Response('{}'); } })).status, 403);
  assert.equal(called, false);
  assert.equal((await membershipNewsSources(req(), {}, { authorize: paid, fetch: async () => new Response('{}') })).status, 502);
});

test('findNewsItemByGuid (SOW-046 C): resolves the canonical item by guid; fail-closed on miss/unconfigured/error', async () => {
  const feed = { items: [{ guid: 'g1', title: 'One', category: 'ai', source: 'Example' }, { guid: 'g2', title: 'Two', category: 'devops' }] };
  let sentUrl = null;
  const fetch = async (url) => { sentUrl = url; return new Response(JSON.stringify(feed), { status: 200 }); };
  const hit = await findNewsItemByGuid(ENV, { guid: 'g2', fetch });
  assert.equal(hit.title, 'Two');
  assert.equal(hit.category, 'devops'); // canonical category drives the channel route, not anything client-supplied
  assert.match(sentUrl, /\/feed\?/);
  // a guid not in the window -> null (the publish path then 404s, posting nothing)
  assert.equal(await findNewsItemByGuid(ENV, { guid: 'ghost', fetch }), null);
  // unconfigured / upstream error -> null, no key leak, no crash
  assert.equal(await findNewsItemByGuid({}, { guid: 'g1', fetch: async () => new Response('{}') }), null);
  assert.equal(await findNewsItemByGuid(ENV, { guid: 'g1', fetch: async () => { throw new Error('net'); } }), null);
  // a forged/unsafe source hint is not forwarded verbatim (bounded to a safe token set)
  let srcUrl = null;
  await findNewsItemByGuid(ENV, { guid: 'g1', source: '../evil?x=1', fetch: async (url) => { srcUrl = url; return new Response(JSON.stringify(feed), { status: 200 }); } });
  assert.ok(!/evil/.test(srcUrl), 'an unsafe source hint is dropped, not forwarded');
});

test('news-categories: paid passes through; non-paid denied; unconfigured 502', async () => {
  const ok = await membershipNewsCategories(req(), ENV, { authorize: paid, fetch: async () => new Response(JSON.stringify({ categories: [{ name: 'AI', count: 3 }] }), { status: 200 }) });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.categories[0].name, 'AI');
  assert.equal((await membershipNewsCategories(req(), ENV, { authorize: denied, fetch: async () => new Response('{}') })).status, 403);
  assert.equal((await membershipNewsCategories(req(), {}, { authorize: paid, fetch: async () => new Response('{}') })).status, 502);
});

// sow-139: the PUBLIC news list. No auth at all; capped tighter than the signed-in proxy; the key
// stays server-side; unconfigured env fails closed with a 502 and no upstream call.
import { publicNews } from '../workers/signup/membership-news.mjs';

test('public news: an anonymous request (no Authorization header) is served with the capped limit', async () => {
  let sentUrl = null; let sentAuth = null;
  const fetch = async (url, init) => { sentUrl = url; sentAuth = init?.headers?.Authorization; return new Response(JSON.stringify({ updatedAt: 9, items: [{ guid: 'g1', title: 'A' }] }), { status: 200 }); };
  const r = await publicNews(new Request('https://signup.gbti.network/news/feed'), ENV, { fetch });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.items.length, 1);
  assert.equal(sentAuth, 'Bearer secret-key'); // the server-held key goes upstream, never to the page
  assert.match(sentUrl, /limit=40/); // the anonymous default is 40
});

test('public news: limit is clamped to 60 and category/since are sanitized', async () => {
  let sentUrl = null;
  const fetch = async (url) => { sentUrl = url; return new Response(JSON.stringify({ items: [] }), { status: 200 }); };
  await publicNews(new Request('https://x/news/feed?limit=500&category=../evil&since=abc'), ENV, { fetch });
  assert.match(sentUrl, /limit=60/);
  assert.doesNotMatch(sentUrl, /category=/); // the unsafe category token is dropped
  assert.doesNotMatch(sentUrl, /since=/); // the non-numeric since is dropped
});

test('public news: an unconfigured news env returns 502 without calling upstream', async () => {
  let called = false;
  const r = await publicNews(new Request('https://x/news/feed'), {}, { fetch: async () => { called = true; return new Response('{}'); } });
  assert.equal(r.status, 502);
  assert.equal(called, false);
});

test('public news: a safe source narrows the upstream window; an unsafe one is dropped', async () => {
  let sentUrl = null;
  const fetch = async (url) => { sentUrl = url; return new Response(JSON.stringify({ items: [] }), { status: 200 }); };
  await publicNews(new Request('https://x/news/feed?source=pytorch'), ENV, { fetch });
  assert.match(sentUrl, /source=pytorch/);
  await publicNews(new Request('https://x/news/feed?source=..%2Fevil%3Fx'), ENV, { fetch });
  assert.doesNotMatch(sentUrl, /source=\.\./);
});
