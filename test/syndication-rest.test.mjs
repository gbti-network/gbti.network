// SOW-058 P4: the Actions-side KV-REST enqueue. A fake CF KV REST API over an in-memory Map proves enqueueViaKvRest
// runs the SAME Worker enqueue (item + dedupe pointer + pending index), is a reported no-op without creds, and
// dedupes a republish.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enqueueViaKvRest } from '../scripts/lib/syndication-rest.mjs';

function fakeKvFetch(store) {
  return async (url, opts = {}) => {
    const m = /namespaces\/[^/]+\/values\/(.+)$/.exec(url);
    const key = m ? decodeURIComponent(m[1]) : '';
    if ((opts.method || 'GET') === 'PUT') { store.set(key, String(opts.body)); return { ok: true, status: 200 }; }
    if (!store.has(key)) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, text: async () => store.get(key) };
  };
}

const ENV = { CF_ACCOUNT_ID: 'a', CF_KV_NAMESPACE_ID: 'n', CF_API_TOKEN: 't' };
const INPUT = { source: 'post', targetType: 'post', targetSlug: 'members/alice/posts/x', author: 'alice', title: 'X', url: 'https://gbti.network/articles/x/', visibility: 'public' };

test('enqueueViaKvRest is a reported no-op without CF creds (never fetches, never throws)', async () => {
  const r = await enqueueViaKvRest([INPUT], { env: {}, fetchImpl: async () => { throw new Error('should not fetch'); } });
  assert.equal(r.available, false);
  assert.equal(r.enqueued, 0);
});

test('enqueueViaKvRest writes the item + dedupe pointer + pending index via REST, with the hold applied', async () => {
  const store = new Map();
  const r = await enqueueViaKvRest([INPUT], { env: ENV, fetchImpl: fakeKvFetch(store), now: () => 1700000000000 });
  assert.equal(r.available, true);
  assert.equal(r.enqueued, 1);
  const itemKeys = [...store.keys()].filter((k) => k.startsWith('synd:item:'));
  assert.equal(itemKeys.length, 1);
  const item = JSON.parse(store.get(itemKeys[0]));
  assert.equal(item.source, 'post');
  assert.equal(item.targetSlug, 'members/alice/posts/x');
  assert.equal(item.status, 'pending');
  assert.ok(item.availableAt > item.enqueuedAt); // the one-hour hold is applied
  assert.equal(store.get('synd:dedupe:post:members/alice/posts/x'), item.id); // dedupe pointer
  assert.ok(JSON.parse(store.get('synd:pending')).ids.includes(item.id)); // pending index
});

test('a republish (same dedupeKey) does not double-enqueue', async () => {
  const store = new Map();
  const opts = { env: ENV, fetchImpl: fakeKvFetch(store), now: () => 1700000000000 };
  await enqueueViaKvRest([INPUT], opts);
  const r2 = await enqueueViaKvRest([INPUT], opts);
  assert.equal(r2.results[0].enqueued, false); // blocked by the dedupe pointer
  assert.equal([...store.keys()].filter((k) => k.startsWith('synd:item:')).length, 1);
});
