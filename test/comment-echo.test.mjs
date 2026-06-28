// SOW-076: the pure comment-echo merge/retract core. No IO. Proves read-your-writes + retract-on-rejection (no
// phantoms) + no merged-not-deployed gap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeCommentEchoes } from '../membership/comment-echo.mjs';

const c = (id, createdAt, extra = {}) => ({ id, createdAt, body: id, ...extra });
const echo = (id, prNumber, postedAt) => ({ id, prNumber, postedAt, body: id });

test('an open-PR echo not yet deployed renders as pending', () => {
  const r = mergeCommentEchoes({ deployed: [], echoes: [echo('e1', 7, '2026-06-28T00:00:01Z')], prState: () => 'open' });
  assert.equal(r.comments.length, 1);
  assert.equal(r.comments[0].id, 'e1');
  assert.equal(r.comments[0]._pending, true);
  assert.ok(r.pending.has('e1'));
  assert.deepEqual(r.reap, []);
});

test('git wins: once a comment is in the deployed build, its echo is reaped (deduped)', () => {
  const r = mergeCommentEchoes({ deployed: [c('e1', '2026-06-28T00:00:00Z')], echoes: [echo('e1', 7)], prState: () => 'merged' });
  assert.equal(r.comments.length, 1);
  assert.equal(r.comments[0]._pending, undefined); // the deployed (authoritative) copy, not the echo
  assert.deepEqual(r.reap, ['e1']);
  assert.equal(r.pending.has('e1'), false);
});

test('retract-on-rejection: a closed/declined PR reaps the echo (no phantom comment)', () => {
  const r = mergeCommentEchoes({ deployed: [], echoes: [echo('e1', 7)], prState: () => 'closed' });
  assert.deepEqual(r.comments, []);
  assert.deepEqual(r.reap, ['e1']);
  assert.equal(r.pending.has('e1'), false);
});

test('no gap: a merged-but-not-yet-deployed echo is KEPT until it appears in the deployed build', () => {
  const r = mergeCommentEchoes({ deployed: [], echoes: [echo('e1', 7)], prState: () => 'merged' });
  assert.equal(r.comments.length, 1); // still shown -> the comment never blinks out during the deploy
  assert.equal(r.comments[0]._pending, true);
  assert.deepEqual(r.reap, []);
});

test('merges + sorts deployed and pending echoes oldest-first', () => {
  const r = mergeCommentEchoes({
    deployed: [c('d1', '2026-06-28T00:00:00Z'), c('d2', '2026-06-28T00:00:05Z')],
    echoes: [echo('e1', 7, '2026-06-28T00:00:03Z')],
    prState: () => 'open',
  });
  assert.deepEqual(r.comments.map((x) => x.id), ['d1', 'e1', 'd2']);
});

test('duplicate echo ids are collapsed; empty inputs are safe', () => {
  const r = mergeCommentEchoes({ deployed: [], echoes: [echo('e1', 7), echo('e1', 7)], prState: () => 'open' });
  assert.equal(r.comments.length, 1);
  assert.deepEqual(mergeCommentEchoes({}), { comments: [], reap: [], pending: new Set() });
});

test('default prState (unknown = still in flight) keeps an undeployed echo', () => {
  const r = mergeCommentEchoes({ echoes: [echo('e1', 7)] });
  assert.equal(r.comments.length, 1);
  assert.equal(r.comments[0]._pending, true);
});
