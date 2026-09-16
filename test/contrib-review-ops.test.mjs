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

// sow-274 Part 2: a decision used to post a GitHub review with the owner's own token. That token's write access is
// retired with the fork path, so every decision is refused and taken on github.com instead, where the gate records
// the reviewer. Part 3 removes the operation and its screens; until then the refusal must be total and silent to
// GitHub: no review, no comment, no close, whatever the decision and whatever the pull request.
test('every decision is refused, and nothing is written to GitHub', async () => {
  for (const [decision, message] of [['approve', 'nice'], ['request-changes', 'tighten the intro'], ['decline', 'not now'], ['decline', undefined], ['merge', undefined]]) {
    const repo = fakeRepo({ pull: bobPull(), files: [f('members/alice/posts/x/index.md')] });
    await assert.rejects(
      () => reviewContribution(ctx({ repo }), { number: 7, decision, message }),
      (e) => e instanceof OperationError && e.code === 'forbidden' && /github\.com/.test(e.message),
      `${decision} was not refused`,
    );
    assert.deepEqual(repo.calls, { reviews: [], comments: [], closed: [] }, `${decision} reached GitHub`);
  }
});

test('the review screen is told it cannot act, so it hides the decide buttons', async () => {
  const repo = fakeRepo({ pull: bobPull(), files: [f('members/alice/posts/x/index.md')], contentByPath: { 'members/alice/posts/x/index.md': '---\ntitle: X\n---\nbody' } });
  const r = await getContributionReview(ctx({ repo }), { number: 7 });
  assert.equal(r.canActInClient, false);
});

test('diffRows classifies hunk / add / del / context; diffTotals sums', () => {
  const rows = diffRows('@@ -1,2 +1,2 @@\n context\n-removed\n+added');
  assert.deepEqual(rows.map((r) => r.cls), ['hunk', 'ctx', 'del', 'add']);
  assert.equal(rows[2].text, '-removed');
  assert.deepEqual(diffRows(null), []);
  assert.deepEqual(diffTotals([{ additions: 2, deletions: 1 }, { additions: 3, deletions: 0 }]), { additions: 5, deletions: 1 });
});
