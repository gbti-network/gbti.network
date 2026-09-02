// SOW-006 admin/superadmin tools: role resolution + the capability-gated orchestration. SOW-038 P4: the pure
// governance edits now live in membership/superadmin-actions.mjs (tested in test/superadmin-actions.test.mjs);
// admin-ops orchestrates that core, so these tests cover the wiring (role gate, PR, idempotency, audit-in-body).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { rolesFromParsed, roleOf, canModerate, canBanGrandfather, canManageRoles } from '../client/src/roles.mjs';
import { createReader, loadRoles } from '../client/src/repo-fs.mjs';
// sow-213 Step 3: ban/unban/grandfather/ungrandfather are retired from admin-ops (governance is KV-native and
// routes through the Worker now); their behaviour is covered by test/membership-admin-author.test.mjs +
// test/governance-routed-to-worker.test.mjs. Only role assignment + content moderation stay local here.
import { setMemberRole, deplatformContent, removeContent, republishContent } from '../client/src/admin-ops.mjs';
import { OperationError } from '../client/src/operations.mjs';

// ---- roles ----

test('roles: parse + rank + capability predicates', () => {
  const map = rolesFromParsed({ superadmins: [{ github_id: '1' }], admins: [{ github_id: '2' }], moderators: [{ github_id: '3' }] });
  assert.equal(roleOf('1', map), 'superadmin');
  assert.equal(roleOf('3', map), 'moderator');
  assert.equal(roleOf('99', map), 'member');
  assert.equal(canModerate('moderator'), true);
  assert.equal(canBanGrandfather('moderator'), false);
  assert.equal(canBanGrandfather('admin'), true);
  assert.equal(canManageRoles('admin'), false);
  assert.equal(canManageRoles('superadmin'), true);
});

test('roles: loadRoles from a local repo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-roles-'));
  fs.mkdirSync(path.join(dir, 'house'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'house', 'roles.yml'), 'superadmins:\n  - github_id: "1"\n    login: alice\n');
  assert.equal(roleOf('1', loadRoles(dir)), 'superadmin');
});

// ---- orchestration ----

function fakeRepo() {
  const puts = [];
  const deletes = [];
  const pulls = [];
  return {
    upstream: 'gbti-network/gbti.network',
    puts,
    deletes,
    pulls,
    async ensureFork() { return { full_name: 'alice/gbti.network', owner: 'alice' }; },
    async getDefaultBranch() { return 'main'; },
    async getBranchSha() { return 'sha'; },
    async ensureBranch() {},
    async getFileSha() { return 'existing'; },
    async putFile(r, p, opts) { puts.push({ path: p, content: Buffer.from(opts.contentBase64, 'base64').toString('utf8'), branch: opts.branch }); },
    async deleteFile(r, p, opts) { deletes.push({ path: p, branch: opts.branch }); },
    async findOpenPull() { return null; },
    async openPull(opts) { pulls.push(opts); return { number: 55, html_url: 'u' }; },
  };
}

function adminCtx({ role = 'admin', repoPath, repo } = {}) {
  return { role: () => role, getRepoClient: () => repo, reader: createReader(repoPath), store: { get: (k) => ({ repoPath })[k] }, now: () => '2026-06-03T00:00:00Z' };
}

function seedRepo(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-admin-'));
  fs.mkdirSync(path.join(dir, 'house'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'house', 'bans.yml'), 'bans: []\n');
  fs.writeFileSync(path.join(dir, 'house', 'grandfathered.yml'), 'grandfathered: []\n');
  fs.writeFileSync(path.join(dir, 'house', 'roles.yml'), 'superadmins: []\nadmins: []\nmoderators: []\n');
  if (extra.content) {
    fs.mkdirSync(path.join(dir, 'members', 'bob', 'posts'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'members', 'bob', 'posts', 'x.md'), '---\ntype: post\ntitle: X\nslug: x\nauthor: bob\nstatus: published\n---\n\nbody\n');
  }
  if (extra.draftContent) {
    fs.mkdirSync(path.join(dir, 'members', 'bob', 'posts'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'members', 'bob', 'posts', 'x.md'), '---\ntype: post\ntitle: X\nslug: x\nauthor: bob\nstatus: draft\n---\n\nbody\n');
  }
  return dir;
}

