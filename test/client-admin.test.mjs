// SOW-006 admin/superadmin tools: pure edits, role resolution, and the capability-gated orchestration.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { addBan, removeBan, addGrandfather, assignRole, revokeRole, setStatusDraft } from '../client/src/admin-edits.mjs';
import { rolesFromParsed, roleOf, canModerate, canBanGrandfather, canManageRoles } from '../client/src/roles.mjs';
import { createReader, loadRoles } from '../client/src/repo-fs.mjs';
import { banMember, grandfatherMember, setMemberRole, deplatformContent, removeContent } from '../client/src/admin-ops.mjs';
import { OperationError } from '../client/src/operations.mjs';

// ---- pure edits ----

test('admin-edits: ban add/remove (idempotency guard)', () => {
  const after = addBan({ bans: [] }, { githubId: '999', reason: 'spam', at: 'T' });
  assert.equal(after.bans[0].github_id, '999');
  assert.throws(() => addBan(after, { githubId: '999' }), /already banned/);
  assert.deepEqual(removeBan(after, '999').bans, []);
});

test('admin-edits: grandfather add with permanent default', () => {
  const after = addGrandfather({}, { githubId: '7', reason: 'founder' });
  assert.equal(after.grandfathered[0].github_id, '7');
  assert.equal(after.grandfathered[0].until, null);
});

test('admin-edits: assignRole moves id to one list; revoke removes from all; unknown role throws', () => {
  const base = { superadmins: [{ github_id: '1' }], admins: [], moderators: [] };
  const asMod = assignRole(base, { githubId: '5', role: 'moderator', login: 'mo' });
  assert.deepEqual(asMod.moderators, [{ github_id: '5', login: 'mo' }]);
  const promote = assignRole(asMod, { githubId: '5', role: 'admin' });
  assert.equal(promote.moderators.length, 0);
  assert.equal(promote.admins[0].github_id, '5');
  assert.equal(revokeRole(promote, '5').admins.length, 0);
  assert.throws(() => assignRole(base, { githubId: '5', role: 'wizard' }), /unknown role/);
});

test('admin-edits: setStatusDraft', () => {
  assert.equal(setStatusDraft({ status: 'published', title: 'x' }).status, 'draft');
});

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
  return {
    upstream: 'gbti-network/gbti.network',
    puts,
    deletes,
    async ensureFork() { return { full_name: 'alice/gbti.network', owner: 'alice' }; },
    async getDefaultBranch() { return 'main'; },
    async getBranchSha() { return 'sha'; },
    async ensureBranch() {},
    async getFileSha() { return 'existing'; },
    async putFile(r, p, opts) { puts.push({ path: p, content: Buffer.from(opts.contentBase64, 'base64').toString('utf8'), branch: opts.branch }); },
    async deleteFile(r, p, opts) { deletes.push({ path: p, branch: opts.branch }); },
    async findOpenPull() { return null; },
    async openPull() { return { number: 55, html_url: 'u' }; },
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
  return dir;
}

test('banMember: forbidden for a plain member, allowed for admin (PR edits bans.yml)', async () => {
  const repoPath = seedRepo();
  await assert.rejects(
    banMember(adminCtx({ role: 'member', repoPath, repo: fakeRepo() }), { githubId: '999' }),
    (e) => e instanceof OperationError && e.code === 'forbidden',
  );
  const repo = fakeRepo();
  const out = await banMember(adminCtx({ role: 'admin', repoPath, repo }), { githubId: '999', reason: 'spam' });
  assert.equal(out.prNumber, 55);
  assert.equal(out.branch, 'gbti/ban-999');
  assert.equal(repo.puts[0].path, 'house/bans.yml');
  assert.match(repo.puts[0].content, /999/);
});

test('grandfatherMember: admin opens a grandfathered.yml PR', async () => {
  const repo = fakeRepo();
  const out = await grandfatherMember(adminCtx({ role: 'admin', repoPath: seedRepo(), repo }), { githubId: '7', reason: 'founder' });
  assert.equal(out.prNumber, 55);
  assert.equal(repo.puts[0].path, 'house/grandfathered.yml');
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

test('removeContent: moderator deletes a member content file via PR', async () => {
  const repo = fakeRepo();
  await removeContent(adminCtx({ role: 'moderator', repoPath: seedRepo({ content: true }), repo }), { path: 'members/bob/posts/x.md' });
  assert.equal(repo.deletes[0].path, 'members/bob/posts/x.md');
});

test('admin ops fail closed without auth or path traversal', async () => {
  await assert.rejects(banMember(adminCtx({ role: 'admin', repoPath: seedRepo(), repo: null }), { githubId: '1' }), (e) => e.code === 'not-authenticated');
  await assert.rejects(removeContent(adminCtx({ role: 'moderator', repoPath: seedRepo(), repo: fakeRepo() }), { path: '../../etc/passwd' }), (e) => e.code === 'bad-request');
});
