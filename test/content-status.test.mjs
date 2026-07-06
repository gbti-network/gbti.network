// SOW-106 Phase B: the member self-unpublish/republish (setOwnContentStatus) + the shared status-flip core.
// Own-folder guard, paid gate, fresh-read flip, idempotent no-op, and the gated-PR wiring. Fakes only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flipContentStatus } from '../client/src/content-ops.mjs';
import { setOwnContentStatus, OperationError } from '../client/src/operations.mjs';

const FILE = '---\ntype: post\ntitle: X\nslug: x\nauthor: alice\nstatus: published\nvisibility: members\ncategories:\n  - devops\n---\n\nThe body.\n';

test('flipContentStatus flips ONLY status (visibility + fields survive) and no-ops when already there', () => {
  const down = flipContentStatus(FILE, 'draft');
  assert.equal(down.changed, true);
  assert.equal(down.current, 'published');
  assert.match(down.content, /status: draft/);
  assert.match(down.content, /visibility: members/);
  assert.match(down.content, /- devops/);
  assert.match(down.content, /The body\./);
  const same = flipContentStatus(FILE, 'published');
  assert.equal(same.changed, false);
  assert.equal(same.content, null);
});

function ctxFor({ username = 'alice', membership = 'paid', file = FILE, repo = null } = {}) {
  return {
    identity: () => ({ username }),
    getRepoClient: () => repo,
    membership: async () => membership,
    reader: { readFile: async (rel) => (rel.includes('/x/') ? file : null) },
    store: { get: () => null },
  };
}

function fakeRepo() {
  const puts = [];
  const pulls = [];
  return {
    puts,
    pulls,
    upstream: 'gbti-network/gbti.network',
    async ensureFork() { return { full_name: 'alice/gbti.network', owner: 'alice' }; },
    async getDefaultBranch() { return 'main'; },
    async getBranchSha() { return 'sha'; },
    async ensureBranch() {},
    async getFileSha() { return 'existing'; },
    async putFile(r, p, opts) { puts.push({ path: p, content: Buffer.from(opts.contentBase64, 'base64').toString('utf8'), branch: opts.branch }); },
    async findOpenPull() { return null; },
    async openPull(opts) { pulls.push(opts); return { number: 77, html_url: 'u' }; },
  };
}

const PATH = 'members/alice/posts/x/index.md';

test('setOwnContentStatus: unpublish flips the own item to draft via the gated own-folder PR', async () => {
  const repo = fakeRepo();
  const r = await setOwnContentStatus(ctxFor({ repo }), { path: PATH, status: 'draft' });
  assert.equal(r.ok, true);
  assert.equal(r.prNumber, 77);
  assert.equal(repo.puts[0].path, PATH);
  assert.equal(repo.puts[0].branch, 'gbti/status-post-x');
  assert.match(repo.puts[0].content, /status: draft/);
  assert.match(repo.puts[0].content, /visibility: members/); // untouched
  assert.match(repo.pulls[0].title, /^Unpublish: x$/);
});

test('setOwnContentStatus: idempotent no-op (no PR) when already in the requested state', async () => {
  const repo = fakeRepo();
  const r = await setOwnContentStatus(ctxFor({ repo }), { path: PATH, status: 'published' });
  assert.deepEqual(r, { ok: true, noop: true, status: 'published' });
  assert.equal(repo.puts.length, 0);
  assert.equal(repo.pulls.length, 0);
});

test('setOwnContentStatus: guards — another member\'s path, a bad shape, a bad status, a non-paid member', async () => {
  const repo = fakeRepo();
  await assert.rejects(
    setOwnContentStatus(ctxFor({ repo }), { path: 'members/bob/posts/x/index.md', status: 'draft' }),
    (e) => e instanceof OperationError && e.code === 'forbidden',
  );
  await assert.rejects(
    setOwnContentStatus(ctxFor({ repo }), { path: 'house/roles.yml', status: 'draft' }),
    (e) => e instanceof OperationError && e.code === 'bad-request',
  );
  await assert.rejects(
    setOwnContentStatus(ctxFor({ repo }), { path: PATH, status: 'hidden' }),
    (e) => e instanceof OperationError && e.code === 'bad-request',
  );
  await assert.rejects(
    setOwnContentStatus(ctxFor({ repo, membership: 'trialing' }), { path: PATH, status: 'draft' }),
    (e) => e instanceof OperationError && e.code === 'membership-required',
  );
  assert.equal(repo.pulls.length, 0);
});

test('setOwnContentStatus: republish flips a drafted item back', async () => {
  const repo = fakeRepo();
  const drafted = FILE.replace('status: published', 'status: draft');
  const r = await setOwnContentStatus(ctxFor({ repo, file: drafted }), { path: PATH, status: 'published' });
  assert.equal(r.ok, true);
  assert.match(repo.puts[0].content, /status: published/);
  assert.match(repo.pulls[0].title, /^Republish: x$/);
});
