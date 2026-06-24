// SOW-073: the workbench stale-while-revalidate cache (in-memory fallback path, since node has no chrome.storage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wbCacheGet, wbCacheSet, wbCacheInvalidate, wbCacheInvalidateMany, wbCacheClear, wbKey, _resetWbMemoryStore,
} from '../client-ui/src/workbench-cache.mjs';

test('set + get round-trips items with a freshness flag', async () => {
  _resetWbMemoryStore();
  await wbCacheSet('me', 'post', [{ slug: 'a' }], { now: () => 1000 });
  const r = await wbCacheGet('me', 'post', { now: () => 1000 });
  assert.deepEqual(r.items, [{ slug: 'a' }]);
  assert.equal(r.fresh, true);
});

test('the TTL governs freshness, not presence (a stale entry is still returned, marked not-fresh)', async () => {
  _resetWbMemoryStore();
  await wbCacheSet('me', 'post', [{ slug: 'a' }], { now: () => 0 });
  const r = await wbCacheGet('me', 'post', { ttl: 1000, now: () => 5000 }); // 5s later, ttl 1s
  assert.ok(r, 'a stale entry is still returned (SWR shows it while revalidating)');
  assert.equal(r.fresh, false);
});

test('write-on-success: an empty list is NOT persisted unless allowEmpty (no auth-failure poisoning)', async () => {
  _resetWbMemoryStore();
  await wbCacheSet('me', 'post', []); // default: skip
  assert.equal(await wbCacheGet('me', 'post'), null);
  await wbCacheSet('me', 'post', [], { allowEmpty: true }); // success path: truly none
  assert.deepEqual((await wbCacheGet('me', 'post')).items, []);
});

test('per-member keying: one member never reads another member cache', async () => {
  _resetWbMemoryStore();
  await wbCacheSet('alice', 'post', [{ slug: 'a' }]);
  assert.equal(await wbCacheGet('bob', 'post'), null);
  assert.equal(wbKey('alice', 'post'), 'gbti:wb:alice:post');
});

test('invalidate removes one type; invalidateMany removes several', async () => {
  _resetWbMemoryStore();
  await wbCacheSet('me', 'post', [{ slug: 'a' }]);
  await wbCacheSet('me', 'prompt', [{ slug: 'b' }]);
  await wbCacheSet('me', 'product', [{ slug: 'c' }]);
  await wbCacheInvalidate('me', 'post');
  assert.equal(await wbCacheGet('me', 'post'), null);
  assert.ok(await wbCacheGet('me', 'prompt'));
  await wbCacheInvalidateMany('me', ['prompt', 'product']);
  assert.equal(await wbCacheGet('me', 'prompt'), null);
  assert.equal(await wbCacheGet('me', 'product'), null);
});

test('clear wipes a member entirely (sign-out / account switch GDPR guard)', async () => {
  _resetWbMemoryStore();
  await wbCacheSet('alice', 'post', [{ slug: 'a' }]);
  await wbCacheSet('alice', 'prs', [{ number: 1 }]);
  await wbCacheSet('bob', 'post', [{ slug: 'z' }]);
  await wbCacheClear('alice');
  assert.equal(await wbCacheGet('alice', 'post'), null);
  assert.equal(await wbCacheGet('alice', 'prs'), null);
  assert.ok(await wbCacheGet('bob', 'post'), 'clearing alice must not touch bob');
});

test('null/garbage inputs are safe no-ops (never throw, never blank the view)', async () => {
  _resetWbMemoryStore();
  await wbCacheSet(null, 'post', [{ slug: 'a' }]);
  await wbCacheSet('me', null, [{ slug: 'a' }]);
  await wbCacheSet('me', 'post', 'not-an-array');
  assert.equal(await wbCacheGet(null, 'post'), null);
  assert.equal(await wbCacheGet('me', 'post'), null);
});
