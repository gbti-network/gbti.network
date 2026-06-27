// SOW-027: member comment authoring. buildCommentFile (flat own-folder file, forced author), commentId, and the
// publishComment / editComment / getComment operations (paid-only, own-folder, updatedAt-on-edit, scope checks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCommentFile, commentId } from '../client/src/content-ops.mjs';
import { publishComment, editComment, getComment, OperationError } from '../client/src/operations.mjs';

const fakeRepo = (puts = []) => ({
  upstream: 'gbti-network/gbti.network',
  async ensureFork() { return { full_name: 'alice/gbti.network', owner: 'alice' }; },
  async getDefaultBranch() { return 'main'; },
  async getBranchSha() { return 'sha'; },
  async ensureBranch() {},
  async getFileSha() { return null; },
  async putFile(_full, path, opts) { puts.push({ path, content: opts?.contentBase64 }); },
  async findOpenPull() { return null; },
  async openPull() { return { number: 7, html_url: 'u' }; },
});

// SOW-044: a members comment encrypts its body via the Worker on publish. This stub stands in for the Worker
// encrypt route, echoing the requested assetId as the envelope AAD (the real Worker binds the same AAD).
const encryptFetch = async (_url, init) => {
  const { assetId } = JSON.parse(init.body);
  return { ok: true, status: 200, json: async () => ({ ok: true, envelope: { v: 1, kid: '1', iv: 'iv', aad: assetId, ct: 'ct' } }) };
};

function ctxFor({ membership = 'paid', repo = fakeRepo(), comment = undefined, now = '2026-06-10T12:00:00Z', fetch = encryptFetch } = {}) {
  return {
    identity: () => ({ login: 'alice', githubId: '1', username: 'alice' }),
    getRepoClient: () => repo,
    membership: () => membership,
    store: { get: (k) => ({ githubToken: 'tok' })[k] },
    now: () => now,
    fetch,
    reader: { get: (username, rel) => (comment === undefined ? null : { path: rel, frontmatter: comment, body: comment?.__body ?? 'old body' }) },
  };
}

const decodeOf = (puts, re) => Buffer.from(puts.find((p) => re.test(p.path)).content, 'base64').toString('utf8');

test('commentId: sortable timestamp stem + suffix', () => {
  assert.equal(commentId('2026-06-10T12:00:00Z', 'aB3!'), '20260610120000-ab3');
  assert.equal(commentId('2026-06-10T12:00:00Z', ''), '20260610120000-c');
});

test('buildCommentFile: forces author=owner + the flat comments/ path, validates the schema', () => {
  const built = buildCommentFile({
    username: 'alice',
    input: { id: '20260610120000-x', author: 'mallory', targetType: 'post', targetSlug: 'hello', createdAt: '2026-06-10T12:00:00Z' },
    body: 'nice post',
  });
  assert.equal(built.path, 'members/alice/comments/20260610120000-x.md');
  assert.equal(built.frontmatter.author, 'alice'); // the spoofed author is overwritten
  assert.equal(built.type, 'comment');
  assert.match(built.markdown, /nice post/);
  // a comment with no targetType is invalid
  assert.throws(() => buildCommentFile({ username: 'alice', input: { id: 'x', createdAt: '2026-06-10T12:00:00Z' }, body: 'hi' }), /invalid comment/);
});

test('buildCommentFile: SOW-032 accepts targetType "share" with a composite "<author>/<shareId>" targetSlug', () => {
  const built = buildCommentFile({
    username: 'bob',
    input: { id: '20260611000000-c', author: 'bob', targetType: 'share', targetSlug: 'alice/20260610120000-astro-tips', createdAt: '2026-06-11T00:00:00Z' },
    body: 'great share',
  });
  assert.equal(built.frontmatter.targetType, 'share'); // the enum now permits 'share' in the client mirror
  assert.equal(built.frontmatter.targetSlug, 'alice/20260610120000-astro-tips');
  assert.equal(built.path, 'members/bob/comments/20260611000000-c.md'); // still the commenter's OWN folder
});

