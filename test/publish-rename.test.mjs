// SOW-112 v2: the publish-event rename (owner-directed stage-first flow). saveDraft stages a slug change on
// the item's OWN branch at its OLD path; publish performs the move (deletes + intro move + redirectFrom merge
// + preserved publishedAt) from the old-slug branch; a plain re-publish with `path` keeps existing
// redirectFrom; a pathless publish is untouched. Fakes only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publish, saveDraft, renameOriginOf, OperationError } from '../client/src/operations.mjs';
import { parseContentFile } from '../client/src/content-ops.mjs';

const OLD = 'members/alice/prompts/old-name/index.md';
const OLD_FM = '---\ntype: prompt\ntitle: X\nslug: old-name\nauthor: alice\nstatus: published\nvisibility: public\npublishedAt: 2026-07-02T00:00:00.000Z\nshortDescription: about it\ntargets:\n  - Claude Code\ncategories:\n  - skill\nredirectFrom:\n  - "/devops/legacy-wp-path/"\n---\n\nOld body.\n';
const INPUT = {
  title: 'X', slug: 'old-name', shortDescription: 'about it', targets: ['Claude Code'],
  categories: ['skill'], visibility: 'public', publishedAt: '2026-07-06T09:00:00.000Z', updatedAt: '2026-07-06T09:00:00.000Z',
};

function fakeRepo({ upstreamFiles = {}, baseHasOld = true } = {}) {
  const puts = []; const deletes = []; const pulls = [];
  return {
    puts, deletes, pulls,
    upstream: 'gbti-network/gbti.network',
    async ensureFork() { return { full_name: 'alice/gbti.network', owner: 'alice' }; },
    async getDefaultBranch() { return 'main'; },
    async getBranchSha(r, branch) { if (branch === 'main') return 'main-sha'; throw new Error('404'); },
    async ensureBranch() {},
    async getFileSha(r, p, ref) { return ref === 'main' ? (baseHasOld && p === OLD ? 'old-sha' : null) : 'blob'; },
    async getFileContent(p) { return upstreamFiles[p] ?? null; },
    async findOpenPull() { return null; },
    async putFile(r, p, opts) { puts.push({ path: p, content: Buffer.from(opts.contentBase64, 'base64').toString('utf8') }); },
    async deleteFile(r, p) { deletes.push(p); },
    async openPull(opts) { pulls.push(opts); return { number: 7, html_url: 'u' }; },
  };
}

function ctxFor({ repo, files = {} } = {}) {
  const all = { [OLD]: OLD_FM, ...files };
  return {
    identity: () => ({ username: 'alice' }),
    getRepoClient: () => repo,
    membership: async () => 'paid',
    reader: { readFile: async (rel) => all[rel] ?? null },
    store: { get: () => null },
  };
}

test('renameOriginOf: own item of the same type only', () => {
  assert.deepEqual(renameOriginOf({ path: OLD, username: 'alice', type: 'prompt' }), { oldSlug: 'old-name', oldPath: OLD });
  assert.equal(renameOriginOf({ path: OLD, username: 'bob', type: 'prompt' }), null);
  assert.equal(renameOriginOf({ path: OLD, username: 'alice', type: 'post' }), null);
  assert.equal(renameOriginOf({ path: 'house/prompts/x/index.md', username: 'alice', type: 'prompt' }), null);
  assert.equal(renameOriginOf({ username: 'alice', type: 'prompt' }), null);
});

test('publish with a changed slug performs the rename from the old-slug branch', async () => {
  const repo = fakeRepo();
  const intro = '---\ntype: comment\nid: intro-old-name\nauthor: alice\ntargetType: prompt\ntargetSlug: old-name\nstatus: published\nvisibility: public\nauthorNote: true\ncreatedAt: 2026-07-02\n---\n\nHi.\n';
  const ctx = ctxFor({ repo, files: { 'members/alice/comments/intro-old-name.md': intro } });
  const res = await publish(ctx, { type: 'prompt', input: { ...INPUT, slug: 'new-name' }, body: 'New body.', path: OLD });
  assert.deepEqual(res.renamed, { from: 'old-name', to: 'new-name' });
  const newIndex = repo.puts.find((f) => f.path === 'members/alice/prompts/new-name/index.md');
  const fm = parseContentFile(newIndex.content).frontmatter;
  assert.equal(fm.slug, 'new-name');
  // redirectFrom = the old file's legacy entry + the rename-generated old URL
  assert.deepEqual([...fm.redirectFrom].sort(), ['/devops/legacy-wp-path/', '/prompts/old-name/'].sort());
  // publishedAt preserved from the OLD file (the editor stamped now; the server restores the original)
  assert.equal(new Date(fm.publishedAt).toISOString(), '2026-07-02T00:00:00.000Z');
  // the old index deletes; the intro moved + retargeted
  assert.ok(repo.deletes.includes(OLD));
  assert.ok(repo.deletes.includes('members/alice/comments/intro-old-name.md'));
  const movedIntro = repo.puts.find((f) => f.path === 'members/alice/comments/intro-new-name.md');
  assert.equal(parseContentFile(movedIntro.content).frontmatter.targetSlug, 'new-name');
  // the PR rode the ITEM's branch (old-slug identity), so a staged rename draft is reused + auto-cleans
  assert.equal(repo.pulls[0].head, 'alice:gbti/prompt-old-name');
});

