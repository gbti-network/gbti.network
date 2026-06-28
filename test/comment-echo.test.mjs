// SOW-076: the pure comment-echo merge/retract core. No IO. Proves read-your-writes + retract-on-rejection (no
// phantoms) + no merged-not-deployed gap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeCommentEchoes, emptyEchoRecord, normalizeEchoRecord, addEcho, reapEchoes, CommentEchoError, MAX_ECHOES_PER_TARGET } from '../membership/comment-echo.mjs';

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

// ---- the per-target echo store ----

const E = (id, author = 'alice', extra = {}) => ({ id, author, targetType: 'post', targetSlug: 'a', body: id, ...extra });

test('addEcho appends, replaces by id, sets postedAt, and stamps updatedAt', () => {
  let r = addEcho(emptyEchoRecord(), E('e1'), { now: () => 100 });
  assert.equal(r.echoes.length, 1);
  assert.equal(r.echoes[0].postedAt, 100);
  assert.equal(r.updatedAt, 100);
  r = addEcho(r, E('e1', 'alice', { body: 'edited' }), { now: () => 200 }); // same id -> replace
  assert.equal(r.echoes.length, 1);
  assert.equal(r.echoes[0].body, 'edited');
});

test('addEcho rejects a malformed echo; the store caps at MAX_ECHOES_PER_TARGET (newest kept)', () => {
  assert.throws(() => addEcho(emptyEchoRecord(), { id: 'x' }), CommentEchoError);
  let r = emptyEchoRecord();
  for (let i = 0; i < MAX_ECHOES_PER_TARGET + 5; i++) r = addEcho(r, E('e' + i), { now: () => 1000 + i });
  assert.equal(r.echoes.length, MAX_ECHOES_PER_TARGET);
  assert.ok(r.echoes.some((e) => e.id === 'e' + (MAX_ECHOES_PER_TARGET + 4)), 'newest retained');
  assert.ok(!r.echoes.some((e) => e.id === 'e0'), 'oldest evicted');
});

test('reapEchoes removes ids; with an author guard it only reaps that author\'s own', () => {
  let r = addEcho(addEcho(emptyEchoRecord(), E('e1', 'alice')), E('e2', 'bob'));
  // alice may not reap bob's echo
  let after = reapEchoes(r, ['e1', 'e2'], { author: 'alice' });
  assert.deepEqual(after.echoes.map((e) => e.id).sort(), ['e2']);
  // the reconcile sweep (no author) reaps any
  after = reapEchoes(r, ['e1', 'e2']);
  assert.deepEqual(after.echoes, []);
});

test('normalizeEchoRecord drops malformed + dedupes by id; null is an empty record', () => {
  const r = normalizeEchoRecord({ echoes: [E('e1', 'alice', { postedAt: 1 }), E('e1', 'alice', { postedAt: 5 }), { id: 'bad' }, null], updatedAt: 7 });
  assert.equal(r.echoes.length, 1);
  assert.equal(r.echoes[0].postedAt, 5); // newest of the dup
  assert.deepEqual(normalizeEchoRecord(null), emptyEchoRecord());
});
