// SOW-059 P1c-B: the conversion freeze + persisted snapshot store. Fake KV + fixture customer -> no network.
// Verifies flag-gating, the absent-only idempotency, conversionAt = paid_at (not now), the self-invite reject,
// touch-record clearing, github_ids-only persistence, and the erasure helpers (own-delete + counterpart scrub).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeAndPersist, readSnapshot, eraseSnapshot, scrubCounterpart, CONV_KEY, ATTRIBUTION_WINDOW_MS } from '../workers/signup/conversion-snapshot-store.mjs';
import { TOUCH_KEY } from '../workers/signup/membership-touches.mjs';

const SID = 'abcdefghijklmnopqrstuvwxyz012345';
const day = 86400000;
const conv = 100 * day;

function fakeKV(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async get(k, t) { const v = store.get(k); return v == null ? null : (t === 'json' ? JSON.parse(v) : v); },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
  };
}
function touchSeed() {
  return JSON.stringify({
    items: [
      { owner: 'alice', type: 'post', slug: 'a', firstAt: conv - 60 * day, lastAt: conv - 60 * day },
      { owner: 'bob', type: 'product', slug: 'b', firstAt: conv - 2 * day, lastAt: conv - 2 * day },
    ],
    invite: null, updatedAt: conv - 60 * day,
  });
}
const customer = (extra = {}) => ({ metadata: { github_id: '7', touch_session: SID, ...extra } });
const envOn = (kv) => ({ SIGNUP_KV: kv, TOUCH_CAPTURE_ENABLED: 'true' });

test('freezeAndPersist writes conv:<id> with the frozen attribution (github_ids only) + paid_at as conversionAt', async () => {
  const kv = fakeKV({ [TOUCH_KEY(SID)]: touchSeed() });
  const r = await freezeAndPersist({ env: envOn(kv), customer: customer({ referred_by: 'carol' }), conversionAt: conv, now: () => 999 });
  assert.equal(r.persisted, true);
  const rec = JSON.parse(kv.store.get(CONV_KEY('7')));
  assert.equal(rec.v, 1); assert.equal(rec.member, '7');
  assert.equal(rec.firstOwner, 'alice'); assert.equal(rec.lastOwner, 'bob');
  assert.deepEqual(rec.firstItem, { owner: 'alice', type: 'post', slug: 'a' });
  assert.deepEqual(rec.lastItem, { owner: 'bob', type: 'product', slug: 'b' });
  assert.equal(rec.inviter, 'carol');           // from referred_by
  assert.equal(rec.conversionAt, conv);          // paid_at, NOT now()
  assert.equal(rec.windowMs, ATTRIBUTION_WINDOW_MS);
  assert.deepEqual(rec.points, []);              // gathered at payout
  assert.equal(rec.frozenAt, 999);
  // no username/email/login anywhere in the record
  assert.ok(!JSON.stringify(rec).match(/login|email|username/i));
});

test('the consumed touch record is cleared after a successful freeze (data minimization)', async () => {
  const kv = fakeKV({ [TOUCH_KEY(SID)]: touchSeed() });
  await freezeAndPersist({ env: envOn(kv), customer: customer(), conversionAt: conv, now: () => 1 });
  assert.equal(kv.store.has(TOUCH_KEY(SID)), false);
});

test('absent-only idempotency: a second conversion event does NOT overwrite the frozen snapshot', async () => {
  const kv = fakeKV({ [TOUCH_KEY(SID)]: touchSeed() });
  await freezeAndPersist({ env: envOn(kv), customer: customer(), conversionAt: conv, now: () => 1 });
  const first = kv.store.get(CONV_KEY('7'));
  const r2 = await freezeAndPersist({ env: envOn(kv), customer: customer(), conversionAt: conv + 5 * day, now: () => 2 });
  assert.equal(r2.persisted, false); assert.equal(r2.reason, 'already_frozen');
  assert.equal(kv.store.get(CONV_KEY('7')), first); // unchanged
});

