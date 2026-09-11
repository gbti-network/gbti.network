// sow-317: the WorkBench's Network content scope for a superadmin: every member's items for a type (the site's
// published index plus what sits unpublished on main) and every member's shares, drafts included. Fakes for the
// Trees call, the GraphQL batch and the site index; the fetch COUNT is the claim in the cost tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contentPathsFromTree, sharePathsFromTree, authorFromContentPath, mergeIndexAndUnlisted, unlistedItemFrom,
  readContentTree, listNetworkContent, listNetworkShares, TREE_CACHE_KEY,
} from '../workers/signup/membership-network.mjs';

const TREE = [
  { path: 'members/alice/posts/hello/index.md', type: 'blob' },
  { path: 'members/alice/posts/hidden/index.md', type: 'blob' },
  { path: 'members/bob/prompts/summarise/index.md', type: 'blob' },
  { path: 'members/bob/projects/tool/index.md', type: 'blob' },
  { path: 'members/carol/products/legacy/index.md', type: 'blob' },
  { path: 'members/alice/posts/hello/images/a.png', type: 'blob' },
  { path: 'members/alice/shares/20260301000000-new.md', type: 'blob' },
  { path: 'members/bob/shares/20260101000000-old.md', type: 'blob' },
  { path: 'house/roles.yml', type: 'blob' },
  { path: 'members/alice/posts', type: 'tree' },
];
const FILES = {
  'members/bob/prompts/summarise/index.md': '---\ntitle: Summarise\nstatus: published\n---\nbody',
  'members/bob/projects/tool/index.md': '---\ntitle: Tool\nstatus: draft\n---\nbody',
  'members/carol/products/legacy/index.md': '---\ntitle: Legacy\n---\nbody',
  'members/alice/posts/hidden/index.md': '---\ntitle: Hidden one\nstatus: draft\nvisibility: members\npublishedAt: 2026-02-01T00:00:00Z\nupdatedAt: 2026-02-02T00:00:00Z\n---\nbody',
  'members/alice/shares/20260301000000-new.md': '---\ntype: share\nid: "20260301000000-new"\nauthor: alice\ntitle: New share\nvisibility: public\ncreatedAt: "2026-03-01T00:00:00Z"\nstatus: draft\n---\nremoved',
  'members/bob/shares/20260101000000-old.md': '---\ntype: share\nid: "20260101000000-old"\nauthor: bob\ntitle: Old share\nvisibility: public\ncreatedAt: "2026-01-01T00:00:00Z"\nstatus: published\n---\nhello',
};
const INDEX = { post: [{ path: 'members/alice/posts/hello/index.md', title: 'Hello', publishedAt: Date.parse('2026-03-01T00:00:00Z'), visibility: 'public' }] };

