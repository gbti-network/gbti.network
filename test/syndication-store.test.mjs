// SOW-058: the KV persistence layer. Fake KV (get/put/list), injected now. No network, no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  enqueue, getItem, listPending, listDue, listAll, removeFromPending, readSyndicationConfig, readContentChannels,
  SYND_ITEM_KEY, SYND_CONFIG_KEY,
} from '../workers/signup/syndication-store.mjs';

function fakeKV(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async get(key, type) { const v = store.get(key); return v === undefined ? null : (type === 'json' ? JSON.parse(v) : v); },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
    async list({ prefix = '', cursor } = {}) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true, cursor: '' };
    },
  };
}
const at = (t) => () => t;
const enabledCfg = { syndication: { enabled: true, hold_minutes: 60, channels: { discord: true } } };

test('readSyndicationConfig fails closed (disabled) when the mirror is absent', async () => {
  const cfg = await readSyndicationConfig(fakeKV());
  assert.equal(cfg.enabled, false);
});

test('enqueue writes the item, the dedupe pointer, and the pending index', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: JSON.stringify(enabledCfg) });
  const r = await enqueue({ SIGNUP_KV: kv }, { source: 'share', targetSlug: 'me/x', url: 'https://ex.com/a', visibility: 'public' }, { kv, now: at(1000) });
  assert.equal(r.enqueued, true);
  const item = await getItem(kv, r.id);
  assert.equal(item.url, 'https://ex.com/a');
  assert.equal(item.availableAt, 1000 + 60 * 60_000); // one-hour hold from the mirror
  const pending = await listPending(kv);
  assert.equal(pending.length, 1);
});

test('enqueue is idempotent on dedupeKey: a second identical enqueue is a no-op', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: JSON.stringify(enabledCfg) });
  const a = await enqueue({ SIGNUP_KV: kv }, { source: 'post', targetSlug: 'members/alice/posts/x' }, { kv, now: at(1) });
  const b = await enqueue({ SIGNUP_KV: kv }, { source: 'post', targetSlug: 'members/alice/posts/x' }, { kv, now: at(2) });
  assert.equal(a.enqueued, true);
  assert.equal(b.enqueued, false);
  assert.equal(b.reason, 'duplicate');
  assert.equal((await listAll(kv)).length, 1);
});

test('listDue returns only items past the hold, oldest-first, capped', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: JSON.stringify(enabledCfg) });
  await enqueue({ SIGNUP_KV: kv }, { source: 'share', targetSlug: 'a/x' }, { kv, now: at(0) }); // availableAt 3.6M
  await enqueue({ SIGNUP_KV: kv }, { source: 'share', targetSlug: 'b/y' }, { kv, now: at(1000) });
  const beforeHold = await listDue(kv, { now: at(1000), limit: 10 });
  assert.equal(beforeHold.length, 0); // nothing past the 1-hour hold yet
  const afterHold = await listDue(kv, { now: at(4 * 60 * 60_000), limit: 10 }); // 4h > both availableAt
  assert.equal(afterHold.length, 2);
  assert.deepEqual(afterHold.map((i) => i.targetSlug), ['a/x', 'b/y']); // oldest availableAt first
});

test('removeFromPending drops an id from the index', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: JSON.stringify(enabledCfg) });
  const r = await enqueue({ SIGNUP_KV: kv }, { source: 'share', targetSlug: 'a/x' }, { kv, now: at(0) });
  await removeFromPending(kv, r.id);
  assert.equal((await listPending(kv)).length, 0);
});

test('listAll returns items of any status via the prefix list', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: JSON.stringify(enabledCfg) });
  await enqueue({ SIGNUP_KV: kv }, { source: 'share', targetSlug: 'a/x' }, { kv, now: at(0) });
  await enqueue({ SIGNUP_KV: kv }, { source: 'share', targetSlug: 'b/y' }, { kv, now: at(1) });
  assert.equal((await listAll(kv)).length, 2);
});

// SOW-087: the synd:channels mirror reader (fail-closed to null).
test('readContentChannels returns the mirrored map, and null when missing/malformed/broken', async () => {
  const good = fakeKV({ 'synd:channels': JSON.stringify({ generatedAt: 'T0', channels: [{ category: 'ai', channelId: '5' }] }) });
  assert.deepEqual((await readContentChannels(good)).channels, [{ category: 'ai', channelId: '5' }]);
  const missing = fakeKV();
  assert.equal(await readContentChannels(missing), null);
  const malformed = fakeKV({ 'synd:channels': JSON.stringify({ nope: true }) });
  assert.equal(await readContentChannels(malformed), null);
  const broken = { get: async () => { throw new Error('kv down'); } };
  assert.equal(await readContentChannels(broken), null);
  assert.equal(await readContentChannels(null), null);
});
