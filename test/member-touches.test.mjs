// SOW-059 P1b: the pure pre-signup touch-store core. No IO. Verifies the per-item first/last model, the invite
// first-wins rule, the bounded cap (earliest-first-touch always retained), normalization, and that toTouchLog feeds
// resolveTouches to the correct first/last owner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyTouches, normalizeTouches, addTouch, setInvite, toTouchLog, TouchError, MAX_TOUCHED_ITEMS } from '../membership/member-touches.mjs';
import { resolveTouches } from '../membership/revenue-model.mjs';

const clock = (t) => () => t;
const item = (owner, slug, type = 'post') => ({ owner, type, slug });

test('emptyTouches is a clean empty record', () => {
  assert.deepEqual(emptyTouches(), { items: [], invite: null, updatedAt: 0 });
});

test('addTouch: a new item records [firstAt, lastAt] = the touch time', () => {
  const r = addTouch(emptyTouches(), { ...item('alice', 'a'), at: 100 }, { now: clock(100) });
  assert.equal(r.items.length, 1);
  assert.deepEqual(r.items[0], { owner: 'alice', type: 'post', slug: 'a', firstAt: 100, lastAt: 100 });
  assert.equal(r.updatedAt, 100);
});

test('addTouch: revisiting the same item WIDENS [firstAt, lastAt], no duplicate', () => {
  let r = addTouch(emptyTouches(), { ...item('alice', 'a'), at: 100 }, { now: clock(100) });
  r = addTouch(r, { ...item('alice', 'a'), at: 300 }, { now: clock(300) });
  r = addTouch(r, { ...item('alice', 'a'), at: 50 }, { now: clock(300) }); // an earlier touch widens firstAt
  assert.equal(r.items.length, 1);
  assert.deepEqual(r.items[0], { owner: 'alice', type: 'post', slug: 'a', firstAt: 50, lastAt: 300 });
});

test('addTouch: distinct items are kept separately', () => {
  let r = addTouch(emptyTouches(), { ...item('alice', 'a'), at: 100 });
  r = addTouch(r, { ...item('bob', 'b', 'product'), at: 200 });
  assert.equal(r.items.length, 2);
  assert.deepEqual(r.items.map((i) => i.owner).sort(), ['alice', 'bob']);
});

test('addTouch: rejects a malformed touch', () => {
  for (const bad of [null, {}, { owner: 'a' }, { owner: 'a', type: 'banana', slug: 'x' }, { owner: 'a', type: 'post' }, { owner: '', type: 'post', slug: 'x' }]) {
    assert.throws(() => addTouch(emptyTouches(), bad), TouchError);
  }
});

test('cap: bounded to MAX_TOUCHED_ITEMS, keeping the earliest-first-touch + the most-recent others', () => {
  let r = emptyTouches();
  // the earliest touch (at=1) on a DISTINCT item, then MAX_TOUCHED_ITEMS later items
  r = addTouch(r, { ...item('first', 'discovery'), at: 1 }, { now: clock(1) });
  for (let i = 0; i < MAX_TOUCHED_ITEMS + 5; i++) {
    r = addTouch(r, { ...item('m' + i, 's' + i), at: 1000 + i }, { now: clock(1000 + i) });
  }
  assert.equal(r.items.length, MAX_TOUCHED_ITEMS);
  // the earliest-first-touch item survived the cap (so the discovery share is not lost)
  assert.ok(r.items.some((it) => it.owner === 'first' && it.firstAt === 1), 'earliest-first-touch retained');
  // the oldest of the bulk items (s0) was evicted in favor of the newest
  assert.ok(!r.items.some((it) => it.slug === 's0'), 's0 evicted as least-recent');
  assert.ok(r.items.some((it) => it.slug === 's' + (MAX_TOUCHED_ITEMS + 4)), 'newest retained');
});

test('setInvite: first invite wins; a later one does not override', () => {
  let r = setInvite(emptyTouches(), '  alice-code  ', { now: clock(10) });
  assert.equal(r.invite, 'alice-code');
  assert.equal(r.updatedAt, 10);
  r = setInvite(r, 'bob-code', { now: clock(20) });
  assert.equal(r.invite, 'alice-code'); // unchanged
  assert.throws(() => setInvite(emptyTouches(), '   '), TouchError);
});

