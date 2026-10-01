// sow-427 B3: everything the superadmin does to a prepared listing AFTER creating it (edit, revoke, send again,
// delete, the manager's reads), plus the two changes to the plain invite routes that keep a prepared invitation out
// of an admin's hands, and the route lines in the Worker. No network: every dependency is a fake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { membershipPreparedPost, membershipPreparedGet, FINALIZE_PER_LIST } from '../workers/signup/membership-prepared-admin.mjs';
import { membershipInviteList, membershipInviteUpdate, mintUniqueInvite } from '../workers/signup/membership-invites-admin.mjs';
import { inviteKey, INVITE_STATE, inviteState } from '../membership/invites.mjs';
import { draftImageKey } from '../membership/draft-images.mjs';
import { membershipClaimPost } from '../workers/signup/membership-claim.mjs';
import { listingKey, listingImageKey, listingState, LISTING_STATE } from '../membership/prepared-listings.mjs';
import * as F from './prepared-claim-fixtures.mjs';
import { workerSource, routeBlock, usesCredentialedCors } from './lib/worker-source.mjs';

const NOW = new Date('2026-10-01T12:00:00.000Z');
const LATER = new Date('2026-10-02T12:00:00.000Z');
const ME = '2002207';
const b64 = (n, fill = 3) => Buffer.alloc(n, fill).toString('base64');

const COUPONS = JSON.stringify({
  generatedAt: NOW.toISOString(),
  coupons: [
    { code: 'CODEABLEYEAR', freeDays: 365, active: true, tier: 'member' },
    { code: 'CREATORYEAR', freeDays: 365, active: true, tier: 'creator' },
    { code: 'RETIRED', freeDays: 30, active: false, tier: 'member' },
  ],
});

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
    async list({ prefix }) {
      return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
    },
  };
}
const staged = (name, fill = 3) => [draftImageKey(ME, 'project:surfacedby', name), JSON.stringify({ dataBase64: b64(40, fill) })];
const seedKv = () => fakeKv({ 'coupons:config': COUPONS, ...Object.fromEntries([staged('icon.png'), staged('cover.webp'), staged('shot-1.png')]) });

