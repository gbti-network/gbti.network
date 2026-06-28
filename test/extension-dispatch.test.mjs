// SOW-006 v2 P4: the extension's /api dispatcher (the background worker side of the messaging GbtiClient).
// Verifies it answers the same routes as the npm host, async-reader-aware, with the same error codes.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dispatch } from '../extension/src/ext-dispatch.mjs';
import { buildExtContext } from '../extension/src/ext-context.mjs';
import { esc } from '../extension/src/onboarding.mjs';

const POST = '---\ntype: post\ntitle: Hello\nslug: hello\nauthor: alice\nstatus: published\n---\n\nBody\n';

function ctxFor({ identity = { login: 'alice', githubId: '1', username: 'alice' }, token = 'tok', files = {}, repo, fetch } = {}) {
  return {
    identity: () => identity,
    store: { get: (k) => ({ githubToken: token })[k] },
    getRepoClient: () => repo ?? null,
    // No network in unit tests: the SOW-038 roster's best-effort Stripe call fails fast -> 'unknown' tiers.
    fetch: fetch ?? (async () => { throw new Error('no network in test'); }),
    reader: {
      async readFile(p) { return files[p] ?? null; },
      async get(u, p) { return p.startsWith(`members/${u}/`) && files[p] ? { path: p, frontmatter: { type: 'post', title: 'Hello' }, body: 'Body' } : null; },
      async list(u, t) { return [{ path: `members/${u}/posts/hello/index.md`, type: 'post', title: 'Hello' }]; },
      async listMembersOnly() { return []; },
    },
  };
}

test('status: returns identity + role resolved from house/roles.yml (async reader)', async () => {
  const ctx = ctxFor({ files: { 'house/roles.yml': 'admins:\n  - github_id: "1"\n' } });
  const r = await dispatch(ctx, { pathname: '/api/status' });
  assert.equal(r.status, 200);
  assert.equal(r.json.identity.login, 'alice');
  assert.equal(r.json.role, 'admin');
  assert.equal(r.json.authenticated, true);
});

test('status: an expired token (401 on the roles read) reports unauthenticated + sessionExpired and clears the dead session', async () => {
  // The REAL buildExtContext wiring: a 401 carrying the token -> the reader fires onAuthError -> the session is
  // cleared. /api/status re-reads auth AFTER the roles read, so it reports authenticated:false + identity:null
  // (no stale @handle) + sessionExpired:true (the shell shows the "session expired" sign-in splash).
  const data = { githubToken: 'dead', identity: { login: 'alice', githubId: '1', username: 'alice' }, membership: 'paid' };
  const store = { get: (k) => data[k], set: (patch) => Object.assign(data, patch) };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ message: 'Bad credentials' }) });
  try {
    const ctx = buildExtContext(store);
    const r = await dispatch(ctx, { pathname: '/api/status' });
    assert.equal(r.status, 200);
    assert.equal(r.json.authenticated, false);
    assert.equal(r.json.identity, null);
    assert.equal(r.json.sessionExpired, true);
    assert.equal(data.githubToken, null, 'the dead token is cleared');
    assert.equal(data.identity, null, 'the stale identity is cleared');
  } finally { globalThis.fetch = realFetch; }
});

test('status: a healthy token is NOT flagged expired', async () => {
  const ctx = ctxFor({ files: { 'house/roles.yml': 'admins:\n  - github_id: "1"\n' } });
  const r = await dispatch(ctx, { pathname: '/api/status' });
  assert.equal(r.json.authenticated, true);
  assert.notEqual(r.json.sessionExpired, true); // undefined/false on the mock ctx (no authExpired) is fine
});

test('SOW-040: billing + referral routes (the account surface) work in the extension host', async () => {
  const billing = await dispatch(ctxFor(), { pathname: '/api/billing' });
  assert.equal(billing.status, 200);
  assert.ok(billing.json.portal, 'returns the Stripe customer-portal deep-link');
  const referral = await dispatch(ctxFor(), { pathname: '/api/referral' });
  assert.equal(referral.status, 200);
  assert.equal(referral.json.code, '1'); // the immutable github_id keys the payout (SOW-007)
  assert.match(referral.json.link, /\/join\?ref=1$/);
});

test('content + item: lists + reads via the async reader, own-folder scoped', async () => {
  const ctx = ctxFor({ files: { 'members/alice/posts/hello/index.md': POST } });
  const list = await dispatch(ctx, { pathname: '/api/content' });
  assert.equal(list.json.items.length, 1);
  const item = await dispatch(ctx, { pathname: '/api/content/item', query: { path: 'members/alice/posts/hello/index.md' } });
  assert.equal(item.json.frontmatter.title, 'Hello');
  const other = await dispatch(ctx, { pathname: '/api/content/item', query: { path: 'members/bob/posts/x/index.md' } });
  assert.equal(other.status, 404);
});

