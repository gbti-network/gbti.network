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
