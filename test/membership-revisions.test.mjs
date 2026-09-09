// sow-232: GET /membership/revisions (workers/signup/github-app.mjs itemRevisions) and the npm host's itemStats
// operation. The Worker route is driven through a fake fetch in the shape of the SOW-028 review proxies: signed-out
// refused, a governance path refused, a member path answered with the count and the last date, a GitHub failure
// surfaced as 502. The npm operation is driven through a fake repo client. No network, no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemRevisions } from '../workers/signup/github-app.mjs';
import { itemStats } from '../client/src/operations-admin.mjs';

const env = { GITHUB_APP_ID: '123', GITHUB_APP_INSTALLATION_ID: '999', GITHUB_APP_PRIVATE_KEY: 'PEM', UPSTREAM_REPO: 'gbti-network/gbti.network' };
const fakeKv = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { store: m, async get(k, t) { const v = m.get(k); return t === 'json' && typeof v === 'string' ? JSON.parse(v) : v ?? null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } };
};
const signJwt = async () => 'fake.jwt.sig';
const userAlice = async () => ({ githubLogin: 'Alice', githubId: '1' });
const getReq = (url) => ({ url, headers: { get: () => 'Bearer tok' } });
const instOk = (url) => /access_tokens$/.test(url) && { ok: true, async json() { return { token: 'ghs_inst', expires_at: new Date(Date.now() + 3600e3).toISOString() }; } };
const base = { kv: fakeKv(), signJwt, fetchUser: userAlice };
const commits = [
  { sha: 'c3', commit: { committer: { date: '2026-09-01T10:00:00Z' }, author: { date: '2026-09-01T09:00:00Z' } } },
  { sha: 'c2', commit: { committer: { date: '2026-08-20T10:00:00Z' }, author: { date: '2026-08-20T09:00:00Z' } } },
  { sha: 'c1', commit: { committer: { date: '2026-08-01T10:00:00Z' }, author: { date: '2026-08-01T09:00:00Z' } } },
];

test('a member path answers with the commit count on main and the last commit date', async () => {
  let asked = '';
  const fetchImpl = async (url) => { if (!/access_tokens$/.test(url)) asked = String(url); return instOk(url) || { ok: true, status: 200, async json() { return commits; } }; };
  const r = await itemRevisions(getReq('https://w/membership/revisions?path=members%2Falice%2Fposts%2Fhello%2Findex.md'), env, { ...base, fetchImpl });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, revisions: 3, capped: false, lastAt: '2026-09-01T10:00:00Z' });
  assert.ok(asked.includes('/repos/gbti-network/gbti.network/commits?path=members%2Falice%2Fposts%2Fhello%2Findex.md&sha=main&per_page=100'), asked);
});

test('signed-out (unresolvable token) is refused before any GitHub call', async () => {
  let ghCalls = 0;
  const fetchImpl = async (url) => { ghCalls++; return instOk(url) || { ok: true, async json() { return commits; } }; };
  const r = await itemRevisions(getReq('https://w/membership/revisions?path=members%2Falice%2Fposts%2Fx%2Findex.md'), env, { ...base, fetchUser: async () => { throw new Error('bad'); }, fetchImpl });
  assert.equal(r.status, 401);
  assert.equal(ghCalls, 0);
});

test('a governance path, a traversal, an absolute path and an empty path are all 400', async () => {
  const fetchImpl = async (url) => instOk(url) || { ok: true, async json() { return commits; } };
  for (const p of ['house/roles.yml', 'members/../house/roles.yml', '/members/alice/posts/x/index.md', '', 'house/bans.yml', '.github/workflows/x.yml']) {
    const r = await itemRevisions(getReq(`https://w/membership/revisions?path=${encodeURIComponent(p)}`), env, { ...base, fetchImpl });
    assert.equal(r.status, 400, `refused: ${JSON.stringify(p)}`);
  }
  for (const p of ['house/posts/hello/index.md', 'house/prompts/p/index.md', 'house/projects/q/index.md']) {
    const r = await itemRevisions(getReq(`https://w/membership/revisions?path=${encodeURIComponent(p)}`), env, { ...base, fetchImpl });
    assert.equal(r.status, 200, `house content allowed: ${p}`);
  }
});

test('a GitHub failure or an unexpected shape is surfaced as 502, never as zero revisions', async () => {
  const bad = async (url) => instOk(url) || { ok: false, status: 403, async json() { return {}; } };
  const r = await itemRevisions(getReq('https://w/membership/revisions?path=members%2Fa%2Fposts%2Fx%2Findex.md'), env, { ...base, fetchImpl: bad });
  assert.equal(r.status, 502);
  const odd = async (url) => instOk(url) || { ok: true, status: 200, async json() { return { message: 'nope' }; } };
  const r2 = await itemRevisions(getReq('https://w/membership/revisions?path=members%2Fa%2Fposts%2Fx%2Findex.md'), env, { ...base, fetchImpl: odd });
  assert.equal(r2.status, 502);
});

test('a hundred commits reads as capped', async () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ sha: `s${i}`, commit: { committer: { date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z` } } }));
  const fetchImpl = async (url) => instOk(url) || { ok: true, status: 200, async json() { return many; } };
  const r = await itemRevisions(getReq('https://w/membership/revisions?path=members%2Fa%2Fposts%2Fx%2Findex.md'), env, { ...base, fetchImpl });
  assert.equal(r.body.revisions, 100);
  assert.equal(r.body.capped, true);
});

// ---- the npm host operation, through a fake repo client ----
const ctxWith = (repo) => ({ identity: () => ({ username: 'alice', githubId: '1' }), getRepoClient: () => repo });

test('npm itemStats asks the repo for commits on main for the path and maps the answer', async () => {
  let got = null;
  const repo = { async listCommits(p, opts) { got = { p, opts }; return commits; } };
  const r = await itemStats(ctxWith(repo), { path: 'members/alice/posts/hello/index.md' });
  assert.deepEqual(got, { p: 'members/alice/posts/hello/index.md', opts: { ref: 'main', perPage: 100 } });
  assert.deepEqual(r, { revisions: 3, capped: false, lastAt: '2026-09-01T10:00:00Z' });
});

test('npm itemStats refuses a governance or malformed path and requires an identity', async () => {
  const repo = { async listCommits() { throw new Error('should not be called'); } };
  for (const p of ['house/roles.yml', '../x', '', '/members/a/posts/x/index.md']) {
    await assert.rejects(() => itemStats(ctxWith(repo), { path: p }), /members\/ or house content path/, `refused ${JSON.stringify(p)}`);
  }
  await assert.rejects(() => itemStats({ identity: () => null, getRepoClient: () => repo }, { path: 'members/a/posts/x/index.md' }), /no signed-in identity/);
});