test('validate + preview + form-fields: reader-free routes work', async () => {
  const ctx = ctxFor();
  const good = await dispatch(ctx, { pathname: '/api/validate', body: { type: 'post', input: { title: 'T', slug: 'ok' } } });
  assert.equal(good.json.valid, true);
  const bad = await dispatch(ctx, { pathname: '/api/validate', body: { type: 'post', input: { title: 'T', slug: 'Bad Slug' } } });
  assert.equal(bad.json.valid, false);
  const prev = await dispatch(ctx, { pathname: '/api/preview', body: { body: '# Hi' } });
  assert.match(prev.json.html, /<h1/);
  const ff = await dispatch(ctx, { pathname: '/api/form-fields', query: { type: 'post' } });
  assert.ok(ff.json.fields.some((f) => f.key === 'categories'));
});

test('publish: builds + opens a PR via the repo client (nested path)', async () => {
  const puts = [];
  const repo = {
    upstream: 'gbti-network/gbti.network',
    async ensureFork() { return { full_name: 'alice/gbti.network', owner: 'alice' }; },
    async getDefaultBranch() { return 'main'; },
    async getBranchSha() { return 'sha'; },
    async ensureBranch() {},
    async getFileSha() { return null; },
    async putFile(r, p) { puts.push(p); },
    async findOpenPull() { return null; },
    async openPull() { return { number: 7, html_url: 'u' }; },
  };
  const r = await dispatch(ctxFor({ repo }), { pathname: '/api/publish', body: { type: 'post', input: { title: 'T', slug: 'my-post' }, body: 'x' } });
  assert.equal(r.json.prNumber, 7);
  assert.deepEqual(puts, ['members/alice/posts/my-post/index.md']);
});

test('no identity -> 409; unknown route -> 404', async () => {
  const noId = await dispatch(ctxFor({ identity: null }), { pathname: '/api/content' });
  assert.equal(noId.status, 409);
  const unknown = await dispatch(ctxFor(), { pathname: '/api/nope' });
  assert.equal(unknown.status, 404);
});

test('onboarding-status: a PRE-AUTH route (works signed-out so it can drive the sign-in step, never a 409)', async () => {
  // Regression for the bug that left the wizard at a "could not reach GitHub / 0 of 3" dead-end: the route sat
  // behind the requires-identity gate, so a signed-out member got a 409 and onboardingStatus() threw. It must
  // resolve 200 with signedIn:false (here classic mode, since no app-mode build define is applied in node).
  const signedOut = await dispatch(ctxFor({ identity: null, token: null }), { pathname: '/api/onboarding-status' });
  assert.equal(signedOut.status, 200);
  assert.equal(signedOut.json.signedIn, false);
  // And /api/status stays pre-auth too (sanity: the gate did not move onto it).
  const st = await dispatch(ctxFor({ identity: null, token: null }), { pathname: '/api/status' });
  assert.equal(st.status, 200);
  assert.equal(st.json.authenticated, false);
});

test('SOW-079: the public admin reads (taxonomy / news-source-pool / quote-pool) load WITHOUT a signed-in identity', async () => {
  const files = {
    'house/taxonomy.yml': 'tree:\n  devops:\n    label: DevOps\n',
    'house/news-sources.yml': 'sources:\n  - id: tnw\n    name: The Next Web\n    url: https://thenextweb.com/feed/\n    enabled: true\n',
    'house/quotes.yml': 'quotes:\n  - text: Focus.\n    author: Jobs\n    enabled: true\n',
  };
  const noId = () => ctxFor({ identity: null, token: null, files });
  assert.equal((await dispatch(noId(), { pathname: '/api/taxonomy' })).status, 200);
  const ns = await dispatch(noId(), { pathname: '/api/news-source-pool' });
  assert.equal(ns.status, 200);
  assert.equal(ns.json.sources.length, 1);
  const q = await dispatch(noId(), { pathname: '/api/quote-pool' });
  assert.equal(q.status, 200);
  assert.equal(q.json.quotes.length, 1);
});

test('SOW-079: syndication + admin writes STILL require identity (only the public reads were ungated)', async () => {
  const synd = await dispatch(ctxFor({ identity: null, token: null }), { pathname: '/api/syndication' });
  assert.equal(synd.status, 409);
  const write = await dispatch(ctxFor({ identity: null, token: null }), { pathname: '/api/admin', method: 'POST', body: { action: 'quote-add', text: 'x', author: 'y' } });
  assert.equal(write.status, 409);
});

