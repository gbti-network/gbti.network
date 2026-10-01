// sow-427: who may see a prepared listing (publicReadable) and what a signed-in account may do with it
// (claimDecision). Every branch of the decision is pinned here, in the order the decision checks them, including
// the three amendments that changed it: a reload after claiming says `claimed` (3), only the preparer gets
// `preview_only` (4), and a not-paying account is offered `redeem` only when a redemption would really grant a year (6).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  publicReadable, claimDecision, CLAIM_STATE, validatePreparedDraft, newListing,
  takeListingClaimLock, markListingClaimed, minimizeClaimedListing, listingResend, listingRevoke,
} from '../membership/prepared-listings.mjs';
import { newInvite, markInviteClaimPending, markInviteClaimed } from '../membership/invites.mjs';

const NOW = new Date('2026-09-30T12:00:00.000Z');
const ID = 'ABCDEFGHJKMNPQRS';
const CODE = 'CDEABEYEAR23456789AB';
const PREPARER = '2002207';
const SAM = '4242';
const OTHER = '9999';

const draft = validatePreparedDraft({
  type: 'project', slug: 'surfacedby',
  frontmatter: { title: 'SurfacedBy', shortDescription: 'x', icon: './images/icon.png', featuredImage: './images/cover.webp' },
}).draft;
const listing = (over = {}) => ({
  ...newListing({ id: ID, draft, recipientName: 'Sam', message: 'Hi', campaign: 'CODEABLEYEAR', code: CODE, preparedBy: PREPARER, preparedByLogin: 'atwellpub', now: NOW }),
  ...over,
});
const invite = (over = {}) => ({ ...newInvite({ campaign: 'CODEABLEYEAR', code: CODE, listingId: ID, now: NOW }), ...over });
const PAID = { status: 'paid', source: 'stripe' };
const decide = (over = {}) => claimDecision({ invite: invite(), listing: listing(), claimantId: SAM, effective: PAID, yearRefusal: null, now: NOW, ...over }).state;

// ---- publicReadable --------------------------------------------------------------------------------------------

test('publicReadable: an issued, a redeemed and a claim-pending invite show their listing', () => {
  assert.equal(publicReadable(invite(), listing(), NOW), true);
  assert.equal(publicReadable(invite({ redeemedAt: NOW.toISOString(), redeemedBy: SAM }), listing(), NOW), true);
  const pending = markInviteClaimPending(invite(), { githubId: SAM, now: NOW }).next;
  assert.equal(publicReadable(pending, listing(), NOW), true);
});

test('publicReadable: every inactive case is false, whatever the reason', () => {
  const at = NOW.toISOString();
  const cases = [
    ['no invite', null, listing()],
    ['no listing', invite(), null],
    ['revoked invite', invite({ revokedAt: at }), listing()],
    ['expired invite', invite({ expiresAt: '2020-01-01T00:00:00.000Z' }), listing()],
    ['claimed invite', invite({ claimedAt: at, claimedBy: SAM }), listing()],
    ['revoked listing', invite(), listing({ revokedAt: at })],
    ['claimed listing', invite(), listing({ claimedAt: at })],
    ['a different listing', invite({ listingId: 'ZZZZZZZZZZZZZZZZ' }), listing()],
    ['a plain invite', invite({ listingId: null }), listing()],
    ['a replaced code (send again)', invite(), listing({ code: 'NEWCODE22' })],
    ['a corrupt listing', invite(), { id: ID, code: CODE }],
  ];
  for (const [label, inv, lst] of cases) assert.equal(publicReadable(inv, lst, NOW), false, label);
});

test('publicReadable: after "send again" the OLD link is dead and the new one works', () => {
  const revoked = listingRevoke(listing(), { now: NOW }).next;
  const resent = listingResend(revoked, { code: 'NEWCODE22', now: NOW }).next;
  const oldInvite = invite({ revokedAt: NOW.toISOString() });
  const newInv = { ...newInvite({ campaign: 'CODEABLEYEAR', code: 'NEWCODE22', listingId: ID, now: NOW }) };
  assert.equal(publicReadable(oldInvite, resent, NOW), false);
  assert.equal(publicReadable(invite(), resent, NOW), false, 'even an unrevoked old invite no longer matches the code');
  assert.equal(publicReadable(newInv, resent, NOW), true);
});

// ---- claimDecision, in the order it checks ---------------------------------------------------------------------

