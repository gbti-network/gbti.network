// SOW-016: the server-side member-content endpoints. The AES-256-GCM key NEVER leaves the Worker; decrypt
// returns plaintext, encrypt returns ciphertext, both ONLY to an effective-paid caller with ban > staff >
// grandfather > Stripe applied server-side from the KV overrides mirror. Verifies every fail-closed path plus
// the decrypt/encrypt round-trip. Injected fetchUser + Stripe + KV: no network, no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { membershipDecrypt, membershipEncrypt, authorizePaid, OVERRIDES_KV_KEY, MAX_OVERRIDES_AGE_MS } from '../workers/signup/membership-content.mjs';
import { encryptAsset, generateEpochKey } from '../client/src/crypto-assets.mjs';

const KEY = generateEpochKey();
const ENC = (body, headers = {}) => new Request('https://signup.gbti.network/membership/decrypt', { method: 'POST', headers, body: body == null ? undefined : JSON.stringify(body) });
const POST = (path, auth, body) => new Request('https://signup.gbti.network/membership/' + path, { method: 'POST', headers: auth ? { Authorization: auth } : {}, body: body == null ? undefined : JSON.stringify(body) });

const freshMirror = (over = {}) => ({ generatedAt: new Date().toISOString(), roles: over.roles ?? {}, bans: over.bans ?? { bans: [] }, grandfathered: over.grandfathered ?? { grandfathered: [] } });
const kvWith = (mirror) => ({ get: async (k) => (k === OVERRIDES_KV_KEY ? mirror : null) });
const ENV = (over = {}, mirror = freshMirror()) => ({ STRIPE_SECRET_KEY: 'rk_test', MEMBER_CONTENT_KEY: KEY, MEMBER_CONTENT_KID: '1', SIGNUP_KV: kvWith(mirror), ...over });
const paid = { id: 'c', metadata: { github_id: '1' }, subscriptions: { data: [{ status: 'active', created: 1 }] } };
const stripeFor = (byId) => () => ({ findCustomerByGithubId: async (id) => byId(id) });
const userIs = (githubId) => async () => ({ githubId, githubLogin: 'u' + githubId });
const deps = (githubId, customerById) => ({ fetchUser: userIs(githubId), makeStripe: stripeFor(customerById) });

test('decrypt: requires a bearer token', async () => {
  assert.equal((await membershipDecrypt(POST('decrypt', null, { ct: 'x' }), ENV())).status, 401);
});

test('decrypt: 403 for a non-paid member (fail closed)', async () => {
  const r = await membershipDecrypt(POST('decrypt', 'Bearer g', { v: 1, kid: '1', iv: 'a', aad: 'a', ct: 'x' }), ENV(), deps('9', () => null));
  assert.equal(r.status, 403);
});

test('decrypt: 403 for a banned member even with a paid Stripe sub', async () => {
  const mirror = freshMirror({ bans: { bans: [{ github_id: '1' }] } });
  const r = await membershipDecrypt(POST('decrypt', 'Bearer g', { v: 1, kid: '1', iv: 'a', aad: 'a', ct: 'x' }), ENV({}, mirror), deps('1', () => paid));
  assert.equal(r.status, 403);
  assert.match(r.body.message, /not permitted/);
});

test('decrypt: 403 (fail closed) when the overrides mirror is missing or stale', async () => {
  const env1 = ENV({}, null);
  assert.equal((await membershipDecrypt(POST('decrypt', 'Bearer g', { v: 1, kid: '1', iv: 'a', aad: 'a', ct: 'x' }), env1, deps('1', () => paid))).status, 403);
  const stale = freshMirror(); stale.generatedAt = new Date(Date.now() - MAX_OVERRIDES_AGE_MS - 1000).toISOString();
  assert.equal((await membershipDecrypt(POST('decrypt', 'Bearer g', { v: 1, kid: '1', iv: 'a', aad: 'a', ct: 'x' }), ENV({}, stale), deps('1', () => paid))).status, 403);
});

test('decrypt: 400 on a malformed (non-envelope) body for a paid member', async () => {
  const r = await membershipDecrypt(POST('decrypt', 'Bearer g', { not: 'an envelope' }), ENV(), deps('1', () => paid));
  assert.equal(r.status, 400);
});

test('decrypt: a paid member gets the plaintext (round-trip with a real envelope)', async () => {
  const envelope = await encryptAsset({ plaintext: 'members-only instructions', key: KEY, assetId: 'post:x:body', kid: '1' });
  const r = await membershipDecrypt(POST('decrypt', 'Bearer g', envelope), ENV(), deps('1', () => paid));
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.text, 'members-only instructions');
});

test('decrypt: a tampered ciphertext is 422 (undecryptable), never a partial read', async () => {
  const envelope = await encryptAsset({ plaintext: 'secret', key: KEY, assetId: 'a', kid: '1' });
  envelope.ct = envelope.ct.slice(0, -4) + 'AAAA'; // corrupt the tail
  const r = await membershipDecrypt(POST('decrypt', 'Bearer g', envelope), ENV(), deps('1', () => paid));
  assert.equal(r.status, 422);
});

