// sow-427 C4: GET /membership/claim?code= (workers/signup/membership-claim.mjs), the state the claim page shows a
// signed-in visitor, and the readiness mechanism for trap 2 (the page waits; the Worker nudges reconcile).
//
// The coupon checks behind `redeem`, `year_used` and `year_unavailable` run through the REAL couponRedemptionCheck
// (the same decision redeemCoupon makes), and one test drives the REAL resolveEffective with a fake Stripe, so the
// `source: 'coupon'` readiness rule is proven against the gate that produces it rather than against a stub.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { membershipClaimStatus, membershipClaimPost, preparerStillSuperadmin } from '../workers/signup/membership-claim.mjs';
import { couponGrantKey } from '../workers/signup/coupons.mjs';
import { listingKey, listingImageKey } from '../membership/prepared-listings.mjs';
import { inviteKey } from '../membership/invites.mjs';
import { rateLimit } from '../workers/signup/abuse.mjs';
import { OVERRIDES_KV_KEY } from '../workers/signup/membership-content.mjs';
import {
  NOW, PREPARER, CLAIMANT, STRANGER, MODERATOR, LISTING_ID, CODE, CAMPAIGN, env, seed, mirror, fakeKv, ghFake, pull, as,
  getReq, postReq, claimDeps,
} from './prepared-claim-fixtures.mjs';

const COUPONS = (active = true) => JSON.stringify({ generatedAt: NOW.toISOString(), coupons: [{ code: CAMPAIGN, freeDays: 365, active, tier: 'member' }] });
const status = (kv, over = {}, fetchImpl = ghFake([])) => membershipClaimStatus(getReq(over.code ?? CODE), env(), claimDeps({ kv, fetchImpl, ...over }));

test('status: a paying, indexed claimant is ready, with nothing to wait for', async () => {
  const { kv } = seed();
  const r = await status(kv);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, state: 'ready', projectUrl: null, retryAfterSeconds: null });
  assert.equal(r.notify, null);
});

test('status: inactive for a malformed, unknown, revoked or deleted listing, with the same body each time', async () => {
  const bodies = [];
  const plain = seed();
  bodies.push((await status(plain.kv, { code: 'no' })).body);
  bodies.push((await status(plain.kv, { code: 'UNKNOWN0000' })).body);
  const revoked = seed({ listingOver: { revokedAt: NOW.toISOString() } });
  bodies.push((await status(revoked.kv)).body);
  const gone = seed();
  gone.kv.store.delete(listingKey(LISTING_ID));
  bodies.push((await status(gone.kv)).body);
  const resent = seed({ listingOver: { code: 'CODEABLENEWCODE22' } });
  bodies.push((await status(resent.kv)).body);
  for (const b of bodies) assert.deepEqual(b, { ok: true, state: 'inactive', projectUrl: null, retryAfterSeconds: null });
});

test('status: source coupon is pending_grant, re-firing ONE regate per window; pending_folder fires ONE enroll', async () => {
  const { kv } = seed({ redeemedBy: CLAIMANT });
  const rec = [];
  const gh = ghFake(rec, { index: 'members:\n' });
  const deps = { resolve: as(CLAIMANT, 'paid', 'coupon'), limiter: rateLimit };
  const a = await status(kv, deps, gh);
  const b = await status(kv, deps, gh);
  for (const r of [a, b]) {
    assert.equal(r.body.state, 'pending_grant');
    assert.equal(r.body.grantPending, true);
    assert.equal(r.body.folderPending, true);
    assert.equal(r.body.retryAfterSeconds, 10);
  }
  assert.equal(rec.filter((c) => c.body?.event_type === 'regate').length, 1);
  assert.equal(rec.filter((c) => c.body?.event_type === 'enroll').length, 0, 'the regate run enrolls too');

  const f = seed();
  const rec2 = [];
  const gh2 = ghFake(rec2, { index: 'members:\n' });
  const c = await status(f.kv, { limiter: rateLimit }, gh2);
  const d = await status(f.kv, { limiter: rateLimit }, gh2);
  for (const r of [c, d]) {
    assert.equal(r.body.state, 'pending_folder');
    assert.equal(r.body.folderPending, true);
    assert.equal(r.body.grantPending, false);
  }
  assert.equal(rec2.filter((x) => x.body?.event_type === 'enroll').length, 1);
});

