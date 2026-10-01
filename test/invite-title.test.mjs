// sow-437: the personal title of a live invitation ("Rob, your Devote listing on GBTI Network"), built by a pure
// function and served by GET /invite/title for the site's edge function. The tests pin the wording rules, that every
// dead link answers the page read's one identical 404 (so it keeps the generic title), that a call with no address is
// counted under a shared key rather than refused, and that the limit is real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { inviteTitleRead, inactiveResponse, LISTING_TITLE_LIMIT, LISTING_READ_LIMIT } from '../workers/signup/prepared-claim-read.mjs';
import { invitationTitle, projectShortName, TITLE_SHORT_NAME_MAX } from '../membership/prepared-listings-shared.mjs';
import { newInvite, inviteKey } from '../membership/invites.mjs';
import { newListing, validatePreparedDraft } from '../membership/prepared-listings.mjs';

const NOW = new Date('2026-10-01T12:00:00.000Z');
const ID = 'ABCDEFGHJKMNPQRS';
const CODE = 'CDEABEYEAR23456789';

function fakeKv(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async get(key, type) {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' || type?.type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
    async list() { return { keys: [], list_complete: true }; },
  };
}

function seeded({ invite: iOver = {}, listing: lOver = {}, title = 'Devote: A Distraction-Free Daily Devotional', name = 'Rob' } = {}) {
  const d = validatePreparedDraft({
    type: 'project', slug: 'devote', body: 'A daily devotional.',
    frontmatter: { title, shortDescription: 'A devotional.', icon: './images/icon.png', featuredImage: './images/cover.webp' },
  });
  assert.ok(d.ok, JSON.stringify(d.issues));
  const listing = { ...newListing({ id: ID, draft: d.draft, recipientName: name, message: 'Hello.', campaign: 'CODEABLEYEAR', code: CODE, preparedBy: '2002207', preparedByLogin: 'atwellpub', now: NOW }), ...lOver };
  const invite = { ...newInvite({ campaign: 'CODEABLEYEAR', code: CODE, issuedBy: '2002207', note: 'admin note', now: NOW, listingId: ID }), ...iOver };
  return fakeKv({ [inviteKey(CODE)]: JSON.stringify(invite), [`invite-listing:${ID}`]: JSON.stringify(listing) });
}

let ipCounter = 0;
const req = (code, ip = `198.51.100.${(ipCounter += 1) % 250}`) =>
  new Request(`https://x/invite/title?code=${encodeURIComponent(code)}`, { headers: ip ? { 'CF-Connecting-IP': ip } : {} });
const INACTIVE = JSON.stringify(inactiveResponse().body);

test('the personal title is name and project, with the project cut at its first colon', () => {
  assert.equal(invitationTitle({ recipientName: 'Rob', title: 'Devote: A Distraction-Free Daily Devotional' }), 'Rob, your Devote listing on GBTI Network');
  assert.equal(invitationTitle({ recipientName: '  Sam  Rivera ', title: 'SurfacedBy' }), 'Sam Rivera, your SurfacedBy listing on GBTI Network');
  assert.equal(projectShortName(': Leading colon'), ': Leading colon'.trim(), 'an empty head falls back to the whole title');
  assert.equal(invitationTitle({ recipientName: '', title: 'Devote' }), '', 'no name, no personal title');
  assert.equal(invitationTitle({ recipientName: 'Rob', title: '' }), '', 'no project, no personal title');
  assert.equal(invitationTitle({}), '');
});

test('a long project name is cut back to a word boundary within the cap', () => {
  const long = 'An extremely long project name that keeps going well past any sensible length for a browser tab title';
  const short = projectShortName(long);
  assert.ok(short.length <= TITLE_SHORT_NAME_MAX, `${short.length}`);
  assert.ok(long.startsWith(short));
  assert.ok(!short.endsWith(' '));
  assert.equal(long[short.length], ' ', 'the cut lands on a word boundary');
  assert.equal(projectShortName('x'.repeat(90)).length, TITLE_SHORT_NAME_MAX, 'one unbroken word is cut at the cap');
});

test('GET /invite/title answers the personal title for a live invitation', async () => {
  const r = await inviteTitleRead(req(CODE.toLowerCase()), {}, { kv: seeded(), now: NOW });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { ok: true, title: 'Rob, your Devote listing on GBTI Network' });
});

test('every dead link answers the page read\'s one identical 404, so it keeps the generic title', async () => {
  const cases = {
    unknown: [seeded(), 'NOSUCHCODE23456789'],
    malformed: [seeded(), 'not a code!'],
    revoked: [seeded({ invite: { revokedAt: NOW.toISOString() }, listing: { revokedAt: NOW.toISOString() } }), CODE],
    claimed: [seeded({ invite: { claimedAt: NOW.toISOString(), claimedBy: '42' }, listing: { claimedAt: NOW.toISOString() } }), CODE],
    noName: [seeded({ name: '' }), CODE],
  };
  for (const [label, [kv, code]] of Object.entries(cases)) {
    const r = await inviteTitleRead(req(code), {}, { kv, now: NOW });
    assert.equal(r.status, 404, `${label}: ${JSON.stringify(r.body)}`);
    assert.equal(JSON.stringify(r.body), INACTIVE, `${label} must not differ from the shared inactive body`);
    assert.doesNotMatch(JSON.stringify(r.body), /Rob|Devote/, `${label} leaked`);
  }
});

test('a call with no address is counted under a shared key, not refused', async () => {
  const calls = [];
  const limiter = async (o) => { calls.push(o); return { allowed: true }; };
  const r = await inviteTitleRead(req(CODE, null), {}, { kv: seeded(), now: NOW, limiter });
  assert.equal(r.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].ip, 'edge');
  assert.equal(calls[0].prefix, LISTING_TITLE_LIMIT.prefix);
  assert.notEqual(LISTING_TITLE_LIMIT.prefix, LISTING_READ_LIMIT.prefix, 'the title has its own counter');
});

test('the title limit is real: the call past it is refused with 429 by the real limiter', async () => {
  const kv = seeded();
  const ip = '192.0.2.77';
  for (let i = 0; i < LISTING_TITLE_LIMIT.limit; i += 1) {
    const ok = await inviteTitleRead(req(CODE, ip), {}, { kv, now: NOW });
    assert.equal(ok.status, 200, `call ${i + 1}`);
  }
  const over = await inviteTitleRead(req(CODE, ip), {}, { kv, now: NOW });
  assert.equal(over.status, 429);
});

test('the route is wired and the module never logs', () => {
  const routes = fs.readFileSync(new URL('../workers/signup/member-routes.mjs', import.meta.url), 'utf8');
  assert.match(routes, /pathname === '\/invite\/title'/);
  assert.match(routes, /inviteTitleRead\(request, env\)/);
  const mod = fs.readFileSync(new URL('../workers/signup/prepared-claim-read.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(mod, /\bconsole\.|\bwlog\(/);
});