test('0: no account number is inactive', () => {
  assert.equal(decide({ claimantId: null }), CLAIM_STATE.inactive);
  assert.equal(decide({ claimantId: 'octocat' }), CLAIM_STATE.inactive);
});

test('1 (amendment 3): the claimant who already claimed it sees `claimed`, even though the link is now inactive', () => {
  const at = NOW.toISOString();
  const lockedListing = takeListingClaimLock(listing(), { githubId: SAM, now: NOW }).next;
  const claimedListing = minimizeClaimedListing(markListingClaimed(lockedListing, { githubId: SAM, folder: 'sam', path: 'p', now: NOW }).next);
  const claimedInvite = markInviteClaimed(invite(), { githubId: SAM, now: NOW }).next;
  assert.equal(publicReadable(claimedInvite, claimedListing, NOW), false, 'the public read says inactive');
  const r = claimDecision({ invite: claimedInvite, listing: claimedListing, claimantId: SAM, effective: PAID, now: NOW });
  assert.deepEqual(r, { state: CLAIM_STATE.claimed, slug: 'surfacedby' }, 'so a reload after publishing succeeds');
  assert.equal(decide({ invite: invite({ claimedAt: at, claimedBy: SAM }), listing: null }), CLAIM_STATE.claimed, 'the invite alone is enough');
  assert.equal(decide({ invite: claimedInvite, listing: claimedListing, claimantId: OTHER }), CLAIM_STATE.inactive, 'anyone else: inactive');
  assert.equal(decide({ invite: claimedInvite, listing: claimedListing, effective: { status: 'banned' } }), CLAIM_STATE.claimed,
    'the fact of the claim is reported before any other check');
});

test('2: not readable, redeemed by someone else, or pending for someone else is inactive', () => {
  const at = NOW.toISOString();
  assert.equal(decide({ invite: invite({ revokedAt: at }) }), CLAIM_STATE.inactive);
  assert.equal(decide({ listing: null }), CLAIM_STATE.inactive);
  assert.equal(decide({ invite: invite({ redeemedAt: at, redeemedBy: OTHER }) }), CLAIM_STATE.inactive);
  assert.equal(decide({ invite: invite({ redeemedAt: at, redeemedBy: null }) }), CLAIM_STATE.inactive, 'a redeemer erased from the record is not this account');
  const pendingOther = markInviteClaimPending(invite(), { githubId: OTHER, now: NOW }).next;
  assert.equal(decide({ invite: pendingOther }), CLAIM_STATE.inactive);
  assert.equal(decide({ listing: takeListingClaimLock(listing(), { githubId: OTHER, now: NOW }).next }), CLAIM_STATE.inactive,
    'a lock taken before the pull request opened counts too');
  assert.equal(decide({ invite: invite({ claimPendingAt: at, claimPendingBy: null }) }), CLAIM_STATE.inactive, 'a pending claim nobody owns is inactive for everyone');
});

test('3: tied to another account is wrong_account, whether the invite or the listing says so', () => {
  assert.equal(decide({ invite: invite({ boundGithubId: OTHER }) }), CLAIM_STATE.wrong_account);
  assert.equal(decide({ listing: listing({ boundGithubId: OTHER }) }), CLAIM_STATE.wrong_account);
  assert.equal(decide({ invite: invite({ boundGithubId: SAM }), listing: listing({ boundGithubId: SAM }) }), CLAIM_STATE.ready, 'the tied account claims');
});

// TRAP (review W1): the binding check used to run before the preparer check, so a superadmin opening their OWN link
// to a listing tied to somebody's GitHub account got wrong_account, a dialog whose primary button signs them out,
// instead of the preview the editor's Open button promises.
test('3: the preparer of a TIED listing is not "another account": they get preview_only, and the tie still holds', () => {
  const tied = { invite: invite({ boundGithubId: SAM, boundLogin: 'sam-dev' }), listing: listing({ boundGithubId: SAM, boundLogin: 'sam-dev' }) };
  const staff = { status: 'paid', source: 'staff' };
  assert.equal(decide({ ...tied, claimantId: PREPARER, effective: staff }), CLAIM_STATE.preview_only, 'the preparer previews their own link');
  assert.equal(decide({ ...tied, claimantId: SAM }), CLAIM_STATE.ready, 'the tied account still claims');
  assert.equal(decide({ ...tied, claimantId: OTHER }), CLAIM_STATE.wrong_account, 'anyone else is still refused');
  assert.equal(decide({ ...tied, claimantId: '3', effective: staff }), CLAIM_STATE.wrong_account, 'so is any other staff account');
  assert.equal(decide({ ...tied, claimantId: PREPARER, effective: { status: 'banned', source: 'ban' } }), CLAIM_STATE.not_permitted,
    'the exemption skips only the tie: a banned preparer is still not_permitted');
});