const okAuth = async () => ({ ok: true, githubId: ME, role: 'superadmin', mirror: { roles: { superadmins: [{ github_id: ME, login: 'atwellpub' }] } } });
const noAuth = async () => ({ ok: false, status: 403, body: { error: 'forbidden' } });
function seqBytes() {
  let call = 0;
  return (n) => { call += 1; return Uint8Array.from({ length: n }, (_, i) => (call * 13 + i * 5) % 240); };
}
const lookupUser = async (_env, login) => {
  const l = String(login).toLowerCase();
  if (l === 'sam-dev') return { ok: true, githubId: '5551234', login: 'Sam-Dev', name: 'Sam' };
  if (l === 'pat') return { ok: true, githubId: '6660001', login: 'pat', name: null };
  return { ok: false, status: 404, error: 'unknown_github_login', message: 'No personal GitHub account has that name.' };
};
const TAXONOMY = { tree: { devops: { label: 'DevOps' } } };
const baseDeps = {
  authorize: okAuth, now: NOW, lookupUser, getToken: async () => 'tok', siteBase: 'https://gbti.network',
  readTree: async () => ({ content: [], shares: [] }), loadHouse: async () => ({ ok: true, parsed: TAXONOMY }),
};
const DRAFT = (fmOver = {}, body = 'It watches the web.\n\n![The dashboard](./images/shot-1.png)') => ({
  type: 'project', slug: 'surfacedby', body,
  frontmatter: { title: 'SurfacedBy', shortDescription: 'x', icon: './images/icon.png', featuredImage: './images/cover.webp', categories: ['devops'], ...fmOver },
});
const req = (body) => new Request('https://x/membership/admin/prepared', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const getReq = (qs = '') => new Request(`https://x/membership/admin/prepared${qs}`, { method: 'GET' });

/** One prepared listing, through the real create path. Returns the kv, the POST helper and the created ids. */
async function prepared({ githubLogin } = {}) {
  const kv = seedKv();
  const rand = seqBytes();
  const post = (body, over = {}) => membershipPreparedPost(req(body), { SIGNUP_KV: kv }, { ...baseDeps, randomBytes: rand, ...over });
  const r = await post({
    op: 'save', campaign: 'CODEABLEYEAR', recipientName: 'Sam', message: 'Hello Sam.', draft: DRAFT(),
    stagedItem: 'project:surfacedby', ...(githubLogin ? { githubLogin } : {}),
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { kv, post, id: r.body.listing.id, code: r.body.code };
}
const listingOf = (kv, id) => JSON.parse(kv.store.get(`invite-listing:${id}`));
const inviteOf = (kv, code) => JSON.parse(kv.store.get(inviteKey(code)));
const writeListing = (kv, rec) => kv.store.set(`invite-listing:${rec.id}`, JSON.stringify(rec));
const writeInvite = (kv, rec) => kv.store.set(inviteKey(rec.code), JSON.stringify(rec));

// ---- edit -----------------------------------------------------------------------------------------------------

test('editing only the message changes the message and leaves the images and any staged upload alone', async () => {
  const { kv, post, id } = await prepared();
  kv.store.set(...staged('icon.png', 9)); // a later upload the superadmin has NOT saved with a project
  const r = await post({ op: 'save', id, message: 'A better hello.' }, { now: LATER });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.created, false);
  assert.equal(r.body.changed, true);
  assert.equal(listingOf(kv, id).message, 'A better hello.');
  assert.equal(listingOf(kv, id).recipientName, 'Sam', 'an absent field is unchanged');
  assert.equal(JSON.parse(kv.store.get(`invite-listing-img:${id}:icon.png`)).dataBase64, b64(40, 3), 'the stored icon is not replaced');
  assert.ok(kv.store.has(draftImageKey(ME, 'project:surfacedby', 'icon.png')), 'the unrelated staged upload stays');
});

test('editing the project: a re-staged image replaces its bytes, a dropped image is deleted, a kept one stays', async () => {
  const { kv, post, id } = await prepared();
  kv.store.set(...staged('cover.webp', 8)); // the superadmin replaced the cover
  const r = await post({ op: 'save', id, draft: DRAFT({}, 'No screenshot any more.'), stagedItem: 'project:surfacedby' }, { now: LATER });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(listingOf(kv, id).images, ['icon.png', 'cover.webp']);
  assert.equal(JSON.parse(kv.store.get(`invite-listing-img:${id}:cover.webp`)).dataBase64, b64(40, 8), 'replaced');
  assert.equal(kv.store.has(`invite-listing-img:${id}:shot-1.png`), false, 'no longer referenced, so deleted');
  assert.ok(kv.store.has(`invite-listing-img:${id}:icon.png`), 'kept from the store without a new upload');
  assert.equal(kv.store.has(draftImageKey(ME, 'project:surfacedby', 'cover.webp')), false, 'the staged copy is gone once stored');
});

test('an edit may tie, retie and untie the invitation while it is unused, and the invite follows the listing', async () => {
  const { kv, post, id, code } = await prepared();
  let r = await post({ op: 'save', id, githubLogin: 'sam-dev' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(inviteOf(kv, code).boundGithubId, '5551234');
  assert.equal(listingOf(kv, id).boundGithubId, '5551234');

  let looked = 0;
  r = await post({ op: 'save', id, githubLogin: 'SAM-DEV' }, { lookupUser: async (...a) => { looked += 1; return lookupUser(...a); } });
  assert.equal(r.status, 200);
  assert.equal(looked, 0, 'the stored name is kept without a lookup, so a renamed login cannot move the tie');

  r = await post({ op: 'save', id, githubLogin: 'pat' });
  assert.equal(inviteOf(kv, code).boundGithubId, '6660001');
  r = await post({ op: 'save', id, githubLogin: '' });
  assert.equal(r.status, 200);
  assert.equal(inviteOf(kv, code).boundGithubId, null, 'untied: first-come again');
  assert.equal(listingOf(kv, id).boundGithubId, null);
});

test('once the invitation is redeemed, the binding is locked (409) and nothing changes', async () => {
  const { kv, post, id, code } = await prepared({ githubLogin: 'sam-dev' });
  writeInvite(kv, { ...inviteOf(kv, code), redeemedAt: NOW.toISOString(), redeemedBy: '5551234' });
  const r = await post({ op: 'save', id, githubLogin: 'pat' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'binding_locked');
  assert.equal(inviteOf(kv, code).boundGithubId, '5551234');
  assert.equal(listingOf(kv, id).boundGithubId, '5551234');
});

test('the campaign is fixed once the invitation is out; a publishing or claimed listing cannot be edited', async () => {
  const { kv, post, id } = await prepared();
  let r = await post({ op: 'save', id, campaign: 'CREATORYEAR' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'campaign_locked');
  assert.equal((await post({ op: 'save', id, campaign: 'codeableyear', message: 'Same campaign, new words.' })).status, 200, 'the same campaign is fine');

  writeListing(kv, { ...listingOf(kv, id), claimPendingAt: NOW.toISOString(), claimPendingBy: '5551234' });
  r = await post({ op: 'save', id, message: 'Too late.' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'not_editable');
  assert.equal((await post({ op: 'save', id: 'NOTANID', message: 'x' })).status, 400);
  assert.equal((await post({ op: 'save', id: 'ABCDEFGHJKMNPQRS', message: 'x' })).status, 404);
});

test('an edit is validated like a create: a taken permalink or a missing image refuses and writes nothing', async () => {
  const { kv, post, id } = await prepared();
  const before = JSON.stringify([...kv.store.entries()].sort());
  let r = await post({ op: 'save', id, draft: { ...DRAFT(), slug: 'taken', frontmatter: { ...DRAFT().frontmatter, slug: 'taken' } } }, {
    readTree: async () => ({ content: [{ type: 'project', slug: 'taken', path: 'members/x/projects/taken/index.md' }], shares: [] }),
  });
  assert.equal(r.status, 409);
  r = await post({ op: 'save', id, draft: DRAFT({}, '![new](./images/new-shot.png)') });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'image_missing');
  assert.equal(JSON.stringify([...kv.store.entries()].sort()), before, 'nothing changed in the store');
});

// ---- revoke, send again, delete ------------------------------------------------------------------------------

test('revoke: the invitation and the listing are both revoked; again is a no-op; a publishing listing refuses', async () => {
  const { kv, post, id, code } = await prepared();
  let r = await post({ op: 'revoke', id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.listing.state, 'revoked');
  assert.equal(r.body.listing.inviteState, 'revoked');
  assert.equal(inviteState(inviteOf(kv, code), NOW), INVITE_STATE.revoked, 'the link can no longer grant a year');
  r = await post({ op: 'revoke', id });
  assert.equal(r.status, 200);
  assert.equal(r.body.changed, false);

  const other = await prepared();
  writeListing(other.kv, { ...listingOf(other.kv, other.id), claimPendingAt: NOW.toISOString(), claimPendingBy: '1' });
  r = await other.post({ op: 'revoke', id: other.id });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'not_revocable');
});

test('revoking a listing whose invite was already REDEEMED stops the claim and leaves the live year alone', async () => {
  const { kv, post, id, code } = await prepared();
  writeInvite(kv, { ...inviteOf(kv, code), redeemedAt: NOW.toISOString(), redeemedBy: '42' });
  const r = await post({ op: 'revoke', id });
  assert.equal(r.status, 200);
  assert.equal(listingOf(kv, id).revokedBy, ME);
  assert.equal(inviteState(inviteOf(kv, code), NOW), INVITE_STATE.redeemed);
});

test('send again: only after a revoke; a NEW code for the same listing, same binding, no expiry, the old code kept', async () => {
  const { kv, post, id, code } = await prepared({ githubLogin: 'sam-dev' });
  let r = await post({ op: 'resend', id });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'not_revoked');

  await post({ op: 'revoke', id });
  r = await post({ op: 'resend', id, campaign: 'creatoryear' }, { now: LATER });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const fresh = r.body.code;
  assert.notEqual(fresh, code);
  assert.equal(r.body.link, `https://gbti.network/claim/?code=${fresh}`);
  assert.equal(r.body.listing.state, 'prepared');

  const inv = inviteOf(kv, fresh);
  assert.equal(inv.listingId, id);
  assert.equal(inv.boundGithubId, '5551234', 'the tie carries over');
  assert.equal(inv.expiresAt, null);
  assert.equal(inv.campaign, 'CREATORYEAR');
  const rec = listingOf(kv, id);
  assert.equal(rec.code, fresh);
  assert.deepEqual(rec.priorCodes, [code]);
  assert.equal(rec.campaign, 'CREATORYEAR');
  assert.equal(inviteState(inviteOf(kv, code), LATER), INVITE_STATE.revoked, 'the old link stays dead');
});

test('send again revokes an old invite that is somehow still issued, and refuses a retired campaign', async () => {
  const { kv, post, id, code } = await prepared();
  writeListing(kv, { ...listingOf(kv, id), revokedAt: NOW.toISOString(), revokedBy: ME }); // the invite write "failed"
  assert.equal(inviteState(inviteOf(kv, code), NOW), INVITE_STATE.issued);
  assert.equal((await post({ op: 'resend', id, campaign: 'RETIRED' })).body.error, 'unknown_campaign');
  const r = await post({ op: 'resend', id });
  assert.equal(r.status, 200);
  assert.equal(inviteState(inviteOf(kv, code), NOW), INVITE_STATE.revoked, 'no old link can still grant a year');
});

test('delete: the listing and its images go, its invitations are revoked first; a publishing listing refuses', async () => {
  const { kv, post, id, code } = await prepared();
  const r = await post({ op: 'delete', id });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, deleted: true, id });
  assert.equal(kv.store.has(`invite-listing:${id}`), false);
  assert.deepEqual([...kv.store.keys()].filter((k) => k.startsWith('invite-listing-img:')), []);
  assert.equal(inviteState(inviteOf(kv, code), NOW), INVITE_STATE.revoked, 'an issued invite with no listing would still grant a year');
  assert.equal((await post({ op: 'delete', id })).status, 404);

  const other = await prepared();
  writeListing(other.kv, { ...listingOf(other.kv, other.id), claimPendingAt: NOW.toISOString(), claimPendingBy: '1', prNumber: 12 });
  const refused = await other.post({ op: 'delete', id: other.id });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'publishing');
  assert.ok(other.kv.store.has(`invite-listing:${other.id}`));
});

// ---- the manager's reads -------------------------------------------------------------------------------------

test('the list: summaries newest first, never the message or the body; a corrupt record is flagged, not dropped', async () => {
  const { kv, post, id } = await prepared();
  for (const n of ['icon.png', 'cover.webp', 'shot-1.png']) kv.store.set(draftImageKey(ME, 'project:second', n), JSON.stringify({ dataBase64: b64(40) }));
  const second = await post({ op: 'save', campaign: 'CODEABLEYEAR', recipientName: 'Pat', message: 'Hi Pat.', draft: { ...DRAFT(), slug: 'second', frontmatter: { ...DRAFT().frontmatter, slug: 'second' } } }, { now: LATER });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  kv.store.set('invite-listing:ZZZZZZZZZZZZZZZZ', '"junk"');
  const r = await membershipPreparedGet(getReq(), { SIGNUP_KV: kv }, { authorize: okAuth, now: LATER });
  assert.equal(r.status, 200);
  const rows = r.body.listings;
  assert.equal(rows.length, 3);
  assert.equal(rows[0].recipientName, 'Pat', 'newest first');
  assert.equal(rows[1].id, id);
  assert.ok(rows.find((x) => x.corrupt && x.key === 'ZZZZZZZZZZZZZZZZ'));
  const text = JSON.stringify(r.body);
  assert.doesNotMatch(text, /Hello Sam|Hi Pat|It watches the web/, 'no message and no body in the manager list');
});

test('the list finalizes up to FINALIZE_PER_LIST publishing rows through the hook, and a throwing hook leaves its row', async () => {
  const kv = seedKv();
  for (let i = 0; i < FINALIZE_PER_LIST + 2; i += 1) {
    const lid = `${'ABCDEFGHJKMNPQR'}${'23456789'[i]}`;
    writeListing(kv, { id: lid, type: 'project', slug: `p-${i}`, title: `T${i}`, code: `CODE${i}XYZ`, createdAt: NOW.toISOString(), claimPendingAt: NOW.toISOString(), claimPendingBy: '9', prNumber: 100 + i, images: [] });
  }
  const called = [];
  const finalize = async ({ listing }) => {
    called.push(listing.id);
    if (listing.prNumber === 100) throw new Error('github down');
    return { listing: { ...listing, claimPendingAt: null, claimPendingBy: null, claimedAt: NOW.toISOString(), claimedBy: '9' } };
  };
  const r = await membershipPreparedGet(getReq(), { SIGNUP_KV: kv }, { authorize: okAuth, now: NOW, finalize });
  assert.equal(called.length, FINALIZE_PER_LIST, 'bounded, so one slow GitHub cannot stall the manager');
  const states = r.body.listings.map((x) => x.state);
  assert.equal(states.filter((s) => s === 'claimed').length, FINALIZE_PER_LIST - 1);
  assert.equal(r.body.listings.find((x) => x.prNumber === 100).state, 'publishing', 'the throwing row is left as it was');
});

// TRAP (review F3): the manager used to finalize the first FINALIZE_PER_LIST publishing rows in KV KEY order, which
// is fixed and arbitrary (listing ids are random), so five claims stuck open took every load. It now takes the
// NEWEST claims, and the scheduled sweep rotates through the rest.
test('the list finalizes the NEWEST claims first, so rows stuck open at the head of the key order cannot take every load', async () => {
  const kv = seedKv();
  const total = FINALIZE_PER_LIST + 2;
  for (let i = 0; i < total; i += 1) {
    const lid = `${'ABCDEFGHJKMNPQR'}${'23456789'[i]}`;
    // Key order and age agree: the first keys are the oldest locks (the stuck ones), the last two the newest.
    const at = new Date(NOW.getTime() - (total - i) * 3600 * 1000).toISOString();
    writeListing(kv, { id: lid, type: 'project', slug: `p-${i}`, title: `T${i}`, code: `CODE${i}XYZ`, createdAt: at, claimPendingAt: at, claimPendingBy: '9', prNumber: 100 + i, images: [] });
  }
  const called = [];
  const finalize = async ({ listing }) => { called.push(listing.prNumber); return { listing }; };
  await membershipPreparedGet(getReq(), { SIGNUP_KV: kv }, { authorize: okAuth, now: NOW, finalize });
  assert.equal(called.length, FINALIZE_PER_LIST);
  assert.ok(called.includes(100 + total - 1) && called.includes(100 + total - 2), `the two newest claims are checked: ${called}`);
  assert.equal(called.includes(100), false, 'the oldest is left to the sweep');
});

test('one listing for Edit carries the message, the project and the link; an image is served by name', async () => {
  const { kv, id, code } = await prepared();
  const r = await membershipPreparedGet(getReq(`?id=${id}`), { SIGNUP_KV: kv }, { authorize: okAuth, now: NOW });
  assert.equal(r.status, 200);
  assert.equal(r.body.listing.message, 'Hello Sam.');
  assert.equal(r.body.listing.frontmatter.title, 'SurfacedBy');
  assert.equal(r.body.link, `https://gbti.network/claim/?code=${code}`);

  const img = await membershipPreparedGet(getReq(`?id=${id}&image=icon.png`), { SIGNUP_KV: kv }, { authorize: okAuth, now: NOW });
  assert.deepEqual(img.body, { ok: true, name: 'icon.png', dataBase64: b64(40), contentType: 'image/png' });
  assert.equal((await membershipPreparedGet(getReq(`?id=${id}&image=nope.png`), { SIGNUP_KV: kv }, { authorize: okAuth })).status, 404);
  assert.equal((await membershipPreparedGet(getReq(`?id=${id}&image=../x.png`), { SIGNUP_KV: kv }, { authorize: okAuth })).status, 400);
  assert.equal((await membershipPreparedGet(getReq('?id=bad'), { SIGNUP_KV: kv }, { authorize: okAuth })).status, 400);
  assert.equal((await membershipPreparedGet(getReq('?id=ABCDEFGHJKMNPQRS'), { SIGNUP_KV: kv }, { authorize: okAuth })).status, 404);
  assert.equal((await membershipPreparedGet(getReq(), { SIGNUP_KV: kv }, { authorize: noAuth })).status, 403);
});

// ---- the plain invite routes ---------------------------------------------------------------------------------

test('the plain invite list never reads a listing key and hides a prepared invitation from admins', async () => {
  const { kv, code } = await prepared();
  kv.store.set('invite:PLAIN234567', JSON.stringify({ code: 'PLAIN234567', campaign: 'CODEABLEYEAR', issuedAt: NOW.toISOString() }));
  kv.gets.length = 0;
  const r = await membershipInviteList(new Request('https://x/y'), { SIGNUP_KV: kv }, { authorize: okAuth, now: NOW });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.invites.map((i) => i.code), ['PLAIN234567']);
  assert.equal(r.body.invites.some((i) => i.code === code), false);
  assert.equal(kv.gets.some((k) => k.startsWith('invite-listing')), false, 'invite-listing: is never swept as an invite');
});

test('the plain PATCH refuses a prepared invitation with 409, for revoke and for the note alike', async () => {
  const { kv, code } = await prepared();
  const before = kv.store.get(inviteKey(code));
  for (const action of ['revoke', 'note']) {
    const r = await membershipInviteUpdate(
      new Request('https://x/y', { method: 'PATCH', body: JSON.stringify({ code, action, note: 'x' }) }),
      { SIGNUP_KV: kv }, { authorize: okAuth, now: NOW },
    );
    assert.equal(r.status, 409, action);
    assert.equal(r.body.error, 'prepared_invite');
  }
  assert.equal(kv.store.get(inviteKey(code)), before, 'the invite is untouched');
});

test('mintUniqueInvite is the one minting loop: it skips issued codes and campaign codes, and reports failure', async () => {
  const kv = fakeKv({ 'coupons:config': COUPONS });
  const same = (n) => new Uint8Array(n); // always the same code
  const first = await mintUniqueInvite(kv, 'CODEABLEYEAR', same, { now: NOW });
  assert.equal(first.ok, true);
  kv.store.set(inviteKey(first.code), JSON.stringify({ code: first.code }));
  assert.deepEqual(await mintUniqueInvite(kv, 'CODEABLEYEAR', same, { now: NOW }), { ok: false, status: 503, error: 'mint_failed', message: 'could not mint a unique code; try again' });
  assert.equal((await mintUniqueInvite(kv, '!!!', same, { now: NOW })).error, 'unmintable');
});

// ---- a claim that lands while a superadmin op is in flight (review F1) -------------------------------------------
// Every op reads the listing, waits (on GitHub for a save), then writes. A REAL claim (membershipClaimPost over the
// claim fixtures, opening pull request #77) is run inside each wait. The op must refuse and leave the claim's lock
// exactly as the claim wrote it: an erased lock is a pull request nothing finalizes, an invitation that can grant a
// year again, and room for a second claim to open a second pull request for the same permalink.

const raceAuth = async () => ({ ok: true, githubId: F.PREPARER, role: 'superadmin', mirror: {} });
const claimNow = (kv) => membershipClaimPost(F.postReq({ code: F.CODE, note: 'My words.' }), F.env(), F.claimDeps({ kv, fetchImpl: F.ghFake([]) }));
function raceOp(kv, body, over = {}) {
  return membershipPreparedPost(req(body), { SIGNUP_KV: kv }, {
    authorize: raceAuth, now: F.NOW, getToken: async () => 'tok', siteBase: 'https://gbti.network',
    readTree: async () => ({ content: [], shares: [] }), loadHouse: async () => ({ ok: true, parsed: F.TAXONOMY }),
    lookupUser: async () => ({ ok: true, githubId: '9990001', login: 'someone-else', name: null }), ...over,
  });
}
/** Run the claim once, the first time a write to a key matching `match` is about to land. */
function claimOnFirstPut(kv, match) {
  const put = kv.put.bind(kv);
  const fired = { claim: null };
  kv.put = async (key, value) => {
    if (!fired.claim && match(key)) fired.claim = await claimNow(kv);
    return put(key, value);
  };
  return fired;
}
function assertClaimHeld(kv, { invite = true } = {}) {
  const l = kv.json(listingKey(F.LISTING_ID));
  assert.ok(l, 'the listing still exists');
  assert.equal(listingState(l), LISTING_STATE.publishing);
  assert.equal(l.claimPendingBy, F.CLAIMANT);
  assert.equal(l.prNumber, 77, 'the pull request number is still recorded, so the sweep can finalize it');
  assert.equal(l.message, 'We built this page for you.\nClaim it any time.', 'what is committed is what is stored');
  if (!invite) return;
  const i = kv.json(inviteKey(F.CODE));
  assert.equal(inviteState(i, F.NOW), INVITE_STATE.claim_pending, 'the link cannot grant a year while the pull request is open');
  assert.equal(i.claimPendingBy, F.CLAIMANT);
  assert.equal(i.boundGithubId, null, 'the tie did not move under the claim');
}

test('race: a claim taken while an edit waits on the GitHub login lookup survives, and the edit refuses', async () => {
  const { kv } = F.seed();
  let claim = null;
  const r = await raceOp(kv, { op: 'save', id: F.LISTING_ID, message: 'An updated message.', githubLogin: 'someone-else' }, {
    lookupUser: async () => { claim = await claimNow(kv); return { ok: true, githubId: '9990001', login: 'someone-else', name: null }; },
  });
  assert.equal(claim.status, 200);
  assert.equal(claim.body.state, 'publishing');
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'not_editable');
  assertClaimHeld(kv);
});

