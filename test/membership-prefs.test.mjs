// SOW-046 (B/E): the member-prefs Worker handler (workers/signup/membership-prefs.mjs) — paid gate + KV
// read-modify-write. Fake KV + stubbed authorizer -> no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handlePrefs, eraseMemberPrefs, PREFS_KEY } from '../workers/signup/membership-prefs.mjs';
import { OVERRIDES_KV_KEY } from '../workers/signup/membership-content.mjs';

const fakeKV = (init = {}) => {
  const store = new Map(Object.entries(init));
  return {
    store,
    async get(k, t) { const v = store.get(k); return v == null ? null : (t === 'json' ? JSON.parse(v) : v); },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
  };
};
const paid = (request, env, deps) => ({ ok: true, githubId: '1' });
const denied = () => ({ ok: false, status: 403, body: { error: 'forbidden' } });
const REQ = (method, body) => new Request('https://x/membership/prefs', { method, ...(body ? { body: JSON.stringify(body) } : {}) });

test('prefs: GET returns normalized prefs for a paid member', async () => {
  const kv = fakeKV({ 'prefs:1': JSON.stringify({ categories: ['ai'], followedChannels: ['sdtimes'] }) });
  const r = await handlePrefs(REQ('GET'), {}, { kv, authorize: paid });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.prefs, { categories: ['ai'], followedChannels: ['sdtimes'] });
});

test('prefs: a non-paid caller is denied (no KV touched)', async () => {
  const kv = fakeKV();
  const r = await handlePrefs(REQ('GET'), {}, { kv, authorize: denied });
  assert.equal(r.status, 403);
  assert.equal(kv.store.size, 0);
});

test('prefs: POST followChannel persists to the per-member KV key', async () => {
  const kv = fakeKV();
  const r = await handlePrefs(REQ('POST', { followChannel: { id: 'bleeping-computer', on: true } }), {}, { kv, authorize: paid });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.prefs.followedChannels, ['bleeping-computer']);
  assert.deepEqual(JSON.parse(kv.store.get('prefs:1')).followedChannels, ['bleeping-computer']);
  // unfollow
  const r2 = await handlePrefs(REQ('POST', { followChannel: { id: 'bleeping-computer', on: false } }), {}, { kv, authorize: paid });
  assert.deepEqual(r2.body.prefs.followedChannels, []);
});

test('prefs: POST an invalid patch -> 400', async () => {
  const r = await handlePrefs(REQ('POST', { categories: 'nope' }), {}, { kv: fakeKV(), authorize: paid });
  assert.equal(r.status, 400);
});

// SOW-078: prefs records NO analytics, so its DEFAULT gate is the Stripe-free authorizeMemberCheap — a free member
// is served and a banned member denied, both with NO Stripe call (proven by a makeStripe that throws if invoked).
const freshMirror = (over = {}) => ({ generatedAt: new Date().toISOString(), roles: over.roles ?? {}, bans: over.bans ?? { bans: [] }, grandfathered: over.grandfathered ?? { grandfathered: [] } });
const userIs = (id) => async () => ({ githubId: id, githubLogin: 'u' });
const explodeStripe = () => () => ({ findCustomerByGithubId: async () => { throw new Error('Stripe must not be called for prefs'); } });
const REQ_AUTH = (method, body) => new Request('https://x/membership/prefs', { method, headers: { Authorization: 'Bearer tok' }, ...(body ? { body: JSON.stringify(body) } : {}) });

test('prefs (SOW-078): the DEFAULT gate is Stripe-free — a free member is served, a banned member denied, no Stripe call', async () => {
  const free = await handlePrefs(REQ_AUTH('GET'), {}, { kv: fakeKV({ [OVERRIDES_KV_KEY]: JSON.stringify(freshMirror()) }), fetchUser: userIs('9'), makeStripe: explodeStripe() });
  assert.equal(free.status, 200);
  const banned = await handlePrefs(REQ_AUTH('GET'), {}, { kv: fakeKV({ [OVERRIDES_KV_KEY]: JSON.stringify(freshMirror({ bans: { bans: [{ github_id: '9' }] } })) }), fetchUser: userIs('9'), makeStripe: explodeStripe() });
  assert.equal(banned.status, 403);
  // a missing mirror still fails closed (a stale/unavailable mirror does not open prefs to a since-banned member)
  const noMirror = await handlePrefs(REQ_AUTH('GET'), {}, { kv: fakeKV(), fetchUser: userIs('9'), makeStripe: explodeStripe() });
  assert.equal(noMirror.status, 403);
});

test('eraseMemberPrefs hard-deletes the key (SOW-024 right-to-erasure)', async () => {
  const kv = fakeKV({ 'prefs:9': JSON.stringify({ categories: ['ai'] }) });
  await eraseMemberPrefs({ SIGNUP_KV: kv }, '9');
  assert.equal(kv.store.has(PREFS_KEY('9')), false);
});