// SOW-152: an admin config write FRESH-BASES its fork branch (POST /membership/sync-fork) BEFORE committing,
// exactly like the content publish path. Without it, the branch force-resets onto a stale fork main -> add/add
// conflicts that a superadmin-automerge PR stalls on. A recording fetch proves the sync ran on a governance
// write; role assignment (roles.yml, git-native) exercises the SAME adminPublish path the retired ban writer did.
test('SOW-152: an admin write syncs the fork main before committing (fresh-base)', async () => {
  const repoPath = seedRepo();
  const repo = fakeRepo();
  const fetched = [];
  const fetch = async (url) => { fetched.push(String(url)); return { ok: true, json: async () => ({ synced: true }) }; };
  const ctx = {
    role: () => 'superadmin', getRepoClient: () => repo, reader: createReader(repoPath),
    store: { get: (k) => ({ repoPath, githubToken: 't' })[k] }, now: () => '2026-06-03T00:00:00Z', fetch,
  };
  const out = await setMemberRole(ctx, { githubId: '77', role: 'moderator' });
  assert.equal(out.changed, true); // the write still succeeds
  assert.ok(fetched.some((u) => u.includes('/membership/sync-fork')), 'the fork main was synced before the commit');
});

test('setMemberRole: unknown role is a bad-request (mapped from the core SuperadminActionError)', async () => {
  await assert.rejects(
    setMemberRole(adminCtx({ role: 'superadmin', repoPath: seedRepo(), repo: fakeRepo() }), { githubId: '5', role: 'wizard' }),
    (e) => e instanceof OperationError && e.code === 'bad-request',
  );
});

test('setMemberRole: requires superadmin; writes roles.yml', async () => {
  const repoPath = seedRepo();
  await assert.rejects(
    setMemberRole(adminCtx({ role: 'admin', repoPath, repo: fakeRepo() }), { githubId: '5', role: 'moderator' }),
    (e) => e.code === 'forbidden',
  );
  const repo = fakeRepo();
  await setMemberRole(adminCtx({ role: 'superadmin', repoPath, repo }), { githubId: '5', role: 'moderator', login: 'mo' });
  assert.equal(repo.puts[0].path, 'house/roles.yml');
  assert.match(repo.puts[0].content, /moderators/);
  assert.match(repo.puts[0].content, /'?5'?/);
});

test('deplatformContent: moderator sets a member content file to draft via PR', async () => {
  const repoPath = seedRepo({ content: true });
  const repo = fakeRepo();
  const out = await deplatformContent(adminCtx({ role: 'moderator', repoPath, repo }), { path: 'members/bob/posts/x.md' });
  assert.equal(out.prNumber, 55);
  assert.equal(repo.puts[0].path, 'members/bob/posts/x.md');
  assert.match(repo.puts[0].content, /status: draft/);
});

test('removeContent: admin deletes a member content file via PR; a moderator is forbidden (SOW-071)', async () => {
  const repo = fakeRepo();
  await removeContent(adminCtx({ role: 'admin', repoPath: seedRepo({ content: true }), repo }), { path: 'members/bob/posts/x.md' });
  assert.equal(repo.deletes[0].path, 'members/bob/posts/x.md');
  // SOW-071: Remove is now admin+ (destructive); Hide/Unhide stay moderator+.
  await assert.rejects(
    removeContent(adminCtx({ role: 'moderator', repoPath: seedRepo({ content: true }), repo: fakeRepo() }), { path: 'members/bob/posts/x.md' }),
    (e) => e instanceof OperationError && e.code === 'forbidden',
  );
});

test('republishContent: moderator flips a draft member content file to published; a member is forbidden (SOW-071)', async () => {
  const repo = fakeRepo();
  const out = await republishContent(adminCtx({ role: 'moderator', repoPath: seedRepo({ draftContent: true }), repo }), { path: 'members/bob/posts/x.md' });
  assert.equal(out.prNumber, 55);
  assert.equal(repo.puts[0].path, 'members/bob/posts/x.md');
  assert.match(repo.puts[0].content, /status: published/);
  await assert.rejects(
    republishContent(adminCtx({ role: 'member', repoPath: seedRepo({ draftContent: true }), repo: fakeRepo() }), { path: 'members/bob/posts/x.md' }),
    (e) => e.code === 'forbidden',
  );
});

test('admin ops fail closed without auth or path traversal', async () => {
  await assert.rejects(setMemberRole(adminCtx({ role: 'superadmin', repoPath: seedRepo(), repo: null }), { githubId: '1', role: 'moderator' }), (e) => e.code === 'not-authenticated');
  await assert.rejects(removeContent(adminCtx({ role: 'admin', repoPath: seedRepo(), repo: fakeRepo() }), { path: '../../etc/passwd' }), (e) => e.code === 'bad-request');
});
