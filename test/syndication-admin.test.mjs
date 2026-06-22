// SOW-058: the superadmin tracker + cancel endpoints. Fake KV + injected authorizer; no network, no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleSyndicationTracker, handleSyndicationCancel } from '../workers/signup/syndication-admin.mjs';
import { enqueue, getItem, SYND_CONFIG_KEY } from '../workers/signup/syndication-store.mjs';

function fakeKV(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async get(key, type) { const v = store.get(key); return v === undefined ? null : (type === 'json' ? JSON.parse(v) : v); },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
    async list({ prefix = '' } = {}) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  };
}
const at = (t) => () => t;
const req = (body = null) => ({ method: 'POST', headers: { get: () => 'Bearer t' }, async json() { return body; } });
const getReq = () => ({ method: 'GET', headers: { get: () => 'Bearer t' } });
const superadmin = async () => ({ ok: true, githubId: '1', role: 'superadmin' });
const adminOnly = async () => ({ ok: true, githubId: '2', role: 'admin' });
const denied = async () => ({ ok: false, status: 403, body: { error: 'forbidden' } });
const cfg = JSON.stringify({ syndication: { enabled: true, hold_minutes: 60, channels: { discord: true } } });

async function seedItem(kv) {
  const r = await enqueue({ SIGNUP_KV: kv }, { source: 'share', targetSlug: 'a/x', url: 'https://ex.com', visibility: 'public' }, { kv, now: at(0) });
  return r.id;
}

test('tracker requires admin and returns the four buckets with a countdown', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: cfg });
  await seedItem(kv);
  const off = await handleSyndicationTracker(getReq(), {}, { kv, authorize: denied });
  assert.equal(off.status, 403);
  const r = await handleSyndicationTracker(getReq(), {}, { kv, now: at(0), authorize: adminOnly });
  assert.equal(r.status, 200);
  assert.equal(r.body.pending.length, 1);
  assert.equal(r.body.pending[0].secondsUntilAvailable, 3600); // one-hour hold
});

test('cancel requires SUPERADMIN (an admin is forbidden)', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: cfg });
  const id = await seedItem(kv);
  const adminTry = await handleSyndicationCancel(req({ id }), {}, { kv, authorize: adminOnly });
  assert.equal(adminTry.status, 403);
});

test('superadmin cancels a pending item; a second cancel is an idempotent no-op', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: cfg });
  const id = await seedItem(kv);
  const r = await handleSyndicationCancel(req({ id }), {}, { kv, now: at(5), authorize: superadmin });
  assert.equal(r.status, 200);
  assert.equal(r.body.cancelled, true);
  assert.equal((await getItem(kv, id)).status, 'cancelled');
  // already cancelled -> cancelled:false (idempotent)
  const again = await handleSyndicationCancel(req({ id }), {}, { kv, authorize: superadmin });
  assert.equal(again.body.cancelled, false);
});

test('cancel of an unknown id is a 404; a missing id is a 400', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: cfg });
  assert.equal((await handleSyndicationCancel(req({ id: 'nope' }), {}, { kv, authorize: superadmin })).status, 404);
  assert.equal((await handleSyndicationCancel(req({}), {}, { kv, authorize: superadmin })).status, 400);
});