test('publishComment: SOW-044 a plain comment is members-only + ENCRYPTED by default (no plaintext leak), own-folder PR', async () => {
  const puts = [];
  const r = await publishComment(ctxFor({ repo: fakeRepo(puts) }), { targetType: 'post', targetSlug: 'hello', body: 'great read' });
  assert.equal(r.targetType, 'post');
  assert.equal(r.visibility, 'members'); // no longer public by default
  assert.equal(r.encrypted, true);
  // SOW-072 P2: the comment op now returns the PR handle (was discarded) so the ack + the MCP post_comment report it.
  assert.equal(r.prNumber, 7);
  assert.equal(r.prUrl, 'u');
  assert.match(r.path, /^members\/alice\/comments\/20260610120000-[a-z0-9]+\.md$/);
  // the body is committed ONLY as an encrypted envelope; the stub .md carries no plaintext
  assert.ok(puts.some((p) => /^members\/alice\/_enc\/comment-.*-body\.enc$/.test(p.path)), JSON.stringify(puts.map((p) => p.path)));
  const stub = decodeOf(puts, /comments\/.*\.md$/);
  assert.doesNotMatch(stub, /great read/, 'the plaintext comment body must never be committed');
  assert.match(stub, /encryptedBody:/);
  assert.match(stub, /visibility: members/);
});

