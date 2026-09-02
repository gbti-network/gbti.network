// sow-213 phase 2a: an admin-issued grandfather grant must be able to name the paid tier it confers, and a
// re-grant must not silently destroy a hand-set one.
//
// Two live defects motivated this file, both in membership/superadmin-actions.mjs grandfather():
//   1. The writer had no `tier` parameter at all, so every admin-issued grant was minted TIERLESS.
//      tier-gate.grantTier resolves a tierless grant to `member` (owner Q15, 2026-08-18), so the recipient is
//      rejected `rejected-not-creator` on their first content PR. The documented escape hatch, an explicit
//      `tier: creator`, was the one field the admin path could not write.
//   2. The writer rebuilt the entry from scratch on a re-grant, so ANY field the caller did not supply was
//      overwritten with a default. A re-grant therefore wiped a hand-set `tier: creator` back to tierless
//      (undoing the escape hatch), reset a hand-set `reason`, and turned a time-boxed `until` into a
//      permanent grant. Losing an expiry grants MORE access than intended, which is the unsafe direction.
//
// The rule this file pins: the writer OVERLAYS only what the caller actually supplied. `undefined` means
// "leave the existing value alone"; an explicit value (including null) means "set it to this".
//
// Owner decision 2026-08-27: the admin picks the tier, and an absent tier defaults to member.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grandfather, SuperadminActionError } from '../membership/superadmin-actions.mjs';
import { grantTier } from '../membership/tier-gate.mjs';
import { TIER } from '../membership/tiers.mjs';
import { membershipAdminAuthor } from '../workers/signup/membership-admin-author.mjs';

const NOW = new Date('2026-08-27T00:00:00.000Z');
const ctx = { actor: { githubId: '1', login: 'root' }, now: NOW };

// A grant that a superadmin set by hand to creator, which is the escape hatch tier-gate.mjs documents.
const HAND_SET_CREATOR = {
  grandfathered: [{ github_id: '77', login: 'ada', reason: 'founding co-op member', until: '2027-01-01', at: '2026-01-01T00:00:00.000Z', tier: 'creator' }],
};

// ---- the pure core ----

test('sow-213: an explicit tier is written into the grant entry', () => {
  const g = grandfather({ grandfathered: [] }, { githubId: '77', login: 'ada', tier: 'creator' }, ctx);
  assert.equal(g.changed, true);
  assert.equal(g.next.grandfathered[0].tier, 'creator');
  assert.equal(grantTier(g.next.grandfathered[0]), TIER.creator, 'the written entry resolves through grantTier to creator');
});

test('sow-213: an explicit tier of member is written too, so the grant is self-describing', () => {
  const g = grandfather({ grandfathered: [] }, { githubId: '77', tier: 'member' }, ctx);
  assert.equal(g.next.grandfathered[0].tier, 'member');
  assert.equal(grantTier(g.next.grandfathered[0]), TIER.member);
});

test('sow-213: an unrecognized tier is REJECTED, never coerced to the default', () => {
  assert.throws(() => grandfather({ grandfathered: [] }, { githubId: '77', tier: 'creatorr' }, ctx), SuperadminActionError);
  assert.throws(() => grandfather({ grandfathered: [] }, { githubId: '77', tier: 'admin' }, ctx), SuperadminActionError);
  assert.throws(() => grandfather({ grandfathered: [] }, { githubId: '77', tier: 7 }, ctx), SuperadminActionError);
});

test('sow-213: tier none is REJECTED; a grant is a PAID comp and none means no grant at all', () => {
  assert.throws(() => grandfather({ grandfathered: [] }, { githubId: '77', tier: 'none' }, ctx), SuperadminActionError);
});

test('sow-213 CONTROL: a new grant with no tier omits the field, and still resolves to member', () => {
  const g = grandfather({ grandfathered: [] }, { githubId: '77', login: 'ada' }, ctx);
  assert.equal('tier' in g.next.grandfathered[0], false, 'no tier supplied means no tier field, as before');
  assert.equal(grantTier(g.next.grandfathered[0]), TIER.member, 'a tierless grant is member, per owner Q15');
});

test('sow-213: a re-grant that supplies no tier PRESERVES a hand-set creator tier', () => {
  const g = grandfather(HAND_SET_CREATOR, { githubId: '77', login: 'ada' }, ctx);
  assert.equal(g.next.grandfathered[0].tier, 'creator', 'the escape hatch survives a re-grant');
  assert.equal(grantTier(g.next.grandfathered[0]), TIER.creator);
});