test('publish rename guards: collision on the new path; fail-closed when the old file is off the branch base', async () => {
  await assert.rejects(
    publish(ctxFor({ repo: fakeRepo({ upstreamFiles: { 'members/alice/prompts/new-name/index.md': 'x' } }) }),
      { type: 'prompt', input: { ...INPUT, slug: 'new-name' }, body: 'B.', path: OLD }),
    (e) => e instanceof OperationError && /already taken/.test(e.message));
  const repo = fakeRepo({ baseHasOld: false });
  await assert.rejects(
    publish(ctxFor({ repo }), { type: 'prompt', input: { ...INPUT, slug: 'new-name' }, body: 'B.', path: OLD }),
    (e) => /fork to sync/.test(e.message));
  assert.equal(repo.pulls.length, 0); // never a half-move
});

test('a plain re-publish with path preserves the old redirectFrom (no rename)', async () => {
  const repo = fakeRepo();
  const res = await publish(ctxFor({ repo }), { type: 'prompt', input: { ...INPUT }, body: 'Edited.', path: OLD });
  assert.equal(res.renamed, undefined);
  const idx = repo.puts.find((f) => f.path === OLD);
  const fm = parseContentFile(idx.content).frontmatter;
  assert.deepEqual(fm.redirectFrom, ['/devops/legacy-wp-path/']); // previously silently dropped
  assert.equal(repo.deletes.length, 0);
  // a plain re-publish keeps the editor's re-surface stamp (only a rename preserves the old date)
  assert.equal(new Date(fm.publishedAt).toISOString(), '2026-07-06T09:00:00.000Z');
});

test('a pathless publish (new item) is untouched by the rename machinery', async () => {
  const repo = fakeRepo();
  const res = await publish(ctxFor({ repo }), { type: 'prompt', input: { ...INPUT, slug: 'fresh' }, body: 'B.' });
  assert.equal(res.renamed, undefined);
  assert.ok(repo.puts.some((f) => f.path === 'members/alice/prompts/fresh/index.md'));
  assert.equal(repo.deletes.length, 0);
});

test('saveDraft with a changed slug stages at the OLD path on the OLD-slug branch (pending rename)', async () => {
  const repo = fakeRepo();
  const commits = [];
  repo.getBranchSha = async (r, b) => { if (b === 'main') return 'main-sha'; throw new Error('404'); };
  const res = await saveDraft(ctxFor({ repo }), { type: 'prompt', input: { ...INPUT, slug: 'new-name' }, body: 'B.', path: OLD });
  assert.equal(res.branch, 'gbti/prompt-old-name'); // the ITEM's branch, not a silent fork under the new slug
  assert.equal(res.path, OLD);                       // staged at the old path; the frontmatter slug is the marker
  assert.deepEqual(res.renamed, { from: 'old-name', to: 'new-name' });
  const staged = repo.puts.find((f) => f.path === OLD);
  assert.equal(parseContentFile(staged.content).frontmatter.slug, 'new-name');
});

test('saveDraft without a slug change stages normally under its own slug', async () => {
  const repo = fakeRepo();
  const res = await saveDraft(ctxFor({ repo }), { type: 'prompt', input: { ...INPUT }, body: 'B.', path: OLD });
  assert.equal(res.branch, 'gbti/prompt-old-name');
  assert.equal(res.renamed, undefined);
});

