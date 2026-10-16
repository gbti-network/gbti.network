// sow-457: the on-page invitation claim. What is under test is not the dialog's appearance, which no unit test
// can see, but the four decisions that go wrong silently:
//
//   1. WHICH PAGE gets the dialog. A destination that matches no page sends 26 invitations to a 404, and no
//      page-driven check can see that, because the broken campaign appears on no page.
//   2. WHETHER IT OPENS AT ALL. The destination is a published article with ordinary readers. If a missing or
//      malformed coupon ever read as present, every reader of that article would meet a popup.
//   3. WHAT IT PROMISES. The terms line comes from the tier registry, and the copy here must not restate it.
//      This is the defect sow-243 found shipped: five true-sounding sentences naming no tier and no price.
//   4. THE LINK SHAPE. A fragment placed before the query makes the coupon part of the fragment, so the page
//      never sees it and the link quietly stops being an invitation while still looking like one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import {
  INVITE_CLAIM_COPY, campaignForPath, couponFromSearch, inviteDestinationUrl, normalizeInvitePath,
} from '../src/lib/invite-claim-core.mjs';
import { DESTINATION_BY_CAMPAIGN, landerFor, destinationFor, LANDER_BY_CAMPAIGN } from '../membership/invites.mjs';
import { tierLine, buildClaimSigninUrl } from '../src/lib/claim-core.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const loadYaml = (p) => yaml.load(fs.readFileSync(path.join(ROOT, p), 'utf8'));

test('the destination map is not empty, so every rule below is checking something', () => {
  // ASSERTED FIRST. Every test in this file iterates the map; an empty one would pass all of them over nothing.
  const ids = Object.keys(DESTINATION_BY_CAMPAIGN);
  assert.ok(ids.length >= 1, 'at least one campaign must have a destination');
  assert.ok(ids.includes('YOUTUBE2026'), `YOUTUBE2026 must be in the destination map; found ${ids.join(', ')}`);
});

test('every campaign with a destination is a real, active campaign with copy for its dialog', () => {
  const byId = new Map((loadYaml('house/campaigns.yml')?.campaigns ?? []).map((c) => [c.id, c]));
  assert.ok(byId.size >= 3, 'the campaign manifest must have loaded');
  for (const [id, dest] of Object.entries(DESTINATION_BY_CAMPAIGN)) {
    const campaign = byId.get(id);
    assert.ok(campaign, `${id} has a destination but is not in house/campaigns.yml`);
    assert.equal(campaign.active, true, `${id} has a destination but is not active`);
    const copy = INVITE_CLAIM_COPY[id];
    assert.ok(copy, `${id} has a destination but no dialog copy, so its link would open a page with no offer on it`);
    assert.equal(copy.tier, campaign.tier,
      `${id}'s dialog says tier "${copy.tier}" but the campaign grants "${campaign.tier}". The dialog would `
      + 'promise what the redemption does not give.');
    assert.ok(String(dest).startsWith('/') && String(dest).endsWith('/'), `${id}'s destination must be an absolute site path with a trailing slash (got ${dest})`);
  }
});

test('every destination resolves to a published content item, so a draft reds this instead of 404ing a recipient', () => {
  // The only direction a unit test can check: the SOURCE of the page exists and is published. A destination
  // whose article is drafted, retitled or moved would answer 404 for every invitation already in an inbox, and
  // nothing else in the suite looks at that pairing.
  let checked = 0;
  for (const [id, dest] of Object.entries(DESTINATION_BY_CAMPAIGN)) {
    const m = /^\/articles\/([a-z0-9-]+)\/$/.exec(dest);
    if (!m) continue; // a non-article destination is checked by the route guard above, not here
    const matches = fs.globSync
      ? fs.globSync(`members/*/posts/${m[1]}/index.md`, { cwd: ROOT })
      : [];
    assert.equal(matches.length, 1, `${id} points at /articles/${m[1]}/, which is not exactly one content item (found ${matches.length})`);
    const fm = yaml.load(fs.readFileSync(path.join(ROOT, matches[0]), 'utf8').split('---')[1]);
    assert.equal(fm.status, 'published', `${id}'s destination article is "${fm.status}", so the link would 404`);
    assert.equal(fm.visibility, 'public', `${id}'s destination article is ${fm.visibility}, so a non-member could not read it`);
    assert.equal(fm.slug, m[1], `${id}'s destination slug does not match the article's own slug (${fm.slug})`);
    checked += 1;
  }
  assert.ok(checked >= 1, `expected at least one article destination, checked ${checked}`);
});

