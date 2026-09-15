// sow-323 Phase 3: the fork route applies the same audience rule as the hosted route. A member whose client
// publishes from their own fork (app mode) opens the pull request through openPullForMember, and the merge gate
// reads only paths, so before this a public article from a fork reached the site with no review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPullForMember, forkChangesForAudience } from '../workers/signup/github-app.mjs';

const env = { GITHUB_APP_ID: '123', GITHUB_APP_INSTALLATION_ID: '999', GITHUB_APP_PRIVATE_KEY: 'PEM', UPSTREAM_REPO: 'gbti-network/gbti.network' };
const kv = () => { const m = new Map(); return { async get(k, t) { const v = m.get(k); return t === 'json' && typeof v === 'string' ? JSON.parse(v) : v ?? null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } }; };
const signJwt = async () => 'fake.jwt.sig';
const TIP = 'a'.repeat(40);
const req = (body) => ({ headers: { get: () => 'Bearer tok' }, json: async () => body });
const user = async () => ({ githubLogin: 'alice', githubId: '1' });
const paid = (tier) => async () => ({ ok: true, githubId: '1', tier });
const fm = (vis, type = 'post') => `---\ntype: ${type}\ntitle: T\nvisibility: ${vis}\n---\nbody`;

/** A GitHub fake: `branch` maps path -> text at the tip; `main` lists paths public on main. Records every call. */
function gh({ branch = {}, removed = [], main = [], compareStatus = 200, extra = [] } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ url, method });
    if (/\/access_tokens$/.test(url)) return { ok: true, async json() { return { token: 'ghs_inst', expires_at: new Date(Date.now() + 3600e3).toISOString() }; } };
    if (/\/compare\//.test(url)) {
      const files = [...Object.keys(branch).map((filename) => ({ filename, status: 'modified' })), ...removed.map((filename) => ({ filename, status: 'removed' })), ...extra];
      return { ok: compareStatus === 200, status: compareStatus, async json() { return { files, commits: [{ sha: 'b'.repeat(40) }, { sha: TIP }] }; } };
    }
    if (/\/contents\//.test(url)) {
      const p = decodeURIComponent(url.split('/contents/')[1].split('?')[0]);
      const ref = url.split('ref=')[1];
      if (ref === TIP && branch[p] != null) return { ok: true, status: 200, async text() { return branch[p]; } };
      if (ref === 'main' && main.includes(p)) return { ok: true, status: 200, async text() { return fm('public'); } };
      return { ok: false, status: 404, async text() { return ''; } };
    }
    if (/\/pulls$/.test(url) && method === 'POST') return { ok: true, status: 201, async json() { return { number: 9, html_url: 'u' }; } };
    return { ok: false, status: 500, async json() { return {}; } };
  };
  return { fetchImpl, calls, opened: () => calls.some((c) => /\/pulls$/.test(c.url) && c.method === 'POST') };
}
const open = (g, tier, { isSuper = false } = {}) => openPullForMember(req({ head: 'alice:gbti-post', base: 'main', title: 'x' }), env, {
  kv: kv(), signJwt, fetchImpl: g.fetchImpl, fetchUser: user, authorize: paid(tier), authorizeSuper: async () => ({ ok: isSuper }),
});

test('the read lists only reviewable content, at the branch TIP, with deletes as null', async () => {
  const g = gh({ branch: { 'members/alice/posts/p/index.md': fm('members') }, removed: ['members/alice/prompts/old/index.md'], extra: [{ filename: 'members/alice/images/x.png', status: 'added' }, { filename: 'members/alice/comments/c.md', status: 'added' }] });
  const r = await forkChangesForAudience({ fetchImpl: g.fetchImpl, instToken: 't', upstream: 'gbti-network/gbti.network', base: 'main', head: 'alice:gbti-post' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.files, [{ path: 'members/alice/posts/p/index.md', content: fm('members') }, { path: 'members/alice/prompts/old/index.md', content: null }]);
  assert.ok(g.calls.some((c) => c.url.endsWith('/repos/gbti-network/gbti.network/compare/main...alice:gbti-post')), 'a cross-fork compare');
  assert.ok(g.calls.some((c) => c.url.includes(`?ref=${TIP}`)), 'files are read by the tip commit, never by branch name');
});

test('the read FAILS CLOSED: a failed compare, a truncated list, an unreadable file, a thrown fetch', async () => {
  const args = (fetchImpl) => ({ fetchImpl, instToken: 't', upstream: 'o/r', base: 'main', head: 'alice:b' });
  assert.equal((await forkChangesForAudience(args(gh({ compareStatus: 404 }).fetchImpl))).ok, false);
  const many = Array.from({ length: 300 }, (_, i) => ({ filename: `members/alice/images/${i}.png`, status: 'added' }));
  assert.equal((await forkChangesForAudience(args(gh({ extra: many }).fetchImpl))).ok, false, 'GitHub stops listing at 300 files');
  const unreadable = gh({ extra: [{ filename: 'members/alice/posts/p/index.md', status: 'added' }] });
  assert.equal((await forkChangesForAudience(args(unreadable.fetchImpl))).ok, false);
  assert.equal((await forkChangesForAudience(args(async () => { throw new Error('down'); }))).ok, false);
});

test('a supporter\'s PUBLIC article from a fork is refused for review, and no pull request opens', async () => {
  const g = gh({ branch: { 'members/alice/posts/p/index.md': fm('public') } });
  const r = await open(g, 'member');
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.equal(r.body.error, 'review_required');
  assert.equal(g.opened(), false);
});

test('members-only content, a trusted author\'s public article, and an already-public item all open', async () => {
  const members = gh({ branch: { 'members/alice/posts/p/index.md': fm('members') } });
  assert.equal((await open(members, 'member')).status, 200);
  assert.equal(members.opened(), true);
  assert.equal((await open(gh({ branch: { 'members/alice/posts/p/index.md': fm('public') } }), 'creator')).status, 200);
  assert.equal((await open(gh({ branch: { 'members/alice/posts/p/index.md': fm('public') } }), 'member')).status, 403);
  assert.equal((await open(gh({ branch: { 'members/alice/posts/p/index.md': fm('public') }, main: ['members/alice/posts/p/index.md'] }), 'member')).status, 200,
    'an approved item stays editable by its author');
});

test('a public share opens only for a superadmin, and a public item in ANOTHER member\'s folder is reviewed too', async () => {
  const share = () => gh({ branch: { 'members/alice/shares/20260915-x.md': fm('public', 'share') } });
  assert.equal((await open(share(), 'creator')).status, 403);
  assert.equal((await open(share(), 'creator', { isSuper: true })).status, 200);
  const other = gh({ branch: { 'members/bob/posts/p/index.md': fm('public') } });
  assert.equal((await open(other, 'member')).status, 403);
  assert.equal(other.opened(), false);
});

test('an unreadable branch refuses with a retry message, and a malformed head never reaches GitHub', async () => {
  const g = gh({ compareStatus: 500 });
  const r = await open(g, 'member');
  assert.equal(r.status, 502);
  assert.equal(g.opened(), false);
  const bad = gh();
  const r2 = await openPullForMember(req({ head: 'alice:x y', base: 'main' }), env, { kv: kv(), signJwt, fetchImpl: bad.fetchImpl, fetchUser: user, authorize: paid('member') });
  assert.equal(r2.status, 400);
  assert.equal(bad.calls.length, 0);
});