test('normalizeTouches: tolerant of garbage; merges duplicate items; coerces', () => {
  const r = normalizeTouches({
    items: [
      { owner: 'a', type: 'post', slug: 'x', firstAt: 100, lastAt: 100 },
      { owner: 'a', type: 'post', slug: 'x', firstAt: 50, lastAt: 200 }, // dup -> merge to [50, 200]
      { owner: 'b', type: 'banana', slug: 'y', firstAt: 1, lastAt: 1 },   // bad type -> dropped
      null, { owner: 'c', type: 'post', slug: 'z' },                       // missing times -> dropped
    ],
    invite: '  code  ', updatedAt: '7',
  });
  assert.equal(r.items.length, 1);
  assert.deepEqual(r.items[0], { owner: 'a', type: 'post', slug: 'x', firstAt: 50, lastAt: 200 });
  assert.equal(r.invite, 'code'); assert.equal(r.updatedAt, 7);
  assert.deepEqual(normalizeTouches(null), emptyTouches());
  assert.deepEqual(normalizeTouches('nope'), emptyTouches());
});

test('toTouchLog: expands first + last per item (one entry when they coincide)', () => {
  const r = { items: [
    { owner: 'a', type: 'post', slug: 'x', firstAt: 10, lastAt: 90 }, // -> two entries
    { owner: 'b', type: 'product', slug: 'y', firstAt: 50, lastAt: 50 }, // -> one entry
  ], invite: null, updatedAt: 0 };
  const log = toTouchLog(r);
  assert.equal(log.length, 3);
  assert.deepEqual(log.filter((t) => t.owner === 'a').map((t) => t.at).sort((m, n) => m - n), [10, 90]);
  assert.deepEqual(log.filter((t) => t.owner === 'b').map((t) => t.at), [50]);
});

// ---- integration: the store feeds resolveTouches to the right first/last owner ----

test('integration: addTouch x N -> toTouchLog -> resolveTouches resolves earliest=first, latest=last', () => {
  const day = 86400000; const conv = 100 * day; const windowMs = 90 * day;
  let r = emptyTouches();
  r = addTouch(r, { ...item('old', 'expired'), at: conv - 120 * day }); // out of window
  r = addTouch(r, { ...item('alice', 'a'), at: conv - 80 * day });       // earliest in-window -> first
  r = addTouch(r, { ...item('clara', 'c', 'product'), at: conv - 40 * day });
  r = addTouch(r, { ...item('bob', 'b', 'prompt'), at: conv - 1 * day }); // latest -> last
  const { firstTouch, lastTouch } = resolveTouches(toTouchLog(r), { conversionAt: conv, windowMs });
  assert.equal(firstTouch.owner, 'alice');
  assert.equal(lastTouch.owner, 'bob');
});

test('integration: a single revisited item is BOTH first and last (owner gets 40 via computeDistribution)', () => {
  const day = 86400000; const conv = 100 * day; const windowMs = 90 * day;
  let r = addTouch(emptyTouches(), { ...item('alice', 'a'), at: conv - 70 * day });
  r = addTouch(r, { ...item('alice', 'a'), at: conv - 2 * day }); // revisit: widens to [first, last]
  const { firstTouch, lastTouch } = resolveTouches(toTouchLog(r), { conversionAt: conv, windowMs });
  assert.equal(firstTouch.owner, 'alice');
  assert.equal(lastTouch.owner, 'alice'); // same owner both -> 40% downstream
});

// SOW-059 (owner decision 2026-07-11): a member PROFILE page is an eligible entry-point touch, first-class
// in the touch store like post/product/prompt.
test('a profile touch records and resolves like any content touch', () => {
  let rec = addTouch(emptyTouches(), { owner: '2002207', type: 'profile', slug: 'atwellpub', at: 1000 }, { now: () => 1000 });
  rec = addTouch(rec, { owner: '999', type: 'post', slug: 'later-article', at: 2000 }, { now: () => 2000 });
  assert.equal(rec.items.length, 2);
  const profile = rec.items.find((it) => it.type === 'profile');
  assert.equal(profile.owner, '2002207');
  assert.equal(profile.firstAt, 1000, 'the profile landing holds the earliest touch');
  assert.throws(() => addTouch(emptyTouches(), { owner: 'x', type: 'wiki', slug: 's', at: 1 }, { now: () => 1 }), /touch/i);
});
