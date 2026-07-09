// SOW-106 Phase A: the Worker-side fork-main sync. Tier gate (paid|trialing), merge-upstream outcome mapping
// (every miss is a clean 200), the fork-installation token helper, and the client-side create-gate. Fakes only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { membershipSyncFork } from '../workers/signup/membership-sync-fork.mjs';
import { getForkInstallationToken } from '../workers/signup/github-app.mjs';
import { syncForkIfCreatingBranch } from '../client/src/operations.mjs';

const req = (body = {}, method = 'POST') => ({ method, headers: { get: () => 'Bearer t' }, json: async () => body });
const memberAs = (login, status) => async () => ({ ok: true, githubId: '42', login, status });

test('sync-fork: maps merge-upstream 200/409/422/network onto clean { synced, reason } bodies', async () => {
  const run = async (impl) => membershipSyncFork(req({}), { UPSTREAM_REPO: 'gbti-network/gbti.network' }, {
    authorize: memberAs('alice', 'paid'),
    forkToken: async () => 'ftok',
    fetchImpl: impl,
  });
  const ok = await run(async (url, init) => {
    assert.ok(url.includes('/repos/alice/gbti.network/merge-upstream'));
    assert.equal(JSON.parse(init.body).branch, 'main');
    assert.match(init.headers.Authorization, /ftok/);
    return { ok: true, status: 200, json: async () => ({ merge_type: 'fast-forward' }) };
  });
  assert.deepEqual(ok.body, { ok: true, synced: true, state: 'fast-forward' });
  const diverged = await run(async () => ({ ok: false, status: 409 }));
  assert.equal(diverged.body.reason, 'diverged');
  const perms = await run(async () => ({ ok: false, status: 422 }));
  assert.equal(perms.body.reason, 'permissions');
  const net = await run(async () => { throw new Error('down'); });
  assert.equal(net.body.reason, 'network');
  for (const r of [ok, diverged, perms, net]) assert.equal(r.status, 200); // a miss never blocks the publish
});

test('sync-fork: tier gate admits paid + trialing, denies none; no token = clean unavailable miss', async () => {
  const deps = (status, forkToken) => ({ authorize: memberAs('bob', status), forkToken: forkToken ?? (async () => 'x'), fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) });
  const trial = await membershipSyncFork(req({}), {}, deps('trialing'));
  assert.equal(trial.status, 200);
  const none = await membershipSyncFork(req({}), {}, deps('none'));
  assert.equal(none.status, 403);
  const noApp = await membershipSyncFork(req({}), {}, deps('paid', async () => null));
  assert.deepEqual(noApp.body, { ok: true, synced: false, reason: 'unavailable' });
  const badBranch = await membershipSyncFork(req({ branch: 'x'.repeat(200) }), {}, deps('paid'));
  assert.equal(badBranch.status, 400);
  const get = await membershipSyncFork({ method: 'GET', headers: { get: () => null } }, {});
  assert.equal(get.status, 405);
});

test('getForkInstallationToken: resolves the fork installation, mints + caches; fail-soft null everywhere', async () => {
  const env = { GITHUB_APP_ID: '1', GITHUB_APP_PRIVATE_KEY: 'pem', UPSTREAM_REPO: 'gbti-network/gbti.network' };
  const kvStore = new Map();
  const kv = { get: async (k) => kvStore.get(k) ?? null, put: async (k, v) => { kvStore.set(k, JSON.parse(v)); } };
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/repos/alice/gbti.network/installation')) return { ok: true, json: async () => ({ id: 77 }) };
    if (url.endsWith('/app/installations/77/access_tokens')) { assert.equal(init.method, 'POST'); return { ok: true, json: async () => ({ token: 'ftok', expires_at: new Date(Date.now() + 3600e3).toISOString() }) }; }
    return { ok: false, status: 404 };
  };
  const tok = await getForkInstallationToken(env, 'Alice', { fetchImpl, kv, signJwt: async () => 'jwt' });
  assert.equal(tok, 'ftok');
  assert.ok(kvStore.get('gh-app:fork-token:alice'));
  // cached reuse: a second call never fetches
  const cached = await getForkInstallationToken(env, 'alice', { fetchImpl: async () => { throw new Error('no'); }, kv, signJwt: async () => 'jwt' });
  assert.equal(cached, 'ftok');
  // not installed -> null; unconfigured -> null
  const notInstalled = await getForkInstallationToken(env, 'mallory', { fetchImpl: async () => ({ ok: false, status: 404 }), kv: null, signJwt: async () => 'jwt' });
  assert.equal(notInstalled, null);
  assert.equal(await getForkInstallationToken({}, 'alice', { fetchImpl }), null);
});

test('syncForkIfCreatingBranch: absent branch syncs; an OPEN PR blocks; a LEFTOVER branch syncs too', async () => {
  const calls = [];
  const sync = async (args) => { calls.push(args); return { ok: true, synced: true }; };
  const ctx = { store: { get: (k) => (k === 'githubToken' ? 'tok' : null) }, fetch: async () => {} };
  const repoWith = (sha, openPull) => ({
    ensureFork: async () => ({ full_name: 'alice/gbti.network', owner: 'alice' }),
    getBranchSha: async () => { if (sha) return sha; throw new Error('404'); },
    findOpenPull: async () => openPull ?? null,
  });
  const absent = await syncForkIfCreatingBranch(ctx, repoWith(null), 'gbti/post-x', { sync });
  assert.equal(absent.synced, true);
  assert.equal(calls.length, 1);
  // A branch with an OPEN PR carries in-flight edits: never synced under it (SOW-053).
  const inFlight = await syncForkIfCreatingBranch(ctx, repoWith('abc', { number: 9 }), 'gbti/post-x', { sync });
  assert.deepEqual(inFlight, { synced: false, reason: 'branch-exists' });
  assert.equal(calls.length, 1); // no second sync
  // A LEFTOVER branch (its PR merged/closed) syncs: publish is about to reset it to the fork main
  // (2026-07-09, PRs 95-97: resetting onto an unsynced main re-created the conflict).
  const leftover = await syncForkIfCreatingBranch(ctx, repoWith('abc', null), 'gbti/post-x', { sync });
  assert.equal(leftover.synced, true);
  assert.equal(calls.length, 2);
  // An unreadable PR state fails SAFE (no sync, the SOW-053 posture).
  const unknown = await syncForkIfCreatingBranch(ctx, { ...repoWith('abc'), findOpenPull: async () => { throw new Error('down'); } }, 'gbti/post-x', { sync });
  assert.deepEqual(unknown, { synced: false, reason: 'branch-exists' });
  // a throwing repo is a silent miss, never an error
  const broken = await syncForkIfCreatingBranch(ctx, { ensureFork: async () => { throw new Error('down'); } }, 'b', { sync });
  assert.equal(broken.synced, false);
});