test('status through the REAL resolveEffective: a fresh coupon grant (Stripe says none) is pending_grant', async () => {
  const until = new Date(NOW.getTime() + 300 * 86400e3).toISOString();
  const { kv } = seed({ redeemedBy: CLAIMANT, extra: { [couponGrantKey(CLAIMANT)]: JSON.stringify({ code: CODE, until, tier: 'member' }) } });
  const r = await membershipClaimStatus(getReq(), env({ STRIPE_SECRET_KEY: 'rk_test' }), {
    kv, fetchImpl: ghFake([]), now: NOW, getToken: async () => 'inst-token', limiter: async () => ({ allowed: true }),
    fetchUser: async () => ({ githubId: CLAIMANT, githubLogin: 'Sam-Dev' }),
    makeStripe: () => ({ findCustomerByGithubId: async () => null }),
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.state, 'pending_grant', 'resolveEffective reports source coupon, which the merge gate cannot see yet');
});

test('status: tied to another account is wrong_account; the preparer is preview_only; a moderator is ready', async () => {
  const bound = seed({ bound: CLAIMANT });
  assert.equal((await status(bound.kv, { resolve: as(STRANGER) })).body.state, 'wrong_account');
  assert.equal((await status(bound.kv)).body.state, 'ready');
  const open = seed();
  assert.equal((await status(open.kv, { resolve: as(PREPARER, 'paid', 'staff', 'atwellpub') })).body.state, 'preview_only');
  const idx = `members:\n  "${MODERATOR}": mod-person\n`;
  assert.equal((await status(open.kv, { resolve: as(MODERATOR, 'paid', 'staff') }, ghFake([], { index: idx }))).body.state, 'ready');
  assert.equal((await status(open.kv, { resolve: as(CLAIMANT, 'banned', 'ban') })).body.state, 'not_permitted');
});

test('status: a not-paying account learns whether the invitation would grant a year (the SAME check signup makes)', async () => {
  // redeem: the campaign is live and this account never had a year.
  const live = seed({ extra: { 'coupons:config': COUPONS(true) } });
  assert.equal((await status(live.kv, { resolve: as(CLAIMANT, 'none', 'stripe') })).body.state, 'redeem');
  // A retired campaign still grants through an issued invite (terms are read without the active gate, trap 6).
  const retired = seed({ extra: { 'coupons:config': COUPONS(false) } });
  assert.equal((await status(retired.kv, { resolve: as(CLAIMANT, 'none', 'stripe') })).body.state, 'redeem');
  // year_used: an expired grant.
  const used = seed({ extra: { 'coupons:config': COUPONS(true), [couponGrantKey(CLAIMANT)]: JSON.stringify({ code: 'OLD', until: '2025-01-01T00:00:00.000Z' }) } });
  assert.equal((await status(used.kv, { resolve: as(CLAIMANT, 'expired', 'stripe') })).body.state, 'year_used');
  // year_unavailable: the campaign is missing from the registry (no terms exist).
  const missing = seed();
  assert.equal((await status(missing.kv, { resolve: as(CLAIMANT, 'none', 'stripe') })).body.state, 'year_unavailable');
  // year_unavailable: a grant record whose end date cannot be read.
  const corrupt = seed({ extra: { 'coupons:config': COUPONS(true), [couponGrantKey(CLAIMANT)]: JSON.stringify({ code: 'OLD', until: 'garbage' }) } });
  assert.equal((await status(corrupt.kv, { resolve: as(CLAIMANT, 'none', 'stripe') })).body.state, 'year_unavailable');
});

test('status: a publishing claim with an OPEN pull request stays publishing, and the page is told to wait', async () => {
  const { kv } = seed();
  await membershipClaimPost(postReq({ code: CODE, note: 'mine' }), env(), claimDeps({ kv, fetchImpl: ghFake([]) }));
  const r = await status(kv, {}, ghFake([], { pulls: new Map([[77, pull(77)]]) }));
  assert.deepEqual(r.body, { ok: true, state: 'publishing', projectUrl: null, retryAfterSeconds: 10 });
  // Anybody else holding the link sees nothing claimable while it is open.
  assert.equal((await status(kv, { resolve: as(STRANGER) }, ghFake([], { pulls: new Map([[77, pull(77)]]) }))).body.state, 'inactive');
});

test('status: the merge is noticed by the poll (claimed, projectUrl, ONE notify), and a reload stays claimed', async () => {
  const { kv } = seed();
  await membershipClaimPost(postReq({ code: CODE, note: 'mine' }), env(), claimDeps({ kv, fetchImpl: ghFake([]) }));
  const merged = ghFake([], { pulls: new Map([[77, pull(77, { state: 'closed', merged: true })]]) });
  const r = await status(kv, {}, merged);
  assert.deepEqual(r.body, { ok: true, state: 'claimed', projectUrl: 'https://gbti.network/projects/surfacedby/', retryAfterSeconds: null });
  assert.ok(r.notify, 'the call that noticed the merge carries the notice');
  assert.equal(r.notify.claimedFolder, 'sam');
  assert.equal(r.notify.prNumber, 77);
  assert.equal(kv.json(listingImageKey(LISTING_ID, 'icon.png')), undefined, 'the staged images are gone');
  // Amendment 3: a reload after claiming answers claimed although the public read is now inactive.
  const again = await status(kv, {}, merged);
  assert.equal(again.body.state, 'claimed');
  assert.equal(again.body.projectUrl, 'https://gbti.network/projects/surfacedby/');
  assert.equal(again.notify, null, 'exactly one notice');
  assert.equal((await status(kv, { resolve: as(STRANGER) }, merged)).body.state, 'inactive');
});

test('status: a CLOSED pull request is claim_failed once for the claimant, then ready again', async () => {
  const { kv } = seed();
  await membershipClaimPost(postReq({ code: CODE, note: 'mine' }), env(), claimDeps({ kv, fetchImpl: ghFake([]) }));
  const closed = ghFake([], { pulls: new Map([[77, pull(77, { state: 'closed', merged: false })]]) });
  const r = await status(kv, {}, closed);
  assert.equal(r.body.state, 'claim_failed');
  assert.equal(r.notify, null);
  assert.equal((await status(kv, {}, closed)).body.state, 'ready');
  assert.equal(kv.json(inviteKey(CODE)).claimPendingAt, null);
});

test('status: a preparer demoted or banned since preparing voids the listing for every claimable state', async () => {
  const { kv } = seed({ mirrorOpts: { superadmins: [] }, extra: { 'coupons:config': COUPONS(true) } });
  assert.equal((await status(kv)).body.state, 'inactive');
  assert.equal((await status(kv, { resolve: as(CLAIMANT, 'none', 'stripe') })).body.state, 'inactive', 'no "redeem" for a dead approval');
  assert.equal(await preparerStillSuperadmin(fakeKv({ [OVERRIDES_KV_KEY]: JSON.stringify(mirror()) }), PREPARER, NOW), true);
  const stale = mirror({ at: new Date(NOW.getTime() - 49 * 3600e3) });
  assert.equal(await preparerStillSuperadmin(fakeKv({ [OVERRIDES_KV_KEY]: JSON.stringify(stale) }), PREPARER, NOW), false, 'a stale mirror fails closed');
  assert.equal(await preparerStillSuperadmin(fakeKv({}), PREPARER, NOW), false);
  assert.equal(await preparerStillSuperadmin(fakeKv({ [OVERRIDES_KV_KEY]: JSON.stringify(mirror()) }), 'not-an-id', NOW), false);
});

test('status: rate limited per member, an unreadable members index is 502, a missing store is 503', async () => {
  const { kv } = seed();
  assert.equal((await status(kv, { limiter: async () => ({ allowed: false }) })).status, 429);
  const r = await status(kv, {}, ghFake([], { failIndex: true }));
  assert.equal(r.status, 502);
  assert.equal(r.body.error, 'index_unavailable');
  const none = await membershipClaimStatus(getReq(), env(), { resolve: as(CLAIMANT), now: NOW });
  assert.equal(none.status, 503);
  assert.equal(kv.json(inviteKey(CODE)).claimPendingAt, null, 'the status never writes a claim');
});
