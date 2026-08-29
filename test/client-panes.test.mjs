// SOW-006 panes backend: settings/billing/referral operations, members-only listing, and the admin API dispatch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createReader } from '../client/src/repo-fs.mjs';
import { getSettings, updateSettings, getBilling, getReferral } from '../client/src/settings-ops.mjs';
import { handleApi } from '../client/src/api.mjs';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-panes-')); }

function ctxFor({ role = 'member', repoPath, repo, identity, data } = {}) {
  const store = data ?? { preferredPort: 4500, mcpEnabled: true, repoPath, endpointToken: 'tok', githubToken: repo ? 'gh' : null };
  return {
    store: { get: (k) => store[k], set: (p) => Object.assign(store, p) },
    reader: createReader(repoPath ?? '/nope'),
    getRepoClient: () => repo ?? null,
    identity: () => (identity === null ? null : { login: 'alice', githubId: '1', username: 'alice' }),
    role: () => role,
  };
}

const fakeRepo = () => ({
  upstream: 'gbti-network/gbti.network',
  async ensureFork() { return { full_name: 'alice/gbti.network', owner: 'alice' }; },
  async getDefaultBranch() { return 'main'; },
  async getBranchSha() { return 'sha'; },
  async ensureBranch() {},
  async getFileSha() { return 'existing'; },
  async putFile() {},
  async deleteFile() {},
  async findOpenPull() { return null; },
  async openPull() { return { number: 77, html_url: 'u' }; },
});

test('settings: read, update (mcp + port), and port validation', () => {
  const ctx = ctxFor({});
  const s = getSettings(ctx);
  assert.equal(s.preferredPort, 4500);
  assert.equal(s.endpointToken, 'tok');
  assert.ok('autostart' in s);

  const updated = updateSettings(ctx, { mcpEnabled: false, preferredPort: 5000 });
  assert.equal(updated.mcpEnabled, false);
  assert.equal(updated.preferredPort, 5000);
  assert.throws(() => updateSettings(ctx, { preferredPort: 99999 }), /1\.\.65535/);
});

test('billing + referral deep-links', () => {
  const ctx = ctxFor({});
  assert.match(getBilling(ctx).portal, /stripe\.com/);
  const ref = getReferral(ctx);
  assert.equal(ref.code, '1');
  assert.match(ref.link, /\?ref=1$/);
  assert.match(ref.connectOnboarding, /\/referral\/connect\/start$/);
});

test('reader.listMembersOnly: returns only visibility:members content', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'members', 'alice', 'posts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'members', 'alice', 'posts', 'pub.md'), '---\ntype: post\ntitle: Public\nslug: pub\nauthor: alice\nvisibility: public\n---\n\nx\n');
  fs.writeFileSync(path.join(dir, 'members', 'alice', 'posts', 'sec.md'), '---\ntype: post\ntitle: Secret\nslug: sec\nauthor: alice\nvisibility: members\n---\n\nx\n');
  const items = createReader(dir).listMembersOnly();
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Secret');
});

test('api: settings GET/POST + members-content', async () => {
  const ctx = ctxFor({ repoPath: tmp() });
  assert.equal((await handleApi({ method: 'GET', pathname: '/api/settings', query: {} }, ctx)).status, 200);
  const posted = await handleApi({ method: 'POST', pathname: '/api/settings', body: { mcpEnabled: false } }, ctx);
  assert.equal(posted.json.mcpEnabled, false);
  assert.equal((await handleApi({ method: 'GET', pathname: '/api/members-content', query: {} }, ctx)).status, 200);
});

// sow-213 Phase 2b: the SUBJECT of this test changed and the old assertion is now the thing that must be
// FALSE. A ban used to be written by the LOCAL writer here (asserted as prNumber 77 off fakeRepo). That path
// holds a GitHub token and no KV credential, so it wrote the git half of a ban and could not write the KV half
// or the moderation log at all. Both hosts now route governance to the Worker; leaving this one behind would
// simply have moved the gap from the extension to the website.
test('api /api/admin: governance goes to the WORKER and is role-gated; unknown actions are rejected', async () => {
  const repoPath = tmp();
  fs.mkdirSync(path.join(repoPath, 'house'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'house', 'bans.yml'), 'bans: []\n');
  // requireAdmin derives the caller's role from roles.yml rather than from a host-provided role(), so the
  // admin case needs the caller (github_id 1) listed there.
  fs.writeFileSync(path.join(repoPath, 'house', 'roles.yml'), 'superadmins: []\nadmins:\n  - github_id: "1"\nmoderators: []\n');

  const calls = [];
  const workerFetch = async (url) => {
    calls.push(String(url));
    return { ok: true, status: 200, async json() { return { ok: true, number: 77, html_url: 'https://x/pull/77', kvWritten: true, kvReason: null }; } };
  };
  const withWorker = (over) => ({ ...ctxFor(over), fetch: workerFetch });

  // A caller absent from roles.yml resolves to member -> forbidden, and never reaches the Worker.
  const memberPath = tmp();
  fs.mkdirSync(path.join(memberPath, 'house'), { recursive: true });
  fs.writeFileSync(path.join(memberPath, 'house', 'bans.yml'), 'bans: []\n');
  const asMember = await handleApi({ method: 'POST', pathname: '/api/admin', body: { action: 'ban', githubId: '9' } }, withWorker({ role: 'member', repoPath: memberPath, repo: fakeRepo() }));
  assert.equal(asMember.status, 403);
  assert.equal(calls.length, 0, 'a rejected caller never reaches the Worker');

  const recording = { ...fakeRepo(), puts: [], async putFile(p2, c) { this.puts.push({ path: p2, content: c }); } };
  const asAdmin = await handleApi({ method: 'POST', pathname: '/api/admin', body: { action: 'ban', githubId: '9', reason: 'spam' } }, withWorker({ role: 'admin', repoPath, repo: recording }));
  assert.equal(asAdmin.status, 200);
  assert.equal(asAdmin.json.prNumber, 77);
  assert.equal(asAdmin.json.kvWritten, true, 'both halves landed, which the local writer could never report');
  assert.match(calls[0], /\/membership\/admin\/author$/);
  assert.equal(recording.puts.length, 0, 'THE POINT: the local git-only writer was not used');

  const unknown = await handleApi({ method: 'POST', pathname: '/api/admin', body: { action: 'frobnicate' } }, withWorker({ role: 'admin', repoPath, repo: fakeRepo() }));
  assert.equal(unknown.status, 400);
});