test('race: a claim taken while an edit of the project waits on the uncached permalink check survives, images untouched', async () => {
  // The edit also stages a replacement icon. Refusing at the first re-read means NOTHING is written: the claim
  // commits the stored bytes, and replacing them under it would publish an image the record never named.
  const stagedKey = draftImageKey(F.PREPARER, 'project:surfacedby', 'icon.png');
  const { kv } = F.seed({ extra: { [stagedKey]: JSON.stringify({ dataBase64: Buffer.alloc(30, 9).toString('base64') }) } });
  const storedIcon = kv.store.get(listingImageKey(F.LISTING_ID, 'icon.png'));
  let claim = null;
  const r = await raceOp(kv, { op: 'save', id: F.LISTING_ID, message: 'An updated message.', draft: F.DRAFT({ title: 'Renamed' }) }, {
    readTree: async () => { claim = await claimNow(kv); return { content: [], shares: [] }; },
  });
  assert.equal(claim.body.state, 'publishing');
  assert.equal(r.status, 409);
  assertClaimHeld(kv);
  assert.equal(kv.json(listingKey(F.LISTING_ID)).frontmatter.title, 'SurfacedBy');
  assert.equal(kv.store.get(listingImageKey(F.LISTING_ID, 'icon.png')), storedIcon, 'the stored image was not replaced');
  assert.ok(kv.store.has(stagedKey));
});