test('sow-213: a re-grant that supplies no reason or until PRESERVES both', () => {
  const g = grandfather(HAND_SET_CREATOR, { githubId: '77', login: 'ada' }, ctx);
  assert.equal(g.next.grandfathered[0].reason, 'founding co-op member', 'a hand-set reason is not reset to the default');
  assert.equal(g.next.grandfathered[0].until, '2027-01-01', 'a time-boxed grant does not silently become permanent');
  assert.equal(g.next.grandfathered[0].at, '2026-01-01T00:00:00.000Z', 'the original grant time is still preserved');
});

test('sow-213: a re-grant that changes nothing is idempotent, so no PR is opened', () => {
  const g = grandfather(HAND_SET_CREATOR, { githubId: '77', login: 'ada' }, ctx);
  assert.equal(g.changed, false);
});

test('sow-213: an explicit tier change is a real change', () => {
  const g = grandfather(HAND_SET_CREATOR, { githubId: '77', login: 'ada', tier: 'member' }, ctx);
  assert.equal(g.changed, true);
  assert.equal(g.next.grandfathered[0].tier, 'member');
});

test('sow-213: an explicit null until makes a time-boxed grant permanent, since null is a supplied value', () => {
  const g = grandfather(HAND_SET_CREATOR, { githubId: '77', login: 'ada', until: null }, ctx);
  assert.equal(g.next.grandfathered[0].until, null);
  assert.equal(g.changed, true);
});

test('sow-213: the audit entry records the tier that was granted', () => {
  const g = grandfather({ grandfathered: [] }, { githubId: '77', tier: 'creator' }, ctx);
  assert.equal(g.audit.detail.tier, 'creator');
});

// ---- the Worker endpoint, which is the path the admin UI actually takes ----

const env = {
  GITHUB_APP_ID: '123', GITHUB_APP_INSTALLATION_ID: '999', GITHUB_APP_PRIVATE_KEY: 'PEM',
  UPSTREAM_REPO: 'gbti-network/gbti.network', MEMBERSHIP_AUTHOR_ENABLED: 'true',
};
// sow-213 Step 3: grandfather is KV-native now (house/grandfathered.yml is deleted), so the endpoint reads +
// writes the overrides mirror. This kv seeds it and records the put; a test asserts the grant in the mirror.
const OVERRIDES_KEY = 'overrides:mirror';
const mirrorSeed = (grandfathered = []) => ({ generatedAt: '2026-08-29T00:00:00.000Z', roles: {}, bans: { bans: [] }, grandfathered: { grandfathered } });
function kvWith(grandfathered = []) {
  const store = new Map();
  store.set(OVERRIDES_KEY, JSON.stringify(mirrorSeed(grandfathered)));
  return {
    store,
    async get(k, type) { const raw = store.get(k); if (raw === undefined) return null; return type === 'json' ? JSON.parse(raw) : raw; },
    async put(k, v) { store.set(k, v); },
  };
}
const writtenGrants = (kv) => JSON.parse(kv.store.get(OVERRIDES_KEY)).grandfathered.grandfathered;
const fakeKv = () => ({ async get() { return null; }, async put() {} });
const allow = async () => ({ allowed: true });
const staffAdmin = async () => ({ ok: true, githubId: '2', role: 'admin' });
const req = (body) => ({ headers: { get: () => 'Bearer tok' }, json: async () => body });
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const deB64 = (s) => Buffer.from(String(s), 'base64').toString('utf8');

