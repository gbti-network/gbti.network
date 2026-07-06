// SOW-112: the true permalink rename. Guards (own folder, collision, staged/PR block, sync fail-closed),
// the one-PR file set (new index + delete old + .enc byte-move + intro move/retarget), redirectFrom append,
// publishedAt preserved. Fakes only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renameContent, OperationError } from '../client/src/operations.mjs';
import { parseContentFile } from '../client/src/content-ops.mjs';

const OLD = 'members/alice/prompts/old-name/index.md';
const PROMPT = '---\ntype: prompt\ntitle: X\nslug: old-name\nauthor: alice\nstatus: published\nvisibility: public\npublishedAt: 2026-07-02\ntargets:\n  - Claude Code\ncategories:\n  - skill\n---\n\nThe body.\n';
const INTRO = '---\ntype: comment\nid: intro-old-name\nauthor: alice\ntargetType: prompt\ntargetSlug: old-name\nstatus: published\nvisibility: public\nauthorNote: true\ncreatedAt: 2026-07-02\n---\n\nFrom the author.\n';

function fakeRepo({ stagedBranches = [], openPull = null, upstreamFiles = {}, baseHasOld = true } = {}) {
  const puts = [];
  const deletes = [];
  const pulls = [];
  return {
    puts, deletes, pulls,
    upstream: 'gbti-network/gbti.network',
    async ensureFork() { return { full_name: 'alice/gbti.network', owner: 'alice' }; },
    async getDefaultBranch() { return 'main'; },
    async getBranchSha(r, branch) {
      if (branch === 'main') return 'main-sha';
      if (stagedBranches.includes(branch)) return 'staged-sha';
      throw new Error('404');
    },
    async ensureBranch() {},
    async getFileSha(r, p, ref) {
      if (ref === 'main') return baseHasOld && p === OLD ? 'old-sha' : null;
      return 'blob-sha';
    },
    async getFileContent(p) { return upstreamFiles[p] ?? null; },
    async findOpenPull({ head }) { return openPull && head.includes(openPull) ? { number: 5 } : null; },
    async putFile(r, p, opts) { puts.push({ path: p, content: Buffer.from(opts.contentBase64, 'base64').toString('utf8') }); },
    async deleteFile(r, p) { deletes.push(p); },
    async openPull(opts) { pulls.push(opts); return { number: 91, html_url: 'u' }; },
  };
}

function ctxFor({ repo, files = {}, membership = 'paid' } = {}) {
  const all = { [OLD]: PROMPT, ...files };
  return {
    identity: () => ({ username: 'alice' }),
    getRepoClient: () => repo,
    membership: async () => membership,
    reader: { readFile: async (rel) => all[rel] ?? null },
    store: { get: () => null },
    now: () => '2026-07-06T12:00:00Z',
  };
}

test('rename: one PR moves the index + intro, appends redirectFrom, preserves publishedAt, deletes the old paths', async () => {
  const repo = fakeRepo();
  const ctx = ctxFor({ repo, files: { 'members/alice/comments/intro-old-name.md': INTRO } });
  const r = await renameContent(ctx, { path: OLD, newSlug: 'new-name' });
  assert.equal(r.ok, true);
  assert.equal(r.prNumber, 91);
  assert.equal(r.path, 'members/alice/prompts/new-name/index.md');
  const newIndex = repo.puts.find((f) => f.path === r.path);
  const fm = parseContentFile(newIndex.content).frontmatter;
  assert.equal(fm.slug, 'new-name');
  assert.deepEqual(fm.redirectFrom, ['/prompts/old-name/']);
  assert.equal(new Date(fm.publishedAt).toISOString().slice(0, 10), '2026-07-02'); // preserved
  assert.equal(fm.updatedAt, '2026-07-06T12:00:00Z');
  const newIntro = repo.puts.find((f) => f.path === 'members/alice/comments/intro-new-name.md');
  const introFm = parseContentFile(newIntro.content).frontmatter;
  assert.equal(introFm.id, 'intro-new-name');
  assert.equal(introFm.targetSlug, 'new-name');
  assert.deepEqual(repo.deletes.sort(), [OLD, 'members/alice/comments/intro-old-name.md'].sort());
  assert.match(repo.pulls[0].title, /^Rename: old-name -> new-name$/);
});

test('rename: a members-only item byte-moves its .enc and repoints encryptedBody', async () => {
  const encOld = 'members/alice/_enc/prompt-old-name-body.enc';
  const memberPrompt = PROMPT.replace('visibility: public', `visibility: members\nencryptedBody: ${encOld}`);
  const envelope = '{"v":1,"kid":"1","iv":"aa","aad":"prompt:old-name:body","ct":"bb"}';
  const repo = fakeRepo();
  const ctx = ctxFor({ repo, files: { [OLD]: memberPrompt, [encOld]: envelope } });
  const r = await renameContent(ctx, { path: OLD, newSlug: 'new-name' });
  const movedEnc = repo.puts.find((f) => f.path === 'members/alice/_enc/prompt-new-name-body.enc');
  assert.equal(movedEnc.content, envelope); // byte-identical: the envelope is path-independent
  const fm = parseContentFile(repo.puts.find((f) => f.path === r.path).content).frontmatter;
  assert.equal(fm.encryptedBody, 'members/alice/_enc/prompt-new-name-body.enc');
  assert.ok(repo.deletes.includes(encOld));
});

test('rename guards: collision, staged draft, open PR, foreign path, bad slug, non-paid, no-op', async () => {
  const base = () => ctxFor({ repo: fakeRepo() });
  await assert.rejects(renameContent(ctxFor({ repo: fakeRepo({ upstreamFiles: { 'members/alice/prompts/new-name/index.md': 'x' } }) }), { path: OLD, newSlug: 'new-name' }),
    (e) => e instanceof OperationError && /already taken/.test(e.message));
  await assert.rejects(renameContent(ctxFor({ repo: fakeRepo({ stagedBranches: ['gbti/prompt-old-name'] }) }), { path: OLD, newSlug: 'new-name' }),
    (e) => /staged draft/.test(e.message));
  await assert.rejects(renameContent(ctxFor({ repo: fakeRepo({ openPull: 'gbti/prompt-new-name' }) }), { path: OLD, newSlug: 'new-name' }),
    (e) => /open pull request/.test(e.message));
  await assert.rejects(renameContent(base(), { path: 'members/bob/prompts/x/index.md', newSlug: 'y' }),
    (e) => e.code === 'forbidden');
  await assert.rejects(renameContent(base(), { path: OLD, newSlug: 'Bad Slug!' }),
    (e) => e.code === 'bad-request');
  await assert.rejects(renameContent(ctxFor({ repo: fakeRepo(), membership: 'trialing' }), { path: OLD, newSlug: 'new-name' }),
    (e) => e.code === 'membership-required');
  assert.deepEqual(await renameContent(base(), { path: OLD, newSlug: 'old-name' }), { ok: true, noop: true, slug: 'old-name' });
});

test('rename fails CLOSED when the old file is not on the branch base (fork sync unavailable)', async () => {
  const repo = fakeRepo({ baseHasOld: false });
  await assert.rejects(renameContent(ctxFor({ repo }), { path: OLD, newSlug: 'new-name' }),
    (e) => e instanceof OperationError && /fork to sync/.test(e.message));
  assert.equal(repo.puts.length, 0); // never a half-move
  assert.equal(repo.pulls.length, 0);
});
