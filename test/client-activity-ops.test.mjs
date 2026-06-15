// SOW-024: the npm-host operations for member activity (favorites + collections). The host injects the
// member's GitHub token + a fake fetch; the op calls the signup Worker's /membership/activity. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getMemberActivity, mutateMemberActivity, OperationError } from '../client/src/operations.mjs';

function fakeFetch(responder) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(init.body) : null, auth: init?.headers?.Authorization });
    return responder(url, init);
  };
  return { fetch, calls };
}
const ok = (body) => ({ ok: true, status: 200, async json() { return body; } });
function ctx({ token = 'tok', fetch } = {}) {
  return {
    identity: () => ({ login: 'alice', githubId: '1', username: 'alice' }),
    store: { get: (k) => ({ githubToken: token })[k] },
    fetch,
  };
}

test('getMemberActivity returns the activity and sends the bearer token', async () => {
  const { fetch, calls } = fakeFetch(() => ok({ ok: true, activity: { favorites: [], collections: [{ id: 'c1', name: 'Faves', items: [] }] } }));
  const a = await getMemberActivity(ctx({ fetch }));
  assert.equal(a.collections[0].name, 'Faves');
  assert.ok(calls[0].url.endsWith('/membership/activity'));
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].auth, 'Bearer tok');
});

test('mutateMemberActivity dispatches each collection action with the right body', async () => {
  const { fetch, calls } = fakeFetch(() => ok({ ok: true, id: 'c1', activity: {} }));
  await mutateMemberActivity(ctx({ fetch }), { action: 'collection.create', name: 'Reading' });
  assert.deepEqual(calls[0].body, { action: 'collection.create', name: 'Reading' });
  await mutateMemberActivity(ctx({ fetch }), { action: 'collection.item', id: 'c1', targetType: 'prompt', targetSlug: 'p1', on: true });
  assert.deepEqual(calls[1].body, { action: 'collection.item', id: 'c1', type: 'prompt', slug: 'p1', on: true });
  await assert.rejects(() => mutateMemberActivity(ctx({ fetch }), { action: 'bogus' }), (e) => e instanceof OperationError && e.code === 'bad-request');
});

test('a missing token maps to a not-authenticated OperationError', async () => {
  const { fetch } = fakeFetch(() => ok({}));
  await assert.rejects(
    () => getMemberActivity(ctx({ token: '', fetch })),
    (e) => e instanceof OperationError && e.code === 'not-authenticated',
  );
});
