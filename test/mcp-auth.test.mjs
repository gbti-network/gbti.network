// SOW-025: the MCP device-flow sign-in (two-call start/confirm). Verifies the pending-state stash, the
// pending -> approved transition, identity + membership persistence, failure cleanup, and logout. Pure over
// injected deps (no network, no real OAuth app).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startDeviceLogin, confirmDeviceLogin, logout } from '../client/src/mcp-auth.mjs';

// A fake store with the same get/set merge semantics as client/src/store.mjs (in-memory).
function fakeStore(initial = {}) {
  const data = { ...initial };
  return { data, get: (k) => data[k], set: (patch) => Object.assign(data, patch) };
}
const ctxWith = (store) => ({ store });

test('startDeviceLogin: requests a code, stashes pending state, returns the user code + URL', async () => {
  const store = fakeStore();
  const requestCode = async ({ clientId, scope }) => {
    assert.equal(scope, 'public_repo read:user');
    assert.ok(clientId);
    return { device_code: 'DEV', user_code: 'WXYZ-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 };
  };
  const r = await startDeviceLogin(ctxWith(store), { requestCode });
  assert.equal(r.userCode, 'WXYZ-1234');
  assert.match(r.verificationUri, /github\.com\/login\/device/);
  assert.deepEqual(store.get('pendingDeviceLogin'), { deviceCode: 'DEV', clientId: store.get('pendingDeviceLogin').clientId });
  assert.equal(store.get('pendingDeviceLogin').deviceCode, 'DEV');
});

test('confirmDeviceLogin: returns pending while GitHub says authorization_pending', async () => {
  const store = fakeStore({ pendingDeviceLogin: { deviceCode: 'DEV', clientId: 'cid' } });
  const r = await confirmDeviceLogin(ctxWith(store), { pollToken: async () => ({ error: 'authorization_pending' }) });
  assert.equal(r.pending, true);
  assert.ok(store.get('pendingDeviceLogin'), 'pending state is kept so the agent can retry');
});

// A readFile that exposes the override files (so the membership resolution runs) + an optional members-index.
const readFileWith = (membersIndex = 'members: {}\n') => (p) =>
  p === 'house/roles.yml' ? 'roles: {}\n' : p === 'house/members-index.yml' ? membersIndex : null;

test('confirmDeviceLogin: on approval, persists token + identity (+ membership) and clears pending', async () => {
  const store = fakeStore({ pendingDeviceLogin: { deviceCode: 'DEV', clientId: 'cid' } });
  const r = await confirmDeviceLogin(ctxWith(store), {
    pollToken: async () => ({ access_token: 'gho_TOKEN' }),
    makeRepoClient: (token) => { assert.equal(token, 'gho_TOKEN'); return { getAuthUser: async () => ({ login: 'Alice', id: 42 }) }; },
    resolveMembershipImpl: async ({ githubId, token }) => { assert.equal(githubId, 42); assert.equal(token, 'gho_TOKEN'); return { stripeStatus: 'paid', membership: 'paid' }; },
    readFile: readFileWith(), // overrides readable -> membership is resolved (folds staff/grandfather/ban)
  });
  assert.equal(r.ok, true);
  assert.equal(r.login, 'Alice');
  assert.equal(r.username, 'alice'); // folder convention: lowercased login (empty members-index)
  assert.equal(r.membership, 'paid');
  assert.equal(store.get('githubToken'), 'gho_TOKEN');
  assert.deepEqual(store.get('identity'), { login: 'Alice', githubId: 42, username: 'alice' });
  assert.equal(store.get('pendingDeviceLogin'), null, 'pending state cleared on success');
});

test('confirmDeviceLogin: no local overrides -> membership unknown (fails open to the gate), never wrongly blocks', async () => {
  const store = fakeStore({ pendingDeviceLogin: { deviceCode: 'DEV', clientId: 'cid' } });
  let resolved = false;
  const r = await confirmDeviceLogin(ctxWith(store), {
    pollToken: async () => ({ access_token: 'tok' }),
    makeRepoClient: () => ({ getAuthUser: async () => ({ login: 'gf', id: 9 }) }),
    resolveMembershipImpl: async () => { resolved = true; return { stripeStatus: 'none', membership: 'none' }; },
    // no readFile -> can't read roles.yml/grandfathered.yml; a grandfather/staff member must NOT be cached as 'none'
    readFile: null,
  });
  assert.equal(r.ok, true);
  assert.equal(r.membership, 'unknown', 'fail open: a grandfathered member is never wrongly blocked');
  assert.equal(resolved, false, 'membership is not resolved from bare Stripe when overrides are unreadable');
});

test('confirmDeviceLogin: a membership-resolution failure (overrides readable) leaves it unknown', async () => {
  const store = fakeStore({ pendingDeviceLogin: { deviceCode: 'DEV', clientId: 'cid' } });
  const r = await confirmDeviceLogin(ctxWith(store), {
    pollToken: async () => ({ access_token: 'tok' }),
    makeRepoClient: () => ({ getAuthUser: async () => ({ login: 'bob', id: 7 }) }),
    resolveMembershipImpl: async () => { throw new Error('signup worker down'); },
    readFile: readFileWith(),
  });
  assert.equal(r.ok, true);
  assert.equal(r.membership, 'unknown');
  assert.equal(store.get('githubToken'), 'tok');
});

test('confirmDeviceLogin: username resolves via members-index (rename-safe), not the renamed login', async () => {
  const store = fakeStore({ pendingDeviceLogin: { deviceCode: 'DEV', clientId: 'cid' } });
  const r = await confirmDeviceLogin(ctxWith(store), {
    pollToken: async () => ({ access_token: 'tok' }),
    makeRepoClient: () => ({ getAuthUser: async () => ({ login: 'NewLogin', id: 42 }) }),
    // the member's folder is "originalname" mapped by github_id 42, even though their login is now NewLogin
    readFile: readFileWith('members:\n  "42": originalname\n'),
  });
  assert.equal(r.username, 'originalname'); // NOT 'newlogin'
  assert.equal(store.get('identity').username, 'originalname');
});

test('confirmDeviceLogin: a transient getAuthUser blip stashes the token; the next confirm reuses it (no re-poll)', async () => {
  const store = fakeStore({ pendingDeviceLogin: { deviceCode: 'DEV', clientId: 'cid' } });
  let polls = 0, lookups = 0;
  const deps = {
    pollToken: async () => { polls++; return { access_token: 'tok' }; },
    makeRepoClient: () => ({ getAuthUser: async () => { lookups++; if (lookups === 1) throw new Error('blip'); return { login: 'al', id: 1 }; } }),
    readFile: null,
  };
  const first = await confirmDeviceLogin(ctxWith(store), deps);
  assert.equal(first.pending, true, 'transient lookup failure -> pending, token stashed');
  assert.equal(store.get('pendingDeviceLogin').accessToken, 'tok', 'the minted token is stashed, not discarded');
  const second = await confirmDeviceLogin(ctxWith(store), deps);
  assert.equal(second.ok, true);
  assert.equal(polls, 1, 'the second confirm did NOT re-poll the single-use device code');
  assert.equal(store.get('githubToken'), 'tok');
});

test('confirmDeviceLogin: a terminal error (expired) clears pending and reports it', async () => {
  const store = fakeStore({ pendingDeviceLogin: { deviceCode: 'DEV', clientId: 'cid' } });
  const r = await confirmDeviceLogin(ctxWith(store), { pollToken: async () => ({ error: 'expired_token' }) });
  assert.equal(r.error, 'expired_token');
  assert.equal(store.get('pendingDeviceLogin'), null);
});

test('confirmDeviceLogin: with no sign-in in progress, asks to call login first', async () => {
  const r = await confirmDeviceLogin(ctxWith(fakeStore()), { pollToken: async () => ({ access_token: 'x' }) });
  assert.equal(r.error, 'no_pending_login');
});

test('logout: clears the local auth state', () => {
  const store = fakeStore({ githubToken: 'tok', identity: { login: 'a' }, membership: 'paid' });
  const r = logout(ctxWith(store));
  assert.equal(r.ok, true);
  assert.equal(store.get('githubToken'), null);
  assert.equal(store.get('identity'), null);
});