test('race: an edit refuses while the INVITATION is held by a claim, even when the listing reads as prepared', async () => {
  // A release clears the listing and the invite in two writes, so for a moment the two can disagree. Moving the tie
  // then would move it on the listing only (setInviteBinding leaves a claim-pending invite alone).
  const { kv } = F.seed({ inviteOver: { claimPendingAt: F.NOW.toISOString(), claimPendingBy: F.CLAIMANT, claimPr: 77 } });
  const r = await raceOp(kv, { op: 'save', id: F.LISTING_ID, githubLogin: 'someone-else' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'not_editable');
  assert.equal(kv.json(listingKey(F.LISTING_ID)).boundGithubId, null);
});

test('race: a claim taken while an edit writes its images (after the first re-read) still survives', async () => {
  // The edit stages a replacement icon, so it writes an image AFTER its first re-read; the claim lands right then.
  // Only the re-read just before the listing write can see it.
  const stagedKey = draftImageKey(F.PREPARER, 'project:surfacedby', 'icon.png');
  const { kv } = F.seed({ extra: { [stagedKey]: JSON.stringify({ dataBase64: Buffer.alloc(30, 9).toString('base64') }) } });
  const fired = claimOnFirstPut(kv, (k) => k === listingImageKey(F.LISTING_ID, 'icon.png'));
  const r = await raceOp(kv, { op: 'save', id: F.LISTING_ID, message: 'An updated message.', draft: F.DRAFT() });
  assert.equal(fired.claim?.body?.state, 'publishing', 'the claim ran inside the image write');
  assert.equal(r.status, 409);
  assertClaimHeld(kv);
  assert.ok(kv.store.has(stagedKey), 'a refused save keeps the staged copy, so the retry finds it');
});

test('a failed listing write puts the tie back on a FRESH read of the invitation, so nothing that landed since is erased', async () => {
  // The tie moved on the invite, then the listing write failed. Writing back the copy read before the edit would
  // also wipe whatever reached the invite in between; here the newly tied account redeemed its year meanwhile.
  let kvRef = null;
  const { kv } = F.seed({ kvOpts: { failPut: (k) => {
    if (k !== listingKey(F.LISTING_ID)) return false;
    const inv = JSON.parse(kvRef.store.get(inviteKey(F.CODE)));
    kvRef.store.set(inviteKey(F.CODE), JSON.stringify({ ...inv, redeemedBy: '9990001', redeemedByLogin: 'someone-else', redeemedAt: F.NOW.toISOString() }));
    return true;
  } } });
  kvRef = kv;
  const r = await raceOp(kv, { op: 'save', id: F.LISTING_ID, githubLogin: 'someone-else' });
  assert.equal(r.status, 503);
  const inv = kv.json(inviteKey(F.CODE));
  assert.equal(inv.redeemedBy, '9990001', 'the redemption that landed meanwhile is kept, so the year cannot be granted twice');
  assert.equal(inviteState(inv, F.NOW), INVITE_STATE.redeemed);
  assert.equal(kv.json(listingKey(F.LISTING_ID)).boundGithubId, null, 'the listing kept its old tie');

  // And with nothing landing in between, the old tie is simply restored.
  const plain = F.seed({ kvOpts: { failPut: (k) => k === listingKey(F.LISTING_ID) } });
  const r2 = await raceOp(plain.kv, { op: 'save', id: F.LISTING_ID, githubLogin: 'someone-else' });
  assert.equal(r2.status, 503);
  assert.equal(plain.kv.json(inviteKey(F.CODE)).boundGithubId, null, 'the invitation is tied as the listing is');
  assert.equal(inviteState(plain.kv.json(inviteKey(F.CODE)), F.NOW), INVITE_STATE.issued);
});

test('race: a save by someone else in the meantime is refused as listing_changed, and their save stands', async () => {
  const { kv } = F.seed();
  const r = await raceOp(kv, { op: 'save', id: F.LISTING_ID, message: 'Mine.', githubLogin: 'someone-else' }, {
    lookupUser: async () => {
      const cur = kv.json(listingKey(F.LISTING_ID));
      kv.store.set(listingKey(F.LISTING_ID), JSON.stringify({ ...cur, message: 'Theirs.', updatedAt: F.NOW.toISOString() }));
      return { ok: true, githubId: '9990001', login: 'someone-else', name: null };
    },
  });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'listing_changed');
  assert.equal(kv.json(listingKey(F.LISTING_ID)).message, 'Theirs.');
  assert.equal(kv.json(inviteKey(F.CODE)).boundGithubId, null, 'nothing of the refused save was written');
});