test('4: a banned account, or one with no effective status, is not_permitted', () => {
  assert.equal(decide({ effective: { status: 'banned', source: 'ban' } }), CLAIM_STATE.not_permitted);
  assert.equal(decide({ effective: null }), CLAIM_STATE.not_permitted);
});

test('5 (amendment 4): only the superadmin who prepared it gets preview_only; every other staff account claims', () => {
  assert.equal(decide({ claimantId: PREPARER, effective: { status: 'paid', source: 'staff' } }), CLAIM_STATE.preview_only);
  assert.equal(decide({ claimantId: '3', effective: { status: 'paid', source: 'staff' } }), CLAIM_STATE.ready, 'a moderator claims an untied listing');
  assert.equal(decide({ effective: { status: 'paid', source: 'grandfather' } }), CLAIM_STATE.ready, 'a grandfathered account claims');
});

test('6: this account\'s own pending claim is publishing', () => {
  const pending = markInviteClaimPending(invite(), { githubId: SAM, pr: 12, now: NOW }).next;
  assert.equal(decide({ invite: pending }), CLAIM_STATE.publishing);
  assert.equal(decide({ listing: takeListingClaimLock(listing(), { githubId: SAM, now: NOW }).next }), CLAIM_STATE.publishing);
  assert.equal(decide({ invite: pending, effective: { status: 'none', source: 'stripe' } }), CLAIM_STATE.publishing,
    'publishing is reported whatever the membership says meanwhile');
});

test('7 (amendment 6): a not-paying account is offered redeem ONLY when a redemption would grant a year', () => {
  const free = { status: 'none', source: 'stripe' };
  assert.equal(decide({ effective: free, yearRefusal: null }), CLAIM_STATE.redeem);
  assert.equal(decide({ effective: free, yearRefusal: 'grant_expired' }), CLAIM_STATE.year_used, 'owner decision 5: told the year is used');
  assert.equal(decide({ effective: free, yearRefusal: 'locked' }), CLAIM_STATE.year_used, 'used before an erasure is still used');
  for (const reason of ['cap_reached', 'not_redeemable', 'grant_corrupt', 'no_terms', 'unreadable', 'grant_active', 'bound_elsewhere']) {
    assert.equal(decide({ effective: free, yearRefusal: reason }), CLAIM_STATE.year_unavailable, reason);
  }
  assert.equal(decide({ effective: free, yearRefusal: undefined }), CLAIM_STATE.year_unavailable, 'a caller that did not ask is never told redeem');
  assert.equal(decide({ effective: free, yearRefusal: null, invite: invite({ redeemedAt: NOW.toISOString(), redeemedBy: SAM }) }),
    CLAIM_STATE.year_unavailable, 'a link this account already redeemed is not offered again');
});

test('8: paying through a free year the merge gate cannot see yet is pending_grant (trap 2)', () => {
  assert.equal(decide({ effective: { status: 'paid', source: 'coupon' } }), CLAIM_STATE.pending_grant);
  assert.equal(decide({ effective: { status: 'paid', source: 'coupon' }, invite: invite({ redeemedAt: NOW.toISOString(), redeemedBy: SAM }) }),
    CLAIM_STATE.pending_grant, 'the usual path: redeemed at sign-in, the fold not landed yet');
});

test('9: otherwise ready, including a redeemed-by-self invite once the grant is folded', () => {
  assert.equal(decide(), CLAIM_STATE.ready, 'a paying member with an untouched link');
  assert.equal(decide({ invite: invite({ redeemedAt: NOW.toISOString(), redeemedBy: SAM }), effective: { status: 'paid', source: 'grandfather' } }), CLAIM_STATE.ready);
});

test('every state the decision can return is a CLAIM_STATE, and the route-only states are named too', () => {
  const values = new Set(Object.values(CLAIM_STATE));
  for (const s of ['inactive', 'claimed', 'wrong_account', 'not_permitted', 'preview_only', 'publishing', 'redeem', 'year_used',
    'year_unavailable', 'pending_grant', 'pending_folder', 'ready', 'claim_failed']) assert.ok(values.has(s), s);
});
