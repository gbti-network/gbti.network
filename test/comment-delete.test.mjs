// SOW-112 QA: a member deletes their OWN comment (own-folder delete PR). Guards + PR shape. Fakes only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deleteComment, OperationError } from '../client/src/operations.mjs';

const MINE = 'members/alice/comments/c-123.md';
const COMMENT = '---\ntype: comment\nid: c-123\nauthor: alice\ntargetType: prompt\ntargetSlug: x\nstatus: published\nvisibility: public\ncreatedAt: 2026-07-01\n---\n\nMy reply.\n';

function fakeRepo() {
  const deletes = []; const pulls = [];
  return {
    deletes, pulls,
    upstream: 'gbti-network/gbti.network',
    async ensureFork() { return { full_name: 'alice/gbti.network', owner: 'alice' }; },
    async getDefaultBranch() { return 'main'; },
    async getBranchSha(r, b) { if (b === 'main') return 'main-sha'; throw new Error('404'); },
    async ensureBranch() {},
    async getFileSha() { return 'sha'; },
    async findOpenPull() { return null; },
    async putFile() {},
    async deleteFile(r, p) { deletes.push(p); },
    async openPull(o) { pulls.push(o); return { number: 5, html_url: 'u' }; },
  };
}

function ctxFor({ repo, files = {}, membership = 'paid' } = {}) {
  const all = { [MINE]: COMMENT, ...files };
  return {
    identity: () => ({ username: 'alice' }),
    getRepoClient: () => repo,
    membership: async () => membership,
    reader: { readFile: async (rel) => all[rel] ?? null },
    store: { get: () => null },
  };
}

test('deleteComment: one delete PR on its own branch, own comment only', async () => {
  const repo = fakeRepo();
  const r = await deleteComment(ctxFor({ repo }), { id: 'c-123' });
  assert.equal(r.ok, true);
  assert.equal(r.prNumber, 5);
  assert.deepEqual(repo.deletes, [MINE]);
  assert.equal(repo.pulls[0].head, 'alice:gbti/comment-delete-c-123');
});

test('deleteComment guards: missing, foreign author, bad id, non-paid', async () => {
  await assert.rejects(deleteComment(ctxFor({ repo: fakeRepo() }), { id: 'ghost' }),
    (e) => e instanceof OperationError && e.code === 'not-found');
  const foreign = COMMENT.replace('author: alice', 'author: bob');
  await assert.rejects(deleteComment(ctxFor({ repo: fakeRepo(), files: { [MINE]: foreign } }), { id: 'c-123' }),
    (e) => e.code === 'forbidden');
  await assert.rejects(deleteComment(ctxFor({ repo: fakeRepo() }), { id: '../evil' }),
    (e) => e.code === 'bad-request');
  await assert.rejects(deleteComment(ctxFor({ repo: fakeRepo(), membership: 'trialing' }), { id: 'c-123' }),
    (e) => e.code === 'membership-required');
});
