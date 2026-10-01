// sow-427: the prepared-listing pure core (membership/prepared-listings.mjs): keys, sanitizers, validation of the
// prepared project, the record and its state machine, and the views. No network, no KV. The claim decision has its
// own file (test/prepared-claim-decision.test.mjs); the claim's files are in test/prepared-claim-files.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  LISTING_KEY_PREFIX, LISTING_IMG_PREFIX, LISTING_ID_LEN, PREPARED_SLUG_MAX, PREPARED_MAX_IMAGES, MAX_MESSAGE, MAX_RECIPIENT_NAME,
  isListingId, listingKey, listingImagePrefix, listingImageKey, mintListingId,
  sanitizeMessage, sanitizeRecipientName, normalizeGithubLogin, validateInvitationText,
  isListingImageName, listingImageRefs, validatePreparedDraft, claimProjectInput,
  LISTING_STATE, newListing, listingState, applyListingEdit, listingRevoke, listingResend,
  takeListingClaimLock, recordListingClaimPr, releaseListingClaimLock, markListingClaimed, minimizeClaimedListing,
  claimLink, projectUrl, listingSummary, listingAdminView, publicListingView,
} from '../membership/prepared-listings.mjs';
import { INVITE_ALPHABET, INVITE_KEY_PREFIX, newInvite } from '../membership/invites.mjs';

const NOW = new Date('2026-09-30T12:00:00.000Z');
const ID = 'ABCDEFGHJKMNPQRS';
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const FM = () => ({
  title: 'SurfacedBy', shortDescription: 'Find where your work was mentioned.', icon: './images/icon.png',
  featuredImage: './images/cover.webp', categories: ['devops'], links: [{ type: 'homepage', url: 'https://surfacedby.example' }],
});
const draftOf = (over = {}, body = 'It watches the web for you.\n\n![The dashboard](./images/shot-1.png "The dashboard")') => {
  const r = validatePreparedDraft({ type: 'project', slug: 'surfacedby', frontmatter: { ...FM(), ...over }, body });
  assert.ok(r.ok, JSON.stringify(r.issues));
  return r.draft;
};
const listing = (over = {}) => ({
  ...newListing({
    id: ID, draft: draftOf(), recipientName: 'Sam', message: 'Hi Sam,\nwe wrote this up for you.', campaign: 'CODEABLEYEAR',
    code: 'CDEABEYEAR23456789AB', preparedBy: '2002207', preparedByLogin: 'atwellpub', now: NOW,
  }),
  ...over,
});

// ---- keys and ids ----------------------------------------------------------------------------------------------

test('the listing keys never fall under the invite: sweep, and they are the ones the backup lists', () => {
  assert.equal(LISTING_KEY_PREFIX, 'invite-listing:');
  assert.equal(LISTING_IMG_PREFIX, 'invite-listing-img:');
  assert.equal(LISTING_KEY_PREFIX.startsWith(INVITE_KEY_PREFIX), false, 'startsWith("invite:") must not match a listing');
  assert.equal(listingKey(ID), `invite-listing:${ID}`);
  assert.equal(listingImagePrefix(ID), `invite-listing-img:${ID}:`);
  assert.equal(listingImageKey(ID, 'icon.png'), `invite-listing-img:${ID}:icon.png`);
});

test('a key is never built from a malformed id or image name', () => {
  for (const bad of ['', 'abcdefghjkmnpqrs', 'ABCDEFGHJKMNPQR', 'ABCDEFGHJKMNPQRSX', 'ABCDEFGHJKMNPQR0', '../x', null]) {
    assert.equal(isListingId(bad), false, JSON.stringify(bad));
    assert.throws(() => listingKey(bad), /invalid listing id/);
  }
  for (const bad of ['Icon.png', 'x.svg', '../x.png', 'a/b.png', '']) assert.throws(() => listingImageKey(ID, bad), /invalid image name/);
});

