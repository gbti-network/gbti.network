// SOW-006 CMS API: the local reader, the API router, and the query-token gate fallback.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createReader } from '../client/src/repo-fs.mjs';
import { handleApi } from '../client/src/api.mjs';
import { requestAllowed, isAuthorized } from '../client/src/security.mjs';

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-repo-'));
  // NESTED layout: members/<u>/posts/<slug>/index.md
  const helloDir = path.join(dir, 'members', 'alice', 'posts', 'hello');
  fs.mkdirSync(helloDir, { recursive: true });
  fs.writeFileSync(path.join(helloDir, 'index.md'), '---\ntype: post\ntitle: Hello\nslug: hello\nauthor: alice\nstatus: published\n---\n\nBody\n');
  fs.writeFileSync(path.join(dir, 'members', 'alice', 'profile.md'), '---\ntype: profile\nusername: alice\ndisplayName: Alice\n---\n\nBio\n');
  // someone else's content, to prove scoping
  const secretDir = path.join(dir, 'members', 'bob', 'posts', 'secret');
  fs.mkdirSync(secretDir, { recursive: true });
  fs.writeFileSync(path.join(secretDir, 'index.md'), '---\ntype: post\ntitle: Secret\nslug: secret\nauthor: bob\n---\n\nx\n');
  return dir;
}

const aliceCtx = (overrides = {}) => ({
  store: { get: (k) => ({ repoPath: overrides.repoPath, githubToken: overrides.githubToken, mcpEnabled: true })[k] },
  reader: overrides.reader,
  getRepoClient: overrides.getRepoClient ?? (() => null),
  identity: () => (overrides.identity === null ? null : { login: 'alice', githubId: '1', username: 'alice' }),
});

test('reader: lists the member own content and reads one item, scoped', () => {
  const dir = tmpRepo();
  const reader = createReader(dir);
  const posts = reader.list('alice', 'post');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].title, 'Hello');
  assert.equal(posts[0].path, 'members/alice/posts/hello/index.md');

  const all = reader.list('alice');
  assert.ok(all.some((i) => i.type === 'profile'));

  const item = reader.get('alice', 'members/alice/posts/hello/index.md');
  assert.equal(item.frontmatter.title, 'Hello');
  assert.equal(item.body.trim(), 'Body');

  // scoping: cannot read another member's folder or traverse
  assert.equal(reader.get('alice', 'members/bob/posts/secret/index.md'), null);
  assert.equal(reader.get('alice', 'members/alice/../bob/posts/secret.md'), null);
});

test('api /api/content: lists via the reader', async () => {
  const dir = tmpRepo();
  const r = await handleApi({ method: 'GET', pathname: '/api/content', query: {} }, aliceCtx({ repoPath: dir, reader: createReader(dir) }));
  assert.equal(r.status, 200);
  assert.ok(r.json.items.length >= 2);
});

test('api /api/validate: reports invalid content without throwing', async () => {
  const ctx = aliceCtx({ reader: createReader(tmpRepo()) });
  const good = await handleApi({ method: 'POST', pathname: '/api/validate', body: { type: 'post', input: { title: 'T', slug: 'ok-slug' } } }, ctx);
  assert.equal(good.json.valid, true);
  const bad = await handleApi({ method: 'POST', pathname: '/api/validate', body: { type: 'post', input: { title: 'T', slug: 'Bad Slug' } } }, ctx);
  assert.equal(bad.json.valid, false);
  assert.match(bad.json.error, /slug/);
});

test('api /api/publish: requires auth, else publishes via the repo client', async () => {
  const reader = createReader(tmpRepo());
  const noAuth = await handleApi(
    { method: 'POST', pathname: '/api/publish', body: { type: 'post', input: { title: 'T', slug: 's' } } },
    aliceCtx({ reader, getRepoClient: () => null }),
  );
  assert.equal(noAuth.status, 401);

  const calls = [];
  const fakeRepo = {
    upstream: 'gbti-network/gbti.network',
    async ensureFork() { return { full_name: 'alice/gbti.network', owner: 'alice' }; },
    async getDefaultBranch() { return 'main'; },
    async getBranchSha() { return 'sha'; },
    async ensureBranch() {},
    async getFileSha() { return null; },
    async putFile(r, p) { calls.push(p); },
    async findOpenPull() { return null; },
    async openPull() { return { number: 9, html_url: 'u' }; },
  };
  const ok = await handleApi(
    { method: 'POST', pathname: '/api/publish', body: { type: 'post', input: { title: 'T', slug: 'my-post' } } },
    aliceCtx({ reader, getRepoClient: () => fakeRepo }),
  );
  assert.equal(ok.status, 200);
  assert.equal(ok.json.prNumber, 9);
  assert.deepEqual(calls, ['members/alice/posts/my-post/index.md']);
});

test('api: 409 when there is no identity, 404 for unknown routes', async () => {
  const noId = await handleApi({ method: 'GET', pathname: '/api/content', query: {} }, aliceCtx({ identity: null, reader: createReader('/nope') }));
  assert.equal(noId.status, 409);
  const unknown = await handleApi({ method: 'GET', pathname: '/api/nope', query: {} }, aliceCtx({ reader: createReader('/nope') }));
  assert.equal(unknown.status, 404);
});

test('security: query-token is accepted as a fallback (for the initial UI navigation)', () => {
  assert.equal(isAuthorized({}, 'tok', 'tok'), true);
  assert.equal(isAuthorized({}, 'tok', 'wrong'), false);
  // header still preferred + sufficient
  assert.equal(isAuthorized({ authorization: 'Bearer tok' }, 'tok'), true);
  const viaQuery = requestAllowed({ headers: { host: '127.0.0.1:4500' }, token: 'tok', queryToken: 'tok' });
  assert.deepEqual(viaQuery, { ok: true });
  const noToken = requestAllowed({ headers: { host: '127.0.0.1:4500' }, token: 'tok' });
  assert.equal(noToken.reason, 'unauthorized');
});
