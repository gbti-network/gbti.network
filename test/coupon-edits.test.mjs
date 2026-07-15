// SOW-119: the pure coupon-pool edit core + the Worker admin coupon endpoints. No network, no fs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { addCouponEdit, updateCouponEdit, CouponEditError } from '../membership/coupon-edits.mjs';
import { membershipCouponUsage, membershipCouponLinkRotate } from '../workers/signup/membership-coupons-admin.mjs';

const CTX = { actor: { githubId: '2002207', login: 'atwellpub' }, now: new Date('2026-07-15T12:00:00.000Z') };
const POOL = { coupons: [{ code: 'CODEABLEYEAR', freeDays: 365, active: true, note: '', maxRedemptions: null, expiresAt: null }] };

test('addCouponEdit adds a normalized coupon and rejects dups + junk', () => {
  const r = addCouponEdit(POOL, { code: ' summer25 ', freeDays: 90, note: 'Summer promo' }, CTX);
  assert.equal(r.changed, true);
  assert.equal(r.next.coupons.length, 2);
  assert.deepEqual(r.next.coupons[1], { code: 'SUMMER25', freeDays: 90, active: true, note: 'Summer promo', maxRedemptions: null, expiresAt: null });
  assert.equal(r.audit.action, 'coupon-add');
  assert.throws(() => addCouponEdit(POOL, { code: 'codeableyear', freeDays: 30 }, CTX), CouponEditError);
  assert.throws(() => addCouponEdit(POOL, { code: 'bad code', freeDays: 30 }, CTX), CouponEditError);
  assert.throws(() => addCouponEdit(POOL, { code: 'OK', freeDays: 0 }, CTX), CouponEditError);
  assert.throws(() => addCouponEdit(POOL, { code: 'OKOK', freeDays: 30, maxRedemptions: 0 }, CTX), CouponEditError);
});

test('updateCouponEdit patches fields, is idempotent, and validates', () => {
  const r = updateCouponEdit(POOL, { code: 'codeableyear', patch: { active: false, freeDays: 180 } }, CTX);
  assert.equal(r.changed, true);
  assert.equal(r.next.coupons[0].active, false);
  assert.equal(r.next.coupons[0].freeDays, 180);
  const same = updateCouponEdit(POOL, { code: 'CODEABLEYEAR', patch: { active: true } }, CTX);
  assert.equal(same.changed, false); // already active
  assert.throws(() => updateCouponEdit(POOL, { code: 'NOPE', patch: { active: false } }, CTX), CouponEditError);
  assert.throws(() => updateCouponEdit(POOL, { code: 'CODEABLEYEAR', patch: {} }, CTX), CouponEditError);
});

function fakeKv(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async get(key, type) {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
    async list({ prefix, cursor }) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true };
    },
  };
}

const NOW = new Date('2026-07-15T12:00:00.000Z');
const MIRROR = JSON.stringify({ generatedAt: NOW.toISOString(), coupons: [{ code: 'CODEABLEYEAR', freeDays: 365, active: true, maxRedemptions: null, expiresAt: null }] });
const okAuth = async () => ({ ok: true, githubId: '2002207' });
const noAuth = async () => ({ ok: false, status: 403, body: { error: 'forbidden' } });
const req = (body) => new Request('https://x/y', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('membershipCouponUsage denies before reading and aggregates counts + links', async () => {
  const kv = fakeKv({
    'coupons:config': MIRROR,
    'redemption:CODEABLEYEAR:42': JSON.stringify({ code: 'CODEABLEYEAR', login: 'octo', redeemedAt: NOW.toISOString(), until: '2027-07-15T12:00:00.000Z' }),
    'redemptions:CODEABLEYEAR': '1',
    'coupon-link-for:CODEABLEYEAR': 'tok123abc',
  });
  const denied = await membershipCouponUsage(new Request('https://x/y'), { SIGNUP_KV: kv }, { authorize: noAuth });
  assert.equal(denied.status, 403);

  const r = await membershipCouponUsage(new Request('https://x/y'), { SIGNUP_KV: kv }, { authorize: okAuth, now: NOW });
  assert.equal(r.status, 200);
  assert.equal(r.body.usage.CODEABLEYEAR.count, 1);
  assert.equal(r.body.usage.CODEABLEYEAR.redemptions[0].login, 'octo');
  assert.equal(r.body.links.CODEABLEYEAR, 'tok123abc');
});

test('membershipCouponLinkRotate mints a token, kills the old link, 404s an unknown code', async () => {
  const kv = fakeKv({ 'coupons:config': MIRROR, 'coupon-link-for:CODEABLEYEAR': 'oldtok', 'coupon-link:oldtok': 'CODEABLEYEAR' });
  let n = 0;
  const randomUUID = () => `new-token-${++n}-abcdef1234567890`;
  const r = await membershipCouponLinkRotate(req({ code: 'codeableyear' }), { SIGNUP_KV: kv }, { authorize: okAuth, now: NOW, randomUUID });
  assert.equal(r.status, 200);
  assert.equal(r.body.rotated, true);
  const token = r.body.token;
  assert.equal(kv.store.get(`coupon-link:${token}`), 'CODEABLEYEAR');
  assert.equal(kv.store.get('coupon-link-for:CODEABLEYEAR'), token);
  assert.equal(kv.store.has('coupon-link:oldtok'), false); // the leaked URL is dead

  const missing = await membershipCouponLinkRotate(req({ code: 'NOPE' }), { SIGNUP_KV: kv }, { authorize: okAuth, now: NOW, randomUUID });
  assert.equal(missing.status, 404);
});
