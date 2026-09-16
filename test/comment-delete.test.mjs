// SOW-112 QA: a member deletes their OWN comment (own-folder delete PR). Guards + PR shape. Fakes only.
// sow-274 Part 2: the delete goes through the network (POST /membership/author); the fake records what reached it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deleteComment, OperationError } from '../client/src/operations.mjs';

const MINE = 'members/alice/comments/c-123.md';
const COMMENT = '---\ntype: comment\nid: c-123\nauthor: alice\ntargetType: prompt\ntargetSlug: x\nstatus: published\nvisibility: public\ncreatedAt: 2026-07-01\n---\n\nMy reply.\n';

/** The network author route: records each change and answers with a pull request. */
function fakeNetwork() {
  const changes = [];
  return {
    changes,
    fetch: async (url, init) => {
      if (!String(url).endsWith('/membership/author')) throw new Error(`unexpected fetch: ${url}`);
      changes.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ ok: true, number: 5, html_url: 'u', branch: 'hosted/1/comment-delete-c-123' }) };
    },
  };
}

function ctxFor({ net = fakeNetwork(), files = {}, membership = 'paid' } = {}) {
  const all = { [MINE]: COMMENT, ...files };
  return {
    identity: () => ({ username: 'alice' }),
    membership: async () => membership,
    reader: { readFile: async (rel) => all[rel] ?? null },
    store: { get: (k) => ({ githubToken: 'tok' })[k] },
    fetch: net.fetch,
  };
}

test('deleteComment: one delete change on its own item, own comment only', async () => {
  const net = fakeNetwork();
  const r = await deleteComment(ctxFor({ net }), { id: 'c-123' });
  assert.equal(r.ok, true);
  assert.equal(r.prNumber, 5);
  assert.equal(net.changes.length, 1);
  assert.deepEqual(net.changes[0].files, [{ path: MINE, content: null }], 'exactly one file, and it is a delete of the own comment');
  assert.equal(net.changes[0].itemId, 'comment-delete-c-123');
});

test('deleteComment guards: missing, foreign author, bad id, non-paid', async () => {
  await assert.rejects(deleteComment(ctxFor(), { id: 'ghost' }),
    (e) => e instanceof OperationError && e.code === 'not-found');
  const foreign = COMMENT.replace('author: alice', 'author: bob');
  await assert.rejects(deleteComment(ctxFor({ files: { [MINE]: foreign } }), { id: 'c-123' }),
    (e) => e.code === 'forbidden');
  await assert.rejects(deleteComment(ctxFor(), { id: '../evil' }),
    (e) => e.code === 'bad-request');
  await assert.rejects(deleteComment(ctxFor({ membership: 'trialing' }), { id: 'c-123' }),
    (e) => e.code === 'membership-required');
});
