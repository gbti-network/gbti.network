// SOW-024: the member activity store (favorites + collections) in the deletable edge store.
// Pure core transforms + the Worker handler, both fully injectable (a fake KV + fake token verifier),
// so there is no network and no secrets. Mirrors the repo's other Worker-handler tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  emptyActivity, normalizeActivity, applyFavorite, createCollection, renameCollection,
  deleteCollection, setCollectionItem, ActivityError, MAX_NAME_LEN,
} from '../membership/member-activity.mjs';
import { handleActivity, eraseMemberActivity, ACTIVITY_KEY } from '../workers/signup/membership-activity.mjs';

const clock = () => 1000;
let counter;
const genId = () => `c${++counter}`;

// ---- pure core ----

test('applyFavorite toggles, dedupes, and validates the target', () => {
  let a = applyFavorite(emptyActivity(), { type: 'prompt', slug: 'my-prompt', on: true }, { now: clock });
  assert.equal(a.favorites.length, 1);
  assert.deepEqual(a.favorites[0], { type: 'prompt', slug: 'my-prompt', addedAt: 1000 });
  // idempotent add
  a = applyFavorite(a, { type: 'prompt', slug: 'my-prompt', on: true }, { now: clock });
  assert.equal(a.favorites.length, 1);
  // remove
  a = applyFavorite(a, { type: 'prompt', slug: 'my-prompt', on: false }, { now: clock });
  assert.equal(a.favorites.length, 0);
  // invalid target -> ActivityError
  assert.throws(() => applyFavorite(emptyActivity(), { type: 'banana', slug: 'x', on: true }), ActivityError);
  assert.throws(() => applyFavorite(emptyActivity(), { type: 'prompt', slug: 'Bad Slug!', on: true }), ActivityError);
});

test('collections: create returns an id, rename, add/remove items, delete', () => {
  counter = 0;
  let { activity: a, id } = createCollection(emptyActivity(), { name: '  My Reading List  ' }, { now: clock, genId });
  assert.equal(id, 'c1');
  assert.equal(a.collections[0].name, 'My Reading List'); // trimmed
  // add a prompt to the collection
  a = setCollectionItem(a, { id, type: 'prompt', slug: 'a-prompt', on: true }, { now: clock });
  assert.equal(a.collections[0].items.length, 1);
  // idempotent add, then remove
  a = setCollectionItem(a, { id, type: 'prompt', slug: 'a-prompt', on: true }, { now: clock });
  assert.equal(a.collections[0].items.length, 1);
  a = setCollectionItem(a, { id, type: 'prompt', slug: 'a-prompt', on: false }, { now: clock });
  assert.equal(a.collections[0].items.length, 0);
  // rename
  a = renameCollection(a, { id, name: 'Renamed' }, { now: clock });
  assert.equal(a.collections[0].name, 'Renamed');
  // unknown id errors
  assert.throws(() => renameCollection(a, { id: 'nope', name: 'x' }, { now: clock }), ActivityError);
  assert.throws(() => setCollectionItem(a, { id: 'nope', type: 'prompt', slug: 'p', on: true }), ActivityError);
  // empty name errors
  assert.throws(() => createCollection(emptyActivity(), { name: '   ' }, { now: clock, genId }), ActivityError);
  // delete
  a = deleteCollection(a, { id }, { now: clock });
  assert.equal(a.collections.length, 0);
  assert.throws(() => deleteCollection(a, { id }, { now: clock }), ActivityError);
});

test('normalizeActivity drops malformed entries and caps the name length', () => {
  const a = normalizeActivity({
    favorites: [{ type: 'prompt', slug: 'ok' }, { type: 'x', slug: 'bad' }, null, { type: 'prompt', slug: 'ok' }],
    collections: [{ id: 'c1', name: 'x'.repeat(200), items: [{ type: 'post', slug: 'p' }, { type: 'nope', slug: 'q' }] }, { id: 'c1', name: 'dup' }],
    updatedAt: 5,
  });
  assert.equal(a.favorites.length, 1); // bad + dup dropped
  assert.equal(a.collections.length, 1); // duplicate id dropped
  assert.equal(a.collections[0].name.length, MAX_NAME_LEN);
  assert.equal(a.collections[0].items.length, 1); // bad item dropped
});

// ---- Worker handler ----

function fakeKV() {
  const store = new Map();
  return {
    store,
    async get(key, type) { const v = store.get(key); return v === undefined ? null : (type === 'json' ? JSON.parse(v) : v); },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
  };
}
function req(method, body, { token = 'tok' } = {}) {
  return {
    method,
    headers: { get: (h) => (h === 'Authorization' && token ? `Bearer ${token}` : null) },
    async json() { return body; },
  };
}
const fetchUser = async () => ({ githubId: '42', githubLogin: 'me' });
const deps = (kv) => ({ kv, fetchUser, now: clock, genId });

test('handler: GET returns empty activity for a new member', async () => {
  const kv = fakeKV();
  const r = await handleActivity(req('GET'), {}, deps(kv));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.activity, emptyActivity());
});

test('handler: favorite toggle persists to KV under activity:<id>', async () => {
  counter = 0;
  const kv = fakeKV();
  const r = await handleActivity(req('POST', { action: 'favorite', type: 'prompt', slug: 'p1', on: true }), {}, deps(kv));
  assert.equal(r.status, 200);
  assert.equal(r.body.activity.favorites.length, 1);
  assert.ok(kv.store.has(ACTIVITY_KEY('42')));
});

test('handler: collection create + add prompt round-trips through KV', async () => {
  counter = 0;
  const kv = fakeKV();
  const create = await handleActivity(req('POST', { action: 'collection.create', name: 'Faves' }), {}, deps(kv));
  assert.equal(create.status, 200);
  const id = create.body.id;
  assert.ok(id);
  const add = await handleActivity(req('POST', { action: 'collection.item', id, type: 'prompt', slug: 'p9', on: true }), {}, deps(kv));
  assert.equal(add.status, 200);
  const got = await handleActivity(req('GET'), {}, deps(kv));
  assert.equal(got.body.activity.collections[0].items[0].slug, 'p9');
});

test('handler: unauthorized without a token, and 400 on a bad action / invalid input', async () => {
  const kv = fakeKV();
  const noTok = await handleActivity(req('GET', null, { token: '' }), {}, deps(kv));
  assert.equal(noTok.status, 401);
  const badUser = await handleActivity(req('GET'), {}, { kv, fetchUser: async () => ({}), now: clock, genId });
  assert.equal(badUser.status, 401);
  const unknown = await handleActivity(req('POST', { action: 'nope' }), {}, deps(kv));
  assert.equal(unknown.status, 400);
  const invalid = await handleActivity(req('POST', { action: 'favorite', type: 'prompt', slug: 'Bad!', on: true }), {}, deps(kv));
  assert.equal(invalid.status, 400);
});

test('eraseMemberActivity hard-deletes the member key (right to erasure)', async () => {
  const kv = fakeKV();
  await handleActivity(req('POST', { action: 'favorite', type: 'prompt', slug: 'p', on: true }), {}, deps(kv));
  assert.ok(kv.store.has(ACTIVITY_KEY('42')));
  const e = await eraseMemberActivity({}, '42', { kv });
  assert.equal(e.ok, true);
  assert.equal(kv.store.has(ACTIVITY_KEY('42')), false);
});
