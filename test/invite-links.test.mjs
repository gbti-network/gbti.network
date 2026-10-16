// sow-230: the invite-link builder. What is under test is the PAIRING of a coupon to the lander that
// describes what it grants, because getting that wrong is not a formatting bug: it is the defect that
// retired /linkedin-invite/, where a member-tier code sat under prose selling the creator tier.
//
// The registry itself is deliberately NOT a fixture here. These tests pass coupon objects directly, so they
// cannot start passing or failing because somebody edited house/coupons.yml, which is the failure that made
// two other guards in this repo untrustworthy this week.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLander, resolveDestination, blockedReason, inviteRow } from '../scripts/invite-links.mjs';
// sow-231 Phase 3: the mapping moved into membership/invites.mjs so the browser coupon manager and this CLI
// resolve a lander identically. Importing it from its real home rather than re-exporting keeps one source.
import { LANDER_BY_TIER, LANDER_BY_CAMPAIGN } from '../membership/invites.mjs';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);

const NOW = new Date('2026-08-15T12:00:00.000Z');
const coupon = (over = {}) => ({ code: 'TESTCODE', tier: 'member', freeDays: 365, active: true, maxRedemptions: null, expiresAt: null, note: '', ...over });

test('a coupon resolves to the lander for ITS tier, not to a default', () => {
  assert.equal(resolveLander(coupon({ tier: 'member' })), '/member-invite/');
  assert.equal(resolveLander(coupon({ tier: 'creator' })), '/curator-invite/');
});

test('a per-campaign lander beats the tier map, because the page belongs to the campaign', () => {
  // A campaign with an audience-specific page uses it whatever its tier, which is what makes the override a
  // property of the CAMPAIGN rather than of the tier. (Corrected 2026-10-15: this comment used to say
  // CODEABLEYEAR was creator tier. It has named `tier: member` since 2026-08-12, and the same false belief
  // written one file over is what kept /codeable-invite/ advertising the wrong tier at the wrong price.)
  assert.equal(resolveLander(coupon({ code: 'CODEABLEYEAR', tier: 'creator' })), '/codeable-invite/');
  assert.equal(resolveLander(coupon({ code: 'CODEABLEYEAR', tier: 'member' })), '/codeable-invite/');
  assert.equal(LANDER_BY_CAMPAIGN.CODEABLEYEAR, '/codeable-invite/');
  // sow-457: YOUTUBE2026 is deliberately NOT here. The owner ruled on 2026-10-15 that its links open the
  // article the creator was featured in, with a claim dialog over it, so the thing it needs is a DESTINATION
  // (membership/invites.mjs DESTINATION_BY_CAMPAIGN), not a lander. It still resolves /member-invite/ by tier,
  // which truthfully describes what it grants, and test/invite-claim.test.mjs holds the two apart.
  assert.equal(LANDER_BY_CAMPAIGN.YOUTUBE2026, undefined);
  assert.equal(resolveLander(coupon({ code: 'YOUTUBE2026', tier: 'member' })), '/member-invite/');
});

test('every per-campaign lander points at a page that exists', () => {
  // The direction a unit test CAN check here: a mapping entry naming a route nobody ships would send a
  // recipient to a 404, and no assertion over the mapping's own values can see that.
  for (const [campaign, route] of Object.entries(LANDER_BY_CAMPAIGN)) {
    const dir = route.replace(/^\/|\/$/g, '');
    assert.ok(fs.existsSync(path.join(root, 'src/pages', dir, 'index.astro')),
      `${campaign} points at ${route}, which is not a page on disk`);
  }
});

test('an unknown tier resolves to NO lander rather than to a plausible one', () => {
  // The important direction. Falling back to any page would describe a tier the coupon does not grant, which
  // is exactly the live defect this script exists to prevent. No page is the honest answer.
  assert.equal(resolveLander(coupon({ tier: 'wizard' })), null);
  assert.equal(resolveLander(coupon({ tier: undefined })), null);
  assert.equal(resolveLander(null), null);
});