test('mintListingId draws LISTING_ID_LEN characters from the invite alphabet, deterministically', () => {
  const bytes = Uint8Array.from({ length: 64 }, (_, i) => (i * 7) % 256);
  const id = mintListingId(bytes);
  assert.equal(id.length, LISTING_ID_LEN);
  assert.ok(isListingId(id));
  for (const ch of id) assert.ok(INVITE_ALPHABET.includes(ch));
  assert.equal(mintListingId(bytes), id);
  assert.throws(() => mintListingId(Uint8Array.from({ length: 64 }, () => 250)), /random bytes/);
});

// ---- sanitizers ------------------------------------------------------------------------------------------------

test('the message keeps its line breaks, strips every other control character, and keeps markup verbatim', () => {
  assert.equal(sanitizeMessage('Hi Sam,\r\nline two'), 'Hi Sam,\nline two');
  assert.equal(sanitizeMessage('a\x00b\x07c\x1bd\x7fe'), 'abcde', 'controls are removed');
  assert.equal(sanitizeMessage('tab\there'), 'tab here');
  assert.equal(sanitizeMessage('one\n\n\n\n\ntwo'), 'one\n\ntwo', 'runs of blank lines collapse');
  assert.equal(sanitizeMessage('  <b>hello</b> & <script>x</script>  '), '<b>hello</b> & <script>x</script>',
    'HTML survives verbatim: it is made safe where it is rendered, with text nodes');
  assert.equal(sanitizeMessage('abc‮dcba⁦x'), 'abcdcbax', 'bidirectional overrides are removed');
  assert.equal(sanitizeMessage('x'.repeat(MAX_MESSAGE + 50)).length, MAX_MESSAGE);
  assert.equal(sanitizeMessage(null), '');
});

test('the greeting name is one line and capped', () => {
  assert.equal(sanitizeRecipientName('  Sam\nDev\t '), 'Sam Dev');
  assert.equal(sanitizeRecipientName('x'.repeat(100)).length, MAX_RECIPIENT_NAME);
  assert.equal(sanitizeRecipientName(42), '');
});

test('normalizeGithubLogin accepts what GitHub accepts and nothing else', () => {
  assert.equal(normalizeGithubLogin(' @Sam-Dev '), 'Sam-Dev');
  for (const bad of ['-sam', 'sam-', 'sa--m', 'sam dev', 'x'.repeat(40), '', 'sam_dev', null]) assert.equal(normalizeGithubLogin(bad), null, JSON.stringify(bad));
  assert.equal(normalizeGithubLogin('x'.repeat(39)), 'x'.repeat(39));
});

test('validateInvitationText requires both the greeting and the message', () => {
  assert.deepEqual(validateInvitationText({ recipientName: ' Sam ', message: ' Hi ' }), { ok: true, recipientName: 'Sam', message: 'Hi' });
  assert.equal(validateInvitationText({ recipientName: '', message: 'Hi' }).error, 'recipient_required');
  assert.equal(validateInvitationText({ recipientName: 'Sam', message: '\n\n' }).error, 'message_required');
});

// ---- image references ------------------------------------------------------------------------------------------

test('listingImageRefs reads the image fields, the gallery and the body, and rejects flat or uppercase names', () => {
  const r = listingImageRefs({
    icon: './images/icon.png', featuredImage: './images/cover.webp', gallery: ['./images/a.png', { src: './images/b.jpg', caption: 'B' }, './images/a.png'],
  }, 'x ![one](./images/c.gif) [link](./images/d.jpeg "t") ![](https://example.com/e.png)');
  assert.deepEqual(r.names, ['icon.png', 'cover.webp', 'a.png', 'b.jpg', 'c.gif', 'd.jpeg']);
  assert.deepEqual(r.bad, []);
  const bad = listingImageRefs({ icon: 'images/icon.png', featuredImage: './images/Cover.webp', banner: 'https://x/y.png', iconLarge: './images/x.svg' }, '![](./images/Shot.PNG)');
  assert.deepEqual(bad.names, []);
  assert.equal(bad.bad.length, 5, 'the flat path, the uppercase names, the remote URL and the svg are all refused');
  assert.equal(isListingImageName('icon.png'), true);
  assert.equal(isListingImageName('Icon.png'), false);
});