test('race: a claim taken while a delete revokes the invitation keeps its listing and images', async () => {
  const { kv } = F.seed();
  const fired = claimOnFirstPut(kv, (k) => k === inviteKey(F.CODE));
  const r = await raceOp(kv, { op: 'delete', id: F.LISTING_ID });
  assert.equal(fired.claim?.body?.state, 'publishing');
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'publishing');
  assertClaimHeld(kv, { invite: false }); // the invite write raced the claim's own: the one-round-trip residual
  assert.ok(kv.store.has(listingImageKey(F.LISTING_ID, 'icon.png')), 'the images the claim committed are kept');
});

test('race: a delete finding the invitation already held by a claim refuses before it writes anything', async () => {
  const { kv } = F.seed();
  assert.equal((await claimNow(kv)).body.state, 'publishing');
  // The listing read the delete starts from predates the claim; the invite it then reads does not.
  const get = kv.get.bind(kv);
  let first = true;
  kv.get = async (key, type) => {
    if (first && key === listingKey(F.LISTING_ID)) {
      first = false;
      const cur = JSON.parse(kv.store.get(key));
      return { ...cur, claimPendingAt: null, claimPendingBy: null, prNumber: null };
    }
    return get(key, type);
  };
  const r = await raceOp(kv, { op: 'delete', id: F.LISTING_ID });
  assert.equal(r.status, 409);
  kv.get = get;
  assertClaimHeld(kv);
});

