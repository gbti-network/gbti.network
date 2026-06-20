// SOW-053 Part B: the PR-conflict surfacing helpers (scripts/lib/pr-conflict.mjs) + the reconcile sweep
// (surfaceConflicts). Pure classification + an idempotent, fail-soft, dry-run-aware sweep over a mock GitHub client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeState, alreadyLabeled, conflictComment, conflictAction, CONFLICT_LABEL } from '../scripts/lib/pr-conflict.mjs';
import { surfaceConflicts } from '../scripts/reconcile.mjs';

test('mergeState: dirty / mergeable false = conflicting; null / unknown = unknown; else clean', () => {
  assert.equal(mergeState({ mergeable_state: 'dirty' }), 'conflicting');
  assert.equal(mergeState({ mergeable: false }), 'conflicting');
  assert.equal(mergeState({ mergeable: null }), 'unknown');           // not computed yet
  assert.equal(mergeState({ mergeable_state: 'unknown' }), 'unknown');
  assert.equal(mergeState({ mergeable: true, mergeable_state: 'clean' }), 'clean');
  assert.equal(mergeState({ mergeable: true, mergeable_state: 'behind' }), 'clean'); // behind != conflict
  assert.equal(mergeState({}), 'unknown');
});

test('alreadyLabeled reads object {name} or string labels', () => {
  assert.equal(alreadyLabeled({ labels: [{ name: 'needs-rebase' }] }), true);
  assert.equal(alreadyLabeled({ labels: ['needs-rebase'] }), true);
  assert.equal(alreadyLabeled({ labels: [{ name: 'other' }] }), false);
  assert.equal(alreadyLabeled({}), false);
});

test('conflictComment @-mentions the author and tells them to re-publish (no git/rebase ask)', () => {
  const c = conflictComment('alice');
  assert.match(c, /^@alice /);
  assert.match(c, /publish it again/i);
  assert.match(c, /do not need to touch git/i);
  assert.doesNotMatch(conflictComment(''), /^@/); // no login -> no stray mention
});

test('conflictAction surfaces only a conflicting + unlabeled PR', () => {
  assert.deepEqual(conflictAction({ mergeable_state: 'dirty', user: { login: 'bob' } }), { surface: true, login: 'bob' });
  assert.equal(conflictAction({ mergeable_state: 'dirty', labels: [{ name: CONFLICT_LABEL }] }).surface, false); // already surfaced
  assert.equal(conflictAction({ mergeable_state: 'clean' }).surface, false);
  assert.equal(conflictAction({ mergeable: null }).surface, false); // unknown -> wait
});

// ---- the sweep ----
function mockGithub(pulls) {
  const calls = { labels: [], comments: [] };
  return {
    calls,
    listOpenPulls: async () => pulls.map((p) => ({ number: p.number, user: p.user })),
    getPull: async (n) => pulls.find((p) => p.number === n),
    addLabels: async (n, labels) => { calls.labels.push({ n, labels }); },
    comment: async (n, body) => { calls.comments.push({ n, body }); },
  };
}

test('surfaceConflicts labels + comments each conflicting unlabeled PR on apply', async () => {
  const github = mockGithub([
    { number: 1, user: { login: 'alice' }, mergeable_state: 'dirty', labels: [] },          // surface
    { number: 2, user: { login: 'bob' }, mergeable: true, mergeable_state: 'clean', labels: [] }, // skip (clean)
    { number: 3, user: { login: 'cara' }, mergeable_state: 'dirty', labels: [{ name: CONFLICT_LABEL }] }, // skip (already)
    { number: 4, user: { login: 'dan' }, mergeable: null, labels: [] },                      // skip (unknown)
  ]);
  const surfaced = await surfaceConflicts({ github, dryRun: false });
  assert.deepEqual(surfaced.map((s) => s.number), [1]);
  assert.deepEqual(github.calls.labels, [{ n: 1, labels: [CONFLICT_LABEL] }]);
  assert.equal(github.calls.comments.length, 1);
  assert.match(github.calls.comments[0].body, /@alice/);
});

test('surfaceConflicts in dry-run reports but does not mutate', async () => {
  const github = mockGithub([{ number: 7, user: { login: 'eve' }, mergeable_state: 'dirty', labels: [] }]);
  const surfaced = await surfaceConflicts({ github, dryRun: true });
  assert.deepEqual(surfaced.map((s) => s.number), [7]);
  assert.equal(github.calls.labels.length, 0);
  assert.equal(github.calls.comments.length, 0);
});

test('surfaceConflicts is fail-soft (a listOpenPulls error yields [])', async () => {
  const github = { listOpenPulls: async () => { throw new Error('boom'); } };
  assert.deepEqual(await surfaceConflicts({ github, dryRun: false }), []);
  assert.deepEqual(await surfaceConflicts({}), []); // no client -> []
});