// ---- validatePreparedDraft -------------------------------------------------------------------------------------

test('a valid project validates, with the server fields STRIPPED and the images listed', () => {
  const r = validatePreparedDraft({
    type: 'project', slug: 'surfacedby', body: '![x](./images/shot-1.png)',
    frontmatter: { ...FM(), author: 'someone', status: 'draft', visibility: 'members', publishedAt: '2020-01-01', contributors: [{ login: 'x' }], updatedAt: '2020-01-01', redirectFrom: ['/old/'], publicStub: false, type: 'project' },
  });
  assert.ok(r.ok, JSON.stringify(r.issues));
  for (const k of ['author', 'status', 'visibility', 'publishedAt', 'contributors', 'updatedAt', 'redirectFrom', 'publicStub', 'type']) {
    assert.equal(k in r.draft.frontmatter, false, `${k} is the server's, not the preparer's`);
  }
  assert.equal(r.draft.frontmatter.slug, 'surfacedby');
  assert.deepEqual(r.draft.images, ['icon.png', 'cover.webp', 'shot-1.png']);
});

test('only projects, and only a slug the image path can carry', () => {
  assert.equal(validatePreparedDraft({ type: 'post', slug: 'x', frontmatter: FM() }).error, 'unsupported_type');
  assert.equal(validatePreparedDraft({ type: 'project', slug: 'Bad Slug', frontmatter: FM() }).error, 'bad_slug');
  assert.equal(validatePreparedDraft({ type: 'project', slug: 'a'.repeat(PREPARED_SLUG_MAX + 1), frontmatter: FM() }).error, 'bad_slug',
    'the image gate allows 64 characters for the item segment, so a longer slug could never be claimed');
  assert.ok(validatePreparedDraft({ type: 'project', slug: 'a'.repeat(PREPARED_SLUG_MAX), frontmatter: FM() }).ok);
  assert.equal(validatePreparedDraft({ type: 'project', slug: 'one', frontmatter: { ...FM(), slug: 'two' } }).error, 'bad_slug');
  assert.ok(validatePreparedDraft({ type: 'project', frontmatter: { ...FM(), slug: 'from-fields' } }).ok, 'the slug may come from the fields');
});

test('javascript: and data: links are refused at save, on every link field', () => {
  const cases = [
    { links: [{ type: 'homepage', url: 'javascript:alert(1)' }] },
    { links: [{ type: 'homepage', url: 'data:text/html,<script>1</script>' }] },
    { pricingUrl: 'javascript:alert(1)' },
    { licenseUrl: 'data:text/plain,x' },
    { video: 'javascript:alert(1)' },
    { newsFeed: 'http://feed.example/rss' },
  ];
  for (const over of cases) {
    const r = validatePreparedDraft({ type: 'project', slug: 'x', frontmatter: { ...FM(), ...over } });
    assert.equal(r.ok, false, JSON.stringify(over));
    assert.ok(r.issues.some((i) => /link/.test(i)), JSON.stringify(r.issues));
  }
  assert.ok(validatePreparedDraft({ type: 'project', slug: 'x', frontmatter: { ...FM(), pricingUrl: 'http://pay.example/', newsFeed: 'https://feed.example/rss' } }).ok);
});

test('no members-only gating of any kind: the claim publishes to everyone', () => {
  const refused = [
    [{ encryptedBody: 'members/x/_enc/y.enc' }, ''],
    [{ publicStub: true }, ''],
    [{ links: [{ type: 'download', url: 'https://x.example', visibility: 'members', encrypted: true }] }, ''],
    [{}, 'public part\n\n<!-- members-only -->\n\nsecret part'],
  ];
  for (const [over, body] of refused) {
    assert.equal(validatePreparedDraft({ type: 'project', slug: 'x', frontmatter: { ...FM(), ...over }, body }).ok, false, JSON.stringify(over));
  }
});

