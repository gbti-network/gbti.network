// SOW-059 P1c: the pure conversion-snapshot composer + the END-TO-END pure pipeline (touch capture -> freeze ->
// distribute), proving the full money split with no IO.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyTouches, addTouch, setInvite } from '../membership/member-touches.mjs';
import { freezeSnapshot } from '../membership/conversion-snapshot.mjs';
import { distributeSnapshot } from '../membership/revenue-model.mjs';

const day = 86400000;
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-9, `${m || ''} expected ~${b}, got ${a}`);
const sums100 = (d) => near(Object.values(d.shares).reduce((n, v) => n + v, 0) + d.retainedPct, 100);

test('freezeSnapshot: resolves first/last owner + items + invite from the touch record', () => {
  const conv = 100 * day; const windowMs = 90 * day;
  let rec = emptyTouches();
  rec = addTouch(rec, { owner: 'alice', type: 'post', slug: 'a', at: conv - 60 * day });
  rec = addTouch(rec, { owner: 'bob', type: 'product', slug: 'b', at: conv - 2 * day });
  rec = setInvite(rec, 'carol', { now: () => conv - 61 * day });
  const snap = freezeSnapshot({ touchRecord: rec, conversionAt: conv, windowMs });
  assert.equal(snap.firstOwner, 'alice');
  assert.equal(snap.lastOwner, 'bob');
  assert.deepEqual(snap.firstItem, { owner: 'alice', type: 'post', slug: 'a' });
  assert.deepEqual(snap.lastItem, { owner: 'bob', type: 'product', slug: 'b' });
  assert.equal(snap.inviter, 'carol');
  assert.deepEqual(snap.points, []); // no collaboration events supplied
});

test('END TO END: touch + invite + a collaborator -> freeze -> distribute = 30 / 10 / 5 / 10 invite / 45', () => {
  const conv = 100 * day; const windowMs = 90 * day;
  let rec = emptyTouches();
  rec = addTouch(rec, { owner: 'alice', type: 'post', slug: 'a', at: conv - 60 * day });   // first
  rec = addTouch(rec, { owner: 'bob', type: 'product', slug: 'b', at: conv - 2 * day });    // last
  rec = setInvite(rec, 'carol');                                                            // invite lane
  const events = [{ member: 'dana', item: { owner: 'bob', type: 'product', slug: 'b' }, kind: 'comment', at: conv - 1 * day }];
  const snap = freezeSnapshot({ touchRecord: rec, conversionAt: conv, windowMs, collaborationEvents: events });
  const d = distributeSnapshot(snap, { eligible: () => true });
  assert.equal(d.shares.alice, 30);
  assert.equal(d.shares.bob, 10);
  near(d.shares.dana, 5);          // sole collaboration point on a touch item
  assert.equal(d.shares.carol, 10); // invite lane (carol is not an owner)
  near(d.retainedPct, 45);
  sums100(d);
});

test('END TO END no-double-dip: an invite from the first-touch owner pays the content share, not the invite', () => {
  const conv = 100 * day; const windowMs = 90 * day;
  let rec = emptyTouches();
  rec = addTouch(rec, { owner: 'alice', type: 'post', slug: 'a', at: conv - 30 * day });
  rec = addTouch(rec, { owner: 'bob', type: 'product', slug: 'b', at: conv - 1 * day });
  rec = setInvite(rec, 'alice'); // alice invited them to her own content
  const d = distributeSnapshot(freezeSnapshot({ touchRecord: rec, conversionAt: conv, windowMs }), {});
  assert.equal(d.shares.alice, 30);
  assert.equal(d.invitePaidPct, 0);
  assert.equal(d.retainedPct, 60);
  sums100(d);
});

test('END TO END direct invite (no content touched): inviter 10, retained 90', () => {
  const conv = 100 * day; const windowMs = 90 * day;
  const rec = setInvite(emptyTouches(), 'carol');
  const snap = freezeSnapshot({ touchRecord: rec, conversionAt: conv, windowMs });
  assert.equal(snap.firstOwner, null); assert.equal(snap.lastOwner, null); assert.equal(snap.inviter, 'carol');
  const d = distributeSnapshot(snap, {});
  assert.equal(d.shares.carol, 10); assert.equal(d.retainedPct, 90);
  sums100(d);
});

test('freezeSnapshot: an expired touch is excluded by the window; an empty record yields nulls', () => {
  const conv = 100 * day; const windowMs = 90 * day;
  let rec = addTouch(emptyTouches(), { owner: 'old', type: 'post', slug: 'x', at: conv - 120 * day }); // expired
  const snap = freezeSnapshot({ touchRecord: rec, conversionAt: conv, windowMs });
  assert.equal(snap.firstOwner, null); assert.equal(snap.lastOwner, null);
  const empty = freezeSnapshot({ touchRecord: emptyTouches(), conversionAt: conv, windowMs });
  assert.deepEqual(empty.points, []); assert.equal(empty.inviter, null);
});

test('freezeSnapshot: an explicit inviter overrides the record invite', () => {
  const conv = 100 * day;
  const rec = setInvite(emptyTouches(), 'carol');
  assert.equal(freezeSnapshot({ touchRecord: rec, conversionAt: conv, windowMs: 90 * day, inviter: 'dave' }).inviter, 'dave');
});