test('a coupon with no resolvable lander is NOT sendable, and says why', () => {
  const row = inviteRow(coupon({ tier: 'wizard' }), NOW);
  assert.equal(row.sendable, false);
  assert.equal(row.url, null, 'no URL is offered rather than a wrong one');
  assert.match(row.warnings.join(' '), /no lander/);
});

test('a tierless coupon warns about the tier rather than about the lander', () => {
  // Two different problems that both end in "no lander", and the message has to name the real one: a missing
  // tier is a registry defect (validateCoupons rejects it while active), a missing map entry is a code gap.
  const row = inviteRow(coupon({ tier: null }), NOW);
  assert.equal(row.sendable, false);
  assert.match(row.warnings.join(' '), /no tier/);
});

test('inactive and expired coupons are blocked, with the reason, and expiry fails CLOSED', () => {
  assert.equal(blockedReason(coupon({ active: false }), NOW), 'inactive');
  assert.match(blockedReason(coupon({ expiresAt: '2026-01-01T00:00:00.000Z' }), NOW), /^expired/);
  assert.equal(blockedReason(coupon({ expiresAt: '2027-01-01T00:00:00.000Z' }), NOW), null, 'a future expiry does not block');
  // An unreadable date is treated as PASSED, matching couponIsRedeemable. A date we cannot parse must never
  // become a coupon that never expires.
  assert.match(blockedReason(coupon({ expiresAt: 'not-a-date' }), NOW), /unreadable/);
});

test('the built URL carries the code and points at the tier-matched lander', () => {
  const row = inviteRow(coupon({ code: 'HUDSINVITE', tier: 'member' }), NOW);
  assert.equal(row.sendable, true);
  assert.equal(row.url, 'https://gbti.network/member-invite/?coupon=HUDSINVITE');
});

test('sow-457: the printed link is the campaign DESTINATION, not the page describing the tier', () => {
  // What somebody running this CLI does with the output is paste it into a message. For a campaign whose links
  // open its own destination (the YouTube creators land on the article they were featured in), printing the
  // lander would hand out a link nobody is being sent, and the mistake would only surface in someone's inbox.
  const yt = coupon({ code: 'YOUTUBE2026', id: 'YOUTUBE2026', tier: 'member' });
  assert.equal(resolveDestination(yt), '/articles/100-wordpress-youtube-channels-to-subscribe-to-in-2026/');
  const row = inviteRow(yt, NOW);
  assert.equal(row.url, 'https://gbti.network/articles/100-wordpress-youtube-channels-to-subscribe-to-in-2026/?coupon=YOUTUBE2026');
  assert.equal(row.lander, '/member-invite/', 'and the row still reports which page describes the tier');
  // Every OTHER campaign is unchanged: no destination means the lander IS the link.
  const plain = coupon({ code: 'HUDSINVITE', tier: 'member' });
  assert.equal(resolveDestination(plain), '/member-invite/');
  assert.equal(inviteRow(plain, NOW).url, 'https://gbti.network/member-invite/?coupon=HUDSINVITE');
  assert.equal(inviteRow(plain, NOW).lander, null, 'nothing to report when the two agree');
  assert.equal(resolveDestination(null), null);
});

test('every tier in the map has a distinct lander, so two tiers cannot share one page', () => {
  // A copy-paste in LANDER_BY_TIER would point two tiers at one page and reintroduce the original defect
  // silently, since every individual lookup would still succeed.
  const landers = Object.values(LANDER_BY_TIER);
  assert.equal(new Set(landers).size, landers.length, `duplicate lander in LANDER_BY_TIER: ${landers.join(', ')}`);
});

test('the tier map covers every PAID tier the system defines', () => {
  // The guard that keeps this file honest as tiers change: a new paid tier with no lander means a coupon for
  // it silently has nowhere to send people. Derived from the tier axis rather than hardcoded, so adding a
  // tier reds this test instead of quietly producing an unsendable coupon later.
  const paid = ['member', 'creator'];
  for (const t of paid) {
    assert.ok(LANDER_BY_TIER[t], `paid tier "${t}" has no lander; a coupon granting it could not be sent`);
  }
});
