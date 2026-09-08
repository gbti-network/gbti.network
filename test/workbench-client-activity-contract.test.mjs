// sow-316: the website client's activity writes must be readable by the Worker that receives them.
//
// The defect this pins: the website client posted { targetType, targetSlug } and the Worker core reads
// { type, slug }, so a signed-in website member's heart reverted and a collection tick never stuck, while
// creating a collection (no item in the payload) worked. Every unit test on both sides was green, because
// each side was tested against its own vocabulary and nothing fed one to the other. This test does exactly
// that: build the payload the way the client does, hand it to the Worker's reader, and require the item to
// land. The negative control feeds the OLD shape and requires the Worker to refuse it, so a green run here
// is one that could have gone red.
import test from 'node:test';
import assert from 'node:assert/strict';

import { activityFavoritePayload, activityCollectionItemPayload, favoritedFrom } from '../src/lib/workbench-client-core.mjs';
import { emptyActivity, applyFavorite, createCollection, setCollectionItem, ActivityError } from '../membership/member-activity.mjs';

const clock = () => 1000;
const ITEM = { targetType: 'post', targetSlug: 'how-to-always-show-claude-code-usage-in-the-terminal' };

test('a favorite built by the website client is accepted by the Worker core and reads back as favorited', () => {
  const payload = activityFavoritePayload({ ...ITEM, on: true });
  assert.equal(payload.action, 'favorite');
  const next = applyFavorite(emptyActivity(), payload, { now: clock });
  assert.equal(next.favorites.length, 1, 'the item landed in the favorites list');
  assert.equal(favoritedFrom(next, ITEM.targetType, ITEM.targetSlug), true, 'the element keeps the heart lit from this answer');
  const off = applyFavorite(next, activityFavoritePayload({ ...ITEM, on: false }), { now: clock });
  assert.equal(favoritedFrom(off, ITEM.targetType, ITEM.targetSlug), false, 'and un-favoriting reads back too');
});

test('a collection tick built by the website client lands in the collection the Worker holds', () => {
  const { activity, id } = createCollection(emptyActivity(), { name: 'Tutorials' }, { now: clock, genId: () => 'c1' });
  const next = setCollectionItem(activity, activityCollectionItemPayload({ id, ...ITEM, on: true }), { now: clock });
  assert.equal(next.collections[0].items.length, 1);
  assert.deepEqual(next.collections[0].items[0], { type: 'post', slug: ITEM.targetSlug, addedAt: 1000 });
  const gone = setCollectionItem(next, activityCollectionItemPayload({ id, ...ITEM, on: false }), { now: clock });
  assert.equal(gone.collections[0].items.length, 0);
});

test('negative control: the shape the client used to send is refused by the Worker core', () => {
  // If this stops throwing, the Worker started accepting the element's names, and the test above no longer
  // proves the client conforms to anything. Keep both.
  assert.throws(() => applyFavorite(emptyActivity(), { action: 'favorite', targetType: 'post', targetSlug: 'x', on: true }, { now: clock }), ActivityError);
  const { activity, id } = createCollection(emptyActivity(), { name: 'T' }, { now: clock, genId: () => 'c1' });
  assert.throws(() => setCollectionItem(activity, { action: 'collection.item', id, targetType: 'post', targetSlug: 'x', on: true }, { now: clock }), ActivityError);
});

test('every content type the site renders a heart for is a type the Worker accepts', () => {
  // FavoriteButton.astro stamps post | project | prompt | share. A type the Worker does not know would revert
  // on that content type only, which is the kind of partial defect a single-type test hides.
  // A share's slug is `<author>/<id>` (the Worker's SHARE_SLUG_RE); the other three are a bare slug.
  for (const [targetType, targetSlug] of [['post', 'a-slug'], ['project', 'a-slug'], ['prompt', 'a-slug'], ['share', 'atwellpub/abc123']]) {
    const next = applyFavorite(emptyActivity(), activityFavoritePayload({ targetType, targetSlug, on: true }), { now: clock });
    assert.equal(favoritedFrom(next, targetType, targetSlug), true, targetType);
  }
});

// The same payload through the Worker HANDLER, so the check crosses the real boundary (auth resolved from a
// fake verifier, the read-modify-write against a fake KV) and not only the pure core behind it.
import { handleActivity, ACTIVITY_KEY } from '../workers/signup/membership-activity.mjs';

// authorizeMemberCheap reads the overrides mirror from the same KV and fails closed without one, so seed a fresh
// mirror the way test/member-activity.test.mjs does; an unseeded store answers 403, not the 400 under test.
const freshMirror = () => ({ generatedAt: new Date().toISOString(), roles: {}, bans: { bans: [] }, grandfathered: { grandfathered: [] } });
function fakeKV() {
  const store = new Map();
  store.set('overrides:mirror', JSON.stringify(freshMirror()));
  return {
    store,
    async get(key, type) { const v = store.get(key); return v === undefined ? null : (type === 'json' ? JSON.parse(v) : v); },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
  };
}
const req = (method, body) => ({ method, headers: { get: (h) => (h === 'Authorization' ? 'Bearer tok' : null) }, async json() { return body; } });
const deps = (kv) => ({ kv, fetchUser: async () => ({ githubId: '42', githubLogin: 'me' }), now: clock, genId: () => 'c1' });

test('handler: the website client payloads persist through the Worker route, and the old shape is a 400', async () => {
  const kv = fakeKV();
  const fav = await handleActivity(req('POST', activityFavoritePayload({ ...ITEM, on: true })), {}, deps(kv));
  assert.equal(fav.status, 200, JSON.stringify(fav.body));
  assert.equal(favoritedFrom(fav.body.activity, ITEM.targetType, ITEM.targetSlug), true);
  assert.ok(kv.store.has(ACTIVITY_KEY('42')), 'written to the member key');
  const made = await handleActivity(req('POST', { action: 'collection.create', name: 'Tutorials' }), {}, deps(kv));
  const tick = await handleActivity(req('POST', activityCollectionItemPayload({ id: made.body.id, ...ITEM, on: true })), {}, deps(kv));
  assert.equal(tick.status, 200, JSON.stringify(tick.body));
  assert.equal(tick.body.activity.collections[0].items.length, 1);
  const old = await handleActivity(req('POST', { action: 'favorite', targetType: 'post', targetSlug: 'x', on: true }), {}, deps(kv));
  assert.equal(old.status, 400, 'the shape the client used to send is what the member saw revert');
  assert.match(String(old.body.message), /invalid favorite target/);
});