test('a flat or uppercase image reference, or too many images, is refused', () => {
  assert.equal(validatePreparedDraft({ type: 'project', slug: 'x', frontmatter: { ...FM(), icon: 'images/icon.png' } }).ok, false);
  assert.equal(validatePreparedDraft({ type: 'project', slug: 'x', frontmatter: { ...FM(), icon: './images/Icon.png' } }).ok, false);
  assert.equal(validatePreparedDraft({ type: 'project', slug: 'x', frontmatter: FM(), body: '![](./images/Shot.png)' }).ok, false);
  const many = Array.from({ length: PREPARED_MAX_IMAGES - 1 }, (_, i) => `./images/g${i}.png`); // + icon + cover = 13
  const r = validatePreparedDraft({ type: 'project', slug: 'x', frontmatter: { ...FM(), gallery: many } });
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => /at most 12 images/.test(i)));
  assert.ok(validatePreparedDraft({ type: 'project', slug: 'x', frontmatter: { ...FM(), gallery: many.slice(1) } }).ok, 'twelve is fine');
});

test('a blank title, a missing required image and an unknown field are refused with sentences', () => {
  const r = validatePreparedDraft({ type: 'project', slug: 'x', frontmatter: { ...FM(), title: '  ', featuredImage: undefined, bogus: 1 } });
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => /title must not be blank/i.test(i)));
  assert.ok(r.issues.some((i) => /featuredImage/.test(i)), 'the schema dry run names the missing field');
  assert.ok(r.issues.some((i) => /"bogus" is not a project field/.test(i)));
});

test('claimProjectInput sets exactly what the claim decides', () => {
  const input = claimProjectInput({ ...FM(), status: 'draft', author: 'x' }, { slug: 's', publishedAt: NOW.toISOString() });
  assert.equal(input.status, 'published');
  assert.equal(input.visibility, 'public');
  assert.equal(input.slug, 's');
  assert.equal(input.publishedAt, NOW.toISOString());
  assert.equal('author' in input, false, 'the author is forced to the folder by the content builder');
});

// ---- the record ------------------------------------------------------------------------------------------------

test('newListing builds a complete record, sanitized, with no claim yet', () => {
  const rec = listing();
  assert.equal(rec.id, ID);
  assert.equal(rec.type, 'project');
  assert.equal(rec.slug, 'surfacedby');
  assert.equal(rec.title, 'SurfacedBy');
  assert.equal(rec.code, 'CDEABEYEAR23456789AB');
  assert.equal(rec.boundGithubId, null);
  assert.deepEqual(rec.priorCodes, []);
  assert.equal(listingState(rec), LISTING_STATE.prepared);
  const tied = newListing({ id: ID, draft: draftOf(), recipientName: 'S', message: 'M', campaign: 'CODEABLEYEAR', code: 'ABCDEF', boundGithubId: 4242, boundLogin: '@sam-dev', preparedBy: '1', now: NOW });
  assert.equal(tied.boundGithubId, '4242');
  assert.equal(tied.boundLogin, 'sam-dev');
  assert.throws(() => newListing({ id: ID, draft: draftOf(), campaign: 'CODEABLEYEAR', code: 'ABCDEF', boundGithubId: 'sam', preparedBy: '1' }), /bound account number/);
  assert.throws(() => newListing({ id: 'bad', draft: draftOf(), campaign: 'CODEABLEYEAR', code: 'ABCDEF', preparedBy: '1' }), /listing id/);
});

test('listingState: claimed, then publishing, then revoked, then prepared', () => {
  const at = NOW.toISOString();
  assert.equal(listingState(listing({ claimedAt: at, claimPendingBy: '1', revokedAt: at })), LISTING_STATE.claimed);
  assert.equal(listingState(listing({ claimPendingAt: at, claimPendingBy: '1', revokedAt: at })), LISTING_STATE.publishing);
  assert.equal(listingState(listing({ revokedAt: at })), LISTING_STATE.revoked);
  assert.equal(listingState(null), LISTING_STATE.unknown);
  assert.equal(listingState({ id: 'bad' }), LISTING_STATE.unknown);
});

