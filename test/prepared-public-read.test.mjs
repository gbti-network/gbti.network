// sow-427 B4: the SIGNED-OUT read of a prepared listing by its invitation code. The code is the only credential,
// so the tests pin what a wrong code learns (nothing: one identical 404 for every inactive case), what a right one
// sees (the project and the invitation text, never the administration note, a code or an account number), and the
// per-IP limit, driven through the REAL limiter so a fail-open limiter would show.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { inviteListingRead, inviteListingImage, inactiveResponse, LISTING_READ_LIMIT, LISTING_IMAGE_LIMIT } from '../workers/signup/prepared-claim-read.mjs';
import { newInvite, inviteKey } from '../membership/invites.mjs';
import { newListing, validatePreparedDraft } from '../membership/prepared-listings.mjs';

const NOW = new Date('2026-10-01T12:00:00.000Z');
const ID = 'ABCDEFGHJKMNPQRS';
const CODE = 'CDEABEYEAR23456789';
const PREPARER = '2002207';
const BOUND = '5551234';
const ADMIN_NOTE = 'met at the Codeable meetup, slow to reply';

function fakeKv(seed = {}) {
  const store = new Map(Object.entries(seed));
  const gets = [];
  return {
    store, gets,
    async get(key, type) {
      gets.push(key);
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' || type?.type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
    async list() { return { keys: [], list_complete: true }; },
  };
}

// The campaign is RETIRED (active: false). Its prepared invitation must still show its terms (trap 6).
const COUPONS = { generatedAt: NOW.toISOString(), coupons: [{ code: 'CODEABLEYEAR', freeDays: 365, active: false, tier: 'member' }] };

function records({ invite: iOver = {}, listing: lOver = {} } = {}) {
  const d = validatePreparedDraft({
    type: 'project', slug: 'surfacedby', body: 'It watches the web.\n\n![The dashboard](./images/shot-1.png)',
    frontmatter: { title: 'SurfacedBy', shortDescription: 'Finds mentions.', icon: './images/icon.png', featuredImage: './images/cover.webp' },
  });
  assert.ok(d.ok, JSON.stringify(d.issues));
  const listing = {
    ...newListing({
      id: ID, draft: d.draft, recipientName: 'Sam Rivera', message: 'Hi Sam,\n\nWe wrote this up for you.', campaign: 'CODEABLEYEAR', code: CODE,
      boundGithubId: BOUND, boundLogin: 'sam-dev', preparedBy: PREPARER, preparedByLogin: 'atwellpub', now: NOW,
    }),
    ...lOver,
  };
  const invite = {
    ...newInvite({ campaign: 'CODEABLEYEAR', code: CODE, issuedBy: PREPARER, note: ADMIN_NOTE, now: NOW, listingId: ID, boundGithubId: BOUND, boundLogin: 'sam-dev' }),
    ...iOver,
  };
  return { listing, invite };
}
function seeded({ invite, listing } = records(), extra = {}) {
  const seed = { 'coupons:config': JSON.stringify(COUPONS), ...extra };
  if (invite) seed[inviteKey(invite.code)] = JSON.stringify(invite);
  if (listing) seed[`invite-listing:${listing.id}`] = JSON.stringify(listing);
  for (const n of ['icon.png', 'cover.webp', 'shot-1.png']) seed[`invite-listing-img:${ID}:${n}`] = JSON.stringify({ dataBase64: `BYTES-${n}`, contentType: 'image/png', bytes: 5 });
  return fakeKv(seed);
}

let ipCounter = 0;
const freshIp = () => `203.0.113.${(ipCounter += 1) % 250}`;
const readReq = (code, ip = freshIp()) => new Request(`https://x/invite/listing?code=${encodeURIComponent(code)}`, { headers: ip ? { 'CF-Connecting-IP': ip } : {} });
const imgReq = (code, name, ip = freshIp()) => new Request(`https://x/invite/listing-image?code=${encodeURIComponent(code)}&name=${encodeURIComponent(name)}`, { headers: ip ? { 'CF-Connecting-IP': ip } : {} });
const read = (kv, code, ip) => inviteListingRead(readReq(code, ip), {}, { kv, now: NOW });

const INACTIVE = JSON.stringify(inactiveResponse().body);

test('a readable code shows the project and the invitation, and the tier and length of a RETIRED campaign', async () => {
  const kv = seeded();
  const r = await read(kv, CODE.toLowerCase());
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const v = r.body.listing;
  assert.equal(v.frontmatter.title, 'SurfacedBy');
  assert.equal(v.recipientName, 'Sam Rivera');
  assert.equal(v.message, 'Hi Sam,\n\nWe wrote this up for you.');
  assert.equal(v.preparedByLogin, 'atwellpub');
  assert.deepEqual(v.images, ['icon.png', 'cover.webp', 'shot-1.png']);
  assert.equal(v.tier, 'member', 'terms come from the campaign without its active gate (trap 6)');
  assert.equal(v.freeDays, 365);
});

test('the answer never carries the administration note, a code or an account number; a tie shows only as its login', async () => {
  const r = await read(seeded(), CODE);
  const text = JSON.stringify(r.body);
  for (const secret of [ADMIN_NOTE, CODE, PREPARER, BOUND, 'CODEABLEYEAR', ID]) {
    assert.equal(text.includes(secret), false, `the public read leaked ${secret}`);
  }
  // sow-434 decision 9: the tied account's LOGIN is shown (the example profile links their GitHub), never its number.
  assert.equal(r.body.listing.githubLogin, 'sam-dev');
  const untied = await read(seeded(records({ listing: { boundGithubId: null, boundLogin: null } })), CODE);
  assert.equal(untied.body.listing.githubLogin, null);
});

test('EVERY inactive case answers the same 404 body, byte for byte, with nothing about the project in it', async () => {
  const cases = [
    ['unknown code', seeded(), 'NOSUCHCODE99'],
    ['malformed code', seeded(), 'ab'],
    ['markup in the code', seeded(), '<script>'],
    ['empty code', seeded(), ''],
    ['revoked invite', seeded(records({ invite: { revokedAt: NOW.toISOString() } })), CODE],
    ['revoked listing', seeded(records({ listing: { revokedAt: NOW.toISOString() } })), CODE],
    ['claimed invite', seeded(records({ invite: { claimedAt: NOW.toISOString(), claimedBy: BOUND } })), CODE],
    ['claimed listing', seeded(records({ listing: { claimedAt: NOW.toISOString(), claimedBy: BOUND } })), CODE],
    ['expired invite', seeded(records({ invite: { expiresAt: '2026-01-01T00:00:00.000Z' } })), CODE],
    ['deleted listing', seeded({ ...records(), listing: null }), CODE],
    ['a plain invite, no listing', seeded(records({ invite: { listingId: null } })), CODE],
    ['listing id mismatch', seeded(records({ invite: { listingId: 'SRQPNMKJHGFEDCBA' } })), CODE],
    ['a code replaced by Send again', seeded(records({ listing: { code: 'CDEABEYEARZZZZZZZZ', priorCodes: [CODE] } })), CODE],
    ['listing with no project', seeded(records({ listing: { frontmatter: null } })), CODE],
  ];
  for (const [label, kv, code] of cases) {
    const r = await read(kv, code);
    assert.equal(r.status, 404, label);
    assert.equal(JSON.stringify(r.body), INACTIVE, `${label}: the body is the one inactive body`);
    assert.doesNotMatch(JSON.stringify(r.body), /SurfacedBy|Sam/, label);
  }
});

test('a redeemed invite and a pending claim are still readable, so the person who holds them can reload the page', async () => {
  const redeemed = await read(seeded(records({ invite: { redeemedAt: NOW.toISOString(), redeemedBy: BOUND } })), CODE);
  assert.equal(redeemed.status, 200);
  const pending = await read(seeded(records({ invite: { claimPendingAt: NOW.toISOString(), claimPendingBy: BOUND } })), CODE);
  assert.equal(pending.status, 200);
});

test('a malformed code is answered before any KV read and without spending the limit', async () => {
  const kv = seeded();
  kv.gets.length = 0;
  const r = await read(kv, 'x!');
  assert.equal(r.status, 404);
  assert.deepEqual(kv.gets, []);
});

test('the per-IP limit: the read allows 30 in ten minutes, then 429; a request with no IP is refused outright', async () => {
  const kv = seeded();
  const ip = '198.51.100.7';
  for (let i = 0; i < LISTING_READ_LIMIT.limit; i += 1) assert.equal((await read(kv, CODE, ip)).status, 200, `request ${i + 1}`);
  const over = await read(kv, CODE, ip);
  assert.equal(over.status, 429);
  assert.equal(over.body.error, 'rate_limited');
  assert.equal((await read(kv, 'NOSUCHCODE99', ip)).status, 429, 'a guessed code is limited like a real one');
  assert.ok(kv.store.has(`rl:listing-read:${ip}`), 'keyed under its own prefix');

  const noIp = await inviteListingRead(readReq(CODE, ''), {}, { kv, now: NOW });
  assert.equal(noIp.status, 429, 'the limiter fails closed on an absent IP');
});

test('a limiter that throws refuses rather than letting the read through', async () => {
  const r = await inviteListingRead(readReq(CODE), {}, { kv: seeded(), now: NOW, limiter: async () => { throw new Error('kv down'); } });
  assert.equal(r.status, 429);
});

test('a stale campaign registry leaves the tier and length null rather than guessing', async () => {
  const kv = seeded(records(), { 'coupons:config': JSON.stringify({ ...COUPONS, generatedAt: '2026-01-01T00:00:00.000Z' }) });
  const r = await read(kv, CODE);
  assert.equal(r.status, 200);
  assert.equal(r.body.listing.tier, null);
  assert.equal(r.body.listing.freeDays, null);
});

test('no edge store is a 503, never a throw', async () => {
  const r = await inviteListingRead(readReq(CODE), {}, { kv: null, now: NOW });
  assert.equal(r.status, 503);
});

test('images: only a name the listing lists is served; every other case is the same inactive 404', async () => {
  const kv = seeded();
  const ok = await inviteListingImage(imgReq(CODE, 'icon.png'), {}, { kv, now: NOW });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { ok: true, name: 'icon.png', dataBase64: 'BYTES-icon.png', contentType: 'image/png' });

  kv.store.set(`invite-listing-img:${ID}:secret.png`, JSON.stringify({ dataBase64: 'STRAY' }));
  const gone = records();
  gone.listing.images = [...gone.listing.images, 'missing.png'];
  const kvGone = seeded(gone);
  kvGone.store.delete(`invite-listing-img:${ID}:missing.png`);
  for (const [label, store, code, name] of [
    ['an unlisted name, even one stored', kv, CODE, 'secret.png'],
    ['a malformed name', kv, CODE, '../icon.png'],
    ['an uppercase name', kv, CODE, 'ICON.PNG'],
    ['a listed name with no bytes', kvGone, CODE, 'missing.png'],
    ['a dead code', seeded(records({ invite: { revokedAt: NOW.toISOString() } })), CODE, 'icon.png'],
    ['an unknown code', kv, 'NOSUCHCODE99', 'icon.png'],
  ]) {
    const r = await inviteListingImage(imgReq(code, name), {}, { kv: store, now: NOW });
    assert.equal(r.status, 404, label);
    assert.equal(JSON.stringify(r.body), INACTIVE, label);
  }
});

test('the image read has its own, wider limit under its own prefix', async () => {
  const kv = seeded();
  const ip = '198.51.100.9';
  for (let i = 0; i < LISTING_IMAGE_LIMIT.limit; i += 1) {
    assert.equal((await inviteListingImage(imgReq(CODE, 'icon.png', ip), {}, { kv, now: NOW })).status, 200, `image ${i + 1}`);
  }
  assert.equal((await inviteListingImage(imgReq(CODE, 'icon.png', ip), {}, { kv, now: NOW })).status, 429);
  assert.ok(kv.store.has(`rl:listing-img:${ip}`));
  assert.equal(kv.store.has(`rl:listing-read:${ip}`), false, 'the two limits do not share a counter');
  assert.equal((await inviteListingImage(imgReq(CODE, 'icon.png', ''), {}, { kv, now: NOW })).status, 429, 'no IP, no image');
});
