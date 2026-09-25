// sow-403 (owner, 2026-09-25): "In the extension, as a superadmin I need to be able to post as any other member,
// like we are able to on the main website."
//
// The Share composer's Author picker (sow-183) is one web component on every host. It shows only when the host's
// client answers authorTargets() with members, and a new share then carries authorTarget to postShare. The website
// adapter had both halves. The extension and the agent server had neither: no authorTargets, so the row stayed
// hidden, and a publishShare that built every share under the caller's own folder whatever it was sent.
//
// These tests drive the real operations with a stubbed Worker. The Worker is the boundary (it re-verifies
// superadmin on the member list and again before accepting a file outside the caller's folder); what is tested here
// is that the client asks for the list only as a superadmin and that the chosen member's folder is what it sends.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { publishShare, listAuthorTargets } from '../client/src/operations.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const ROLES = `superadmins:
  - github_id: "7"
    login: alice
admins:
  - github_id: "8"
    login: bob
moderators: []
`;

const MEMBERS = [{ githubId: '9', username: 'carol' }, { githubId: '10', username: 'dave' }];

/** A signed-in context for github_id `githubId`, recording every Worker call. */
function context({ githubId = '7', username = 'alice', targetsStatus = 200 } = {}) {
  const network = [];
  const ctx = {
    identity: () => ({ login: username, githubId, username }),
    store: { get: (k) => ({ githubToken: 'tok', authMode: 'app' })[k], set() {} },
    membership: async () => 'paid',
    reader: { readFile: async (p) => (p === 'house/roles.yml' ? ROLES : null), get: async () => null },
    now: () => '2026-09-25T12:00:00.000Z',
    fetch: async (url, init = {}) => {
      const u = String(url);
      const body = init.body ? JSON.parse(init.body) : null;
      network.push({ path: new URL(u).pathname, method: init.method || 'GET', auth: init.headers?.Authorization ?? null, body });
      if (u.endsWith('/membership/author/targets')) {
        return targetsStatus === 200
          ? { ok: true, status: 200, json: async () => ({ ok: true, members: MEMBERS }) }
          : { ok: false, status: targetsStatus, json: async () => ({ error: 'forbidden', message: 'superadmin only' }) };
      }
      if (u.endsWith('/membership/author')) return { ok: true, status: 200, json: async () => ({ ok: true, branch: 'hosted/7/x', number: 12, html_url: 'u' }) };
      if (u.endsWith('/membership/encrypt')) return { ok: true, status: 200, json: async () => ({ ok: true, envelope: { v: 1 } }) };
      return { ok: false, status: 404, json: async () => ({}) };
    },
  };
  return { ctx, network };
}

const SHARE = { input: { url: 'https://example.com/a', title: 'A link', category: 'devops', visibility: 'public' }, body: '' };
const authored = (network) => network.filter((n) => n.path === '/membership/author');
const sentPaths = (network) => authored(network).flatMap((n) => n.body.files.map((f) => f.path));

// ---- the member list ----

test('a superadmin gets the member list from the Worker, with their bearer token', async () => {
  const { ctx, network } = context();
  const r = await listAuthorTargets(ctx);
  assert.deepEqual(r.members.map((m) => m.username), ['carol', 'dave']);
  const calls = network.filter((n) => n.path === '/membership/author/targets');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].auth, 'Bearer tok');
});

test('an admin who is not a superadmin gets no list, and the Worker is never asked', async () => {
  const { ctx, network } = context({ githubId: '8', username: 'bob' });
  assert.deepEqual(await listAuthorTargets(ctx), { members: [] });
  assert.deepEqual(network, []);
});

test('a plain member gets no list, and the Worker is never asked', async () => {
  const { ctx, network } = context({ githubId: '99', username: 'erin' });
  assert.deepEqual(await listAuthorTargets(ctx), { members: [] });
  assert.deepEqual(network, []);
});

test('a Worker refusal reaches a superadmin as an error, not as an empty list', async () => {
  // The composer treats a throw as "no picker", so the row still hides; an empty list here would read as
  // "nobody to pick", which is a different claim.
  const { ctx } = context({ targetsStatus: 403 });
  await assert.rejects(listAuthorTargets(ctx), (e) => e.code === 'admin-op-failed' && /superadmin only/.test(e.message));
});

// ---- posting as the chosen member ----

test('a share posted with an author target is written under that member\'s folder', async () => {
  const { ctx, network } = context();
  const r = await publishShare(ctx, { ...SHARE, authorTarget: 'carol' });
  const paths = sentPaths(network);
  assert.equal(paths.length, 1);
  assert.match(paths[0], /^members\/carol\/shares\/[^/]+\.md$/);
  // The composer's "Posted as @carol" and the just-posted reader card both read the author from this path.
  assert.match(r.path, /^members\/carol\/shares\//);
});

test('a members-only share posted as another member keeps its ciphertext in that member\'s folder', async () => {
  const { ctx, network } = context();
  await publishShare(ctx, { input: { ...SHARE.input, visibility: 'members' }, body: 'For members.', authorTarget: 'carol' });
  const paths = sentPaths(network);
  assert.ok(paths.length >= 2, `expected the stub and its ciphertext, got ${paths.join(', ')}`);
  for (const p of paths) assert.match(p, /^members\/carol\//, `${p} is outside the chosen member's folder`);
});

test('a target is lowercased, as the website does', async () => {
  const { ctx, network } = context();
  await publishShare(ctx, { ...SHARE, authorTarget: 'Carol' });
  assert.match(sentPaths(network)[0], /^members\/carol\/shares\//);
});

test('a malformed target is ignored and the share goes under the caller', async () => {
  for (const bad of ['../house', 'carol/x', '', '-carol', ' carol', 42, null]) {
    const { ctx, network } = context();
    await publishShare(ctx, { ...SHARE, authorTarget: bad });
    assert.match(sentPaths(network)[0], /^members\/alice\/shares\//, `target ${JSON.stringify(bad)} was not ignored`);
  }
});

test('with no target, a share goes under the caller exactly as before', async () => {
  const { ctx, network } = context();
  const r = await publishShare(ctx, SHARE);
  assert.match(sentPaths(network)[0], /^members\/alice\/shares\//);
  assert.match(r.path, /^members\/alice\/shares\//);
});

// ---- every host serves the list ----

test('the extension, the agent server and the shared client all route the member list', () => {
  assert.ok(read('extension/src/ext-dispatch.mjs').includes("case '/api/author-targets'"), 'ext-dispatch has no case for the route');
  assert.match(read('extension/src/ext-dispatch.mjs'), /listAuthorTargets\(ctx\)/, 'ext-dispatch does not call the op');
  assert.ok(read('client/src/api.mjs').includes("pathname === '/api/author-targets'"), 'api.mjs has no route');
  assert.match(read('client/src/api.mjs'), /listAuthorTargets\(ctx\)/, 'api.mjs does not call the op');
  assert.match(read('client-ui/src/client.mjs'), /authorTargets:\s*\(\)\s*=>\s*request\('GET', '\/api\/author-targets'\)/, 'the shared client has no authorTargets');
});

test('the route sits below the extension\'s identity gate', () => {
  // A signed-out caller must be refused before the op runs; ext-dispatch encodes that by position.
  const src = read('extension/src/ext-dispatch.mjs');
  const gate = src.indexOf("throw new OperationError('no-identity'");
  const route = src.indexOf("case '/api/author-targets'");
  assert.ok(gate > 0 && route > gate, 'the author-targets case is above the identity gate');
});