test('race: a claim taken while a revoke writes the invitation keeps its lock; a claimed listing can still be deleted', async () => {
  const { kv } = F.seed();
  const fired = claimOnFirstPut(kv, (k) => k === inviteKey(F.CODE));
  const r = await raceOp(kv, { op: 'revoke', id: F.LISTING_ID });
  assert.equal(fired.claim?.body?.state, 'publishing');
  assert.equal(r.status, 409);
  assertClaimHeld(kv, { invite: false });

  const done = F.seed({
    listingOver: { claimedAt: F.NOW.toISOString(), claimedBy: F.CLAIMANT, frontmatter: null, body: null, message: null, images: [] },
    inviteOver: { claimedAt: F.NOW.toISOString(), claimedBy: F.CLAIMANT },
  });
  const del = await raceOp(done.kv, { op: 'delete', id: F.LISTING_ID });
  assert.equal(del.status, 200, 'the manager offers Delete on a claimed row: the record is all that is left');
  assert.equal(done.kv.store.has(listingKey(F.LISTING_ID)), false);
});

// ---- the Worker's route lines --------------------------------------------------------------------------------

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
// A route's own block (routeBlock): a fixed-length window read into the next route, whose `credentials: true`
// then satisfied this route's assertion after the 900-line split (2026-09-30).
const block = routeBlock;