test('applyListingEdit edits a prepared listing and reports the images it no longer uses', () => {
  const rec = listing();
  const next = draftOf({ title: 'SurfacedBy 2', gallery: ['./images/new.png'] }, 'no body images');
  const r = applyListingEdit(rec, { draft: next, message: 'New words' }, { now: new Date('2026-10-01T00:00:00.000Z'), invite: newInvite({ campaign: 'CODEABLEYEAR', code: rec.code, now: NOW }) });
  assert.ok(r.ok);
  assert.equal(r.changed, true);
  assert.equal(r.next.title, 'SurfacedBy 2');
  assert.equal(r.next.message, 'New words');
  assert.deepEqual(r.removedImages, ['shot-1.png']);
  assert.equal(r.next.updatedAt, '2026-10-01T00:00:00.000Z');
  assert.equal(applyListingEdit(rec, {}, { now: NOW }).changed, false);
});

test('applyListingEdit refuses once publishing or claimed, and refuses a blank greeting or message', () => {
  const at = NOW.toISOString();
  assert.equal(applyListingEdit(listing({ claimPendingAt: at, claimPendingBy: '1' }), { message: 'x' }).error, 'not_editable');
  assert.equal(applyListingEdit(listing({ claimedAt: at }), { message: 'x' }).error, 'not_editable');
  assert.equal(applyListingEdit(listing(), { recipientName: ' ' }).error, 'recipient_required');
  assert.equal(applyListingEdit(listing(), { message: '' }).error, 'message_required');
});

test('the tie can change while the invitation is unused, and never after it was redeemed', () => {
  const rec = listing();
  const issued = newInvite({ campaign: 'CODEABLEYEAR', code: rec.code, now: NOW });
  const tie = applyListingEdit(rec, { binding: { boundGithubId: '4242', boundLogin: 'sam' } }, { now: NOW, invite: issued });
  assert.ok(tie.ok);
  assert.equal(tie.next.boundGithubId, '4242');
  const redeemed = { ...issued, redeemedAt: NOW.toISOString(), redeemedBy: '4242' };
  assert.equal(applyListingEdit(tie.next, { binding: null }, { now: NOW, invite: redeemed }).error, 'binding_locked');
  assert.equal(applyListingEdit(rec, { binding: { boundGithubId: '1' } }, { now: NOW }).error, 'binding_locked', 'no invite to check means no change');
  assert.equal(applyListingEdit(tie.next, { binding: { boundGithubId: '4242', boundLogin: 'sam' } }, { now: NOW, invite: redeemed }).ok, true, 'restating the same tie is not a change');
  assert.equal(applyListingEdit(rec, { binding: { boundGithubId: 'sam' } }, { now: NOW, invite: issued }).error, 'invalid');
});

test('revoke, then send again under a new code; the old code is kept on the record', () => {
  const rec = listing();
  assert.equal(listingResend(rec, { code: 'NEWCODE22', now: NOW }).error, 'not_revoked', 'send again needs a revoke first');
  const revoked = listingRevoke(rec, { by: '2002207', now: NOW });
  assert.ok(revoked.ok && revoked.changed);
  assert.equal(listingState(revoked.next), LISTING_STATE.revoked);
  assert.equal(listingRevoke(revoked.next, { now: NOW }).changed, false, 'idempotent');
  const again = listingResend(revoked.next, { code: 'newcode22', now: NOW });
  assert.ok(again.ok);
  assert.equal(again.next.code, 'NEWCODE22');
  assert.deepEqual(again.next.priorCodes, ['CDEABEYEAR23456789AB']);
  assert.equal(listingState(again.next), LISTING_STATE.prepared);
  assert.equal(listingRevoke(listing({ claimedAt: NOW.toISOString() }), { now: NOW }).error, 'not_revocable');
});

