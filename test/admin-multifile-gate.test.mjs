// sow-161 A: the multi-file admin-write MAX-RANK gate, driven through the real dispatch (membershipAdminAuthor),
// not just the maxRankForPaths helper. This is the falsifiable guard SowMaster required: a category-batch that
// touches a SUPERADMIN-pinned file (house/content-channels.yml) is REFUSED for an admin and ALLOWED for a
// superadmin, and a taxonomy-only batch stays admin-usable (the positive control, so a blanket "always 403"
// could not pass). Mutation check: delete the maxRankForPaths re-check in the MULTI branch and the admin
// mixed-tier case flips from 403 to 200.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { membershipAdminAuthor } from '../workers/signup/membership-admin-author.mjs';

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const TAXONOMY_YML = 'tree:\n  - key: ai\n    label: AI\n';
const CHANNELS_YML = 'channels: []\n';

// A fetchImpl router: serves the two config reads, and (for the allowed path) the branch + file PUT + PR calls.
function makeFetch(seen) {
  return async (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    seen.push(`${method} ${u.replace('https://api.github.com', '')}`);
    if (method === 'GET' && u.includes('/contents/house/taxonomy.yml')) return { ok: true, status: 200, json: async () => ({ content: b64(TAXONOMY_YML), sha: 't1' }) };
    if (method === 'GET' && u.includes('/contents/house/content-channels.yml')) return { ok: true, status: 200, json: async () => ({ content: b64(CHANNELS_YML), sha: 'c1' }) };
    if (method === 'GET' && u.includes('/git/ref/heads/main')) return { ok: true, status: 200, json: async () => ({ object: { sha: 'mainsha' } }) };
    if (method === 'POST' && u.endsWith('/git/refs')) return { ok: true, status: 201, json: async () => ({}) };
    if (method === 'GET' && u.includes('/contents/')) return { ok: false, status: 404, json: async () => ({}) }; // applyFile existence probe -> new file
    if (method === 'PUT' && u.includes('/contents/')) return { ok: true, status: 201, json: async () => ({}) };
    if (method === 'POST' && u.endsWith('/pulls')) return { ok: true, status: 201, json: async () => ({ number: 42, html_url: 'https://github.com/x/pull/42' }) };
    return { ok: false, status: 500, json: async () => ({}) };
  };
}

const ENV = { MEMBERSHIP_AUTHOR_ENABLED: 'true', GITHUB_APP_INSTALLATION_ID: '123', UPSTREAM_REPO: 'gbti-network/gbti.network' };
// getInstallationToken reads a cached token from kv without any network call when it is fresh.
const KV = { get: async () => ({ token: 'inst-token', expiresAt: Date.now() + 3600e3 }), put: async () => {} };
const noLimit = async () => ({ allowed: true });
const authAs = (role) => async () => ({ ok: true, role, githubId: '999' });
const req = (payload) => ({ json: async () => payload });

async function run(role, payload) {
  const seen = [];
  const res = await membershipAdminAuthor(req(payload), ENV, {
    fetchImpl: makeFetch(seen), authorize: authAs(role), kv: KV, limiter: noLimit, allowCookie: false,
  });
  return { res, seen };
}

const MIXED = { action: 'category-batch', ops: [
  { kind: 'add', args: { parentPath: [], key: 'newcat', label: 'New Cat' } },
  { kind: 'channel-set', args: { category: 'ai', channelId: '123456789' } },
] };
const TAX_ONLY = { action: 'category-batch', ops: [{ kind: 'add', args: { parentPath: [], key: 'newcat', label: 'New Cat' } }] };

test('category-batch touching a superadmin-pinned file (content-channels.yml) is REFUSED for an admin', async () => {
  const { res } = await run('admin', MIXED);
  assert.equal(res.status, 403, `expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.match(res.body?.message || '', /higher role/i);
});

test('the SAME mixed-tier category-batch is ALLOWED for a superadmin', async () => {
  const { res, seen } = await run('superadmin', MIXED);
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body?.number, 42);
  // It actually WROTE both files (the multi-file apply), not just one.
  assert.ok(seen.some((s) => s.includes('PUT /repos/gbti-network/gbti.network/contents/house/taxonomy.yml')), 'taxonomy.yml not written');
  assert.ok(seen.some((s) => s.includes('PUT /repos/gbti-network/gbti.network/contents/house/content-channels.yml')), 'content-channels.yml not written');
});

test('POSITIVE CONTROL: a taxonomy-ONLY batch is admin-usable (the guard is falsifiable, not a blanket 403)', async () => {
  const { res, seen } = await run('admin', TAX_ONLY);
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.ok(seen.some((s) => s.includes('PUT /repos/gbti-network/gbti.network/contents/house/taxonomy.yml')), 'taxonomy.yml not written');
  assert.ok(!seen.some((s) => s.includes('content-channels.yml')), 'a taxonomy-only batch must not touch content-channels.yml');
});

test('tag-edit (member content, admin curation) is allowed for an admin and writes the retagged file', async () => {
  const POST_MD = '---\ntitle: X\ntags:\n  - oldtag\n  - keep\n---\n\nbody\n';
  const seen = [];
  const fetchImpl = async (url, opts = {}) => {
    const u = String(url); const method = opts.method || 'GET';
    seen.push(`${method} ${u.replace('https://api.github.com', '')}`);
    if (method === 'GET' && u.includes('/contents/members/atwellpub/posts/foo/index.md') && u.includes('?ref=main')) return { ok: true, status: 200, json: async () => ({ content: b64(POST_MD), sha: 'p1' }) };
    if (method === 'GET' && u.includes('/git/ref/heads/main')) return { ok: true, status: 200, json: async () => ({ object: { sha: 'mainsha' } }) };
    if (method === 'POST' && u.endsWith('/git/refs')) return { ok: true, status: 201, json: async () => ({}) };
    if (method === 'GET' && u.includes('/contents/')) return { ok: false, status: 404, json: async () => ({}) };
    if (method === 'PUT' && u.includes('/contents/')) return { ok: true, status: 201, json: async () => ({}) };
    if (method === 'POST' && u.endsWith('/pulls')) return { ok: true, status: 201, json: async () => ({ number: 7, html_url: 'u' }) };
    return { ok: false, status: 500, json: async () => ({}) };
  };
  const res = await membershipAdminAuthor(
    req({ action: 'tag-edit', mode: 'rename', tag: 'oldtag', to: 'newtag', paths: ['members/atwellpub/posts/foo/index.md'] }),
    ENV, { fetchImpl, authorize: authAs('admin'), kv: KV, limiter: noLimit });
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.ok(seen.some((s) => s.includes('PUT /repos/gbti-network/gbti.network/contents/members/atwellpub/posts/foo/index.md')), 'the retagged post was not written');
});

test('tag-edit REFUSES a non-content path (the CONTENT_ITEM_RE filter drops it, so nothing to write)', async () => {
  // house/roles.yml is not a content item; it is filtered out, leaving zero paths -> a clean 400, never a write.
  const seen = [];
  const res = await membershipAdminAuthor(
    req({ action: 'tag-edit', mode: 'retire', tag: 'x', paths: ['house/roles.yml', 'CODEOWNERS'] }),
    ENV, { fetchImpl: makeFetch(seen), authorize: authAs('superadmin'), kv: KV, limiter: noLimit });
  assert.equal(res.status, 400);
  assert.ok(!seen.some((s) => s.startsWith('PUT')), 'no file should be written when every path is filtered out');
});