test('decrypt: a wrong-epoch envelope (no key for that kid) is a 500 misconfig, not a leak', async () => {
  const envelope = await encryptAsset({ plaintext: 'x', key: KEY, assetId: 'a', kid: '99' });
  const r = await membershipDecrypt(POST('decrypt', 'Bearer g', envelope), ENV(), deps('1', () => paid));
  assert.equal(r.status, 500);
});

test('encrypt: a paid author gets an envelope that the same epoch decrypts; the key is never returned', async () => {
  const r = await membershipEncrypt(POST('encrypt', 'Bearer g', { plaintext: 'new perk', assetId: 'post:y:body' }), ENV(), deps('1', () => paid));
  assert.equal(r.status, 200);
  assert.equal(r.body.envelope.kid, '1');
  assert.equal(r.body.envelope.aad, 'post:y:body');
  assert.equal(r.body.key, undefined, 'the response must NOT contain the key');
  // round-trip the produced envelope back through decrypt
  const back = await membershipDecrypt(POST('decrypt', 'Bearer g', r.body.envelope), ENV(), deps('1', () => paid));
  assert.equal(back.body.text, 'new perk');
});

test('encrypt: a non-paid author cannot encrypt (403)', async () => {
  const r = await membershipEncrypt(POST('encrypt', 'Bearer g', { plaintext: 'x', assetId: 'a' }), ENV(), deps('9', () => null));
  assert.equal(r.status, 403);
});

test('encrypt: 400 when plaintext or assetId is missing', async () => {
  assert.equal((await membershipEncrypt(POST('encrypt', 'Bearer g', { assetId: 'a' }), ENV(), deps('1', () => paid))).status, 400);
  assert.equal((await membershipEncrypt(POST('encrypt', 'Bearer g', { plaintext: 'x' }), ENV(), deps('1', () => paid))).status, 400);
});

// SOW-018: a Share asset (AAD `share:...`) grants LIMITED TRIAL ACCESS — an active trial may READ it, but a
// non-Share members-only asset stays paid-only, and posting (encrypt) stays paid-only.
const trialing = { id: 'c', metadata: { github_id: '1', trial_started_at: new Date().toISOString() }, subscriptions: { data: [] } };

test('decrypt: an active TRIAL member can read a Share asset (aad share:...)', async () => {
  const envelope = await encryptAsset({ plaintext: 'a quick find', key: KEY, assetId: 'share:20260610-x:body', kid: '1' });
  const r = await membershipDecrypt(POST('decrypt', 'Bearer g', envelope), ENV(), deps('1', () => trialing));
  assert.equal(r.status, 200);
  assert.equal(r.body.text, 'a quick find');
});

test('decrypt: a TRIAL member CANNOT read a non-Share members-only asset (post stays paid-only)', async () => {
  const envelope = await encryptAsset({ plaintext: 'paid perk', key: KEY, assetId: 'post:x:body', kid: '1' });
  const r = await membershipDecrypt(POST('decrypt', 'Bearer g', envelope), ENV(), deps('1', () => trialing));
  assert.equal(r.status, 403);
});

// SOW-044: a member comment encrypts under AAD `comment:<id>:body`, which is NOT a `share:` asset, so a comment
// stays PAID-ONLY to read. This pins the owner decision that limited-access trial members cannot read member
// comments (they read the Share body but not its members-only replies), and guards the carve-out from drift.
test('decrypt: a TRIAL member CANNOT read a member COMMENT (aad comment:... stays paid-only)', async () => {
  const envelope = await encryptAsset({ plaintext: 'a members reply', key: KEY, assetId: 'comment:20260610120000-x:body', kid: '1' });
  const r = await membershipDecrypt(POST('decrypt', 'Bearer g', envelope), ENV(), deps('1', () => trialing));
  assert.equal(r.status, 403);
});

test('decrypt: a PAID member CAN read a member COMMENT (any effective-paid caller, not the author only)', async () => {
  const envelope = await encryptAsset({ plaintext: 'a members reply', key: KEY, assetId: 'comment:20260610120000-x:body', kid: '1' });
  const r = await membershipDecrypt(POST('decrypt', 'Bearer g', envelope), ENV(), deps('1', () => paid));
  assert.equal(r.status, 200);
  assert.equal(r.body.text, 'a members reply');
});

test('decrypt: an EXPIRED/none account cannot read a Share (the extension shows its lock splash)', async () => {
  const envelope = await encryptAsset({ plaintext: 'a quick find', key: KEY, assetId: 'share:20260610-x:body', kid: '1' });
  const r = await membershipDecrypt(POST('decrypt', 'Bearer g', envelope), ENV(), deps('9', () => null));
  assert.equal(r.status, 403);
});

test('decrypt: a paid member can still read a Share asset', async () => {
  const envelope = await encryptAsset({ plaintext: 'a quick find', key: KEY, assetId: 'share:20260610-x:body', kid: '1' });
  const r = await membershipDecrypt(POST('decrypt', 'Bearer g', envelope), ENV(), deps('1', () => paid));
  assert.equal(r.status, 200);
});

test('authorizePaid: a grandfathered member with no Stripe sub is authorized (source grandfather)', async () => {
  const mirror = freshMirror({ grandfathered: { grandfathered: [{ github_id: '3' }] } });
  const r = await authorizePaid(POST('decrypt', 'Bearer g'), ENV({}, mirror), deps('3', () => null));
  assert.equal(r.ok, true);
  assert.equal(r.source, 'grandfather');
});
