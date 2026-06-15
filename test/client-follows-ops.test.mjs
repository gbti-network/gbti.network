// SOW-023: the npm/extension-host operations for the member FOLLOW graph (getFollows/setFollow). The host
// injects the member's GitHub token + a fake fetch; the op calls the signup Worker's /membership/follows. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getFollows, setFollow, OperationError } from '../client/src/operations.mjs';

function fakeFetch(responder) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(init.body) : null, auth: init?.headers?.Authorization });
    return responder(url, init);
  };
  return { fetch, calls };
}
const ok = (body) => ({ ok: true, status: 200, async json() { return body; } });
const fail = (status, body) => ({ ok: false, status, async json() { return body; } });
function ctx({ token = 'tok', fetch } = {}) {
  return {
    identity: () => ({ login: 'alice', githubId: '1', username: 'alice' }),
    store: { get: (k) => ({ githubToken: token })[k] },
    fetch,
  };
}

test('getFollows returns the following list and sends the bearer token', async () => {
  const { fetch, calls } = fakeFetch(() => ok({ ok: true, following: [{ username: 'bob', addedAt: 1 }] }));
  const list = await getFollows(ctx({ fetch }));
  assert.deepEqual(list, [{ username: 'bob', addedAt: 1 }]);
  assert.ok(calls[0].url.endsWith('/membership/follows'));
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].auth, 'Bearer tok');
});

test('setFollow posts { username, on } and returns the updated list', async () => {
  const { fetch, calls } = fakeFetch(() => ok({ ok: true, following: [{ username: 'bob', addedAt: 2 }] }));
  const list = await setFollow(ctx({ fetch }), { username: 'Bob', on: true });
  assert.deepEqual(calls[0].body, { username: 'Bob', on: true });
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(list, [{ username: 'bob', addedAt: 2 }]);
});

test('a missing token maps to a not-authenticated OperationError', async () => {
  const { fetch } = fakeFetch(() => ok({}));
  await assert.rejects(() => getFollows(ctx({ token: '', fetch })), (e) => e instanceof OperationError && e.code === 'not-authenticated');
});

test('a Worker 403 (not paid) surfaces as a follows-failed OperationError', async () => {
  const { fetch } = fakeFetch(() => fail(403, { error: 'forbidden', message: 'an active paid membership is required' }));
  await assert.rejects(
    () => setFollow(ctx({ fetch }), { username: 'bob' }),
    (e) => e instanceof OperationError && e.code === 'follows-failed' && /paid membership/.test(e.message),
  );
});