test('campaignForPath finds the destination with or without its trailing slash, and NOTHING else', () => {
  const dest = DESTINATION_BY_CAMPAIGN.YOUTUBE2026;
  assert.equal(campaignForPath(dest)?.id, 'YOUTUBE2026');
  assert.equal(campaignForPath(dest.replace(/\/$/, ''))?.id, 'YOUTUBE2026', 'trailingSlash ignore serves both forms');
  // The important direction. A dialog on a page no campaign points at would tell the reader they are on a list
  // they are not on.
  for (const other of ['/', '/articles/', '/membership/', '/member-invite/', '/articles/some-other-article/', '/youtube-invite/', '']) {
    assert.equal(campaignForPath(other), null, `${other || '(empty)'} must get no invitation dialog`);
  }
  assert.equal(campaignForPath(null), null);
  assert.equal(campaignForPath(undefined), null);
});

test('campaignForPath hands the page its copy, and the copy states no price and no benefit', () => {
  const c = campaignForPath(DESTINATION_BY_CAMPAIGN.YOUTUBE2026);
  for (const field of ['kicker', 'heading', 'message', 'stripNote', 'openLabel', 'signinLabel', 'laterLabel']) {
    assert.ok(typeof c[field] === 'string' && c[field].trim(), `${field} must be non-empty copy`);
  }
  // sow-243: the terms belong to tierLine() over the registry. A page that writes its own price keeps stating
  // it after the registry changes, and that is the defect that shipped on a lander.
  const prose = [c.kicker, c.heading, c.message, c.stripNote, c.openLabel, c.signinLabel, c.laterLabel].join(' ');
  assert.doesNotMatch(prose, /\$\d/, 'no price in the dialog copy; the price comes from house/membership-tiers.yml');
  assert.doesNotMatch(prose, /Network Supporter|Curator|Content Creator/, 'no tier name in the dialog copy');
  // Writing conventions: no em or en dashes, no contractions, in anything a reader sees.
  assert.doesNotMatch(prose, /[—–]/, 'no em or en dashes in user-facing copy');
  assert.doesNotMatch(prose, /\b\w+'(s|t|re|ll|ve|d|m)\b/i, 'no contractions in user-facing copy');
});

test('the terms line is the registry one, and it names the tier the campaign grants', () => {
  const tiers = (loadYaml('house/membership-tiers.yml')?.tiers ?? []);
  const member = tiers.find((t) => t.key === 'member');
  assert.ok(member, 'the member tier must exist in the registry');
  const copy = INVITE_CLAIM_COPY.YOUTUBE2026;
  const line = tierLine({ tier: copy.tier, freeDays: copy.freeDays }, { member: { label: member.label, priceAnnual: member.priceAnnual } });
  assert.ok(line, 'the terms line must resolve for the campaign the dialog ships');
  assert.match(line, new RegExp(member.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'it names the registry label');
  assert.match(line, /a free year/, '365 days reads as a free year');
  // And it fails CLOSED: an unresolvable tier shows nothing rather than a half-built offer.
  assert.equal(tierLine({ tier: 'wizard', freeDays: 365 }, {}), null);
  assert.equal(tierLine({ tier: copy.tier, freeDays: null }, { member: { label: member.label, priceAnnual: 50 } }), null);
});

test('couponFromSearch admits a usable code and NOTHING else, because a false positive pops at every reader', () => {
  assert.equal(couponFromSearch('?coupon=YTBE22637PYPCZPR3'), 'YTBE22637PYPCZPR3');
  assert.equal(couponFromSearch('?a=1&coupon=abc123&b=2'), 'ABC123', 'normalized, as the Worker normalizes it');
  assert.equal(couponFromSearch('?coupon=%20abc123%20'), 'ABC123', 'trimmed');
  // Every one of these must leave the dialog shut.
  for (const search of ['', '?', '?coupon=', '?coupon=ab', '?coupon=has-a-dash', '?coupon=' + 'A'.repeat(33), '?code=ABC123', '?coup=ABC123']) {
    assert.equal(couponFromSearch(search), '', `${search || '(empty)'} must not open the dialog`);
  }
  assert.equal(couponFromSearch(null), '');
  assert.equal(couponFromSearch(undefined), '');
});

test('an invitation link puts the coupon in the QUERY and the entry in the fragment, in that order', () => {
  const url = inviteDestinationUrl({
    siteBase: 'https://gbti.network',
    path: '/articles/x/',
    code: 'ABC123',
    fragment: '1-elliott-richmond',
  });
  assert.equal(url, 'https://gbti.network/articles/x/?coupon=ABC123#1-elliott-richmond');
  // THE ORDER IS THE POINT. A fragment before the query swallows the coupon, the page never reads it, and the
  // link still looks exactly like an invitation.
  assert.ok(url.indexOf('?coupon=') < url.indexOf('#'), 'the query must come before the fragment');
  assert.equal(couponFromSearch(new URL(url).search), 'ABC123', 'and the page can actually read it back');
  // A leading # on the fragment is accepted without doubling it.
  assert.equal(inviteDestinationUrl({ siteBase: 'https://x.test', path: '/a/', code: 'ABC123', fragment: '#f' }), 'https://x.test/a/?coupon=ABC123#f');
  // An accented anchor is percent-encoded, because three of the 26 entries have one and a raw non-ASCII URL in
  // an email is at the mercy of whatever rewrites it on the way. It must still resolve to the same anchor.
  const accented = inviteDestinationUrl({ siteBase: 'https://x.test', path: '/a/', code: 'ABC123', fragment: '19-la-m\u00e1quina-del-branding' });
  assert.equal(accented, 'https://x.test/a/?coupon=ABC123#19-la-m%C3%A1quina-del-branding');
  assert.equal(decodeURIComponent(new URL(accented).hash.slice(1)), '19-la-m\u00e1quina-del-branding');
  // No fragment, and refusals rather than half-built links.
  assert.equal(inviteDestinationUrl({ siteBase: 'https://x.test', path: '/a/', code: 'ABC123' }), 'https://x.test/a/?coupon=ABC123');
  assert.equal(inviteDestinationUrl({ siteBase: 'https://x.test', path: '', code: 'ABC123' }), null);
  assert.equal(inviteDestinationUrl({ siteBase: 'https://x.test', path: '/a/', code: 'no' }), null);
});

test('destinationFor answers where a link goes; landerFor still answers which page describes the tier', () => {
  // The two questions are different, and conflating them is what this split exists to prevent: an article
  // cannot satisfy the lander contract (bind one tier, render registry benefits), and should not try.
  assert.equal(destinationFor({ id: 'YOUTUBE2026', tier: 'member' }), DESTINATION_BY_CAMPAIGN.YOUTUBE2026);
  assert.equal(landerFor({ id: 'YOUTUBE2026', tier: 'member' }), '/member-invite/',
    'the campaign still has a page that truthfully describes what it grants');
  assert.equal(LANDER_BY_CAMPAIGN.YOUTUBE2026, undefined, 'and it is NOT a per-campaign lander any more');
  // A campaign with no destination falls through to its lander, so every existing caller is unchanged.
  assert.equal(destinationFor({ id: 'CODEABLEYEAR', tier: 'member' }), '/codeable-invite/');
  assert.equal(destinationFor({ id: 'HUDSINVITE', tier: 'member' }), '/member-invite/');
  assert.equal(destinationFor({ tier: 'wizard' }), null, 'and an unknown tier still resolves nothing rather than a plausible page');
});

test('the sign-in URL carries the coupon and, for this dialog, NO return_to', () => {
  const base = { signupBase: 'https://signup.gbti.network', token: 'tok', code: 'ABC123' };
  const u = new URL(buildClaimSigninUrl({ ...base, returnTo: null }));
  assert.equal(u.pathname, '/signup/start');
  assert.equal(u.searchParams.get('coupon'), 'ABC123');
  assert.equal(u.searchParams.get('cf-turnstile-response'), 'tok');
  assert.equal(u.searchParams.get('return_to'), null, 'a new member lands on the welcome, as from an invite lander');
  // The default is UNCHANGED, which is what keeps the prepared-listing claim page working.
  assert.equal(new URL(buildClaimSigninUrl(base)).searchParams.get('return_to'), '/claim/?code=ABC123');
  // Referral and touch cookies ride along when present, exactly as the landers forward them.
  const withRef = new URL(buildClaimSigninUrl({ ...base, returnTo: null, ref: 'r1', via: 'v1', sid: 's1' }));
  assert.equal(withRef.searchParams.get('ref'), 'r1');
  assert.equal(withRef.searchParams.get('via'), 'v1');
  assert.equal(withRef.searchParams.get('sid'), 's1');
  // No token, no URL: a button can never send a half-built request.
  assert.equal(buildClaimSigninUrl({ ...base, token: '', returnTo: null }), null);
});

test('normalizeInvitePath strips one trailing slash and nothing else', () => {
  assert.equal(normalizeInvitePath('/a/b/'), '/a/b');
  assert.equal(normalizeInvitePath('/a/b'), '/a/b');
  assert.equal(normalizeInvitePath('/'), '/', 'the root keeps its slash rather than becoming empty');
  assert.equal(normalizeInvitePath('/a/?coupon=X#f'), '/a', 'a query or fragment never reaches the comparison');
  assert.equal(normalizeInvitePath(''), '');
});