test('publishDraft routes a pending-rename draft through the full rename publish (never a half-rename PR)', async () => {
  const { publishDraft } = await import('../client/src/operations.mjs');
  const repo = fakeRepo();
  const stagedText = OLD_FM.replace('slug: old-name', 'slug: new-name');
  repo.getForkFileContent = async (r, p, branch) => (p === OLD && branch === 'gbti/prompt-old-name' ? stagedText : null);
  const res = await publishDraft(ctxFor({ repo }), { type: 'prompt', slug: 'old-name' });
  assert.deepEqual(res.renamed, { from: 'old-name', to: 'new-name' });
  assert.ok(repo.puts.some((f) => f.path === 'members/alice/prompts/new-name/index.md'));
  assert.ok(repo.deletes.includes(OLD)); // the move shipped, not the raw mismatched branch file
  assert.equal(repo.pulls[0].head, 'alice:gbti/prompt-old-name');
});

test('publishDraft without a pending rename opens the PR from the branch untouched', async () => {
  const { publishDraft } = await import('../client/src/operations.mjs');
  const repo = fakeRepo();
  repo.getForkFileContent = async () => OLD_FM; // slug matches the branch
  const res = await publishDraft(ctxFor({ repo }), { type: 'prompt', slug: 'old-name' });
  assert.equal(res.renamed, undefined);
  assert.equal(repo.puts.length, 0); // no rebuild: the branch ships as-is
  assert.equal(repo.pulls[0].head, 'alice:gbti/prompt-old-name');
});

// SOW-112 QA: the create-only sync gate skips an EXISTING draft branch (created from a stale base before the
// App permission), so the rename must recover: sync the fork main directly, then rebuild the branch.
test('rename recovers a stale draft branch: direct sync + branch rebuild, then the move ships', async () => {
  const repo = fakeRepo({ baseHasOld: false });
  let synced = false;
  const branchDeletes = [];
  let staleBranchGone = false;
  repo.getBranchSha = async (r, b) => {
    if (b === 'main') return 'main-sha';
    if (staleBranchGone) throw new Error('404');
    return 'stale-branch-sha'; // the draft branch EXISTS (created from a base that predates the item)
  };
  // ref-aware: the stale branch NEVER has the old file; main gains it once the sync runs.
  repo.getFileSha = async (r, p, ref) => {
    if (p !== OLD) return 'blob';
    if (ref === 'main') return synced ? 'old-sha' : null;
    return staleBranchGone ? 'old-sha' : null; // the rebuilt branch (from fresh main) has it; the stale one did not
  };
  repo.deleteBranch = async (r, b) => { branchDeletes.push(b); staleBranchGone = true; };
  const ctx = ctxFor({ repo });
  ctx.store = { get: (k) => (k === 'githubToken' ? 'tok' : null) };
  ctx.fetch = async () => { synced = true; return { ok: true, json: async () => ({ ok: true, synced: true }) }; };
  const res = await publish(ctx, { type: 'prompt', input: { ...INPUT, slug: 'new-name' }, body: 'B.', path: OLD });
  assert.deepEqual(res.renamed, { from: 'old-name', to: 'new-name' });
  assert.deepEqual(branchDeletes, ['gbti/prompt-old-name']); // the stale branch rebuilt from the fresh base
  assert.ok(repo.deletes.includes(OLD)); // and the delete half shipped
});

// The half-rename hole (PR #67): the staged draft ADDS the old-path file to the branch, so a branch check is
// satisfied while the MERGE BASE still predates the file and the delete nets out of the PR diff. Renames must
// therefore ALWAYS rebuild the branch from a verified-fresh main, even when main is already fresh.
test('rename rebuilds an existing branch unconditionally (a branch check would be fooled by the staged file)', async () => {
  const repo = fakeRepo();
  const branchDeletes = [];
  let staleBranchGone = false;
  repo.getBranchSha = async (r, b) => {
    if (b === 'main') return 'main-sha';
    if (staleBranchGone) throw new Error('404');
    return 'stale-branch-sha';
  };
  repo.getFileSha = async (r, p, ref) => {
    if (p !== OLD) return 'blob';
    if (ref === 'main') return 'old-sha'; // fresh main HAS the file
    return 'staged-sha'; // the stale branch ALSO has it (the staged pending rename lives at the old path!)
  };
  repo.deleteBranch = async (r, b) => { branchDeletes.push(b); staleBranchGone = true; };
  const res = await publish(ctxFor({ repo }), { type: 'prompt', input: { ...INPUT, slug: 'new-name' }, body: 'B.', path: OLD });
  assert.deepEqual(res.renamed, { from: 'old-name', to: 'new-name' });
  assert.deepEqual(branchDeletes, ['gbti/prompt-old-name']);
  assert.ok(repo.deletes.includes(OLD)); // the delete would have been silently skipped without the rebuild
});

