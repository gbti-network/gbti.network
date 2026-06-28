// SOW-028 P2/P3: the owner-side contribution review ops (getContributionReview + reviewContribution) and the
// pure diff parser. Fail-closed: both ops only ever touch a PR another member opened entirely inside the
// signed-in owner's folder. No network (a fake repo client records calls).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getContributionReview, reviewContribution, OperationError } from '../client/src/operations.mjs';
import { diffRows, diffTotals } from '../client-ui/src/contrib-diff.mjs';

function fakeRepo({ pull, files = [], contentByPath = {} } = {}) {
  const calls = { reviews: [], comments: [], closed: [] };
  return {
    calls,
    async getPull() { return pull; },
    async getPullDiffFiles() { return files; },
    async getFileContent(path) { return contentByPath[path] ?? null; },
    async submitReview(number, opts) { calls.reviews.push({ number, ...opts }); return { id: 1 }; },
    async commentOnPull(number, body) { calls.comments.push({ number, body }); return { id: 2 }; },
    async closePull(number) { calls.closed.push(number); return { state: 'closed' }; },
  };
}
function ctx({ identity = { login: 'alice', githubId: '1', username: 'alice' }, repo } = {}) {
  return { identity: () => identity, getRepoClient: () => repo };
}
const bobPull = (extra = {}) => ({ number: 7, title: 'Improve X', html_url: 'u7', state: 'open', headSha: 'HEAD7', author: { login: 'bob', id: '2' }, ...extra });
const f = (filename, extra = {}) => ({ filename, status: 'modified', additions: 0, deletions: 0, patch: null, ...extra });

test('getContributionReview returns the diff + the proposed body for preview-as-merged', async () => {
  const repo = fakeRepo({
    pull: bobPull(),
    files: [f('members/alice/posts/x/index.md', { additions: 2, deletions: 1, patch: '@@ -1 +1 @@\n-old\n+new' })],
    contentByPath: { 'members/alice/posts/x/index.md': '---\ntitle: X\nslug: x\n---\nThe new body.' },
  });
  const r = await getContributionReview(ctx({ repo }), { number: 7 });
  assert.equal(r.number, 7);
  assert.equal(r.headSha, 'HEAD7');
  assert.equal(r.files.length, 1);
  assert.equal(r.files[0].patch, '@@ -1 +1 @@\n-old\n+new');
  assert.deepEqual(r.proposed, [{ filename: 'members/alice/posts/x/index.md', body: 'The new body.' }]);
});

test('getContributionReview fails closed for the owner own PR and for another folder', async () => {
  const own = fakeRepo({ pull: bobPull({ author: { login: 'alice', id: '1' } }), files: [f('members/alice/posts/x/index.md')] });
  await assert.rejects(() => getContributionReview(ctx({ repo: own }), { number: 7 }), (e) => e instanceof OperationError && e.code === 'forbidden');

  const other = fakeRepo({ pull: bobPull(), files: [f('members/carol/posts/z/index.md')] });
  await assert.rejects(() => getContributionReview(ctx({ repo: other }), { number: 7 }), (e) => e instanceof OperationError && e.code === 'forbidden');
});

test('approve submits an APPROVE review on the CURRENT head SHA', async () => {
  const repo = fakeRepo({ pull: bobPull(), files: [f('members/alice/posts/x/index.md')] });
  const out = await reviewContribution(ctx({ repo }), { number: 7, decision: 'approve', message: 'nice' });
  assert.deepEqual(out, { ok: true, decision: 'approve', number: 7 });
  assert.equal(repo.calls.reviews.length, 1);
  assert.deepEqual(repo.calls.reviews[0], { number: 7, event: 'APPROVE', body: 'nice', commitId: 'HEAD7' });
});

test('request-changes needs a message; with one it submits REQUEST_CHANGES', async () => {
  const repo = fakeRepo({ pull: bobPull(), files: [f('members/alice/posts/x/index.md')] });
  await assert.rejects(
    () => reviewContribution(ctx({ repo }), { number: 7, decision: 'request-changes', message: '   ' }),
    (e) => e instanceof OperationError && e.code === 'bad-request',
  );
  await reviewContribution(ctx({ repo }), { number: 7, decision: 'request-changes', message: 'tighten the intro' });
  assert.equal(repo.calls.reviews[0].event, 'REQUEST_CHANGES');
  assert.equal(repo.calls.reviews[0].body, 'tighten the intro');
});

test('decline submits a REQUEST_CHANGES review with the note + best-effort close (never merges)', async () => {
  const repo = fakeRepo({ pull: bobPull(), files: [f('members/alice/posts/x/index.md')] });
  await reviewContribution(ctx({ repo }), { number: 7, decision: 'decline', message: 'not now' });
  assert.equal(repo.calls.reviews.length, 1);
  assert.equal(repo.calls.reviews[0].event, 'REQUEST_CHANGES');
  assert.equal(repo.calls.reviews[0].body, 'not now');
  assert.deepEqual(repo.calls.closed, [7]); // best-effort close attempted
});

test('decline survives a close that the owner is not permitted to make', async () => {
  const repo = fakeRepo({ pull: bobPull(), files: [f('members/alice/posts/x/index.md')] });
  repo.closePull = async () => { throw new Error('403 not a collaborator'); };
  const out = await reviewContribution(ctx({ repo }), { number: 7, decision: 'decline' });
  assert.deepEqual(out, { ok: true, decision: 'decline', number: 7 });
  assert.equal(repo.calls.reviews[0].event, 'REQUEST_CHANGES'); // the declining review still stands
});

test('an unknown decision is a bad-request', async () => {
  const repo = fakeRepo({ pull: bobPull(), files: [f('members/alice/posts/x/index.md')] });
  await assert.rejects(
    () => reviewContribution(ctx({ repo }), { number: 7, decision: 'merge' }),
    (e) => e instanceof OperationError && e.code === 'bad-request',
  );
});

test('diffRows classifies hunk / add / del / context; diffTotals sums', () => {
  const rows = diffRows('@@ -1,2 +1,2 @@\n context\n-removed\n+added');
  assert.deepEqual(rows.map((r) => r.cls), ['hunk', 'ctx', 'del', 'add']);
  assert.equal(rows[2].text, '-removed');
  assert.deepEqual(diffRows(null), []);
  assert.deepEqual(diffTotals([{ additions: 2, deletions: 1 }, { additions: 3, deletions: 0 }]), { additions: 5, deletions: 1 });
});