test('onboarding esc: escapes HTML metacharacters before innerHTML (matches gbti-auth)', () => {
  assert.equal(esc('alice'), 'alice');
  assert.equal(esc('"><img src=x onerror=alert(1)>'), '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(esc("a&b'c"), 'a&amp;b&#39;c');
  assert.equal(esc(undefined), '');
});

// SOW-036/038: governance from the extension. admin-ops reads via the ASYNC reader (host-portable) and the
// dispatcher supplies a sync role() + a repoPath sentinel; the SOW-005 gate + CODEOWNERS remain the real boundary.
function adminRepo() {
  const puts = [];
  return {
    puts,
    upstream: 'gbti-network/gbti.network',
    async ensureFork() { return { full_name: 'alice/gbti.network', owner: 'alice' }; },
    async getDefaultBranch() { return 'main'; },
    async getBranchSha() { return 'sha'; },
    async ensureBranch() {},
    async getFileSha() { return 'existing'; },
    async putFile(r, p, opts) { puts.push({ path: p, content: Buffer.from(opts.contentBase64, 'base64').toString('utf8') }); },
    async findOpenPull() { return null; },
    async openPull() { return { number: 88, html_url: 'u' }; },
  };
}

test('admin: an admin (per roles.yml, async-read) bans via a bans.yml PR; a plain member is forbidden', async () => {
  const repo = adminRepo();
  const files = { 'house/roles.yml': 'admins:\n  - github_id: "1"\n', 'house/bans.yml': 'bans: []\n' };
  const r = await dispatch(ctxFor({ repo, files }), { pathname: '/api/admin', method: 'POST', body: { action: 'ban', githubId: '999', reason: 'spam' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.prNumber, 88);
  assert.equal(repo.puts[0].path, 'house/bans.yml');
  assert.match(repo.puts[0].content, /999/);

  // A caller NOT in roles.yml resolves to 'member' -> forbidden (UX gate; the PR gate is the real boundary).
  const member = await dispatch(ctxFor({ repo: adminRepo(), files: { 'house/bans.yml': 'bans: []\n' } }), { pathname: '/api/admin', method: 'POST', body: { action: 'ban', githubId: '999' } });
  assert.equal(member.status, 403);
  assert.equal(member.json.error, 'forbidden');
});

test('overrides (SOW-038 P2): an admin caller gets the roster; a non-admin is forbidden', async () => {
  const files = {
    'house/roles.yml': 'admins:\n  - github_id: "1"\n',
    'house/bans.yml': 'bans:\n  - github_id: "9"\n',
    'house/grandfathered.yml': 'grandfathered:\n  - github_id: "3"\n    until: null\n',
    'house/members-index.yml': 'members:\n  "1": alice\n  "3": founder\n  "9": baddie\n',
  };
  const r = await dispatch(ctxFor({ files }), { pathname: '/api/overrides' });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.roster));
  assert.equal(r.json.summary.banned, 1);
  assert.ok(r.json.roster.find((m) => m.githubId === '1' && m.role === 'admin'), 'the admin caller is in the roster');

  // A caller NOT listed in roles.yml resolves to 'member' -> forbidden (the route is the real boundary).
  const member = await dispatch(ctxFor({ files: { 'house/members-index.yml': 'members: {}\n' } }), { pathname: '/api/overrides' });
  assert.equal(member.status, 403);
  assert.equal(member.json.error, 'forbidden');
});

test('open-pulls (SOW-038 P2): admin gets the open-PR queue; a non-admin is forbidden before the repo is read', async () => {
  let listed = false;
  const repo = { async listOpenPulls() { listed = true; return [{ number: 7, title: 'Add a post', html_url: 'u', author: { login: 'bob', id: '5' }, createdAt: '2026-06-17' }]; } };
  const r = await dispatch(ctxFor({ files: { 'house/roles.yml': 'admins:\n  - github_id: "1"\n' }, repo }), { pathname: '/api/open-pulls' });
  assert.equal(r.status, 200);
  assert.equal(r.json.pulls.length, 1);
  assert.equal(r.json.pulls[0].number, 7);

  const member = await dispatch(ctxFor({ files: {}, repo: { async listOpenPulls() { listed = true; return []; } } }), { pathname: '/api/open-pulls' });
  assert.equal(member.status, 403);
});

test('admin: an unknown action is a bad-request', async () => {
  const r = await dispatch(ctxFor({ repo: adminRepo(), files: { 'house/roles.yml': 'superadmins:\n  - github_id: "1"\n' } }), { pathname: '/api/admin', method: 'POST', body: { action: 'wizard' } });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'bad-request');
});

test('pr-status: rejects non-positive-integer PR numbers before hitting GitHub (matches the npm guard)', async () => {
  const calls = [];
  const repo = { upstream: 'gbti-network/gbti.network', async gateStatus(n) { calls.push(n); return { state: 'success' }; } };
  for (const number of ['abc', '0', '-1', '1.5', '', undefined]) {
    const r = await dispatch(ctxFor({ repo }), { pathname: '/api/pr-status', query: { number } });
    assert.equal(r.status, 400, `number=${JSON.stringify(number)} should be a bad-request`);
  }
  assert.deepEqual(calls, [], 'gateStatus must never be called with an invalid number');
  const good = await dispatch(ctxFor({ repo }), { pathname: '/api/pr-status', query: { number: '7' } });
  assert.equal(good.status, 200);
  assert.deepEqual(calls, [7], 'a valid number reaches gateStatus coerced to an integer');
});