function fakeGitHub({ calls = [] } = {}) {
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET' });
    const u = String(url);
    if (u.includes('/git/trees/')) return { ok: true, json: async () => ({ tree: TREE }) };
    if (u.endsWith('/graphql')) {
      const q = JSON.parse(init.body).query;
      const repo = {};
      for (const m of q.matchAll(/(b\d+): object\(expression: "main:([^"]+)"\)/g)) repo[m[1]] = FILES[m[2]] ? { text: FILES[m[2]], isBinary: false } : null;
      return { ok: true, json: async () => ({ data: { repository: repo } }) };
    }
    if (u.includes('gbti.network/blog-index.json')) return { ok: true, json: async () => ({ items: INDEX.post }) };
    if (u.includes('gbti.network/prompts-index.json') || u.includes('gbti.network/projects-index.json')) return { ok: true, json: async () => ({ items: [] }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  impl.calls = calls;
  return impl;
}
function fakeKv() { const m = new Map(); return { m, async get(k, t) { const v = m.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } }; }
const req = (path) => new Request(`https://signup.gbti.network${path}`);
const superOk = async () => ({ ok: true, githubId: '1', role: 'superadmin' });
const superNo = async () => ({ ok: false, status: 403, body: { error: 'forbidden', message: 'superadmin access is required' } });
const deps = (extra = {}) => ({ fetchImpl: fakeGitHub(), kv: null, getToken: async () => 'tok', authorizeSuper: superOk, upstream: 'gbti-network/gbti.network', site: 'https://gbti.network', ...extra });

test('contentPathsFromTree keeps only canonical item files, with author, type and slug; shares sort newest first', () => {
  const c = contentPathsFromTree(TREE);
  assert.deepEqual(c.map((e) => [e.path, e.author, e.type, e.slug]), [
    ['members/alice/posts/hello/index.md', 'alice', 'post', 'hello'],
    ['members/alice/posts/hidden/index.md', 'alice', 'post', 'hidden'],
    ['members/bob/prompts/summarise/index.md', 'bob', 'prompt', 'summarise'],
    ['members/bob/projects/tool/index.md', 'bob', 'project', 'tool'],
    ['members/carol/products/legacy/index.md', 'carol', 'project', 'legacy'],
  ]);
  assert.deepEqual(sharePathsFromTree(TREE).map((s) => s.id), ['20260301000000-new', '20260101000000-old']);
  assert.equal(authorFromContentPath('members/Bob/shares/x.md'), 'bob');
  assert.equal(authorFromContentPath('house/roles.yml'), '');
});

test('mergeIndexAndUnlisted: index items are published with the author from the path; unlisted keep their status; newest first', () => {
  const merged = mergeIndexAndUnlisted(INDEX.post, [unlistedItemFrom({ path: 'members/alice/posts/hidden/index.md', type: 'post', slug: 'hidden', author: 'alice' }, FILES['members/alice/posts/hidden/index.md'])]);
  assert.deepEqual(merged.map((i) => [i.path, i.author, i.status]), [
    ['members/alice/posts/hello/index.md', 'alice', 'published'],
    ['members/alice/posts/hidden/index.md', 'alice', 'draft'],
  ]);
  assert.equal(merged[1].title, 'Hidden one');
  assert.equal(merged[1].visibility, 'members');
  assert.equal(merged[1].unlisted, true);
  // a duplicate path across the two sources is listed once, as the index (published) row
  const dup = mergeIndexAndUnlisted(INDEX.post, [{ path: 'members/alice/posts/hello/index.md', status: 'draft' }]);
  assert.equal(dup.length, 1);
  assert.equal(dup[0].status, 'published');
});

test('network-content for posts: the index row plus the unpublished one, in Trees + GraphQL + index = three fetches', async () => {
  const f = fakeGitHub();
  const r = await listNetworkContent(req('/membership/network-content?type=post'), {}, deps({ fetchImpl: f }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items.map((i) => [i.slug || i.path, i.status, i.author]), [['members/alice/posts/hello/index.md', 'published', 'alice'], ['hidden', 'draft', 'alice']]);
  const kinds = f.calls.map((c) => c.url.includes('/git/trees/') ? 'trees' : c.url.endsWith('/graphql') ? 'graphql' : c.url.includes('-index.json') ? 'index' : 'other');
  assert.deepEqual(kinds.sort(), ['graphql', 'index', 'trees']);
});

test('the content tree is cached in KV for a minute: the second call makes no Trees call', async () => {
  const f = fakeGitHub();
  const kv = fakeKv();
  await listNetworkContent(req('/membership/network-content?type=prompt'), {}, deps({ fetchImpl: f, kv }));
  assert.ok(kv.m.has(TREE_CACHE_KEY));
  const before = f.calls.filter((c) => c.url.includes('/git/trees/')).length;
  const r = await listNetworkContent(req('/membership/network-content?type=project'), {}, deps({ fetchImpl: f, kv }));
  assert.equal(f.calls.filter((c) => c.url.includes('/git/trees/')).length, before, 'served from the cache');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items.map((i) => i.slug).sort(), ['legacy', 'tool'], 'products/ and projects/ are both projects; unlisted on main, so read live');
});

test('a non-superadmin is refused before any read; a bad type is a 400', async () => {
  const f = fakeGitHub();
  const r = await listNetworkContent(req('/membership/network-content?type=post'), {}, deps({ fetchImpl: f, authorizeSuper: superNo }));
  assert.equal(r.status, 403);
  assert.equal(f.calls.length, 0);
  const bad = await listNetworkContent(req('/membership/network-content?type=profile'), {}, deps());
  assert.equal(bad.status, 400);
});

test('a Trees failure is a 502, never a partial list', async () => {
  const f = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const r = await listNetworkContent(req('/membership/network-content?type=post'), {}, deps({ fetchImpl: f }));
  assert.equal(r.status, 502);
});

test('network-shares lists every member\'s shares, drafts INCLUDED, newest first, with the author', async () => {
  const f = fakeGitHub();
  const r = await listNetworkShares(req('/membership/network-shares'), {}, deps({ fetchImpl: f }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items.map((s) => [s.id, s.author, s.status]), [['20260301000000-new', 'alice', 'draft'], ['20260101000000-old', 'bob', 'published']]);
  assert.equal(f.calls.filter((c) => c.url.endsWith('/graphql')).length, 1, 'one batch for every stub');
  const refused = await listNetworkShares(req('/membership/network-shares'), {}, deps({ authorizeSuper: superNo }));
  assert.equal(refused.status, 403);
});

test('readContentTree ignores trees, non-content blobs and images', async () => {
  const t = await readContentTree({}, deps({ useCache: false }));
  assert.equal(t.content.length, 5);
  assert.equal(t.shares.length, 2);
});
