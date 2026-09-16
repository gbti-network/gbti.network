// SOW-106 Phase A: the Worker-side fork-main sync. Tier gate (paid|trialing), merge-upstream outcome mapping
// (every miss is a clean 200), and the fork-installation token helper. Fakes only. The Worker route stays until
// sow-274 Part 4 deletes it; the client-side caller is already gone (see the note at the foot).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { membershipSyncFork } from '../workers/signup/membership-sync-fork.mjs';
import { getForkInstallationToken } from '../workers/signup/github-app.mjs';

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

// sow-274 Part 2 removed syncForkIfCreatingBranch (the client-side create-gate): no client publishes from a fork now.