test('the claim lock holds while the pull request is open: no expiry, no second claimant', () => {
  const rec = listing();
  const a = takeListingClaimLock(rec, { githubId: '42', now: NOW });
  assert.ok(a.ok && a.changed);
  assert.equal(listingState(a.next), LISTING_STATE.publishing);
  assert.equal(takeListingClaimLock(a.next, { githubId: '43', now: new Date('2027-01-01T00:00:00.000Z') }).error, 'locked',
    'a year later it is still held: only a closed pull request releases it');
  assert.equal(takeListingClaimLock(a.next, { githubId: '42', now: NOW }).changed, false, 'the holder may retake it');
  const pr = recordListingClaimPr(a.next, { githubId: '42', prNumber: 12 });
  assert.equal(pr.next.prNumber, 12);
  assert.equal(recordListingClaimPr(a.next, { githubId: '43', prNumber: 12 }).ok, false);
  const released = releaseListingClaimLock(pr.next);
  assert.equal(released.changed, true);
  assert.equal(listingState(released.next), LISTING_STATE.prepared);
  assert.equal(takeListingClaimLock(released.next, { githubId: '43', now: NOW }).ok, true, 'after release another account may claim');
  assert.equal(takeListingClaimLock(listing({ revokedAt: NOW.toISOString() }), { githubId: '42' }).error, 'revoked');
});

test('a claimed listing is minimized: the project copy, the images and the message do not outlive the claim', () => {
  const locked = takeListingClaimLock(listing(), { githubId: '42', now: NOW }).next;
  const claimed = markListingClaimed(locked, { githubId: '42', login: 'Sam-Dev', folder: 'sam-dev', path: 'members/sam-dev/projects/surfacedby/index.md', prNumber: 12, now: NOW });
  assert.equal(claimed.changed, true);
  assert.equal(markListingClaimed(claimed.next, { githubId: '99', now: NOW }).changed, false, 'idempotent on claimedAt');
  const min = minimizeClaimedListing(claimed.next);
  assert.equal(min.frontmatter, null);
  assert.equal(min.body, null);
  assert.equal(min.message, null);
  assert.deepEqual(min.images, []);
  assert.equal(min.recipientName, 'Sam', 'the manager still says who it was prepared for');
  assert.equal(min.title, 'SurfacedBy');
  assert.equal(min.claimedLogin, 'Sam-Dev');
  assert.equal(min.prNumber, 12);
  assert.equal(listingState(min), LISTING_STATE.claimed);
});

// ---- views -----------------------------------------------------------------------------------------------------

test('claimLink and projectUrl', () => {
  assert.equal(claimLink('https://gbti.network/', 'cdeabeyear23456789ab'), 'https://gbti.network/claim/?code=CDEABEYEAR23456789AB');
  assert.equal(projectUrl('https://gbti.network', 'surfacedby'), 'https://gbti.network/projects/surfacedby/');
  assert.equal(projectUrl('https://gbti.network', null), null);
});

test('the manager row never carries the personal message or the body; the admin view does', () => {
  const inv = newInvite({ campaign: 'CODEABLEYEAR', code: 'CDEABEYEAR23456789AB', listingId: ID, now: NOW });
  const s = listingSummary(listing({ boundGithubId: '4242', boundLogin: 'sam' }), inv, NOW);
  assert.equal(s.state, 'prepared');
  assert.equal(s.inviteState, 'issued');
  assert.equal(s.bound, true);
  assert.equal(s.boundLogin, 'sam');
  assert.equal(s.imageCount, 3);
  const flat = JSON.stringify(s);
  assert.ok(!flat.includes('we wrote this up'), 'no message in the row');
  assert.ok(!flat.includes('It watches the web'), 'no body in the row');
  const full = listingAdminView(listing(), inv, NOW);
  assert.equal(full.message, 'Hi Sam,\nwe wrote this up for you.');
  assert.equal(full.frontmatter.title, 'SurfacedBy');
});

test('the public view carries the listing and the terms, and never an account number, the code or the tie', () => {
  const v = publicListingView(listing({ boundGithubId: '4242', boundLogin: 'sam' }), { tier: 'member', freeDays: 365, code: 'CODEABLEYEAR' });
  assert.deepEqual(Object.keys(v).sort(), ['body', 'freeDays', 'frontmatter', 'images', 'message', 'preparedByLogin', 'recipientName', 'slug', 'tier', 'type']);
  assert.equal(v.tier, 'member');
  assert.equal(v.freeDays, 365);
  const flat = JSON.stringify(v);
  for (const secret of ['4242', 'CDEABEYEAR23456789AB', '2002207', 'CODEABLEYEAR']) assert.ok(!flat.includes(secret), secret);
  assert.equal(publicListingView(listing(), null).tier, null, 'an unknown campaign simply omits the terms');
});

