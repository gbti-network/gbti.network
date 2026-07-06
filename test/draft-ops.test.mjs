// SOW-082: the universal draft-staging operations. A draft is the item committed to its per-item branch
// gbti/<type>-<slug> on the member's FORK with NO open PR. Save commits there (trial+paid); Publish opens the
// canonical PR from that branch (paid-only). Tested against a fake ctx/repo (no network, no Worker).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveDraft, listDrafts, readDraft, discardDraft, publishDraft, OperationError } from '../client/src/operations.mjs';

function draftCtx({ membership = 'paid', refs = [], files = {}, openPull = null } = {}) {
  const calls = { put: [], deleteBranch: [], openPull: [] };
  return {
    calls,
    identity: () => ({ login: 'alice', githubId: '1', username: 'alice' }),
    membership: () => membership,
    store: { get: () => 'tok' },
    fetch: async () => { throw new Error('no network in this unit test'); },
    getRepoClient: () => ({
      upstream: 'gbti-network/gbti.network',
      ensureFork: async () => ({ full_name: 'alice/gbti.network', owner: 'alice' }),
      getDefaultBranch: async () => 'main',
      getBranchSha: async () => 'sha',
      ensureBranch: async () => {},
      getFileSha: async () => null,
      putFile: async (_r, _p, opts) => { calls.put.push({ path: _p, branch: opts.branch }); },
      deleteFile: async () => {},
      findOpenPull: async () => openPull,
      openPull: async (o) => { calls.openPull.push(o); return { number: 99, html_url: 'pr-url' }; },
      listMatchingRefs: async () => refs.map((branch) => ({ branch, sha: 's' })),
      getForkFileContent: async (_r, _path, ref) => files[ref] ?? null,
      deleteBranch: async (_r, b) => { calls.deleteBranch.push(b); },
    }),
  };
}

test('saveDraft: a TRIAL member stages to the fork branch and NEVER opens a PR', async () => {
  const ctx = draftCtx({ membership: 'trialing' });
  const out = await saveDraft(ctx, { type: 'post', input: { title: 'Hello', slug: 'my-post' }, body: 'Body' });
  assert.equal(out.state, 'staged');
  assert.equal(out.branch, 'gbti/post-my-post');
  assert.equal(ctx.calls.put[0].branch, 'gbti/post-my-post');
  assert.equal(ctx.calls.openPull.length, 0, 'Save must never open a PR');
});

test('saveDraft: free/lapsed/banned are forbidden to stage; unknown fails OPEN', async () => {
  for (const m of ['none', 'expired', 'cancelled', 'banned']) {
    await assert.rejects(
      () => saveDraft(draftCtx({ membership: m }), { type: 'post', input: { title: 'T', slug: 'my-post' }, body: 'x' }),
      (e) => { assert.ok(e instanceof OperationError); assert.equal(e.code, 'forbidden'); return true; },
    );
  }
  const out = await saveDraft(draftCtx({ membership: 'unknown' }), { type: 'post', input: { title: 'T', slug: 'my-post' }, body: 'x' });
  assert.equal(out.state, 'staged'); // unknown -> fail open
});

test('listDrafts: enumerates gbti/* branches, reads each, skips non-content (share/comment) branches', async () => {
  const post = '---\ntitle: My Post\nstatus: draft\nvisibility: public\n---\nBody';
  const profile = '---\ndisplayName: Alice\n---\nabout';
  const ctx = draftCtx({
    refs: ['gbti/post-my-post', 'gbti/share-12345', 'gbti/profile'],
    files: { 'gbti/post-my-post': post, 'gbti/profile': profile },
  });
  const { drafts } = await listDrafts(ctx, {});
  assert.deepEqual(drafts.map((d) => d.type).sort(), ['post', 'profile']); // gbti/share-* is skipped
  const p = drafts.find((d) => d.type === 'post');
  assert.equal(p.slug, 'my-post');
  assert.equal(p.title, 'My Post');
  assert.equal(p.pull, null); // no open PR -> the UI renders this as Staged
});