function ghFetch(record, govFile, reads = []) {
  return async (url, init = {}) => {
    const method = init.method || 'GET';
    if (/\/access_tokens$/.test(url)) return { ok: true, status: 201, async json() { return { token: 'ghs_inst', expires_at: new Date(Date.now() + 3600e3).toISOString() }; } };
    if (/\/contents\/house\/grandfathered\.yml\?ref=main$/.test(url) && method === 'GET') { reads.push(url); return { ok: true, status: 200, async json() { return { content: b64(govFile) }; } }; }
    if (/\/git\/ref\/heads\/main$/.test(url)) return { ok: true, status: 200, async json() { return { object: { sha: 'mainsha' } }; } };
    if (/\/git\/refs$/.test(url) && method === 'POST') { record.push({ method, url, body: JSON.parse(init.body) }); return { ok: true, status: 201, async json() { return {}; } }; }
    if (/\/git\/refs\/heads\//.test(url) && method === 'PATCH') { record.push({ method, url }); return { ok: true, status: 200, async json() { return {}; } }; }
    if (/\/contents\/.+\?ref=/.test(url) && method === 'GET') return { ok: true, status: 200, async json() { return { sha: 'oldsha' }; } };
    if (/\/contents\//.test(url) && method === 'PUT') { record.push({ method, url, body: JSON.parse(init.body) }); return { ok: true, status: 201, async json() { return {}; } }; }
    if (/\/pulls$/.test(url) && method === 'POST') { record.push({ method, url, body: JSON.parse(init.body) }); return { ok: true, status: 201, async json() { return { number: 42, html_url: 'https://x/pull/42' }; } }; }
    return { ok: false, status: 500, async json() { return {}; } };
  };
}
const run = (body, fetchImpl, kv = fakeKv()) =>
  membershipAdminAuthor(req(body), env, { fetchImpl, authorize: staffAdmin, kv, limiter: allow, signJwt: async () => 'fake.jwt.sig' });

test('sow-213 Step 3 endpoint: a tier in the payload reaches the MIRROR grant that is written (KV-native, no PR)', async () => {
  const record = [];
  const kv = kvWith();
  const r = await run({ action: 'grandfather', githubId: '77', tier: 'creator' }, ghFetch(record, 'grandfathered: []\n'), kv);
  assert.equal(r.status, 200);
  assert.equal(r.body.kvWritten, true);
  assert.ok(!record.some((c) => /\/pulls$/.test(c.url)), 'no PR');
  assert.equal(writtenGrants(kv).find((e) => e.github_id === '77').tier, 'creator', 'the admin-chosen tier is committed, not dropped');
});

test('sow-213 endpoint: an invalid tier is 400, rejected BEFORE the governance file is read', async () => {
  const record = []; const reads = [];
  const r = await run({ action: 'grandfather', githubId: '77', tier: 'wizard' }, ghFetch(record, 'grandfathered: []\n', reads));
  assert.equal(r.status, 400);
  assert.equal(record.length, 0, 'rejected before any branch, write or PR');
  // This is the assertion that makes the ENDPOINT check load-bearing. The pure core also rejects a bad tier,
  // but only after the file is fetched, so a status-only assertion passes with the endpoint check deleted.
  assert.equal(reads.length, 0, 'the endpoint rejects on its own, without spending a GitHub read');
});

test('sow-213 Step 3 endpoint: an until in the payload reaches the MIRROR grant', async () => {
  const record = [];
  const kv = kvWith();
  const r = await run({ action: 'grandfather', githubId: '77', until: '2027-01-01' }, ghFetch(record, 'grandfathered: []\n'), kv);
  assert.equal(r.status, 200);
  assert.equal(writtenGrants(kv).find((e) => e.github_id === '77').until, '2027-01-01');
});

test('sow-213 endpoint: a malformed until is 400, rejected BEFORE the governance file is read', async () => {
  const record = []; const reads = [];
  const r = await run({ action: 'grandfather', githubId: '77', until: 'not-a-date' }, ghFetch(record, 'grandfathered: []\n', reads));
  assert.equal(r.status, 400);
  assert.equal(record.length, 0);
  assert.equal(reads.length, 0, 'the endpoint rejects on its own, without spending a GitHub read');
});

test('sow-213 Step 3 endpoint CONTROL: no tier in the payload writes no tier field, and a valid request DOES write the mirror', async () => {
  const record = [];
  const kv = kvWith();
  const r = await run({ action: 'grandfather', githubId: '77' }, ghFetch(record, 'grandfathered: []\n'), kv);
  assert.equal(r.status, 200);
  const grant = writtenGrants(kv).find((e) => e.github_id === '77');
  assert.ok(grant, 'the mirror WAS written, so the "absent stays absent" below is a real result and not a dead instrument');
  assert.equal('tier' in grant, false, 'absent stays absent, so legacy behaviour is unchanged');
});

test('sow-213 Step 3 endpoint: a re-grant through the endpoint does not wipe a hand-set creator tier (overlay against the mirror)', async () => {
  const record = [];
  const kv = kvWith([{ github_id: '77', login: 'ada', reason: 'founding co-op member', until: null, at: '2026-01-01T00:00:00.000Z', tier: 'creator', source: 'kv' }]);
  const r = await run({ action: 'grandfather', githubId: '77', reason: 'renewed' }, ghFetch(record, 'grandfathered: []\n'), kv);
  assert.equal(r.status, 200);
  assert.equal(writtenGrants(kv).find((e) => e.github_id === '77').tier, 'creator', 'the escape hatch survives a re-grant, overlaid onto the existing mirror grant');
});
