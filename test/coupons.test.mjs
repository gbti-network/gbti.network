// SOW-119: the coupon registry core (membership/coupons.mjs). Pure, no network, no fs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCouponCode,
  couponsFromParsed,
  couponByCode,
  couponIsRedeemable,
  redemptionUntil,
  redemptionKey,
  redemptionCountKey,
  couponLinkKey,
  validateCoupons,
  toCouponsMirror,
} from '../membership/coupons.mjs';

const POOL = {
  coupons: [
    { code: 'CODEABLEYEAR', freeDays: 365, active: true, note: 'Codeable', maxRedemptions: null, expiresAt: null },
    { code: 'halfyear', freeDays: 182, active: true },
    { code: 'RETIRED', freeDays: 30, active: false },
    { code: 'CAPPED', freeDays: 30, active: true, maxRedemptions: 2 },
    { code: 'EXPIRED', freeDays: 30, active: true, expiresAt: '2020-01-01T00:00:00.000Z' },
  ],
};

test('normalizeCouponCode trims and uppercases', () => {
  assert.equal(normalizeCouponCode('  codeableyear '), 'CODEABLEYEAR');
  assert.equal(normalizeCouponCode(null), '');
});

test('couponsFromParsed normalizes, skips malformed, first write wins on dup', () => {
  const map = couponsFromParsed({
    coupons: [
      { code: 'GOOD', freeDays: 10, active: true },
      { code: 'good', freeDays: 99, active: true }, // dup after normalization: ignored
      { code: 'bad code!', freeDays: 10, active: true }, // invalid chars
      { code: 'NODAYS', freeDays: 0, active: true }, // invalid freeDays
      { code: 'FLOAT', freeDays: 1.5, active: true },
      { code: 'NEGCAP', freeDays: 10, active: true, maxRedemptions: -1 },
    ],
  });
  assert.deepEqual([...map.keys()], ['GOOD']);
  assert.equal(map.get('GOOD').freeDays, 10);
});

test('couponByCode resolves case-insensitively and fails closed', () => {
  const now = new Date('2026-07-15T00:00:00Z');
  assert.equal(couponByCode(POOL, 'codeableyear', now)?.code, 'CODEABLEYEAR');
  assert.equal(couponByCode(POOL, 'HALFYEAR', now)?.freeDays, 182);
  assert.equal(couponByCode(POOL, 'RETIRED', now), null); // inactive
  assert.equal(couponByCode(POOL, 'EXPIRED', now), null); // past expiresAt
  assert.equal(couponByCode(POOL, 'UNKNOWN', now), null);
  assert.equal(couponByCode(null, 'CODEABLEYEAR', now), null);
});

test('couponIsRedeemable fails closed on an unparseable expiresAt', () => {
  assert.equal(couponIsRedeemable({ code: 'X', freeDays: 10, active: true, expiresAt: 'not-a-date' }), false);
  assert.equal(couponIsRedeemable({ code: 'X', freeDays: 10, active: true, expiresAt: null }), true);
});

test('redemptionUntil adds freeDays in UTC and fails closed on junk', () => {
  assert.equal(redemptionUntil(new Date('2026-07-15T08:00:00.000Z'), 365), '2027-07-15T08:00:00.000Z');
  assert.equal(redemptionUntil(new Date('2026-07-15T08:00:00.000Z'), 0), null);
  assert.equal(redemptionUntil('garbage', 10), null);
});

test('KV key helpers normalize the code', () => {
  assert.equal(redemptionKey('codeableyear', '1367750'), 'redemption:CODEABLEYEAR:1367750');
  assert.equal(redemptionCountKey('codeableyear'), 'redemptions:CODEABLEYEAR');
  assert.equal(couponLinkKey(' tok123 '), 'coupon-link:tok123');
});

test('validateCoupons flags structural problems and accepts the shipped file shape', () => {
  assert.deepEqual(validateCoupons(POOL), []);
  assert.deepEqual(validateCoupons(null), []);
  const errs = validateCoupons({
    coupons: [
      { code: 'x!', freeDays: 0, active: 'yes', maxRedemptions: 0, expiresAt: 'junk' },
      { code: 'DUP', freeDays: 5, active: true },
      { code: 'dup', freeDays: 5, active: true },
    ],
  });
  assert.ok(errs.some((e) => e.includes('code must be')));
  assert.ok(errs.some((e) => e.includes('freeDays')));
  assert.ok(errs.some((e) => e.includes('active')));
  assert.ok(errs.some((e) => e.includes('maxRedemptions')));
  assert.ok(errs.some((e) => e.includes('expiresAt')));
  assert.ok(errs.some((e) => e.includes('duplicate coupon code DUP')));
  assert.deepEqual(validateCoupons({ coupons: 'nope' }), ['coupons.yml: `coupons` must be a list']);
});

test('toCouponsMirror carries only normalized coupons + generatedAt', () => {
  const m = toCouponsMirror(POOL, new Date('2026-07-15T00:00:00Z'));
  assert.equal(m.generatedAt, '2026-07-15T00:00:00.000Z');
  assert.equal(m.coupons.length, 5);
  assert.ok(m.coupons.every((c) => /^[A-Z0-9]+$/.test(c.code)));
});