test('the admin route: both verbs, the cookie session with credentialed CORS, and never cached', () => {
  const idx = workerSource();
  const b = block(idx, "pathname === '/membership/admin/prepared'");
  assert.ok(b.length > 100, 'the route exists');
  // sow-427 C2 (builder 3): the GET passes the claim module's finalize hook, so the manager finalizes publishing rows.
  assert.match(b, /membershipPreparedGet\(request, env, \{ allowCookie: true, finalize: preparedFinalizeHook\(env, ctx\) \}\)/);
  assert.match(b, /membershipPreparedPost\(request, env, \{ allowCookie: true \}\)/);
  assert.match(b, /credentials: true/);
  assert.ok(usesCredentialedCors(b, 2), 'the preflight and both replies use the credentialed CORS, never the wildcard');
  assert.equal((b.match(/'Cache-Control': 'no-store'/g) || []).length, 2, 'no-store on both verbs');
  const src = read('workers/signup/membership-prepared-admin.mjs');
  assert.match(src, /authorize = authorizeSuperadmin/);
  assert.doesNotMatch(src, /authorizeAdmin|authorizeStaff|authorizeMember/, 'nothing below superadmin reaches these handlers');
});

test('the public read routes: wildcard CORS with no credentials, no-store and Vary on the bearer', () => {
  const idx = workerSource();
  const b = block(idx, "pathname === '/invite/listing'");
  assert.match(b, /pathname === '\/invite\/listing-image'/);
  assert.match(b, /inviteListingRead\(request, env\)/);
  assert.match(b, /inviteListingImage\(request, env\)/);
  assert.match(b, /\{ \.\.\.MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' \}/);
  assert.doesNotMatch(b, /credentials: true/, 'a signed-out read must not ride a cookie');
});
