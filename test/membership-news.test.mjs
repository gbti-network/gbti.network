// SOW-043 P2: the members-only news proxy (workers/signup/membership-news.mjs). Effective-paid gated; holds the
// NEWS_API_KEY server-side and proxies the news worker's /feed. Pure over injected authorize/fetch -> no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { membershipNews, membershipNewsCategories } from '../workers/signup/membership-news.mjs';

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

test('news-categories: paid passes through; non-paid denied; unconfigured 502', async () => {
  const ok = await membershipNewsCategories(req(), ENV, { authorize: paid, fetch: async () => new Response(JSON.stringify({ categories: [{ name: 'AI', count: 3 }] }), { status: 200 }) });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.categories[0].name, 'AI');
  assert.equal((await membershipNewsCategories(req(), ENV, { authorize: denied, fetch: async () => new Response('{}') })).status, 403);
  assert.equal((await membershipNewsCategories(req(), {}, { authorize: paid, fetch: async () => new Response('{}') })).status, 502);
});
