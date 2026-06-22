// SOW-059: the pure simplified-revenue-model core, tested against the 8 worked examples in
// .data/ops/revenue-ops/README.md (the spec) + the window / sum-to-100 / eligibility edge cases. No IO.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTouches, qualifyingCollaboration, computeDistribution, distributeSnapshot, FIRST_TOUCH_PCT, LAST_TOUCH_PCT, COLLAB_POOL_PCT } from '../membership/revenue-model.mjs';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ''} expected ~${b}, got ${a}`);
const sums100 = (d) => near(Object.values(d.shares).reduce((n, v) => n + v, 0) + d.retainedPct, 100, 'shares + retained');
const pts = (...pairs) => pairs.map(([member, points]) => ({ member, points }));

test('constants match the spec (30 / 10 / 5)', () => {
  assert.deepEqual([FIRST_TOUCH_PCT, LAST_TOUCH_PCT, COLLAB_POOL_PCT], [30, 10, 5]);
});

test('Example 1: simple first + last, no collaboration -> 30 / 10 / 0, retained 60', () => {
  const d = computeDistribution({ firstOwner: 'alice', lastOwner: 'bob', points: [] });
  assert.equal(d.shares.alice, 30);
  assert.equal(d.shares.bob, 10);
  assert.equal(d.collaborationUsedPct, 0);
  assert.equal(d.retainedPct, 60); // the unused 5% pool returns to retained
  sums100(d);
});

test('Example 2: same item is first AND last -> owner 40, retained 60', () => {
  const d = computeDistribution({ firstOwner: 'alice', lastOwner: 'alice', points: [] });
  assert.equal(d.shares.alice, 40);
  assert.equal(d.retainedPct, 60);
  sums100(d);
});

test('Example 3: four single-point collaborators split the 5% evenly (1.25 each)', () => {
  const d = computeDistribution({ firstOwner: 'alice', lastOwner: 'bob', points: pts(['chris', 1], ['dana', 1], ['eli', 1], ['fran', 1]) });
  assert.equal(d.shares.alice, 30); assert.equal(d.shares.bob, 10);
  for (const m of ['chris', 'dana', 'eli', 'fran']) near(d.shares[m], 1.25, m);
  near(d.collaborationUsedPct, 5); near(d.retainedPct, 55);
  sums100(d);
});

test('Example 4: one member with multiple points (Chris 2, Dana 1 -> 3.3334 / 1.6667)', () => {
  const d = computeDistribution({ firstOwner: 'alice', lastOwner: 'bob', points: pts(['chris', 2], ['dana', 1]) });
  near(d.shares.chris, (5 / 3) * 2); // 3.3333...
  near(d.shares.dana, 5 / 3);        // 1.6666...
  near(d.retainedPct, 55);
  sums100(d);
});

test('Example 5: a comment on an in-between item does not count (only first/last items)', () => {
  const first = { owner: 'alice', type: 'post', slug: 'a' };
  const between = { owner: 'clara', type: 'product', slug: 'c' };
  const last = { owner: 'bob', type: 'prompt', slug: 'b' };
  const points = qualifyingCollaboration({ firstTouch: first, lastTouch: last, conversionAt: 100, events: [
    { member: 'dana', item: between, kind: 'comment', at: 50 }, // in-between -> excluded
    { member: 'eli', item: first, kind: 'comment', at: 50 },
    { member: 'fran', item: last, kind: 'contribution', at: 60 },
  ] });
  assert.deepEqual(points.map((p) => p.member).sort(), ['eli', 'fran']);
  const d = computeDistribution({ firstOwner: 'alice', lastOwner: 'bob', points });
  near(d.shares.eli, 2.5); near(d.shares.fran, 2.5); near(d.retainedPct, 55);
  sums100(d);
});

test('Example 6: an author self-comment (and author-intro) on their own item does not count', () => {
  const first = { owner: 'alice', type: 'post', slug: 'a' };
  const last = { owner: 'bob', type: 'product', slug: 'b' };
  const points = qualifyingCollaboration({ firstTouch: first, lastTouch: last, conversionAt: 100, events: [
    { member: 'alice', item: first, kind: 'comment', at: 10, authorIntro: true }, // self author-intro -> excluded
    { member: 'chris', item: first, kind: 'comment', at: 20 },
    { member: 'dana', item: first, kind: 'contribution', at: 30 },
    { member: 'bob', item: last, kind: 'comment', at: 40 },                        // owner self-comment -> excluded
    { member: 'eli', item: last, kind: 'comment', at: 50 },
  ] });
  assert.deepEqual(points.map((p) => p.member).sort(), ['chris', 'dana', 'eli']);
  const d = computeDistribution({ firstOwner: 'alice', lastOwner: 'bob', points });
  for (const m of ['chris', 'dana', 'eli']) near(d.shares[m], 5 / 3, m);
  near(d.retainedPct, 55);
  sums100(d);
});

