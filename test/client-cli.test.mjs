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
// sow-274 Part 2: a publish reaches the network, so every context carries a fetch that answers the author route
// and records what it received. With no fetch injected the publish would call the real network.
function networkFake() {
  const authored = [];
  const fetch = async (url, init = {}) => {
    if (new URL(String(url)).pathname === '/membership/author') {
      authored.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ ok: true, number: 21, html_url: 'u', branch: 'hosted/1/post-hello' }) };
    }
    throw new Error(`unexpected network call in test: ${url}`);
  };
  return { fetch, authored };
}
function ctxFor({ repoPath, repo, identity, net = networkFake() } = {}) {
  const data = { repoPath, githubToken: repo ? 'tok' : null };
  return {
    store: { get: (k) => data[k], set: (p) => Object.assign(data, p) },
    reader: createReader(repoPath ?? '/nope'),
    getRepoClient: () => repo ?? null,
    identity: () => (identity === null ? null : { login: 'alice', githubId: '1', username: 'alice' }),
    fetch: net.fetch,
  };
}
// The repository client is read-only now: identity, the canonical file read, and the pull request reads.
const fakeRepo = () => ({
  upstream: 'gbti-network/gbti.network',
  async getAuthUser() { return { login: 'Alice', id: '1' }; },
  async getFileContent() { return null; },
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

test('cmdPublish: reads a staged file and publishes it through the network', async () => {
  const repo = seedRepo(tmp());
  const net = networkFake();
  const ctx = ctxFor({ repoPath: repo, repo: fakeRepo(), net });
  cmdNew(ctx, { type: 'post', input: { title: 'Hello', slug: 'hello' }, body: 'Body' });
  const out = await cmdPublish(ctx, { file: 'members/alice/posts/hello/index.md' });
  assert.equal(out.prNumber, 21);
  assert.equal(net.authored.length, 1);
  assert.deepEqual(net.authored[0].files.map((f) => f.path), ['members/alice/posts/hello/index.md']);
  assert.match(net.authored[0].files[0].content, /Body/);
});

test('cmdWhoami + cmdPr', async () => {
  const ctx = ctxFor({ repoPath: seedRepo(tmp()), repo: fakeRepo() });
  assert.equal(cmdWhoami(ctx).identity.login, 'alice');
  const list = await cmdPr(ctx, {});
  assert.equal(list.prs.length, 1);
  const status = await cmdPr(ctx, { number: 21 });
  assert.equal(status.meaning, 'held');
});
