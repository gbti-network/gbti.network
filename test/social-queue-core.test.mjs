// sow-282: the Social Queue's Mark done and Delete froze the whole panel on every click.
//
// `_action` set `_busy`, which dims all rows and kills pointer events, then made TWO sequential Worker
// round trips: the action, then `await this.load()` refetching the entire queue. Nothing moved on screen
// until both returned. These tests cover the pure transformation that replaces the wait, and the two
// things most likely to be got wrong or silently regressed:
//
//   - THE ROLLBACK, which is the half nobody exercises. An optimistic UI whose revert is untested fails
//     into a state that LOOKS correct, so the failure path is tested here as carefully as the happy one.
//   - THE SECOND ROUND TRIP, which a later edit could reintroduce while every behavioural test still
//     passes. It is pinned by a source assertion, since latency is not observable from the core.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyQueueAction, revertQueueAction } from '../client-ui/src/social-queue-core.mjs';

const src = (rel) => fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

/** A queue with the target deliberately in the MIDDLE, so restoring to the end is detectable. */
const fixture = () => ({
  pending: [{ id: 'a', title: 'first' }, { id: 'b', title: 'target' }, { id: 'c', title: 'third' }],
  done: [{ id: 'z', title: 'already done', doneAt: 111 }],
});

test('sow-282 mark done: the row moves from pending to done and is stamped', () => {
  const before = fixture();
  const { next } = applyQueueAction(before, 'done', 'b', { now: 999 });
  assert.deepEqual(next.pending.map((r) => r.id), ['a', 'c']);
  assert.equal(next.done[0].id, 'b');
  assert.equal(next.done[0].doneAt, 999);
  assert.equal(next.done.length, 2, 'the pre-existing done row must survive');
});

test('sow-282 delete: the row is removed, from either list', () => {
  const fromPending = applyQueueAction(fixture(), 'delete', 'b');
  assert.deepEqual(fromPending.next.pending.map((r) => r.id), ['a', 'c']);
  assert.equal(fromPending.next.done.length, 1, 'delete must not touch the other list');

  const fromDone = applyQueueAction(fixture(), 'delete', 'z');
  assert.deepEqual(fromDone.next.done, []);
  assert.equal(fromDone.next.pending.length, 3);
});

test('sow-282 ROLLBACK restores the exact original INDEX, not merely presence', () => {
  // The point of the test: a row that comes back at the BOTTOM of a 49 item list reads to the operator as
  // a second bug, not as a recovery. Presence alone is not enough, so assert position.
  const before = fixture();
  const { next, undo } = applyQueueAction(before, 'delete', 'b');
  assert.deepEqual(next.pending.map((r) => r.id), ['a', 'c']);

  const reverted = revertQueueAction(next, undo);
  assert.deepEqual(reverted.pending.map((r) => r.id), ['a', 'b', 'c'], 'b must return to the MIDDLE');
  assert.deepEqual(reverted, before, 'a reverted queue must equal the one the operator last saw');
});

test('sow-282 ROLLBACK after mark done removes the added copy AND restores position', () => {
  // Mark done both removes and adds, so its revert has two halves. Dropping the added copy is the half a
  // naive revert forgets, and it would leave the row visible in BOTH tabs.
  const before = fixture();
  const { next, undo } = applyQueueAction(before, 'done', 'b', { now: 999 });
  const reverted = revertQueueAction(next, undo);

  assert.deepEqual(reverted.pending.map((r) => r.id), ['a', 'b', 'c']);
  assert.deepEqual(reverted.done.map((r) => r.id), ['z'], 'the optimistic done copy must be gone');
  assert.deepEqual(reverted, before);
});

test('sow-282 post is NOT locally computable and must return null', () => {
  // A real publish to Reddit or LinkedIn cannot be emulated: the client does not know whether the network
  // accepted it. null is the signal to keep the synchronous path rather than render a success that may
  // never have happened.
  assert.equal(applyQueueAction(fixture(), 'post', 'b'), null);
  assert.equal(applyQueueAction(fixture(), 'nonsense', 'b'), null);
});

test('sow-282 an unknown id, a missing queue, and an already-done row all return null', () => {
  assert.equal(applyQueueAction(fixture(), 'delete', 'nope'), null);
  assert.equal(applyQueueAction(null, 'delete', 'b'), null);
  assert.equal(applyQueueAction(fixture(), 'delete', ''), null);
  assert.equal(applyQueueAction(fixture(), 'done', 'z'), null, 'z is already in done: nothing to emulate');
});

test('sow-282 the core is pure: the caller\'s queue object is never mutated', () => {
  const before = fixture();
  const snapshot = JSON.parse(JSON.stringify(before));
  applyQueueAction(before, 'done', 'b', { now: 999 });
  applyQueueAction(before, 'delete', 'a');
  assert.deepEqual(before, snapshot, 'applyQueueAction mutated its input');
});

test('sow-282 revert clamps rather than throwing if the list shrank underneath it', () => {
  const { undo } = applyQueueAction(fixture(), 'delete', 'c'); // index 2
  const shrunk = { pending: [{ id: 'a' }], done: [] };
  const out = revertQueueAction(shrunk, undo);
  assert.deepEqual(out.pending.map((r) => r.id), ['a', 'c'], 'appended at the clamped position, no throw');
});

test('sow-282 the optimistic path makes exactly ONE client call and never refetches', () => {
  // Latency is not observable from the core, so pin it at the source. A later edit reintroducing
  // `await this.load()` would restore most of the delay while every behavioural test above still passed.
  const text = src('client-ui/src/elements/gbti-social-queue.mjs');
  const fn = text.match(/async _action\(action, id\) \{[\s\S]*?\n  \}/);
  assert.ok(fn, 'could not extract _action from the component: this guard would otherwise pass vacuously');

  // Target the OPTIMISTIC branch only. `post` legitimately still awaits and still refetches, because its
  // outcome depends on an external adapter and is not locally computable, so a whole-function assertion
  // here would be wrong rather than strict.
  const opt = fn[0].match(/if \(opt\) \{[\s\S]*?\n      return;\n    \}/);
  assert.ok(opt, 'could not extract the optimistic branch: this guard would otherwise pass vacuously');
  const body = opt[0];

  assert.equal((body.match(/this\.client\.socialQueueAction\(/g) || []).length, 1,
    'the optimistic path must call the Worker exactly once');
  assert.ok(!/this\.load\(\)/.test(body),
    'the optimistic path must not refetch the queue: that is the second round trip sow-282 removed');
  assert.ok(/applyQueueAction/.test(fn[0]) && /revertQueueAction/.test(body),
    'it must apply the change and be able to revert it on failure');
  assert.ok(!/_busy\b/.test(text.replace(/_rowBusy/g, '')),
    'the panel-wide busy freeze must be gone: busy is per-row now');
});
