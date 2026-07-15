// SOW-119: coupon redemption at signup (workers/signup/coupons.mjs) + the runSignup coupon path + the
// membership-status fast-path. No network, no secrets: in-memory KV/Stripe/Discord fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  readCouponsConfig,
  validateCouponParam,
  redeemCoupon,
  readCouponGrant,
  couponGrantKey,
} from '../workers/signup/coupons.mjs';
import { redemptionKey, redemptionCountKey } from '../membership/coupons.mjs';
import { runSignup } from '../workers/signup/signup.mjs';
import { membershipStatus } from '../workers/signup/membership-status.mjs';

const NOW = new Date('2026-07-15T12:00:00.000Z');

function fakeKv(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async get(key, type) {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' || type?.type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

const MIRROR = JSON.stringify({
  generatedAt: NOW.toISOString(),
  coupons: [
    { code: 'CODEABLEYEAR', freeDays: 365, active: true, note: '', maxRedemptions: null, expiresAt: null },
    { code: 'CAPPED', freeDays: 30, active: true, note: '', maxRedemptions: 1, expiresAt: null },
  ],
});

test('readCouponsConfig honors the freshness guard', async () => {
  const fresh = fakeKv({ 'coupons:config': MIRROR });
  assert.ok(await readCouponsConfig(fresh, NOW));
  const stale = fakeKv({
    'coupons:config': JSON.stringify({ generatedAt: '2026-07-01T00:00:00.000Z', coupons: [] }),
  });
  assert.equal(await readCouponsConfig(stale, NOW), null); // > 48h old
  assert.equal(await readCouponsConfig(fakeKv(), NOW), null); // absent
});

test('validateCouponParam returns the normalized code only when redeemable', async () => {
  const kv = fakeKv({ 'coupons:config': MIRROR });
  assert.equal(await validateCouponParam(kv, ' codeableyear ', NOW), 'CODEABLEYEAR');
  assert.equal(await validateCouponParam(kv, 'UNKNOWN', NOW), '');
  assert.equal(await validateCouponParam(kv, '', NOW), '');
});

test('redeemCoupon writes the grant, the per-code record, and the counter', async () => {
  const kv = fakeKv({ 'coupons:config': MIRROR });
  const r = await redeemCoupon({ kv, code: 'CODEABLEYEAR', githubId: '42', now: NOW });
  assert.equal(r.already, false);
  assert.equal(r.until, '2027-07-15T12:00:00.000Z');
  assert.ok(kv.store.has(couponGrantKey('42')));
  assert.ok(kv.store.has(redemptionKey('CODEABLEYEAR', '42')));
  assert.equal(kv.store.get(redemptionCountKey('CODEABLEYEAR')), '1');
});

test('redeemCoupon is idempotent per github_id (one coupon per member, ever)', async () => {
  const kv = fakeKv({ 'coupons:config': MIRROR });
  await redeemCoupon({ kv, code: 'CODEABLEYEAR', githubId: '42', now: NOW });
  const again = await redeemCoupon({ kv, code: 'CODEABLEYEAR', githubId: '42', now: NOW });
  assert.equal(again.already, true);
  assert.equal(kv.store.get(redemptionCountKey('CODEABLEYEAR')), '1'); // counter did not move
  const other = await redeemCoupon({ kv, code: 'CAPPED', githubId: '42', now: NOW });
  assert.equal(other.already, true); // the existing grant wins; no second coupon
  assert.equal(kv.store.has(redemptionKey('CAPPED', '42')), false);
});

test('redeemCoupon enforces maxRedemptions and fails closed on unknowns', async () => {
  const kv = fakeKv({ 'coupons:config': MIRROR });
  assert.ok(await redeemCoupon({ kv, code: 'CAPPED', githubId: '1', now: NOW }));
  assert.equal(await redeemCoupon({ kv, code: 'CAPPED', githubId: '2', now: NOW }), null); // cap hit
  assert.equal(await redeemCoupon({ kv, code: 'UNKNOWN', githubId: '3', now: NOW }), null);
  assert.equal(await redeemCoupon({ kv: null, code: 'CODEABLEYEAR', githubId: '4', now: NOW }), null);
});

test('readCouponGrant honors the window and fails closed on junk', async () => {
  const kv = fakeKv({
    [couponGrantKey('42')]: JSON.stringify({ code: 'CODEABLEYEAR', redeemedAt: NOW.toISOString(), until: '2027-07-15T12:00:00.000Z' }),
    [couponGrantKey('99')]: JSON.stringify({ code: 'CODEABLEYEAR', redeemedAt: '2025-01-01T00:00:00.000Z', until: '2026-01-01T00:00:00.000Z' }),
    [couponGrantKey('66')]: JSON.stringify({ code: 'X', until: 'garbage' }),
  });
  assert.equal((await readCouponGrant(kv, '42', NOW))?.code, 'CODEABLEYEAR');
  assert.equal(await readCouponGrant(kv, '99', NOW), null); // expired
  assert.equal(await readCouponGrant(kv, '66', NOW), null); // malformed until
  assert.equal(await readCouponGrant(kv, '77', NOW), null); // absent
});

function fakeStripeCreate() {
  const created = [];
  return {
    created,
    async searchCustomerByGithubId() { return null; },
    async createCustomer(body, idem) { created.push({ body, idem }); return { id: 'cus_test1' }; },
    async updateCustomer() { throw new Error('should not update on create path'); },
  };
}
const fakeDiscord = { async addGuildMember() {}, async addRole() {} };

test('runSignup redeems a coupon for a new customer and reports it', async () => {
  const kv = fakeKv({ 'coupons:config': MIRROR });
  const out = await runSignup({
    identity: { githubId: '4242', githubLogin: 'octo', discordUserId: null, email: 'o@example.com', discordAccessToken: null },
    stripe: fakeStripeCreate(),
    discord: fakeDiscord,
    kv,
    config: { trialRoleId: 'r', guildId: 'g' },
    refCode: '',
    via: '',
    touchSession: '',
    coupon: 'CODEABLEYEAR',
    now: NOW,
  });
  assert.equal(out.couponApplied, true);
  assert.equal(out.couponUntil, '2027-07-15T12:00:00.000Z');
  assert.ok(kv.store.has(couponGrantKey('4242')));
});

test('runSignup with no coupon reports couponApplied false and writes no grant', async () => {
  const kv = fakeKv({ 'coupons:config': MIRROR });
  const out = await runSignup({
    identity: { githubId: '4243', githubLogin: 'octo2', discordUserId: null, email: null, discordAccessToken: null },
    stripe: fakeStripeCreate(),
    discord: fakeDiscord,
    kv,
    config: {},
    now: NOW,
  });
  assert.equal(out.couponApplied, false);
  assert.equal(kv.store.has(couponGrantKey('4243')), false);
});

test('runSignup records the coupon in new-customer metadata', async () => {
  const kv = fakeKv({ 'coupons:config': MIRROR });
  const stripe = fakeStripeCreate();
  await runSignup({
    identity: { githubId: '4244', githubLogin: 'octo3', discordUserId: null, email: null, discordAccessToken: null },
    stripe,
    discord: fakeDiscord,
    kv,
    config: {},
    coupon: 'CODEABLEYEAR',
    now: NOW,
  });
  assert.equal(stripe.created[0].body.metadata.coupon, 'CODEABLEYEAR');
});

test('membership-status reports paid for a fresh coupon grant (Stripe says none)', async () => {
  const kv = fakeKv({
    [couponGrantKey('777')]: JSON.stringify({ code: 'CODEABLEYEAR', redeemedAt: NOW.toISOString(), until: '2027-07-15T12:00:00.000Z' }),
  });
  const env = { STRIPE_SECRET_KEY: 'sk_test', SIGNUP_KV: kv };
  const request = new Request('https://signup.example/membership/status', { headers: { Authorization: 'Bearer tok' } });
  const r = await membershipStatus(request, env, {
    fetchImpl: async () => { throw new Error('no network'); },
    makeStripe: () => ({ async searchCustomerByGithubId() { throw new Error('stripe down'); } }),
    fetchUser: async () => ({ githubId: 777, githubLogin: 'couponer' }),
    now: NOW,
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'paid');
});