test('publishComment: SOW-044 a from-the-author intro (authorNote on a product) stays PUBLIC + plaintext', async () => {
  const puts = [];
  const r = await publishComment(ctxFor({ repo: fakeRepo(puts) }), { targetType: 'product', targetSlug: 'radle', body: 'why I built this', authorNote: true, visibility: 'public' });
  assert.equal(r.visibility, 'public');
  assert.equal(r.encrypted, false); // a public intro is plain (it is the public teaser on the product page)
  const md = decodeOf(puts, /comments\/.*\.md$/);
  assert.match(md, /why I built this/); // the intro body is public by design
  assert.match(md, /authorNote: true/);
  assert.ok(!puts.some((p) => /_enc\//.test(p.path)), 'no .enc for a public intro');
});

test('publishComment: SOW-044 a public NON-intro (no authorNote) is COERCED to members + encrypted', async () => {
  const puts = [];
  const r = await publishComment(ctxFor({ repo: fakeRepo(puts) }), { targetType: 'post', targetSlug: 'hello', body: 'just a reply', visibility: 'public' });
  assert.equal(r.visibility, 'members'); // the server ignores a public request without an authorNote intro
  assert.equal(r.encrypted, true);
  assert.doesNotMatch(decodeOf(puts, /comments\/.*\.md$/), /just a reply/);
});

test('publishComment: SOW-044 a Share comment is ALWAYS members, even with authorNote (no public intro on a Share)', async () => {
  const puts = [];
  const r = await publishComment(ctxFor({ repo: fakeRepo(puts) }), { targetType: 'share', targetSlug: 'alice/20260610120000-astro-tips', body: 'nice find', authorNote: true, visibility: 'public' });
  assert.equal(r.visibility, 'members'); // a share is not a post/product/prompt, so authorNote cannot make it public
  assert.equal(r.encrypted, true);
  assert.doesNotMatch(decodeOf(puts, /comments\/.*\.md$/), /nice find/);
});

test('publishComment: a trial member is blocked before any PR (paid-only)', async () => {
  await assert.rejects(
    () => publishComment(ctxFor({ membership: 'trialing' }), { targetType: 'post', targetSlug: 'hello', body: 'x' }),
    (e) => e instanceof OperationError && e.code === 'membership-required',
  );
});

test('editComment: preserves createdAt + target, sets updatedAt, re-publishes the same id (a public intro stays public)', async () => {
  const puts = [];
  // A from-the-author intro on a product (the legit public comment): editing keeps it public + plaintext.
  const existing = { type: 'comment', id: '20260101000000-old', author: 'alice', targetType: 'product', targetSlug: 'radle', status: 'published', visibility: 'public', authorNote: true, createdAt: '2026-01-01T00:00:00Z', __body: 'first version' };
  const r = await editComment(ctxFor({ repo: fakeRepo(puts), comment: existing }), { id: '20260101000000-old', body: 'edited version' });
  assert.equal(r.edited, true);
  assert.equal(r.id, '20260101000000-old');
  // SOW-032: editComment carries the target back (like publishComment) so the gbti-comment-edited event can
  // refresh the right open discussion thread.
  assert.equal(r.targetType, 'product');
  assert.equal(r.targetSlug, 'radle');
  // the re-published file carries the original createdAt + a new updatedAt + the new body (a public intro is plaintext)
  const file = Buffer.from(puts.find((p) => /comments\/20260101000000-old\.md$/.test(p.path)).content, 'base64').toString('utf8');
  assert.match(file, /createdAt: '?2026-01-01/); // original createdAt preserved (js-yaml quotes the ISO string)
  assert.match(file, /updatedAt: '?2026-06-10/);
  assert.match(file, /edited version/);
  assert.match(file, /visibility: public/);
});

test('editComment: SOW-044 un-flagging an intro (authorNote->false) coerces it to members + encrypts (no plaintext strand)', async () => {
  const puts = [];
  const existing = { type: 'comment', id: '20260101000000-old', author: 'alice', targetType: 'product', targetSlug: 'radle', status: 'published', visibility: 'public', authorNote: true, createdAt: '2026-01-01T00:00:00Z', __body: 'was an intro' };
  // Explicitly drop the author-note flag on edit: the comment is no longer a from-the-author intro, so it must
  // become members-only + encrypted rather than stranding as a public non-intro plaintext comment.
  const r = await editComment(ctxFor({ repo: fakeRepo(puts), comment: existing }), { id: '20260101000000-old', body: 'now just a reply', authorNote: false });
  assert.equal(r.visibility, 'members');
  assert.equal(r.encrypted, true);
  const stub = decodeOf(puts, /comments\/20260101000000-old\.md$/);
  assert.doesNotMatch(stub, /now just a reply/, 'the demoted comment body must be encrypted, not committed plaintext');
  assert.match(stub, /encryptedBody:/);
  assert.ok(puts.some((p) => /_enc\/comment-.*-body\.enc$/.test(p.path)));
});

test('editComment: another member’s comment (author mismatch) is rejected', async () => {
  const existing = { type: 'comment', id: 'x', author: 'bob', targetType: 'post', targetSlug: 'hello', status: 'published', visibility: 'public', createdAt: '2026-01-01T00:00:00Z' };
  await assert.rejects(
    () => editComment(ctxFor({ comment: existing }), { id: 'x', body: 'sneaky' }),
    (e) => e instanceof OperationError && e.code === 'not-authorized',
  );
});

test('getComment: a members comment is DECRYPTED for the author edit prefill (no blank/data-loss)', async () => {
  // Regression (review HIGH): a members comment stores its body in the .enc; the stub .md body is empty. The
  // edit prefill must decrypt it, else editing starts blank and a save replaces the gated text.
  const envelope = JSON.stringify({ v: 1, kid: '1', iv: 'iv', aad: 'comment:x:body', ct: 'ct' });
  const ctx = {
    identity: () => ({ username: 'alice', login: 'alice', githubId: '1' }),
    store: { get: (k) => ({ githubToken: 'tok' })[k] },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, text: 'the real members comment' }) }),
    reader: {
      get: (_u, rel) => ({ path: rel, frontmatter: { type: 'comment', id: 'x', author: 'alice', targetType: 'post', targetSlug: 'p', visibility: 'members', encryptedBody: 'members/alice/_enc/comment-x-body.enc', createdAt: '2026-01-01T00:00:00Z' }, body: '' }),
      readFile: (p) => (p === 'members/alice/_enc/comment-x-body.enc' ? envelope : null),
    },
  };
  const r = await getComment(ctx, { id: 'x' });
  assert.equal(r.body, 'the real members comment', 'edit prefill uses the decrypted body, not the empty stub');
});

test('editComment + getComment: a missing comment is not-found', async () => {
  await assert.rejects(() => editComment(ctxFor({ comment: undefined }), { id: 'nope', body: 'x' }), (e) => e.code === 'not-found');
  await assert.rejects(() => getComment(ctxFor({ comment: undefined }), { id: 'nope' }), (e) => e.code === 'not-found');
});