test('flag OFF -> nothing is persisted (inert until activation)', async () => {
  const kv = fakeKV({ [TOUCH_KEY(SID)]: touchSeed() });
  const r = await freezeAndPersist({ env: { SIGNUP_KV: kv /* TOUCH_CAPTURE_ENABLED unset */ }, customer: customer(), conversionAt: conv });
  assert.equal(r.persisted, false); assert.equal(r.reason, 'disabled');
  assert.equal(kv.store.has(CONV_KEY('7')), false);
});

test('no github_id -> no write; no touch_session -> still freezes (all-retained, invite from referred_by)', async () => {
  const kv1 = fakeKV();
  assert.equal((await freezeAndPersist({ env: envOn(kv1), customer: { metadata: {} }, conversionAt: conv })).reason, 'no_github_id');
  const kv2 = fakeKV();
  const r = await freezeAndPersist({ env: envOn(kv2), customer: { metadata: { github_id: '9', referred_by: 'carol' } }, conversionAt: conv, now: () => 1 });
  assert.equal(r.persisted, true);
  const rec = JSON.parse(kv2.store.get(CONV_KEY('9')));
  assert.equal(rec.firstOwner, null); assert.equal(rec.lastOwner, null); assert.equal(rec.inviter, 'carol');
});

test('self-invite is rejected (referred_by === the converting member -> inviter null)', async () => {
  const kv = fakeKV({ [TOUCH_KEY(SID)]: touchSeed() });
  await freezeAndPersist({ env: envOn(kv), customer: customer({ referred_by: '7' }), conversionAt: conv, now: () => 1 });
  assert.equal(JSON.parse(kv.store.get(CONV_KEY('7'))).inviter, null);
});

test('self-pay content lane: a converting member who is their own first/last-touch owner is scrubbed (share falls to retained)', async () => {
  // The pre-signup touch session contains ONLY content owned by the converting member ('7').
  const selfTouch = JSON.stringify({
    items: [{ owner: '7', type: 'post', slug: 'mine', firstAt: conv - 30 * day, lastAt: conv - 30 * day }],
    invite: null, updatedAt: conv - 30 * day,
  });
  const kv = fakeKV({ [TOUCH_KEY(SID)]: selfTouch });
  const r = await freezeAndPersist({ env: envOn(kv), customer: customer(), conversionAt: conv, now: () => 1 });
  assert.equal(r.persisted, true);
  const rec = JSON.parse(kv.store.get(CONV_KEY('7')));
  assert.equal(rec.firstOwner, null); // self-owner nulled -> the 30%/10% fall to retained, never self-paid
  assert.equal(rec.lastOwner, null);
});

test('readSnapshot + eraseSnapshot round-trip', async () => {
  const kv = fakeKV({ [TOUCH_KEY(SID)]: touchSeed() });
  await freezeAndPersist({ env: envOn(kv), customer: customer(), conversionAt: conv, now: () => 1 });
  assert.equal((await readSnapshot(envOn(kv), '7')).member, '7');
  await eraseSnapshot(envOn(kv), '7');
  assert.equal(await readSnapshot(envOn(kv), '7'), null);
});

test('scrubCounterpart nulls the erased member everywhere they are a counterpart', () => {
  const rec = {
    v: 1, member: '7', firstOwner: 'X', lastOwner: 'bob', firstItem: { owner: 'X', type: 'post', slug: 'a' },
    lastItem: { owner: 'bob', type: 'product', slug: 'b' }, inviter: 'X', points: [{ member: 'X', points: 1 }, { member: 'dana', points: 1 }],
  };
  const out = scrubCounterpart(rec, 'X');
  assert.equal(out.firstOwner, null); assert.equal(out.inviter, null); assert.equal(out.firstItem.owner, null);
  assert.equal(out.lastOwner, 'bob'); assert.equal(out.lastItem.owner, 'bob');
  assert.deepEqual(out.points, [{ member: 'dana', points: 1 }]);
  // a record not referencing X is left alone (null = nothing to write back)
  assert.equal(scrubCounterpart({ firstOwner: 'bob', points: [] }, 'X'), null);
});
