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

/**
 * The network as the tools see it (sow-274 Part 2: every publish goes to POST /membership/author, drafts to the
 * private store). `authored` records each publish body; `drafts` seeds the store; `deletes` records each store
 * delete; `repoItems` is the committed repo-drafts listing. Nothing here reaches a real network.
 */
function fakeNetwork({ drafts = [], repoItems = [] } = {}) {
  const net = { authored: [], deletes: [] };
  const store = new Map(drafts.map((d) => [`${d.type}:${d.slug}`, d]));
  net.fetch = async (url, init = {}) => {
    const u = new URL(String(url)).pathname;
    const body = init.body ? JSON.parse(init.body) : null;
    const json = (status, data) => ({ ok: status < 400, status, json: async () => data });
    if (u === '/membership/author') { net.authored.push(body); return json(200, { ok: true, number: 11, html_url: 'u', branch: `hosted/1/${body.itemId}` }); }
    if (u === '/membership/repo-drafts') return json(200, { items: repoItems });
    if (u === '/membership/drafts' && (init.method || 'GET') === 'GET') return json(200, { drafts: [...store.values()] });
    if (u === '/membership/drafts' && body?.op === 'delete') { net.deletes.push(`${body.type}:${body.slug}`); store.delete(`${body.type}:${body.slug}`); return json(200, { ok: true }); }
    return json(404, {});
  };
  return net;
}

function ctxFor({ repoPath, repo, identity, net = fakeNetwork() } = {}) {
  return {
    store: { get: (k) => ({ repoPath, githubToken: repo ? 'tok' : null, mcpEnabled: true })[k] },
    reader: createReader(repoPath ?? '/nope'),
    getRepoClient: () => repo ?? null,
    identity: () => (identity === null ? null : { login: 'alice', githubId: '1', username: 'alice' }),
    fetch: net.fetch,
    net,
  };
}