test('Example 7: same owner first+last (40) plus collaborators sharing the 5% pool', () => {
  const d = computeDistribution({ firstOwner: 'alice', lastOwner: 'alice', points: pts(['chris', 1], ['dana', 1], ['eli', 1]) });
  assert.equal(d.shares.alice, 40);
  for (const m of ['chris', 'dana', 'eli']) near(d.shares[m], 5 / 3, m);
  near(d.retainedPct, 55);
  sums100(d);
});

test('Example 8: a collaborator ineligible at payout is dropped; survivors re-split the pool (Dana full 5%)', () => {
  const d = distributeSnapshot(
    { firstOwner: 'alice', lastOwner: 'bob', points: pts(['chris', 1], ['dana', 1]) },
    { eligible: (m) => m !== 'chris' }, // Chris banned before payout
  );
  assert.equal(d.shares.chris, undefined);
  near(d.shares.dana, 5); // the whole pool, re-split across the one survivor
  assert.equal(d.shares.alice, 30); assert.equal(d.shares.bob, 10);
  near(d.retainedPct, 55);
  sums100(d);
});

test('an INELIGIBLE owner share falls to retained (not paid)', () => {
  const d = distributeSnapshot({ firstOwner: 'alice', lastOwner: 'bob', points: [] }, { eligible: (m) => m !== 'alice' });
  assert.equal(d.shares.alice, undefined);
  assert.equal(d.shares.bob, 10);
  assert.equal(d.retainedPct, 90); // alice's 30 + the base 60 - bob's 10... = 90
  sums100(d);
});

test('an owner who is ALSO a collaborator on the OTHER item accumulates both shares', () => {
  // Alice owns first-touch; Alice also commented on Bob's last-touch item (not her own) -> she gets 30 + a collab point.
  const d = computeDistribution({ firstOwner: 'alice', lastOwner: 'bob', points: pts(['alice', 1], ['dana', 1]) });
  near(d.shares.alice, 30 + 2.5); near(d.shares.dana, 2.5); near(d.retainedPct, 55);
  sums100(d);
});

test('resolveTouches: earliest in-window is first, latest is last; an expired touch is excluded', () => {
  const day = 86400000; const conv = 100 * day; const windowMs = 90 * day;
  const touches = [
    { owner: 'old', type: 'post', slug: 'x', at: conv - 120 * day }, // expired (>90d) -> not first
    { owner: 'alice', type: 'post', slug: 'a', at: conv - 80 * day }, // earliest in-window -> first
    { owner: 'clara', type: 'product', slug: 'c', at: conv - 40 * day },
    { owner: 'bob', type: 'prompt', slug: 'b', at: conv - 1 * day }, // latest -> last
  ];
  const { firstTouch, lastTouch } = resolveTouches(touches, { conversionAt: conv, windowMs });
  assert.equal(firstTouch.owner, 'alice');
  assert.equal(lastTouch.owner, 'bob');
  // all touches expired -> no attribution
  const none = resolveTouches([{ owner: 'old', type: 'post', slug: 'x', at: conv - 200 * day }], { conversionAt: conv, windowMs });
  assert.deepEqual(none, { firstTouch: null, lastTouch: null });
});

// ---- review fixes (strict-before + robust points) ----

test('resolveTouches excludes a touch AT the conversion instant (strictly before)', () => {
  const conv = 1000; const windowMs = 500;
  const { firstTouch, lastTouch } = resolveTouches([
    { owner: 'a', type: 'post', slug: 'x', at: 900 },
    { owner: 'b', type: 'post', slug: 'y', at: 1000 }, // AT conversion -> excluded
  ], { conversionAt: conv, windowMs });
  assert.equal(lastTouch.owner, 'a'); // not b (b is at conversion)
  assert.equal(firstTouch.owner, 'a');
});

test('computeDistribution is crash-proof + exact on malformed points', () => {
  for (const bad of [null, undefined, 'nope', 42, [null], [{}], [{ member: 'x' }], [{ member: 'x', points: 0 }], [{ member: 'x', points: -3 }], [{ member: 'x', points: Infinity }], [{ member: 'x', points: NaN }]]) {
    const d = computeDistribution({ firstOwner: 'a', lastOwner: 'b', points: bad });
    assert.equal(d.shares.a, 30); assert.equal(d.shares.b, 10);
    assert.equal(d.collaborationUsedPct, 0); // no VALID points -> pool to retained, never NaN
    assert.ok(Number.isFinite(d.retainedPct) && d.retainedPct === 60);
    assert.ok(Object.values(d.shares).every(Number.isFinite));
  }
  // a valid point mixed with junk -> only the valid one counts, pool exactly 5
  const d = computeDistribution({ firstOwner: 'a', lastOwner: 'b', points: [{ member: 'c', points: 1 }, null, { member: 'x', points: Infinity }] });
  near(d.shares.c, 5); assert.equal(d.collaborationUsedPct, 5); assert.equal(d.shares.x, undefined);
  near(Object.values(d.shares).reduce((n, v) => n + v, 0) + d.retainedPct, 100);
});

test('distributeSnapshot is crash-proof on a null points list', () => {
  const d = distributeSnapshot({ firstOwner: 'a', lastOwner: 'b', points: null });
  assert.equal(d.shares.a, 30); assert.equal(d.retainedPct, 60);
});
