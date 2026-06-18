// SOW-043 P2: the client read path for the news proxy (client/src/news-client.mjs). Fake fetch -> no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workerGetNews, workerGetNewsCategories, NewsClientError } from '../client/src/news-client.mjs';

const opts = (fetch) => ({ token: 'tok', signupBase: 'https://signup.gbti.network', fetch });

test('workerGetNews returns the items + sends the bearer token + builds the query', async () => {
  let url = null; let auth = null;
  const fetch = async (u, init) => { url = u; auth = init.headers.Authorization; return { ok: true, status: 200, json: async () => ({ items: [{ guid: 'g' }], updatedAt: 9 }) }; };
  const r = await workerGetNews({ ...opts(fetch), category: 'ai', limit: 10 });
  assert.equal(r.items.length, 1);
  assert.equal(r.updatedAt, 9);
  assert.equal(auth, 'Bearer tok');
  assert.match(url, /\/membership\/news\?/);
  assert.match(url, /category=ai/);
  assert.match(url, /limit=10/);
});

test('workerGetNews maps 401/403 to a paid-membership error (not a generic failure)', async () => {
  const fetch = async () => ({ ok: false, status: 403, json: async () => ({}) });
  await assert.rejects(() => workerGetNews(opts(fetch)), (e) => e instanceof NewsClientError && /paid membership/i.test(e.message));
});

test('workerGetNews requires a token + base (not signed in)', async () => {
  await assert.rejects(() => workerGetNews({ signupBase: 'https://x', fetch: async () => ({}) }), (e) => e instanceof NewsClientError && /not signed in/i.test(e.message));
});

test('workerGetNews maps a non-auth failure to a generic news-unavailable error', async () => {
  const fetch = async () => ({ ok: false, status: 502, json: async () => ({}) });
  await assert.rejects(() => workerGetNews(opts(fetch)), (e) => e instanceof NewsClientError && /unavailable/i.test(e.message));
});

test('workerGetNewsCategories returns the category list', async () => {
  const fetch = async () => ({ ok: true, status: 200, json: async () => ({ categories: [{ name: 'AI' }] }) });
  const r = await workerGetNewsCategories(opts(fetch));
  assert.equal(r.categories[0].name, 'AI');
});