// The repo client now only reads (the canonical fallback, the member's pull requests and their gate status).
const fakeRepo = () => ({
  upstream: 'gbti-network/gbti.network',
  async getFileContent() { return null; },
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
  for (const expected of ['login', 'login_confirm', 'logout', 'whoami', 'list_my_content', 'get_content', 'validate_content', 'publish_content', 'add_prompt', 'add_product', 'add_post', 'list_prs', 'pr_status', 'post_comment', 'edit_comment', 'list_comments']) {
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

test('tools/call publish_content: publishes through the network', async () => {
  const ctx = ctxFor({ repoPath: tmpRepo(), repo: fakeRepo() });
  const res = await call('publish_content', { type: 'post', status: 'published', input: { title: 'T', slug: 'my-post' } }, ctx);
  assert.notEqual(res.result.isError, true, JSON.stringify(res.result));
  assert.equal(textOf(res).prNumber, 11);
  assert.equal(ctx.net.authored.length, 1);
  assert.ok(ctx.net.authored[0].files.some((f) => f.path === 'members/alice/posts/my-post/index.md'));
});

test('tools/call publish_content without auth is an isError tool result, not a transport error', async () => {
  const ctx = ctxFor({ repoPath: tmpRepo(), repo: null });
  const res = await call('publish_content', { type: 'post', status: 'published', input: { title: 'T', slug: 'my-post' } }, ctx);
  assert.equal(res.result.isError, true);
  assert.equal(textOf(res).error, 'not-authenticated');
});

// SOW-025: the per-type add_* wrappers forward to publish with the correct type (so the right schema applies).
test('tools/call add_prompt: publishes a prompt (the prompt schema applies) into the prompts folder', async () => {
  const ctx = ctxFor({ repoPath: tmpRepo(), repo: fakeRepo() });
  const ok = await call('add_prompt', { status: 'published', input: { title: 'P', slug: 'my-prompt', shortDescription: 'a one-liner' }, body: 'do the thing' }, ctx);
  assert.notEqual(ok.result.isError, true, JSON.stringify(ok.result));
  assert.equal(textOf(ok).prNumber, 11);
  const paths = ctx.net.authored.flatMap((a) => a.files.map((f) => f.path));
  assert.ok(paths.some((p) => p.includes('/prompts/my-prompt/')), `expected a prompts/ path, got ${JSON.stringify(paths)}`);
  // missing shortDescription -> invalid as a PROMPT (proving the prompt schema, not the post schema, is applied)
  const bad = await call('add_prompt', { status: 'published', input: { title: 'P', slug: 'no-desc' } }, ctxFor({ repoPath: tmpRepo(), repo: fakeRepo() }));
  assert.equal(bad.result.isError, true);
  assert.equal(textOf(bad).error, 'invalid-content');
});

test('tools/call add_product: requires the product image fields (invalid-content without them)', async () => {
  const res = await call('add_product', { status: 'published', input: { title: 'X', slug: 'a-product', shortDescription: 'sd' } }, ctxFor({ repoPath: tmpRepo(), repo: fakeRepo() }));
  assert.equal(res.result.isError, true);
  assert.equal(textOf(res).error, 'invalid-content'); // missing icon + featuredImage
});

// SOW-106: the publish tools require an explicit status; omitting it is a forced-intent error, not a silent draft.
test('tools/call add_prompt without status is a status-required isError (forced intent)', async () => {
  const ctx = ctxFor({ repoPath: tmpRepo(), repo: fakeRepo() });
  const res = await call('add_prompt', { input: { title: 'P', slug: 'no-status', shortDescription: 'x' }, body: 'b' }, ctx);
  assert.equal(res.result.isError, true);
  assert.equal(textOf(res).error, 'status-required');
});

test('tools/call with invalid content surfaces invalid-content as isError', async () => {
  const ctx = ctxFor({ repoPath: tmpRepo(), repo: fakeRepo() });
  const res = await call('publish_content', { type: 'post', status: 'published', input: { title: 'T', slug: 'Bad Slug' } }, ctx);
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

// ---------------------------------------------------------------------------
// sow-193: the MCP author surface can express what publish() supports, and the
// draft lifecycle is reachable at all.
// ---------------------------------------------------------------------------

test('sow-193: the four draft-lifecycle tools are exposed (an agent could create a draft it could never retrieve)', async () => {
  const res = await dispatch({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, ctxFor());
  const names = res.result.tools.map((t) => t.name);
  for (const expected of ['list_drafts', 'read_draft', 'publish_draft', 'discard_draft']) {
    assert.ok(names.includes(expected), `missing draft tool ${expected}`);
  }
});

test('sow-193: the author tools accept path + scope (rename and house targeting were previously inexpressible)', async () => {
  const res = await dispatch({ jsonrpc: '2.0', id: 4, method: 'tools/list' }, ctxFor());
  const byName = Object.fromEntries(res.result.tools.map((t) => [t.name, t]));
  for (const name of ['publish_content', 'add_post', 'add_product', 'add_prompt']) {
    assert.ok(byName[name].inputSchema.properties.path, `${name} cannot express a rename`);
    assert.ok(byName[name].inputSchema.properties.scope, `${name} cannot express a scope`);
  }
  // scope is an enum, so an agent cannot invent a folder.
  assert.deepEqual(byName.publish_content.inputSchema.properties.scope.enum, ['member', 'house']);
  // list_my_content reads house content for a superadmin; it never forwarded scope before.
  assert.ok(byName.list_my_content.inputSchema.properties.scope);
  // sow-274 Part 2: the network writes its own commit message and pull request body, so the tools stop offering
  // them. Advertising a field that does nothing invites an agent to rely on it.
  for (const name of ['publish_content', 'add_post', 'add_product', 'add_prompt', 'add_share', 'post_comment', 'publish_draft']) {
    const props = byName[name].inputSchema.properties;
    assert.equal('message' in props, false, `${name} still advertises message`);
    assert.equal('prBody' in props, false, `${name} still advertises prBody`);
  }
});

test('sow-193: authorContent FORWARDS path to publish, so a changed slug renames instead of duplicating', async () => {
  // The proof is that publish() sees `path`: with it, the existing item is read and its slug compared, which
  // is what turns a re-publish into a rename. Without it publish() never enters that branch at all.
  // publish() turns `path` into a rename origin (renameOriginOf) and then reads the OLD file to merge its
  // redirectFrom and preserve publishedAt. That read is the first observable effect of `path`: with `path`
  // dropped, `origin` is null and readFile is never called for the old path at all.
  const seen = [];
  const withSpy = (repoPath) => {
    const ctx = ctxFor({ repoPath, repo: fakeRepo() });
    const orig = ctx.reader.readFile.bind(ctx.reader);
    ctx.reader.readFile = (p) => { seen.push(p); return orig(p); };
    return ctx;
  };
  const repoDir = tmpRepo();
  const args = { status: 'published', input: { title: 'Hello renamed', slug: 'hello-renamed' }, body: 'x' };
  await call('add_post', { ...args, path: 'members/alice/posts/hello/index.md' }, withSpy(repoDir)).catch(() => {});
  assert.ok(seen.includes('members/alice/posts/hello/index.md'), 'publish never read the existing item, so path was dropped');

  // Control: the SAME call without `path` must never look for the old file. This is the regression the fix
  // closes, so it is worth asserting both directions rather than only the positive.
  seen.length = 0;
  await call('add_post', args, withSpy(repoDir)).catch(() => {});
  assert.ok(!seen.includes('members/alice/posts/hello/index.md'), 'without path there is no rename origin to read');
});

test('sow-193: listMembersOnly awaits its reader (a Promise as `items` was the async-reader trap)', async () => {
  const { listMembersOnly } = await import('../client/src/operations.mjs');
  // An ASYNC reader, which is what a clone-free npm host and the extension both use.
  const ctx = {
    identity: () => ({ login: 'alice', githubId: '1', username: 'alice' }),
    reader: { listMembersOnly: async () => [{ path: 'members/alice/posts/x/index.md' }] },
  };
  const out = await listMembersOnly(ctx);
  assert.ok(Array.isArray(out.items), 'items must be an array, not a pending Promise');
  assert.equal(out.items.length, 1);
});

// ---------------------------------------------------------------------------
// sow-194 seam: list_drafts folds REPO drafts, so the action tools must route
// by store. Asserted at the TOOL layer, driving the REAL listDrafts path via
// the ctx (no module mocking: mcp-tools binds these imports at load, so mocking
// the module export would not affect the handler under test). The op-layer test
// supplies `store` by hand, which is the one condition a real caller never meets.
// ---------------------------------------------------------------------------

/** A ctx whose repo-drafts route returns `repoItems` and whose private store holds `drafts`. */
function ctxWithRepoDrafts({ repoItems = [], drafts = [] } = {}) {
  return ctxFor({ repoPath: tmpRepo(), repo: fakeRepo(), net: fakeNetwork({ repoItems, drafts }) });
}

test('sow-194 seam: discard_draft on a REPO row is refused instead of reporting a false success', async () => {
  // Before the fix, `store` was undefined at the tool boundary, so discard fell to the wrong store's delete and
  // reported success. The agent was told it discarded a draft that is still sitting in the repo.
  const ctx = ctxWithRepoDrafts({
    repoItems: [{ type: 'post', slug: 'my-repo-draft', path: 'members/alice/posts/my-repo-draft/index.md', title: 'My repo draft' }],
  });

  const res = await call('discard_draft', { type: 'post', slug: 'my-repo-draft' }, ctx);
  assert.equal(res.result.isError, true, 'a repo draft must be refused, not silently "discarded"');
  assert.equal(textOf(res).error, 'unsupported');
  assert.deepEqual(ctx.net.deletes, [], 'nothing may be deleted for a repo draft');
});

// sow-274 Part 2 removed the unreadable-fork-branch case: there is no fork branch left to orphan.

test('sow-194 seam: an UNRESOLVABLE draft is refused rather than falling through to a delete', async () => {
  const ctx = ctxWithRepoDrafts({});
  const res = await call('discard_draft', { type: 'post', slug: 'ghost' }, ctx);
  assert.equal(res.result.isError, true);
  assert.equal(textOf(res).error, 'not-found');
  assert.deepEqual(ctx.net.deletes, [], 'an unidentified draft must never reach a delete');
});

test('sow-194 seam: a genuine STAGED draft still discards (the guard is not over-broad)', async () => {
  const ctx = ctxWithRepoDrafts({ drafts: [{ type: 'post', slug: 'real-draft', path: 'members/alice/posts/real-draft/index.md', frontmatter: { title: 'Real', slug: 'real-draft' }, body: 'b' }] });
  const res = await call('discard_draft', { type: 'post', slug: 'real-draft' }, ctx);
  assert.notEqual(res.result.isError, true, textOf(res)?.error ?? 'expected success');
  assert.deepEqual(ctx.net.deletes, ['post:real-draft']);
});

// ---- sow-195 regression: the WorkBench network scope must reach members/gbtilabs/ ----
// sow-195 moved the network's 35 content items out of house/ into members/gbtilabs/ but left the WorkBench
// "House content" scope pointing at house/<sub>, which no longer exists. The live result was an empty list
// and "Could not open that draft." on every network item. These pin both halves so the scope cannot be left
// pointing at a folder the migration emptied.

/** A ctx whose reader is a stub: enough for the two scope branches, no filesystem needed. */
function networkCtx({ username = 'atwellpub', role = 'superadmin', files = {} } = {}) {
  const roles = `superadmins:\n  - github_id: '${role === 'superadmin' ? '1' : '999'}'\n`;
  return {
    identity: () => ({ login: username, githubId: '1', username }),
    reader: {
      list: async (user, type, scope) => [{ path: `members/${user}/posts/x/index.md`, scope, type }],
      get: async (user, rel) => (rel.startsWith(`members/${user}/`) ? { path: rel, frontmatter: {}, body: '' } : null),
      readFile: async (rel) => (rel === 'house/roles.yml' ? roles : (files[rel] ?? null)),
    },
  };
}

test('sow-195: the network scope lists members/gbtilabs, not the emptied house/ folder', async () => {
  const { listContent } = await import('../client/src/operations.mjs');
  const out = await listContent(networkCtx(), { type: 'post', scope: 'house' });
  assert.equal(out.items[0].path, 'members/gbtilabs/posts/x/index.md');
  assert.equal(out.items[0].scope, 'member', 'it goes through the ordinary member reader now');
});

test('sow-195: a superadmin can OPEN a network item from another folder (the "Could not open that draft" bug)', async () => {
  const { getContentItem } = await import('../client/src/operations.mjs');
  const p = 'members/gbtilabs/posts/airllm/index.md';
  const ctx = networkCtx({ files: { [p]: '---\ntype: post\nslug: airllm\nauthor: gbtilabs\n---\n\nbody\n' } });
  const item = await getContentItem(ctx, { path: p });
  assert.equal(item.path, p);
  assert.equal(item.frontmatter.author, 'gbtilabs');
});

test('sow-195: a NON-superadmin still cannot open network content', async () => {
  const { getContentItem } = await import('../client/src/operations.mjs');
  const p = 'members/gbtilabs/posts/airllm/index.md';
  const ctx = networkCtx({ role: 'member', files: { [p]: '---\ntype: post\n---\n\nx\n' } });
  await assert.rejects(() => getContentItem(ctx, { path: p }), /superadmin-only/);
});

test('sow-195: the retargeted path regex still rejects traversal and governance files', async () => {
  const { getContentItem } = await import('../client/src/operations.mjs');
  const ctx = networkCtx();
  for (const bad of [
    'members/gbtilabs/../roles.yml',
    'members/gbtilabs/roles.yml',
    'members/gbtilabs/posts/x/secrets.md',
  ]) {
    // Only the regex error is acceptable: a 'no such item' would mean the path slipped past this branch
    // into the own-folder member reader, which is the failure mode the anchored pattern exists to prevent.
    await assert.rejects(() => getContentItem(ctx, { path: bad }), /invalid network content path/, bad);
  }
});
