// SOW-006 CLI command layer: login (device flow -> store), whoami, new (scaffold), publish, pr.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createStore } from '../client/src/store.mjs';
import { createReader } from '../client/src/repo-fs.mjs';
import { usernameFromRepo, cmdLogin, cmdWhoami, cmdNew, cmdPublish, cmdPr } from '../client/src/cli-commands.mjs';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-cli-'));
}
function seedRepo(dir, withIndex = true) {
  fs.mkdirSync(path.join(dir, 'members', 'alice', 'posts'), { recursive: true });
  if (withIndex) {
    fs.mkdirSync(path.join(dir, 'house'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'house', 'members-index.yml'), 'members:\n  "1": alice\n');
  }
  return dir;
}
function ctxFor({ repoPath, repo, identity } = {}) {
  const data = { repoPath, githubToken: repo ? 'tok' : null };
  return {
    store: { get: (k) => data[k], set: (p) => Object.assign(data, p) },
    reader: createReader(repoPath ?? '/nope'),
    getRepoClient: () => repo ?? null,
    identity: () => (identity === null ? null : { login: 'alice', githubId: '1', username: 'alice' }),
  };
}
const fakeRepo = () => ({
  upstream: 'gbti-network/gbti.network',
  async getAuthUser() { return { login: 'Alice', id: '1' }; },
  async ensureFork() { return { full_name: 'alice/gbti.network', owner: 'alice' }; },
  async getDefaultBranch() { return 'main'; },
  async getBranchSha() { return 'sha'; },
  async ensureBranch() {},
  async getFileSha() { return null; },
  async putFile() {},
  async findOpenPull() { return null; },
  async openPull() { return { number: 21, html_url: 'u' }; },
  async listMyPulls() { return [{ number: 21, title: 'x', html_url: 'u' }]; },
  async gateStatus() { return { state: 'failure', meaning: 'held', sha: 'sha' }; },
});

test('usernameFromRepo: resolves via members-index, else falls back to login', () => {
  const dir = seedRepo(tmp());
  assert.equal(usernameFromRepo(dir, '1', 'Whoever'), 'alice');
  assert.equal(usernameFromRepo(dir, '999', 'Bob'), 'bob');
  assert.equal(usernameFromRepo('/nope', '1', 'Carol'), 'carol');
});

test('cmdLogin: device flow writes token + resolved identity to the store', async () => {
  const dir = tmp();
  const repo = seedRepo(tmp());
  const store = createStore({ dir });
  store.set({ repoPath: repo });
  const result = await cmdLogin({
    store,
    clientId: 'Iv1.abc',
    deviceFlowLogin: async () => ({ accessToken: 'gho_secret' }),
    makeRepoClient: () => ({ getAuthUser: async () => ({ login: 'Alice', id: '1' }) }),
    onPrompt: () => {},
    // SOW-011: injected status oracle (no network in tests). Returns the Stripe-derived status.
    signupBase: 'https://signup.example',
    fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, github_id: '1', status: 'paid' }) }),
  });
  assert.equal(result.login, 'Alice');
  assert.equal(result.username, 'alice');
  assert.equal(store.get('githubToken'), 'gho_secret');
  assert.deepEqual(store.get('identity'), { login: 'Alice', githubId: '1', username: 'alice' });
  // membership resolved + cached at login (paid stripe status, no override demotes it)
  assert.equal(result.membership, 'paid');
  assert.equal(store.get('membership'), 'paid');
});

test('cmdLogin: errors without a client id', async () => {
  await assert.rejects(cmdLogin({ store: createStore({ dir: tmp() }), clientId: '' }), /client id/);
});

test('cmdNew: scaffolds a validated file into the working copy and refuses to clobber', () => {
  const repo = seedRepo(tmp());
  const ctx = ctxFor({ repoPath: repo });
  const r = cmdNew(ctx, { type: 'post', input: { title: 'Hello', slug: 'hello' }, body: 'Body' });
  assert.equal(r.path, 'members/alice/posts/hello/index.md');
  assert.ok(fs.existsSync(path.join(repo, r.path)));
  assert.throws(() => cmdNew(ctx, { type: 'post', input: { title: 'Hello', slug: 'hello' } }), /already exists/);
});

test('cmdPublish: reads a staged file and opens a PR through the gate', async () => {
  const repo = seedRepo(tmp());
  const ctx = ctxFor({ repoPath: repo, repo: fakeRepo() });
  cmdNew(ctx, { type: 'post', input: { title: 'Hello', slug: 'hello' }, body: 'Body' });
  const out = await cmdPublish(ctx, { file: 'members/alice/posts/hello/index.md' });
  assert.equal(out.prNumber, 21);
});

test('cmdWhoami + cmdPr', async () => {
  const ctx = ctxFor({ repoPath: seedRepo(tmp()), repo: fakeRepo() });
  assert.equal(cmdWhoami(ctx).identity.login, 'alice');
  const list = await cmdPr(ctx, {});
  assert.equal(list.prs.length, 1);
  const status = await cmdPr(ctx, { number: 21 });
  assert.equal(status.meaning, 'held');
});
