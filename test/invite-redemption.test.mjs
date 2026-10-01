// sow-231 Phase 2: redeeming an ISSUED INVITE, not just a campaign code.
//
// Each test here pins one of the five traps identified in planning. They are not general coverage of
// redemption (test/worker-coupons.test.mjs has that); they are the specific ways this feature goes wrong,
// written down so a later refactor that reintroduces one fails loudly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRedeemable, redeemCoupon, couponGrantKey, couponRedemptionCheck, couponRefusalReason, COUPON_REFUSAL } from '../workers/signup/coupons.mjs';
import { newInvite, inviteKey, inviteState } from '../membership/invites.mjs';
import { redemptionKey, redemptionCountKey, COUPONS_MIRROR_KEY } from '../membership/coupons.mjs';
import { couponLockKey, COUPON_LOCK_VALUE } from '../membership/coupon-lock.mjs';
import { runSignup } from '../workers/signup/signup.mjs';
import { yearStateFor, CLAIM_STATE } from '../membership/prepared-listings.mjs';

const NOW = new Date('2026-08-16T12:00:00.000Z');

/** KV double. Coupon config is seeded as the mirror the Worker actually reads. */
function fakeKv({ coupons = [], invites = [], extra = {} } = {}) {
  const store = new Map(Object.entries(extra));
  store.set(COUPONS_MIRROR_KEY, JSON.stringify({ generatedAt: NOW.toISOString(), coupons }));
  for (const inv of invites) store.set(inviteKey(inv.code), JSON.stringify(inv));
  return {
    store,
    async get(key, type) {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' || type?.type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
  };
}

const CAMPAIGN = { code: 'CODEABLEYEAR', freeDays: 365, active: true, tier: 'creator', maxRedemptions: null, expiresAt: null };
const invite = (over = {}) => ({ ...newInvite({ campaign: 'CODEABLEYEAR', code: 'CODEABLE7F3Q', now: NOW }), ...over });

// ---------------------------------------------------------------------------
// TRAP 1: a retired campaign must not void invites already sent
// ---------------------------------------------------------------------------

test('an invite still redeems after its campaign is RETIRED (active: false)', async () => {
  // The trap that would have done real damage. couponByCode returns null for a non-redeemable campaign, and
  // Phase 4 retires CODEABLEYEAR by setting active:false. Resolving invite TERMS through that helper would
  // silently void every outstanding link the moment the flag flipped, and those links were hand-issued to
  // named people who were promised a year. `active: false` closes the WALK-UP code, not the invites.
  const kv = fakeKv({ coupons: [{ ...CAMPAIGN, active: false }], invites: [invite()] });
  const { coupon, invite: inv } = await resolveRedeemable(kv, 'CODEABLE7F3Q', NOW);
  assert.ok(coupon, 'the invite still resolves to its campaign terms');
  assert.equal(coupon.tier, 'creator');
  assert.equal(inv.code, 'CODEABLE7F3Q');
});

test('the retired campaign code ITSELF is still refused, which is the point of retiring it', async () => {
  const kv = fakeKv({ coupons: [{ ...CAMPAIGN, active: false }], invites: [invite()] });
  const { coupon } = await resolveRedeemable(kv, 'CODEABLEYEAR', NOW);
  assert.equal(coupon, null, 'a walk-up redemption of the shared code is closed');
});

test('an invite whose campaign was DELETED outright resolves to nothing', async () => {
  // Distinct from retired: with no registry entry there are no terms to grant, so refusing is the only
  // honest answer. Fails closed to a plain signup.
  const kv = fakeKv({ coupons: [], invites: [invite()] });
  assert.deepEqual(await resolveRedeemable(kv, 'CODEABLE7F3Q', NOW), { coupon: null, invite: null });
});

test('a revoked, expired or already-redeemed invite resolves to nothing', async () => {
  const cases = [
    ['revoked', invite({ revokedAt: NOW.toISOString(), revokedBy: '1' })],
    ['expired', invite({ expiresAt: '2026-01-01T00:00:00.000Z' })],
    ['redeemed', invite({ redeemedAt: NOW.toISOString(), redeemedBy: '999' })],
  ];
  for (const [label, inv] of cases) {
    const kv = fakeKv({ coupons: [CAMPAIGN], invites: [inv] });
    const { coupon } = await resolveRedeemable(kv, inv.code, NOW);
    assert.equal(coupon, null, `${label} must not resolve`);
  }
});

// ---------------------------------------------------------------------------
// TRAP 2: never burn an invite when no grant was written
// ---------------------------------------------------------------------------

test('a member who ALREADY holds a grant does not burn the invite', async () => {
  // The realistic loss. Someone redeemed a campaign code months ago, then clicks an invite link. The
  // one-coupon-per-member lock refuses them, correctly, and the seat must NOT be spent for nothing.
  const existing = { code: 'OTHER', until: '2027-01-01T00:00:00.000Z' };
  const kv = fakeKv({
    coupons: [CAMPAIGN], invites: [invite()],
    extra: { [couponGrantKey('12345')]: JSON.stringify(existing) },
  });
  const out = await redeemCoupon({ kv, code: 'CODEABLE7F3Q', githubId: '12345', now: NOW });
  assert.equal(out.already, true, 'the existing grant is returned');
  const after = JSON.parse(kv.store.get(inviteKey('CODEABLE7F3Q')));
  assert.equal(after.redeemedBy, null, 'the invite is untouched');
  assert.equal(inviteState(after, NOW), 'issued');
});

test('the signup chain redeeming TWICE marks the invite once and keeps the same grant', async () => {
  // runSignup calls redeemCoupon on the GitHub hop and again on the deferred Discord link.
  const kv = fakeKv({ coupons: [CAMPAIGN], invites: [invite()] });
  const first = await redeemCoupon({ kv, code: 'CODEABLE7F3Q', githubId: '12345', login: 'octocat', now: NOW });
  const second = await redeemCoupon({ kv, code: 'CODEABLE7F3Q', githubId: '12345', login: 'octocat', now: NOW });
  assert.equal(first.already, false);
  assert.equal(second.already, true);
  assert.equal(Number(kv.store.get(redemptionCountKey('CODEABLEYEAR'))), 1, 'counted once, not twice');
  const after = JSON.parse(kv.store.get(inviteKey('CODEABLE7F3Q')));
  assert.equal(after.redeemedBy, '12345');
});

// ---------------------------------------------------------------------------
// TRAP 3: the cap counts against the CAMPAIGN, not the link
// ---------------------------------------------------------------------------

test('a campaign cap binds across MANY issued invites', async () => {
  // Keyed by invite code every link would have a count of 1 and a cap of 2 would never bind, which is the
  // opposite of what a cap is for.
  const invites = ['CODEABLEAAA', 'CODEABLEBBB', 'CODEABLECCC'].map((code) => invite({ code }));
  const kv = fakeKv({ coupons: [{ ...CAMPAIGN, maxRedemptions: 2 }], invites });
  const a = await redeemCoupon({ kv, code: 'CODEABLEAAA', githubId: '1', now: NOW });
  const b = await redeemCoupon({ kv, code: 'CODEABLEBBB', githubId: '2', now: NOW });
  const c = await redeemCoupon({ kv, code: 'CODEABLECCC', githubId: '3', now: NOW });
  assert.ok(a && b, 'the first two are within the cap');
  assert.equal(c, null, 'the third is refused by the CAMPAIGN cap');
  const third = JSON.parse(kv.store.get(inviteKey('CODEABLECCC')));
  assert.equal(third.redeemedBy, null, 'and the refused link is not burned');
});

// ---------------------------------------------------------------------------
// TRAP 4: the record carries the campaign so the fold can resolve a tier
// ---------------------------------------------------------------------------

test('the redemption record keys on the INVITE code and also names its campaign', async () => {
  const kv = fakeKv({ coupons: [CAMPAIGN], invites: [invite()] });
  const out = await redeemCoupon({ kv, code: 'CODEABLE7F3Q', githubId: '12345', now: NOW });
  assert.equal(out.code, 'CODEABLE7F3Q', 'provenance: the roster joins on the code actually used');
  assert.equal(out.campaign, 'CODEABLEYEAR', 'the fold needs a registry key it can resolve');
  assert.equal(out.tier, 'creator');
  assert.ok(kv.store.has(redemptionKey('CODEABLE7F3Q', '12345')), 'the per-member record uses the invite code');
});

// ---------------------------------------------------------------------------
// Unchanged behaviour: a plain campaign redemption
// ---------------------------------------------------------------------------

test('a campaign code still redeems exactly as before, with campaign == code', async () => {
  const kv = fakeKv({ coupons: [CAMPAIGN] });
  const out = await redeemCoupon({ kv, code: 'CODEABLEYEAR', githubId: '77', now: NOW });
  assert.equal(out.code, 'CODEABLEYEAR');
  assert.equal(out.campaign, 'CODEABLEYEAR');
  assert.equal(out.tier, 'creator');
});

// ---------------------------------------------------------------------------------------------------------------
// TRAP 5 (sow-427): a BOUND invite grants nothing to any other account, and stays unused for the right one
// ---------------------------------------------------------------------------------------------------------------
// Owner decision 3: "A different account signs in on a tied invitation: refuse BOTH the year and the listing. They
// end up with a plain free account and nothing more; the invitation stays unused so the right person can still
// claim both." redeemCoupon is the first point an account number exists, so the refusal lives there, and it must
// look exactly like the other early returns: nothing written, the link untouched.

const bound = (over = {}) => invite({ listingId: 'ABCDEFGHJKMNPQRS', boundGithubId: '4242', boundLogin: 'sam-dev', ...over });
const grantOrRedemptionKeys = (kv) => [...kv.store.keys()].filter((k) => k.startsWith('coupon-grant:') || k.startsWith('redemption:') || k.startsWith('redemptions:'));

test('TRAP 5: a bound invite and a DIFFERENT account: no grant, nothing written, the invite stays issued', async () => {
  const kv = fakeKv({ coupons: [CAMPAIGN], invites: [bound()] });
  const out = await redeemCoupon({ kv, code: 'CODEABLE7F3Q', githubId: '9999', login: 'someone-else', now: NOW });
  assert.equal(out, null, 'no year for the wrong account');
  const after = JSON.parse(kv.store.get(inviteKey('CODEABLE7F3Q')));
  assert.equal(after.redeemedBy, null, 'the link is not burned');
  assert.equal(inviteState(after, NOW), 'issued', 'the right person can still redeem it');
  assert.deepEqual(grantOrRedemptionKeys(kv), [], 'no coupon-grant:, redemption: or counter key was written');
});

test('TRAP 5: the same bound invite and the RIGHT account: the year is granted and the invite marked', async () => {
  const kv = fakeKv({ coupons: [CAMPAIGN], invites: [bound()] });
  // The wrong account first, then the right one: the refusal must not have spent anything the right one needs.
  assert.equal(await redeemCoupon({ kv, code: 'CODEABLE7F3Q', githubId: '9999', now: NOW }), null);
  const out = await redeemCoupon({ kv, code: 'CODEABLE7F3Q', githubId: '4242', login: 'sam-dev', now: NOW });
  assert.ok(out, 'the tied account gets its year');
  assert.equal(out.already, false);
  assert.ok(kv.store.has(couponGrantKey('4242')));
  const after = JSON.parse(kv.store.get(inviteKey('CODEABLE7F3Q')));
  assert.equal(after.redeemedBy, '4242');
});

test('TRAP 5: an UNBOUND prepared invite is first-come, exactly as sow-231 ruled', async () => {
  const kv = fakeKv({ coupons: [CAMPAIGN], invites: [invite({ listingId: 'ABCDEFGHJKMNPQRS' })] });
  const out = await redeemCoupon({ kv, code: 'CODEABLE7F3Q', githubId: '9999', now: NOW });
  assert.ok(out, 'whoever holds the link redeems it');
  assert.equal(JSON.parse(kv.store.get(inviteKey('CODEABLE7F3Q'))).redeemedBy, '9999');
});

test('TRAP 5: a refused bound invite leaves no copy of its code on the wrong account\'s customer record', async () => {
  const kv = fakeKv({ coupons: [CAMPAIGN], invites: [bound()] });
  const created = [];
  const stripe = {
    async searchCustomerByGithubId() { return null; },
    async createCustomer(body) { created.push(body); return { id: 'cus_x' }; },
    async updateCustomer() { throw new Error('create path only'); },
  };
  const out = await runSignup({
    identity: { githubId: '9999', githubLogin: 'someone-else', discordUserId: null, email: null, discordAccessToken: null },
    stripe, discord: { async addGuildMember() {}, async addRole() {} }, kv, config: {},
    refCode: '', via: '', touchSession: '', coupon: 'CODEABLE7F3Q', now: NOW,
  });
  assert.equal(out.couponApplied, false, 'a plain free signup');
  assert.equal(created[0].metadata.coupon, undefined, 'the bearer code is not recorded against the wrong account');
});

test('TRAP 5: a claim-pending or claimed invite resolves to nothing, so the next link holder gets no year', async () => {
  const at = NOW.toISOString();
  for (const inv of [invite({ claimPendingAt: at, claimPendingBy: '42' }), invite({ claimedAt: at, claimedBy: '42' })]) {
    const kv = fakeKv({ coupons: [CAMPAIGN], invites: [inv] });
    assert.deepEqual(await resolveRedeemable(kv, 'CODEABLE7F3Q', NOW), { coupon: null, invite: null });
    assert.equal(await redeemCoupon({ kv, code: 'CODEABLE7F3Q', githubId: '77', now: NOW }), null);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// sow-427 amendment 6: the claim page decides from the SAME reasons redeemCoupon refuses on
// ---------------------------------------------------------------------------------------------------------------
// The loop this closes: the claim page says "sign in to redeem your free year", the person signs in, redeemCoupon
// refuses for a reason the page did not know about, and they land back on the same offer. So every early return is
// named once (couponRefusalReason), redeemCoupon decides through it, and each one is pinned here against BOTH.

const LOCK_SECRET = 'test-coupon-lock-secret';

async function reasonAndRedeem(kv, githubId = '4242', { lockSecret = null, code = 'CODEABLE7F3Q' } = {}) {
  const check = await couponRedemptionCheck({ kv, code, githubId, now: NOW, lockSecret });
  const out = await redeemCoupon({ kv, code, githubId, now: NOW, lockSecret });
  return { reason: check.reason, out };
}

test('amendment 6: a grantable invite has NO refusal reason, and redeemCoupon grants', async () => {
  const { reason, out } = await reasonAndRedeem(fakeKv({ coupons: [CAMPAIGN], invites: [invite()] }));
  assert.equal(reason, null);
  assert.ok(out && out.already === false);
});

test('amendment 6: an existing grant is active, expired or corrupt, and each hands the record back unchanged', async () => {
  const cases = [
    ['grant_active', '2027-01-01T00:00:00.000Z'],
    ['grant_expired', '2026-01-01T00:00:00.000Z'],
    ['grant_corrupt', 'not a date'],
  ];
  for (const [want, until] of cases) {
    const kv = fakeKv({ coupons: [CAMPAIGN], invites: [invite()], extra: { [couponGrantKey('4242')]: JSON.stringify({ code: 'OTHER', until }) } });
    const { reason, out } = await reasonAndRedeem(kv);
    assert.equal(reason, want);
    assert.equal(out.already, true, `${want}: redeemCoupon returns the existing record, as before`);
    assert.equal(JSON.parse(kv.store.get(inviteKey('CODEABLE7F3Q'))).redeemedBy, null, `${want}: the invite is untouched`);
  }
});

test('amendment 6: the post-erasure lock refuses, and redeemCoupon returns null', async () => {
  const lockKey = await couponLockKey(LOCK_SECRET, '4242');
  const kv = fakeKv({ coupons: [CAMPAIGN], invites: [invite()], extra: { [lockKey]: COUPON_LOCK_VALUE } });
  const { reason, out } = await reasonAndRedeem(kv, '4242', { lockSecret: LOCK_SECRET });
  assert.equal(reason, COUPON_REFUSAL.locked);
  assert.equal(out, null);
});

test('amendment 6: a campaign missing from the registry refuses as not_redeemable', async () => {
  const { reason, out } = await reasonAndRedeem(fakeKv({ coupons: [], invites: [invite()] }));
  assert.equal(reason, COUPON_REFUSAL.notRedeemable);
  assert.equal(out, null);
});

test('amendment 6: a spent campaign cap refuses as cap_reached', async () => {
  const kv = fakeKv({ coupons: [{ ...CAMPAIGN, maxRedemptions: 1 }], invites: [invite()], extra: { [redemptionCountKey('CODEABLEYEAR')]: '1' } });
  const { reason, out } = await reasonAndRedeem(kv);
  assert.equal(reason, COUPON_REFUSAL.capReached);
  assert.equal(out, null);
});

test('amendment 6: a bound invite and another account refuses as bound_elsewhere', async () => {
  const { reason, out } = await reasonAndRedeem(fakeKv({ coupons: [CAMPAIGN], invites: [bound()] }), '9999');
  assert.equal(reason, COUPON_REFUSAL.boundElsewhere);
  assert.equal(out, null);
});

test('amendment 6: terms with no end date refuse as no_terms (pure, since the registry never admits one)', () => {
  // couponsFromParsed drops a campaign whose freeDays cannot make an end date, so this branch is reachable only
  // through a hand-built entry. It is pinned on the pure function, which is what redeemCoupon decides through.
  assert.equal(couponRefusalReason({ coupon: { ...CAMPAIGN, freeDays: 0 }, invite: null, githubId: '1', now: NOW }), COUPON_REFUSAL.noTerms);
});

test('amendment 6: an unreadable store refuses as unreadable, never as grantable', async () => {
  const kv = { async get() { throw new Error('kv down'); }, async put() {}, async delete() {} };
  const { reason, out } = await reasonAndRedeem(kv);
  assert.equal(reason, COUPON_REFUSAL.unreadable);
  assert.equal(out, null);
});

test('amendment 6: every refusal reason maps to a claim state, and only a grantable issued invite offers redeem', () => {
  assert.equal(yearStateFor(null, 'issued'), CLAIM_STATE.redeem);
  assert.equal(yearStateFor(null, 'redeemed'), CLAIM_STATE.year_unavailable, 'redeem is offered only while the link is unused');
  assert.equal(yearStateFor(undefined, 'issued'), CLAIM_STATE.year_unavailable, 'nobody asked is not the same as grantable');
  const used = new Set([COUPON_REFUSAL.grantExpired, COUPON_REFUSAL.locked]);
  for (const reason of Object.values(COUPON_REFUSAL)) {
    const want = used.has(reason) ? CLAIM_STATE.year_used : CLAIM_STATE.year_unavailable;
    assert.equal(yearStateFor(reason, 'issued'), want, `${reason} must be placed, and is never redeem`);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// TRAP 6 (sow-427, owner decision 5): a PAYING member claims a prepared listing with no free year involved
// ---------------------------------------------------------------------------------------------------------------
// The claim page's sign-in always carries the code, because a signed-out visitor could be anyone. A paying member
// who opens the link signed out (a fresh browser, a phone, an expired session) must not have it redeemed: that
// spent the invitation and a campaign slot, alerted the owner, and once folded put a member-tier grant AHEAD of
// Stripe for a year (or replaced a permanent grandfather entry with a one-year one). Skipping the redemption leaves
// the invitation issued, and the claim runs issued, then claim pending, then claimed.

const OVERRIDES = 'overrides:mirror';
const mirror = (over = {}) => JSON.stringify({
  generatedAt: NOW.toISOString(), roles: { superadmins: [], admins: [], moderators: [] },
  bans: { bans: [] }, grandfathered: { grandfathered: [] }, ...over,
});
const payingCustomer = { id: 'cus_paying', metadata: { github_id: '5555' }, subscriptions: { data: [{ status: 'active' }] } };
const freeCustomer = { id: 'cus_free', metadata: { github_id: '5555' } };
const CAPPED = { ...CAMPAIGN, tier: 'member', maxRedemptions: 10 };

async function signInWithCode(kv, customer, code = 'CODEABLE7F3Q') {
  const stripe = {
    async searchCustomerByGithubId() { return customer; },
    async createCustomer() { return { id: 'cus_new' }; },
    async updateCustomer() { return {}; },
  };
  return runSignup({
    identity: { githubId: '5555', githubLogin: 'payer', discordUserId: null, email: null, discordAccessToken: null },
    stripe, discord: {}, kv, config: {}, refCode: '', via: '', touchSession: '', coupon: code, now: NOW,
  });
}

function assertNothingSpent(kv, out) {
  assert.equal(out.couponApplied, false, 'no free year for an account that already pays');
  assert.equal(out.couponRedeemed, null, 'so no owner redemption notice and no regate nudge');
  assert.equal(kv.store.has(couponGrantKey('5555')), false, 'no coupon-grant record to fold ahead of Stripe');
  assert.deepEqual(grantOrRedemptionKeys(kv), [], 'no redemption record and the campaign counter did not move');
  const after = JSON.parse(kv.store.get(inviteKey('CODEABLE7F3Q')));
  assert.equal(after.redeemedAt, null);
  assert.equal(inviteState(after, NOW), 'issued', 'the invitation stays issued for the claim');
}

test('TRAP 6: a Stripe-paying account signing in on a prepared listing invite redeems nothing', async () => {
  const kv = fakeKv({ coupons: [CAPPED], invites: [invite({ listingId: 'ABCDEFGHJKMNPQRS' })] });
  assertNothingSpent(kv, await signInWithCode(kv, payingCustomer));
});

test('TRAP 6: a PERMANENTLY grandfathered account (no Stripe subscription) redeems nothing either', async () => {
  const kv = fakeKv({
    coupons: [CAPPED], invites: [invite({ listingId: 'ABCDEFGHJKMNPQRS' })],
    extra: { [OVERRIDES]: mirror({ grandfathered: { grandfathered: [{ github_id: '5555', reason: 'founding member' }] } }) },
  });
  assertNothingSpent(kv, await signInWithCode(kv, freeCustomer));
});

test('TRAP 6: a staff account with no Stripe customer redeems nothing (the preparer testing their own link)', async () => {
  const kv = fakeKv({
    coupons: [CAPPED], invites: [invite({ listingId: 'ABCDEFGHJKMNPQRS' })],
    extra: { [OVERRIDES]: mirror({ roles: { superadmins: ['5555'], admins: [], moderators: [] } }) },
  });
  assertNothingSpent(kv, await signInWithCode(kv, null));
});

test('TRAP 6: a FREE account on the same invite still redeems its year, and a stale mirror changes nothing', async () => {
  const kv = fakeKv({
    coupons: [CAPPED], invites: [invite({ listingId: 'ABCDEFGHJKMNPQRS' })],
    extra: { [OVERRIDES]: mirror({ generatedAt: '2026-01-01T00:00:00.000Z', grandfathered: { grandfathered: [{ github_id: '5555' }] } }) },
  });
  const out = await signInWithCode(kv, freeCustomer);
  assert.equal(out.couponApplied, true, 'a stale mirror is not evidence of paying: the redemption runs as before');
  assert.equal(JSON.parse(kv.store.get(inviteKey('CODEABLE7F3Q'))).redeemedBy, '5555');
});

test('TRAP 6: a paying account on a PLAIN invite redeems exactly as before (only listing invites are affected)', async () => {
  const kv = fakeKv({ coupons: [CAPPED], invites: [invite()] });
  const out = await signInWithCode(kv, payingCustomer);
  assert.equal(out.couponApplied, true);
  assert.equal(JSON.parse(kv.store.get(inviteKey('CODEABLE7F3Q'))).redeemedBy, '5555');
});
