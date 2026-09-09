// sow-189: the four flag operations through admin-ops: the superadmin gate, the one file they write, the branch,
// idempotency. A fake repo records the put; a temp clone supplies the registry through the real reader.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

import { createReader } from '../client/src/repo-fs.mjs';
import { markStale, unmarkStale, markUnindexed, unmarkUnindexed } from '../client/src/admin-ops.mjs';
import { OperationError } from '../client/src/operations.mjs';

function fakeRepo() {
  const puts = [], pulls = [];
  return {
    upstream: 'gbti-network/gbti.network', puts, pulls,
    async ensureFork() { return { full_name: 'hudson/gbti.network', owner: 'hudson' }; },
    async getDefaultBranch() { return 'main'; },
    async getBranchSha() { return 'sha'; },
    async ensureBranch() {},
    async getFileSha() { return 'existing'; },
    async putFile(r, p, opts) { puts.push({ path: p, content: Buffer.from(opts.contentBase64, 'base64').toString('utf8'), branch: opts.branch }); },
    async deleteFile() {},
    async findOpenPull() { return null; },
    async openPull(opts) { pulls.push(opts); return { number: 77, html_url: 'u' }; },
  };
}
function seed(registry = 'flags: {}\n') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-flags-'));
  fs.mkdirSync(path.join(dir, 'house'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'house', 'content-flags.yml'), registry);
  fs.writeFileSync(path.join(dir, 'house', 'roles.yml'), 'superadmins: []\nadmins: []\nmoderators: []\n');
  return dir;
}
const ctxFor = (role, repoPath, repo) => ({
  role: () => role, getRepoClient: () => repo, reader: createReader(repoPath),
  store: { get: (k) => ({ repoPath, githubToken: 't' })[k] }, now: () => '2026-09-08T22:00:00Z',
  identity: () => ({ githubId: '1', login: 'hudson' }),
  fetch: async () => ({ ok: true, json: async () => ({ synced: true }) }),
});
const PATH = 'members/bob/posts/old-news/index.md';

test('an admin is refused; only a superadmin may flag content', async () => {
  const repo = fakeRepo();
  await assert.rejects(markStale(ctxFor('admin', seed(), repo), { path: PATH }), (e) => e instanceof OperationError && e.code === 'forbidden');
  assert.equal(repo.puts.length, 0);
});

test('mark stale writes ONE file, the registry, on a content-flag branch, with who/when/why and an audit in the PR', async () => {
  const repo = fakeRepo();
  const r = await markStale(ctxFor('superadmin', seed(), repo), { path: PATH, reason: 'superseded by the 2026 guide' });
  assert.equal(r.changed, true);
  assert.equal(repo.puts.length, 1);
  assert.equal(repo.puts[0].path, 'house/content-flags.yml');
  assert.equal(repo.puts[0].branch, 'gbti/content-flag-post-old-news');
  const doc = yaml.load(repo.puts[0].content);
  assert.deepEqual(doc.flags['post:old-news'], { stale: true, at: '2026-09-08T22:00:00.000Z', by: 'hudson', reason: 'superseded by the 2026 guide' });
  assert.match(repo.pulls[0].body, /content\.stale/);
  assert.equal(r.audit.action, 'content.stale');
});

test('the member file itself is never touched, and a non-member path is refused', async () => {
  const repo = fakeRepo();
  await markUnindexed(ctxFor('superadmin', seed(), repo), { path: PATH });
  assert.ok(repo.puts.every((p) => p.path === 'house/content-flags.yml'), 'the flag is a house entry, not an edit to members/bob');
  await assert.rejects(markStale(ctxFor('superadmin', seed(), fakeRepo()), { path: 'house/posts/x/index.md' }), (e) => e instanceof OperationError && e.code === 'forbidden', 'the control is confined to member content, like Hide');
  await assert.rejects(markStale(ctxFor('superadmin', seed(), fakeRepo()), { path: 'members/bob/shares/12.md' }), (e) => e instanceof OperationError && e.code === 'bad-request');
});

test('idempotent: flagging twice is a no-op with no PR; clearing removes the flag and an empty entry', async () => {
  const already = 'flags:\n  "post:old-news":\n    stale: true\n    unindexed: true\n    at: "2026-09-01T00:00:00.000Z"\n';
  const repo = fakeRepo();
  const r = await markStale(ctxFor('superadmin', seed(already), repo), { path: PATH });
  assert.equal(r.changed, false); assert.equal(repo.puts.length, 0);
  const r2 = await unmarkStale(ctxFor('superadmin', seed(already), repo), { path: PATH });
  assert.equal(r2.changed, true);
  assert.deepEqual(yaml.load(repo.puts[0].content).flags['post:old-news'], { unindexed: true, at: '2026-09-01T00:00:00.000Z' }, 'stale cleared, unindexed kept');
  const repo3 = fakeRepo();
  await unmarkUnindexed(ctxFor('superadmin', seed('flags:\n  "post:old-news":\n    unindexed: true\n'), repo3), { path: PATH });
  assert.deepEqual(yaml.load(repo3.puts[0].content).flags, {}, 'nothing left: the entry goes');
});