// ---- guards over every new sow-427 core module -----------------------------------------------------------------

const NEW_MODULES = [
  'membership/prepared-listings.mjs', 'membership/prepared-listings-shared.mjs', 'membership/prepared-claim-files.mjs',
  'membership/prepared-notify.mjs', 'scripts/lib/erase-prepared-listings.mjs',
];

// The new test files are held to the cap too: a test suite is where the cap gets broken, one case at a time.
const NEW_TESTS = [
  'test/prepared-listings-core.test.mjs', 'test/prepared-claim-decision.test.mjs', 'test/prepared-claim-files.test.mjs',
  'test/erase-prepared-listings.test.mjs',
];

test('each new module and test file stays at or under 900 lines', () => {
  for (const f of [...NEW_MODULES, ...NEW_TESTS]) {
    const n = read(f).split('\n').length;
    assert.ok(n > 20, `${f} was read as nearly empty: this check is broken, not the subject`);
    assert.ok(n <= 900, `${f} is over the 900-line cap (${n})`);
  }
});

test('no new module logs: the code is a bearer secret, and the title, greeting and message are about a person', () => {
  for (const f of NEW_MODULES) {
    assert.doesNotMatch(read(f), /\bconsole\.|\bwlog\(/, `${f} must not log`);
  }
});

test('the copy in the new modules follows the writing rules', () => {
  const contraction = /\b(?:can't|won't|don't|doesn't|isn't|aren't|wasn't|weren't|didn't|hasn't|haven't|hadn't|couldn't|wouldn't|shouldn't|it's|that's|there's|you're|we're|they're|you've|we've|let's)\b/i;
  for (const f of [...NEW_MODULES, 'workers/signup/signin-landing.mjs']) {
    const src = read(f);
    assert.doesNotMatch(src, /—|–/, `${f}: no em or en dash`);
    assert.doesNotMatch(src, /[A-Za-z0-9,.)] - [A-Za-z0-9(]/, `${f}: no spaced hyphen standing in for a dash`);
    assert.doesNotMatch(src, /\btrial\b/i, `${f}: "free year", never "trial"`);
    assert.doesNotMatch(src, contraction, `${f}: no contractions`);
  }
});

// The shared UI and the extension bundle whatever they import. prepared-listings.mjs validates with the content
// builder and its schemas, and importing even a link helper from it put the whole schema library into the shared
// UI bundle (1.5 MB to 2.1 MB, measured 2026-09-30). Browser-side code imports the light module instead.
test('browser-side code imports the light shared module, never the validating core', () => {
  const shared = read('membership/prepared-listings-shared.mjs');
  const imports = [...shared.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
  assert.ok(imports.length > 0, 'read the shared module as having no imports: this check is broken, not the subject');
  for (const spec of imports) {
    assert.ok(['./invites.mjs', './coupons.mjs', './item-id.mjs'].includes(spec), `the shared module must stay light, not import ${spec}`);
  }
  const browserFiles = [
    'client-ui/src/prepared-editor.mjs', 'client-ui/src/prepared-listings-core.mjs',
    'client-ui/src/elements/gbti-prepared-listings.mjs', 'client/src/operations-admin.mjs',
  ];
  let sawShared = 0;
  for (const f of browserFiles) {
    const src = read(f);
    assert.doesNotMatch(src, /membership\/prepared-listings\.mjs'/, `${f} must import prepared-listings-shared.mjs`);
    if (src.includes('membership/prepared-listings-shared.mjs')) sawShared += 1;
  }
  assert.ok(sawShared >= 3, `expected the browser-side modules to import the shared module (saw ${sawShared})`);
});