test('rename still fails closed when the direct sync cannot provide the old file (even though the staged file sits on the branch)', async () => {
  const repo = fakeRepo({ baseHasOld: false });
  repo.getBranchSha = async (r, b) => (b === 'main' ? 'main-sha' : 'stale-branch-sha');
  repo.getFileSha = async (r, p, ref) => (ref === 'main' ? null : 'staged-sha'); // main never gains it; the branch has the staged copy
  const ctx = ctxFor({ repo });
  ctx.store = { get: (k) => (k === 'githubToken' ? 'tok' : null) };
  ctx.fetch = async () => ({ ok: false, status: 422, json: async () => ({}) }); // permission still missing
  await assert.rejects(
    publish(ctx, { type: 'prompt', input: { ...INPUT, slug: 'new-name' }, body: 'B.', path: OLD }),
    (e) => /fork to sync/.test(e.message));
  assert.equal(repo.pulls.length, 0);
});


test('rename with an OPEN pull request on the item branch blocks with a clear message (never closes it)', async () => {
  const repo = fakeRepo();
  const branchDeletes = [];
  repo.getBranchSha = async (r, b) => (b === 'main' ? 'main-sha' : 'branch-sha');
  repo.findOpenPull = async () => ({ number: 12 });
  repo.deleteBranch = async (r, b) => { branchDeletes.push(b); };
  await assert.rejects(
    publish(ctxFor({ repo }), { type: 'prompt', input: { ...INPUT, slug: 'new-name' }, body: 'B.', path: OLD }),
    (e) => /open pull request .*#12/.test(e.message));
  assert.deepEqual(branchDeletes, []);
});

test('publishDraft rename routing forces status published (a staged draft may carry status draft)', async () => {
  const { publishDraft } = await import('../client/src/operations.mjs');
  const repo = fakeRepo();
  const stagedText = OLD_FM.replace('slug: old-name', 'slug: new-name').replace('status: published', 'status: draft');
  repo.getForkFileContent = async (r, p, branch) => (p === OLD && branch === 'gbti/prompt-old-name' ? stagedText : null);
  repo.findOpenPull = async () => null;
  const res = await publishDraft(ctxFor({ repo }), { type: 'prompt', slug: 'old-name' });
  assert.deepEqual(res.renamed, { from: 'old-name', to: 'new-name' });
  const fm = parseContentFile(repo.puts.find((f) => f.path === 'members/alice/prompts/new-name/index.md').content).frontmatter;
  assert.equal(fm.status, 'published'); // PR #67 landed status: draft without this
});

// PR #68 residual: the editor prefills the author note from the existing intro, so a rename publish writes a
// FRESH intro at the new slug — the OLD intro must still be deleted, or it orphans (a duplicate author note
// via the alias union).
test('rename with a fresh authorNote intro still deletes the old intro', async () => {
  const repo = fakeRepo();
  const intro = '---\ntype: comment\nid: intro-old-name\nauthor: alice\ntargetType: prompt\ntargetSlug: old-name\nstatus: published\nvisibility: public\nauthorNote: true\ncreatedAt: 2026-07-02\n---\n\nHi.\n';
  const ctx = ctxFor({ repo, files: { 'members/alice/comments/intro-old-name.md': intro } });
  const res = await publish(ctx, { type: 'prompt', input: { ...INPUT, slug: 'new-name' }, body: 'B.', path: OLD, authorNote: 'A fresh intro note.' });
  assert.deepEqual(res.renamed, { from: 'old-name', to: 'new-name' });
  assert.ok(repo.puts.some((f) => f.path === 'members/alice/comments/intro-new-name.md')); // the fresh intro
  assert.ok(repo.deletes.includes('members/alice/comments/intro-old-name.md')); // the old one still deletes
});

// SOW-100 Phase 0.5 (owner ask): the rename machinery was only E2E-tested on prompts. Prove POST + PRODUCT
// parity through the same publish-time flow, including the type seams: a post has NO intro comment (none
// required, none moved), a product's intro moves like a prompt's and its pricing fields round-trip, and each
// type's URL base lands in redirectFrom.
const POST_OLD = 'members/alice/posts/old-name/index.md';
const POST_FM = '---\ntype: post\ntitle: X\nslug: old-name\nauthor: alice\nstatus: published\nvisibility: public\npublishedAt: 2026-07-02T00:00:00.000Z\nexcerpt: about it\ncategories:\n  - devops\n---\n\nOld body.\n';
const POST_INPUT = { title: 'X', slug: 'old-name', excerpt: 'about it', categories: ['devops'], visibility: 'public', publishedAt: '2026-07-07T09:00:00.000Z', updatedAt: '2026-07-07T09:00:00.000Z' };

test('POST rename parity: full move, /articles/ base, and NO intro machinery', async () => {
  const repo = fakeRepo();
  repo.getFileSha = async (r, p, ref) => (ref === 'main' ? (p === POST_OLD ? 'old-sha' : null) : 'blob');
  const reads = [];
  const ctx = ctxFor({ repo, files: { [POST_OLD]: POST_FM } });
  const innerRead = ctx.reader.readFile;
  ctx.reader = { readFile: async (rel) => { reads.push(rel); return innerRead(rel); } };
  const res = await publish(ctx, { type: 'post', input: { ...POST_INPUT, slug: 'new-name' }, body: 'B.', path: POST_OLD });
  assert.deepEqual(res.renamed, { from: 'old-name', to: 'new-name' });
  const fm = parseContentFile(repo.puts.find((f) => f.path === 'members/alice/posts/new-name/index.md').content).frontmatter;
  assert.deepEqual(fm.redirectFrom, ['/articles/old-name/']); // the POST url base
  assert.equal(new Date(fm.publishedAt).toISOString(), '2026-07-02T00:00:00.000Z');
  assert.ok(repo.deletes.includes(POST_OLD));
  assert.equal(repo.pulls[0].head, 'alice:gbti/post-old-name');
  assert.ok(!reads.some((r) => r.includes('/comments/intro-')), 'a post rename must not touch intro comments');
  assert.ok(!repo.deletes.some((d) => d.includes('/comments/')), 'no comment deletes for a post');
});

const PROD_OLD = 'members/alice/products/old-name/index.md';
const PROD_FM = '---\ntype: product\ntitle: X\nslug: old-name\nauthor: alice\nstatus: published\nvisibility: public\npublishedAt: 2026-07-02T00:00:00.000Z\nshortDescription: about it\nicon: ./images/icon.png\nfeaturedImage: ./images/feat.png\npricing: paid\npricingUrl: https://example.com/buy\ncategories:\n  - devops\n---\n\nOld body.\n';
const PROD_INPUT = {
  title: 'X', slug: 'old-name', shortDescription: 'about it', icon: './images/icon.png',
  featuredImage: './images/feat.png', pricing: 'paid', pricingUrl: 'https://example.com/buy',
  categories: ['devops'], visibility: 'public', publishedAt: '2026-07-07T09:00:00.000Z', updatedAt: '2026-07-07T09:00:00.000Z',
};

test('PRODUCT rename parity: full move, /products/ base, intro moves, pricing round-trips', async () => {
  const repo = fakeRepo();
  repo.getFileSha = async (r, p, ref) => (ref === 'main' ? (p === PROD_OLD ? 'old-sha' : null) : 'blob');
  const intro = '---\ntype: comment\nid: intro-old-name\nauthor: alice\ntargetType: product\ntargetSlug: old-name\nstatus: published\nvisibility: public\nauthorNote: true\ncreatedAt: 2026-07-02\n---\n\nHi.\n';
  const ctx = ctxFor({ repo, files: { [PROD_OLD]: PROD_FM, 'members/alice/comments/intro-old-name.md': intro } });
  const res = await publish(ctx, { type: 'product', input: { ...PROD_INPUT, slug: 'new-name' }, body: 'B.', path: PROD_OLD });
  assert.deepEqual(res.renamed, { from: 'old-name', to: 'new-name' });
  const fm = parseContentFile(repo.puts.find((f) => f.path === 'members/alice/products/new-name/index.md').content).frontmatter;
  assert.deepEqual(fm.redirectFrom, ['/products/old-name/']); // the PRODUCT url base
  assert.equal(fm.pricing, 'paid');
  assert.equal(fm.pricingUrl, 'https://example.com/buy'); // commerce fields survive the move
  const movedIntro = repo.puts.find((f) => f.path === 'members/alice/comments/intro-new-name.md');
  assert.equal(parseContentFile(movedIntro.content).frontmatter.targetSlug, 'new-name');
  assert.ok(repo.deletes.includes(PROD_OLD));
  assert.ok(repo.deletes.includes('members/alice/comments/intro-old-name.md'));
});

test('saveDraft rename staging parity for post + product (old path, old-slug branch)', async () => {
  for (const [type, oldPath, fm, input] of [
    ['post', POST_OLD, POST_FM, POST_INPUT],
    ['product', PROD_OLD, PROD_FM, PROD_INPUT],
  ]) {
    const repo = fakeRepo();
    const res = await saveDraft(ctxFor({ repo, files: { [oldPath]: fm } }), { type, input: { ...input, slug: 'renamed-x' }, body: 'B.', path: oldPath });
    assert.equal(res.branch, `gbti/${type}-old-name`);
    assert.equal(res.path, oldPath);
    assert.deepEqual(res.renamed, { from: 'old-name', to: 'renamed-x' });
  }
});

// 2026-07-09: date parity with the WorkBench editor. The MCP/API publish path never stamped
// publishedAt, so an add_* item landed dateless (bottom of every feed, no date chip: the /ci prompt).
test('publish stamps publishedAt for a NEW item; preserves it (+ bumps updatedAt) on a re-publish', async () => {
  // New item (no prior file anywhere): publishedAt stamped.
  const repoA = fakeRepo();
  await publish(ctxFor({ repo: repoA }), { type: 'prompt', input: { title: 'Fresh', slug: 'fresh', shortDescription: 'd' }, body: 'B' });
  const created = repoA.puts.find((f) => f.path === 'members/alice/prompts/fresh/index.md');
  const fmNew = parseContentFile(created.content).frontmatter;
  assert.ok(fmNew.publishedAt, 'a new publish carries publishedAt');
  assert.ok(!fmNew.updatedAt, 'a first publish has no updatedAt');

  // Re-publish of an existing item WITHOUT a path param (the MCP add_* shape): the canonical file's
  // publishedAt is preserved and updatedAt bumps.
  const existing = '---\ntype: prompt\ntitle: Fresh\nslug: fresh\nauthor: alice\nstatus: published\nvisibility: public\nshortDescription: d\npublishedAt: 2026-07-01T00:00:00.000Z\n---\n\nOld body.\n';
  const repoB = fakeRepo();
  await publish(ctxFor({ repo: repoB, files: { 'members/alice/prompts/fresh/index.md': existing } }),
    { type: 'prompt', input: { title: 'Fresh', slug: 'fresh', shortDescription: 'd' }, body: 'B2' });
  const updated = repoB.puts.find((f) => f.path === 'members/alice/prompts/fresh/index.md');
  const fmUp = parseContentFile(updated.content).frontmatter;
  assert.match(String(fmUp.publishedAt instanceof Date ? fmUp.publishedAt.toISOString() : fmUp.publishedAt), /^2026-07-01/);
  assert.ok(fmUp.updatedAt, 'a re-publish bumps updatedAt');

  // The MCP host has no working reader: the repo client's canonical read preserves the date instead.
  const repoD = fakeRepo();
  repoD.getFileContent = async (p2) => (p2 === 'members/alice/prompts/fresh/index.md' ? existing : null);
  const ctxNoReader = { ...ctxFor({ repo: repoD }), reader: {} };
  await publish(ctxNoReader, { type: 'prompt', input: { title: 'Fresh', slug: 'fresh', shortDescription: 'd' }, body: 'B3' });
  const viaRepo = parseContentFile(repoD.puts.find((f) => f.path === 'members/alice/prompts/fresh/index.md').content).frontmatter;
  assert.match(String(viaRepo.publishedAt instanceof Date ? viaRepo.publishedAt.toISOString() : viaRepo.publishedAt), /^2026-07-01/);

  // An explicit caller publishedAt always wins (never overwritten).
  const repoC = fakeRepo();
  await publish(ctxFor({ repo: repoC }), { type: 'prompt', input: { title: 'Fresh', slug: 'fresh', shortDescription: 'd', publishedAt: '2026-06-01T00:00:00.000Z' }, body: 'B' });
  const explicit = parseContentFile(repoC.puts.find((f) => f.path === 'members/alice/prompts/fresh/index.md').content).frontmatter;
  assert.match(String(explicit.publishedAt instanceof Date ? explicit.publishedAt.toISOString() : explicit.publishedAt), /^2026-06-01/);
});
