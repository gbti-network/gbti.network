// sow-213 Phase 2b + 2c: the KV half of the governance dual-write, and the private moderation log.
// Every test here pins a rule that exists because of a specific way this write could fail QUIETLY.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyKvOverride, writeOverrideToKv, appendModerationLog, moderationLogKey,
  OVERRIDES_KV_KEY, KV_SOURCE,
} from '../workers/signup/membership-override-kv.mjs';

const FRESH = '2026-08-27T00:00:00.000Z';
const mirror = (over = {}) => ({
  generatedAt: FRESH,
  roles: { superadmins: [{ github_id: '1' }], admins: [], moderators: [] },
  bans: { bans: [{ github_id: '900', reason: 'from git', at: FRESH }] },
  grandfathered: { grandfathered: [{ github_id: '77', reason: 'comp', tier: 'creator', at: FRESH }] },
  ...over,
});

// A KV store whose failure modes are selectable, so "could not read" and "nothing there" are distinguishable.
function fakeKv({ store = new Map(), getThrows = false, putThrows = false } = {}) {
  return {
    store,
    async get(key, type) {
      if (getThrows) throw new Error('KV unavailable');
      const raw = store.get(key);
      if (raw === undefined) return null;
      return type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(key, value) {
      if (putThrows) throw new Error('KV write refused');
      store.set(key, value);
    },
  };
}

// ---- applyKvOverride: the pure rules ----

test('sow-213: a ban written to KV is marked source:kv, so the 6-hourly sync cannot delete it', () => {
  const r = applyKvOverride(mirror(), { section: 'bans', githubId: '555', entry: { reason: 'spam', at: FRESH } });
  assert.equal(r.ok, true);
  const added = r.next.bans.bans.find((e) => e.github_id === '555');
  assert.equal(added.source, KV_SOURCE, 'without this mark, kv-mirror.mergeOverridesSection erases it within six hours');
});

test('sow-213: generatedAt is NEVER touched, so an admin action cannot mask a dead sync', () => {
  const r = applyKvOverride(mirror(), { section: 'bans', githubId: '555', entry: { reason: 'spam' } });
  assert.equal(r.next.generatedAt, FRESH, 'refreshing it here would make a stale mirror look healthy to all six fail-closed readers');
});

test('sow-213: a stale mirror stays stale and is still written, because the staleness gate is the reader\'s job', () => {
  const old = mirror({ generatedAt: '2020-01-01T00:00:00.000Z' });
  const r = applyKvOverride(old, { section: 'bans', githubId: '555', entry: { reason: 'spam' } });
  assert.equal(r.ok, true);
  assert.equal(r.next.generatedAt, '2020-01-01T00:00:00.000Z');
});

test('sow-213: other sections and unknown fields pass through untouched', () => {
  const m = mirror({ someFutureField: 'keep me' });
  const r = applyKvOverride(m, { section: 'bans', githubId: '555', entry: { reason: 'spam' } });
  assert.deepEqual(r.next.roles, m.roles, 'roles.yml stays git-native and must not be disturbed');
  assert.deepEqual(r.next.grandfathered, m.grandfathered);
  assert.equal(r.next.someFutureField, 'keep me');
});

test('sow-213: an ABSENT or malformed mirror is REFUSED, never fabricated', () => {
  for (const bad of [null, undefined, 'a string', [], {}, { generatedAt: FRESH }, { bans: { bans: [] } }]) {
    const r = applyKvOverride(bad, { section: 'bans', githubId: '555', entry: { reason: 'spam' } });
    assert.equal(r.ok, false, `refused: ${JSON.stringify(bad)}`);
    assert.equal(r.next, undefined, 'a refusal returns no blob to write');
  }
});

test('sow-213: fabricating a mirror would fail OPEN, which is why the refusal above is the whole point', () => {
  // Stated as a test so the reasoning is not only in a comment: a fabricated blob would carry ONE ban and a
  // fresh generatedAt, and every reader would treat it as the complete override set.
  const r = applyKvOverride(null, { section: 'bans', githubId: '555', entry: { reason: 'spam' } });
  assert.match(r.reason, /absent|not an object/);
});

test('sow-213: a removal drops ONLY the KV-native copy, because the sync would restore a git-sourced one', () => {
  const m = mirror({ bans: { bans: [
    { github_id: '900', reason: 'from git', at: FRESH },
    { github_id: '900', reason: 'from kv', at: FRESH, source: KV_SOURCE },
  ] } });
  const r = applyKvOverride(m, { section: 'bans', githubId: '900', remove: true });
  assert.equal(r.next.bans.bans.length, 1);
  assert.equal(r.next.bans.bans[0].reason, 'from git', 'the git-sourced entry survives; the git PR removes it');
});

test('sow-213: re-writing the same entry is idempotent (no spurious KV write)', () => {
  const first = applyKvOverride(mirror(), { section: 'bans', githubId: '555', entry: { reason: 'spam', at: FRESH } });
  const again = applyKvOverride(first.next, { section: 'bans', githubId: '555', entry: { reason: 'spam', at: FRESH } });
  assert.equal(again.changed, false);
});

test('sow-213: roles is NOT a writable section here', () => {
  const r = applyKvOverride(mirror(), { section: 'roles', githubId: '555', entry: {} });
  assert.equal(r.ok, false);
});

// ---- writeOverrideToKv: the IO rules ----

test('sow-213 IO: a happy-path ban is persisted to overrides:mirror', async () => {
  const kv = fakeKv();
  kv.store.set(OVERRIDES_KV_KEY, JSON.stringify(mirror()));
  const r = await writeOverrideToKv({ kv, section: 'bans', githubId: '555', entry: { reason: 'spam' } });
  assert.equal(r.written, true);
  const after = JSON.parse(kv.store.get(OVERRIDES_KV_KEY));
  assert.equal(after.bans.bans.find((e) => e.github_id === '555').source, KV_SOURCE);
});

test('sow-213 IO: a READ FAILURE never resolves to "the mirror is empty"', async () => {
  const kv = fakeKv({ getThrows: true });
  kv.store.set(OVERRIDES_KV_KEY, JSON.stringify(mirror()));
  const r = await writeOverrideToKv({ kv, section: 'bans', githubId: '555', entry: { reason: 'spam' } });
  assert.equal(r.written, false);
  assert.match(r.reason, /could not read/);
  // The decisive assertion: the existing bans are still there. Treating an unreadable mirror as empty would
  // have written a blob containing only the new ban, dropping every existing one.
  const after = JSON.parse(kv.store.get(OVERRIDES_KV_KEY));
  assert.equal(after.bans.bans.length, 1);
  assert.equal(after.bans.bans[0].github_id, '900');
});

test('sow-213 IO: an ABSENT mirror is refused and nothing is created', async () => {
  const kv = fakeKv();
  const r = await writeOverrideToKv({ kv, section: 'bans', githubId: '555', entry: { reason: 'spam' } });
  assert.equal(r.written, false);
  assert.equal(kv.store.has(OVERRIDES_KV_KEY), false, 'no mirror was fabricated');
});

test('sow-213 IO: a write failure is reported, not swallowed', async () => {
  const kv = fakeKv({ putThrows: true });
  kv.store.set(OVERRIDES_KV_KEY, JSON.stringify(mirror()));
  const r = await writeOverrideToKv({ kv, section: 'bans', githubId: '555', entry: { reason: 'spam' } });
  assert.equal(r.written, false);
  assert.match(r.reason, /could not write/);
});

test('sow-213 IO CONTROL: the fake store can be written, so the assertions above are not vacuous', async () => {
  const kv = fakeKv();
  kv.store.set(OVERRIDES_KV_KEY, JSON.stringify(mirror()));
  const r = await writeOverrideToKv({ kv, section: 'grandfathered', githubId: '42', entry: { reason: 'comp', tier: 'member' } });
  assert.equal(r.written, true);
  assert.equal(JSON.parse(kv.store.get(OVERRIDES_KV_KEY)).grandfathered.grandfathered.length, 2);
});

// ---- appendModerationLog: Phase 2c ----

const audit = (over = {}) => ({
  at: FRESH,
  actor: { github_id: '2', login: 'admin' },
  action: 'ban',
  target: { github_id: '555', login: 'spammer' },
  detail: { reason: 'spam' },
  ...over,
});

test('sow-213 modlog: the record is written and carries who, whom, when and why', async () => {
  const kv = fakeKv();
  const r = await appendModerationLog({ kv, audit: audit() });
  assert.equal(r.written, true);
  const saved = JSON.parse(kv.store.get(r.key));
  assert.equal(saved.actor.github_id, '2');
  assert.equal(saved.target.github_id, '555');
  assert.equal(saved.at, FRESH);
  assert.equal(saved.detail.reason, 'spam', 'the ban reason is RETAINED here and never surfaced publicly');
});

test('sow-213 modlog: APPEND-ONLY as a property. A same-millisecond second action never overwrites the first', async () => {
  const kv = fakeKv();
  const a = await appendModerationLog({ kv, audit: audit({ detail: { reason: 'first' } }) });
  const b = await appendModerationLog({ kv, audit: audit({ detail: { reason: 'second' } }) });
  assert.notEqual(a.key, b.key, 'the second write took a fresh key rather than clobbering');
  assert.equal(JSON.parse(kv.store.get(a.key)).detail.reason, 'first', 'the first record is intact');
  assert.equal(JSON.parse(kv.store.get(b.key)).detail.reason, 'second');
  assert.equal(kv.store.size, 2);
});

test('sow-213 modlog: keys are prefixed so every action against one member can be listed', async () => {
  const kv = fakeKv();
  const r = await appendModerationLog({ kv, audit: audit() });
  assert.match(r.key, /^modlog:555:/);
  assert.equal(moderationLogKey({ targetId: '555', at: FRESH, actorId: '2' }), `modlog:555:${FRESH}:2`);
});

test('sow-213 modlog: a KV failure is reported so the caller can refuse the action', async () => {
  const kv = fakeKv({ putThrows: true });
  const r = await appendModerationLog({ kv, audit: audit() });
  assert.equal(r.written, false);
  assert.match(r.reason, /moderation log write failed/);
});

test('sow-213 modlog: an audit entry with no target is refused rather than written under a junk key', async () => {
  const kv = fakeKv();
  const r = await appendModerationLog({ kv, audit: audit({ target: null }) });
  assert.equal(r.written, false);
  assert.equal(kv.store.size, 0);
});

// ---- the endpoint wiring: log-first, then git, then the KV half ----

import { membershipAdminAuthor } from '../workers/signup/membership-admin-author.mjs';

const wenv = {
  GITHUB_APP_ID: '123', GITHUB_APP_INSTALLATION_ID: '999', GITHUB_APP_PRIVATE_KEY: 'PEM',
  UPSTREAM_REPO: 'gbti-network/gbti.network', MEMBERSHIP_AUTHOR_ENABLED: 'true',
};
const wreq = (body) => ({ headers: { get: () => 'Bearer tok' }, json: async () => body });
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const staffAdmin = async () => ({ ok: true, githubId: '2', role: 'admin' });

/** `prFails` makes the PR step fail AFTER the log write, which is how log-first becomes observable. */
function wgh(record, govFile, { prFails = false } = {}) {
  return async (url, init = {}) => {
    const method = init.method || 'GET';
    if (/\/access_tokens$/.test(url)) return { ok: true, status: 201, async json() { return { token: 't', expires_at: new Date(Date.now() + 3600e3).toISOString() }; } };
    if (/\/contents\/house\/(bans|grandfathered|roles)\.yml\?ref=main$/.test(url) && method === 'GET') return { ok: true, status: 200, async json() { return { content: b64(govFile) }; } };
    if (/\/git\/ref\/heads\/main$/.test(url)) return { ok: true, status: 200, async json() { return { object: { sha: 'mainsha' } }; } };
    if (/\/git\/refs$/.test(url) && method === 'POST') { record.push({ method, url }); return { ok: true, status: 201, async json() { return {}; } }; }
    if (/\/contents\/.+\?ref=/.test(url) && method === 'GET') return { ok: true, status: 200, async json() { return { sha: 'oldsha' }; } };
    if (/\/contents\//.test(url) && method === 'PUT') { record.push({ method, url, body: JSON.parse(init.body) }); return { ok: true, status: 201, async json() { return {}; } }; }
    if (/\/pulls$/.test(url) && method === 'POST') {
      record.push({ method, url });
      if (prFails) return { ok: false, status: 500, async json() { return {}; } };
      return { ok: true, status: 201, async json() { return { number: 42, html_url: 'https://x/pull/42' }; } };
    }
    return { ok: false, status: 500, async json() { return {}; } };
  };
}
const wrun = (body, fetchImpl, kv) =>
  membershipAdminAuthor(wreq(body), wenv, { fetchImpl, authorize: staffAdmin, kv, limiter: async () => ({ allowed: true }), signJwt: async () => 'j' });

const modlogKeys = (kv) => [...kv.store.keys()].filter((k) => k.startsWith('modlog:'));

test('sow-213 endpoint: a ban DUAL-WRITES, and the KV entry is marked source:kv', async () => {
  const kv = fakeKv();
  kv.store.set(OVERRIDES_KV_KEY, JSON.stringify(mirror()));
  const r = await wrun({ action: 'ban', githubId: '555', reason: 'spam' }, wgh([], 'bans: []\n'), kv);
  assert.equal(r.status, 200);
  assert.equal(r.body.kvWritten, true);
  const after = JSON.parse(kv.store.get(OVERRIDES_KV_KEY));
  assert.equal(after.bans.bans.find((e) => e.github_id === '555').source, KV_SOURCE);
});

test('sow-213 endpoint: a KV failure does NOT discard the git write; it is REPORTED', async () => {
  const kv = fakeKv(); // no overrides:mirror present, so the KV half must refuse
  const record = [];
  const r = await wrun({ action: 'ban', githubId: '555', reason: 'spam' }, wgh(record, 'bans: []\n'), kv);
  assert.equal(r.status, 200, 'the ban still landed in git');
  assert.equal(r.body.number, 42, 'the PR was still opened');
  assert.equal(r.body.kvWritten, false);
  assert.match(r.body.kvReason, /absent|not an object/, 'the caller can tell a dual-write from a git-only write');
});

test('sow-213 endpoint: the moderation log is written BEFORE the action is enacted', async () => {
  const kv = fakeKv();
  kv.store.set(OVERRIDES_KV_KEY, JSON.stringify(mirror()));
  // The PR step fails, so the action does NOT land. If the log were written afterwards there would be none.
  const r = await wrun({ action: 'ban', githubId: '555', reason: 'spam' }, wgh([], 'bans: []\n', { prFails: true }), kv);
  assert.equal(r.status, 502, 'the action did not land');
  assert.equal(modlogKeys(kv).length, 1, 'the attempt was recorded anyway, which is the safe way round');
});

test('sow-213 endpoint: if the moderation log CANNOT be written the action is REFUSED and git is untouched', async () => {
  const kv = fakeKv({ putThrows: true });
  const record = [];
  const r = await wrun({ action: 'ban', githubId: '555', reason: 'spam' }, wgh(record, 'bans: []\n'), kv);
  assert.equal(r.status, 503);
  assert.match(r.body.message, /moderation log/);
  assert.equal(record.length, 0, 'no branch, no file write, no PR: nothing was enacted without a record');
});

test('sow-213 endpoint: the log carries the actor, the target and the reason', async () => {
  const kv = fakeKv();
  kv.store.set(OVERRIDES_KV_KEY, JSON.stringify(mirror()));
  await wrun({ action: 'ban', githubId: '555', reason: 'spam' }, wgh([], 'bans: []\n'), kv);
  const saved = JSON.parse(kv.store.get(modlogKeys(kv)[0]));
  assert.equal(saved.actor.github_id, '2', 'the acting admin, inserted server-side');
  assert.equal(saved.target.github_id, '555');
  assert.equal(saved.detail.reason, 'spam');
  assert.equal(saved.action, 'ban');
});

test('sow-213 endpoint: an unban removes the KV-native entry and leaves the git-sourced one', async () => {
  const kv = fakeKv();
  kv.store.set(OVERRIDES_KV_KEY, JSON.stringify(mirror({ bans: { bans: [
    { github_id: '900', reason: 'from git', at: FRESH },
    { github_id: '900', reason: 'from kv', at: FRESH, source: KV_SOURCE },
  ] } })));
  const gov = "bans:\n  - github_id: '900'\n    reason: from git\n    at: '2026-08-27T00:00:00.000Z'\n";
  const r = await wrun({ action: 'unban', githubId: '900' }, wgh([], gov), kv);
  assert.equal(r.status, 200);
  assert.equal(r.body.kvWritten, true);
  const bans = JSON.parse(kv.store.get(OVERRIDES_KV_KEY)).bans.bans;
  assert.equal(bans.length, 1);
  assert.equal(bans[0].reason, 'from git');
});

test('sow-213 endpoint CONTROL: a ROLE change has no KV half, so it reports none', async () => {
  const kv = fakeKv();
  kv.store.set(OVERRIDES_KV_KEY, JSON.stringify(mirror()));
  const staffSuper = async () => ({ ok: true, githubId: '1', role: 'superadmin' });
  const r = await membershipAdminAuthor(wreq({ action: 'role', githubId: '55', role: 'moderator' }), wenv, {
    fetchImpl: wgh([], 'superadmins: []\nadmins: []\nmoderators: []\n'), authorize: staffSuper, kv,
    limiter: async () => ({ allowed: true }), signJwt: async () => 'j',
  });
  assert.equal(r.status, 200);
  assert.equal('kvWritten' in r.body, false, 'roles.yml stays git-native by owner ruling and has no KV half');
  assert.equal(modlogKeys(kv).length, 1, 'a role change is still recorded in the moderation log');
});
