// sow-316: a save control must show the member's existing state on load, with one read per page.
//
// The defect: the heart and the collection pill wrote correctly and read nothing back, so a favorite that the
// server held did not survive a refresh on screen. These tests cover the module the two elements prime from:
// memoized per client, shared in flight, refreshed by a write's answer, forgotten by a write without one, and
// the two derivations the elements render from.
import test from 'node:test';
import assert from 'node:assert/strict';

import { primeActivity, noteActivity, invalidateActivity, isFavorited, collectionsHolding, collectionPill } from '../client-ui/src/activity-state.mjs';

const T = { type: 'post', slug: 'how-to-always-show-claude-code-usage-in-the-terminal' };
const held = () => ({
  favorites: [{ type: 'post', slug: T.slug, addedAt: 1 }],
  collections: [
    { id: 'c1', name: 'Tutorials', items: [{ type: 'post', slug: T.slug, addedAt: 1 }] },
    { id: 'c2', name: 'Later', items: [] },
  ],
});

function fakeClient(activity = held()) {
  const client = { calls: 0, async getActivity() { client.calls += 1; return activity; } };
  return client;
}

test('one read per page: many controls priming at once share a single request', async () => {
  const client = fakeClient();
  const results = await Promise.all(Array.from({ length: 40 }, () => primeActivity(client)));
  assert.equal(client.calls, 1, 'forty hearts, one request');
  assert.equal(isFavorited(results[39], T), true, 'and every one of them sees the favorite');
  await primeActivity(client);
  assert.equal(client.calls, 1, 'a later prime is answered from the snapshot');
});

test('the snapshot is per client: a different client reads for itself', async () => {
  const a = fakeClient(); const b = fakeClient({ favorites: [], collections: [] });
  assert.equal(isFavorited(await primeActivity(a), T), true);
  assert.equal(isFavorited(await primeActivity(b), T), false);
  assert.equal(a.calls + b.calls, 2);
});

test('a write that returns the activity becomes the answer without another read', async () => {
  const client = fakeClient({ favorites: [], collections: [] });
  assert.equal(isFavorited(await primeActivity(client), T), false);
  noteActivity(client, held());
  assert.equal(isFavorited(await primeActivity(client), T), true);
  assert.equal(client.calls, 1);
});

test('a write without the activity in its answer forgets the snapshot, so the next prime re-reads', async () => {
  const client = fakeClient();
  await primeActivity(client);
  invalidateActivity(client);
  await primeActivity(client);
  assert.equal(client.calls, 2);
});

test('a failed read is not remembered as an answer', async () => {
  let fail = true;
  const client = { calls: 0, async getActivity() { client.calls += 1; if (fail) throw new Error('offline'); return held(); } };
  await assert.rejects(primeActivity(client), /offline/);
  fail = false;
  assert.equal(isFavorited(await primeActivity(client), T), true, 'the retry reads again rather than replaying the failure');
  assert.equal(client.calls, 2);
});

test('no client, or a client with no activity read, primes to empty rather than throwing', async () => {
  assert.deepEqual(await primeActivity(null), { favorites: [], collections: [] });
  assert.deepEqual(await primeActivity({}), { favorites: [], collections: [] });
});

test('isFavorited and collectionsHolding read the item by type AND slug', () => {
  const a = held();
  assert.equal(isFavorited(a, T), true);
  assert.equal(isFavorited(a, { type: 'prompt', slug: T.slug }), false, 'same slug, other type');
  assert.equal(isFavorited(a, { type: 'post', slug: 'other' }), false);
  assert.equal(isFavorited(a, { type: 'post' }), false, 'no slug, no match');
  assert.equal(collectionsHolding(a, T), 1);
  a.collections[1].items.push({ type: 'post', slug: T.slug, addedAt: 2 });
  assert.equal(collectionsHolding(a, T), 2);
  assert.equal(collectionsHolding(a, { type: 'post', slug: 'other' }), 0);
  assert.equal(collectionsHolding(null, T), 0);
});

test('the pill says Save until the item is held, then Saved with the count', () => {
  assert.deepEqual(collectionPill(0), { text: 'Save', label: 'Save to a collection' });
  assert.deepEqual(collectionPill(1), { text: 'Saved (1)', label: 'Saved in 1 collection' });
  assert.deepEqual(collectionPill(3), { text: 'Saved (3)', label: 'Saved in 3 collections' });
  assert.equal(collectionPill(undefined).text, 'Save');
});