test('listDrafts: a type filter narrows to that content type', async () => {
  const post = '---\ntitle: P\nstatus: draft\n---\nx';
  const ctx = draftCtx({ refs: ['gbti/post-my-post', 'gbti/profile'], files: { 'gbti/post-my-post': post, 'gbti/profile': '---\ndisplayName: A\n---\n' } });
  const { drafts } = await listDrafts(ctx, { type: 'post' });
  assert.deepEqual(drafts.map((d) => d.type), ['post']);
});

test('readDraft: returns the staged frontmatter + body for the editor prefill', async () => {
  const md = '---\ntitle: My Post\nstatus: draft\n---\nThe body text';
  const ctx = draftCtx({ files: { 'gbti/post-my-post': md } });
  const out = await readDraft(ctx, { type: 'post', slug: 'my-post' });
  assert.equal(out.frontmatter.title, 'My Post');
  assert.equal(out.body, 'The body text');
  assert.equal(out.branch, 'gbti/post-my-post');
});

test('discardDraft: refuses with an open PR; deletes the branch when clean', async () => {
  const open = draftCtx({ openPull: { number: 5, html_url: 'u' } });
  await assert.rejects(
    () => discardDraft(open, { type: 'post', slug: 'my-post' }),
    (e) => { assert.match(e.message, /open pull request/i); return true; },
  );
  assert.equal(open.calls.deleteBranch.length, 0, 'must not delete a branch with an open PR');

  const clean = draftCtx({ openPull: null });
  const out = await discardDraft(clean, { type: 'post', slug: 'my-post' });
  assert.equal(out.branch, 'gbti/post-my-post');
  assert.deepEqual(clean.calls.deleteBranch, ['gbti/post-my-post']);
});

test('publishDraft: a trial member is blocked; a paid member opens the PR from the staged branch', async () => {
  await assert.rejects(
    () => publishDraft(draftCtx({ membership: 'trialing' }), { type: 'post', slug: 'my-post' }),
    (e) => { assert.equal(e.code, 'membership-required'); return true; },
  );

  const paid = draftCtx({ membership: 'paid' });
  const out = await publishDraft(paid, { type: 'post', slug: 'my-post' });
  assert.equal(out.prNumber, 99);
  assert.equal(paid.calls.openPull[0].head, 'alice:gbti/post-my-post');
  assert.equal(paid.calls.openPull[0].base, 'main');
});

test('publishDraft: reuses an already-open PR instead of opening a duplicate', async () => {
  const paid = draftCtx({ membership: 'paid', openPull: { number: 7, html_url: 'existing' } });
  const out = await publishDraft(paid, { type: 'post', slug: 'my-post' });
  assert.equal(out.updated, true);
  assert.equal(out.prNumber, 7);
  assert.equal(paid.calls.openPull.length, 0, 'must not open a second PR');
});

// SOW-106 Phase C: schema-drift validity surfaced on each draft row.
test('listDrafts: a draft that fails the CURRENT schema carries valid:false + a reason; a clean one valid:true', async () => {
  const good = '---\ntype: post\ntitle: Fine\nslug: fine\nauthor: alice\nstatus: published\n---\n\nBody.\n';
  const bad = '---\ntype: post\nslug: broken\nauthor: alice\nstatus: published\n---\n\nBody.\n'; // no title (required)
  const ctx = draftCtx({
    refs: ['gbti/post-fine', 'gbti/post-broken'],
    files: { 'gbti/post-fine': good, 'gbti/post-broken': bad },
  });
  const { drafts } = await listDrafts(ctx, {});
  const fine = drafts.find((d) => d.slug === 'fine');
  const broken = drafts.find((d) => d.slug === 'broken');
  assert.equal(fine.valid, true);
  assert.equal(fine.invalidReason, null);
  assert.equal(broken.valid, false);
  assert.match(String(broken.invalidReason), /title/i);
});
