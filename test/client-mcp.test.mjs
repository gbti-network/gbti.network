// SOW-006 MCP tool surface: the JSON-RPC dispatcher + managed-abstraction tools (same operations core the
// CMS HTTP API uses).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { dispatch, TOOLS } from '../client/src/mcp-tools.mjs';
import { createReader } from '../client/src/repo-fs.mjs';

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-mcp-'));
  fs.mkdirSync(path.join(dir, 'members', 'alice', 'posts', 'hello'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'members', 'alice', 'posts', 'hello', 'index.md'), '---\ntype: post\ntitle: Hello\nslug: hello\nauthor: alice\n---\n\nx\n');
  return dir;
}

function ctxFor({ repoPath, repo, identity } = {}) {
  return {
    store: { get: (k) => ({ repoPath, githubToken: repo ? 'tok' : null, mcpEnabled: true })[k] },
    reader: createReader(repoPath ?? '/nope'),
    getRepoClient: () => repo ?? null,
    identity: () => (identity === null ? null : { login: 'alice', githubId: '1', username: 'alice' }),
  };
}

const fakeRepo = () => ({
  upstream: 'gbti-network/gbti.network',
  async ensureFork() { return { full_name: 'alice/gbti.network', owner: 'alice' }; },
  async getDefaultBranch() { return 'main'; },
  async getBranchSha() { return 'sha'; },
  async ensureBranch() {},
  async getFileSha() { return null; },
  async putFile() {},
  async findOpenPull() { return null; },
  async openPull() { return { number: 11, html_url: 'u' }; },
  async listMyPulls() { return [{ number: 11, title: 'x', html_url: 'u' }]; },
  async gateStatus() { return { state: 'failure', meaning: 'held', sha: 'sha' }; },
});

const call = (name, args, ctx) => dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ctx);
const textOf = (res) => JSON.parse(res.result.content[0].text);

test('initialize: advertises protocol + server info', async () => {
  const res = await dispatch({ jsonrpc: '2.0', id: 1, method: 'initialize' }, ctxFor());
  assert.equal(res.result.serverInfo.name, 'gbti-network');
  assert.ok(res.result.protocolVersion);
  assert.ok(res.result.capabilities.tools);
});

test('tools/list: returns every managed-abstraction tool with an input schema', async () => {
  const res = await dispatch({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, ctxFor());
  const names = res.result.tools.map((t) => t.name);
  for (const expected of ['login', 'login_confirm', 'logout', 'whoami', 'list_my_content', 'get_content', 'validate_content', 'publish_content', 'add_prompt', 'add_product', 'add_post', 'list_prs', 'pr_status']) {
    assert.ok(names.includes(expected), `missing tool ${expected}`);
  }
  assert.equal(res.result.tools.length, TOOLS.length);
  assert.ok(res.result.tools.every((t) => t.inputSchema && t.inputSchema.type === 'object'));
});

test('tools/call whoami + list_my_content', async () => {
  const ctx = ctxFor({ repoPath: tmpRepo() });
  const who = textOf(await call('whoami', {}, ctx));
  assert.equal(who.identity.login, 'alice');
  const list = textOf(await call('list_my_content', { type: 'post' }, ctx));
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].title, 'Hello');
});

test('tools/call validate_content: valid and invalid both return cleanly', async () => {
  const ctx = ctxFor({ repoPath: tmpRepo() });
  const good = textOf(await call('validate_content', { type: 'post', input: { title: 'T', slug: 'ok-slug' } }, ctx));
  assert.equal(good.valid, true);
  const bad = textOf(await call('validate_content', { type: 'post', input: { title: 'T', slug: 'Bad Slug' } }, ctx));
  assert.equal(bad.valid, false);
});

test('tools/call publish_content: opens a PR via the repo client', async () => {
  const ctx = ctxFor({ repoPath: tmpRepo(), repo: fakeRepo() });
  const res = await call('publish_content', { type: 'post', input: { title: 'T', slug: 'my-post' } }, ctx);
  assert.notEqual(res.result.isError, true);
  assert.equal(textOf(res).prNumber, 11);
});

test('tools/call publish_content without auth is an isError tool result, not a transport error', async () => {
  const ctx = ctxFor({ repoPath: tmpRepo(), repo: null });
  const res = await call('publish_content', { type: 'post', input: { title: 'T', slug: 'my-post' } }, ctx);
  assert.equal(res.result.isError, true);
  assert.equal(textOf(res).error, 'not-authenticated');
});

// SOW-025: the per-type add_* wrappers forward to publish with the correct type (so the right schema applies).
test('tools/call add_prompt: publishes a prompt (the prompt schema applies) into the prompts folder', async () => {
  const puts = [];
  const repo = { ...fakeRepo(), async putFile(_full, path) { puts.push(path); } };
  const ctx = ctxFor({ repoPath: tmpRepo(), repo });
  const ok = await call('add_prompt', { input: { title: 'P', slug: 'my-prompt', shortDescription: 'a one-liner' }, body: 'do the thing' }, ctx);
  assert.notEqual(ok.result.isError, true);
  assert.equal(textOf(ok).prNumber, 11);
  assert.ok(puts.some((p) => p.includes('/prompts/my-prompt/')), `expected a prompts/ path, got ${JSON.stringify(puts)}`);
  // missing shortDescription -> invalid as a PROMPT (proving the prompt schema, not the post schema, is applied)
  const bad = await call('add_prompt', { input: { title: 'P', slug: 'no-desc' } }, ctxFor({ repoPath: tmpRepo(), repo: fakeRepo() }));
  assert.equal(bad.result.isError, true);
  assert.equal(textOf(bad).error, 'invalid-content');
});

test('tools/call add_product: requires the product image fields (invalid-content without them)', async () => {
  const res = await call('add_product', { input: { title: 'X', slug: 'a-product', shortDescription: 'sd' } }, ctxFor({ repoPath: tmpRepo(), repo: fakeRepo() }));
  assert.equal(res.result.isError, true);
  assert.equal(textOf(res).error, 'invalid-content'); // missing icon + featuredImage
});

test('tools/call with invalid content surfaces invalid-content as isError', async () => {
  const ctx = ctxFor({ repoPath: tmpRepo(), repo: fakeRepo() });
  const res = await call('publish_content', { type: 'post', input: { title: 'T', slug: 'Bad Slug' } }, ctx);
  assert.equal(res.result.isError, true);
  assert.equal(textOf(res).error, 'invalid-content');
});

test('unknown tool -> JSON-RPC error; unknown method -> -32601; notification -> null', async () => {
  const ctx = ctxFor();
  const unknownTool = await call('frobnicate', {}, ctx);
  assert.equal(unknownTool.error.code, -32602);
  const unknownMethod = await dispatch({ jsonrpc: '2.0', id: 9, method: 'nope/nope' }, ctx);
  assert.equal(unknownMethod.error.code, -32601);
  const notif = await dispatch({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx);
  assert.equal(notif, null);
});
