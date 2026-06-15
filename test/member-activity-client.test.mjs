// SOW-024: the client write path for member activity (favorites + collections) against the Worker.
// Fake fetch: no network. Verifies the request shape (method, bearer, action body) and error handling.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getActivity, setFavorite, createCollection, renameCollection, deleteCollection, setCollectionItem,
  ActivityClientError,
} from '../client/src/member-activity-client.mjs';

function fakeFetch(responder) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
    return responder(url, init);
  };
  return { fetch, calls };
}
const ok = (body) => ({ ok: true, status: 200, async json() { return body; } });
const opts = (fetch) => ({ token: 'tok', signupBase: 'https://w.example/', fetch });

test('getActivity GETs /membership/activity with the bearer token', async () => {
  const { fetch, calls } = fakeFetch(() => ok({ ok: true, activity: { favorites: [], collections: [] } }));
  const r = await getActivity(opts(fetch));
  assert.deepEqual(r.activity, { favorites: [], collections: [] });
  assert.equal(calls[0].url, 'https://w.example/membership/activity'); // trailing slash trimmed
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
});

test('setFavorite + collection ops send the right action bodies', async () => {
  const { fetch, calls } = fakeFetch(() => ok({ ok: true, id: 'c1', activity: {} }));
  await setFavorite({ targetType: 'prompt', targetSlug: 'p1', on: true, ...opts(fetch) });
  assert.deepEqual(calls[0].body, { action: 'favorite', type: 'prompt', slug: 'p1', on: true });

  await createCollection({ name: 'Faves', ...opts(fetch) });
  assert.deepEqual(calls[1].body, { action: 'collection.create', name: 'Faves' });

  await setCollectionItem({ id: 'c1', targetType: 'prompt', targetSlug: 'p9', on: true, ...opts(fetch) });
  assert.deepEqual(calls[2].body, { action: 'collection.item', id: 'c1', type: 'prompt', slug: 'p9', on: true });

  await renameCollection({ id: 'c1', name: 'New', ...opts(fetch) });
  assert.deepEqual(calls[3].body, { action: 'collection.rename', id: 'c1', name: 'New' });

  await deleteCollection({ id: 'c1', ...opts(fetch) });
  assert.deepEqual(calls[4].body, { action: 'collection.delete', id: 'c1' });
});

test('throws ActivityClientError when not signed in or on a non-ok response', async () => {
  await assert.rejects(() => getActivity({ token: '', signupBase: 'https://w', fetch: async () => ok({}) }), ActivityClientError);
  const { fetch } = fakeFetch(() => ({ ok: false, status: 400, async json() { return { message: 'invalid' }; } }));
  await assert.rejects(() => setFavorite({ targetType: 'prompt', targetSlug: 'x', ...opts(fetch) }), ActivityClientError);
});
