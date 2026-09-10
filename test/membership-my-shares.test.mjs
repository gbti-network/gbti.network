// sow-304: GET /membership/my-shares (workers/signup/membership-shares.mjs listMyShares + listMemberShares). The
// caller's OWN shares for the WorkBench Shares tab: the login comes from the verified session (never a query
// parameter), drafts are included (an unpublished share must still be editable), members bodies stay pointer-only,
// a member with no shares folder gets an empty list, and any other GitHub failure is a 502. Injected fetch + auth
// + token: no network, no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listMemberShares, listMyShares } from '../workers/signup/membership-shares.mjs';

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const shareFile = ({ id, author, visibility = 'members', status = 'published', title = 'A share', body = 'hello', enc = null, updatedAt = null, category = null }) => b64([
  '---', 'type: share', `id: "${id}"`, `author: ${author}`, `title: "${title}"`, `visibility: ${visibility}`, `status: ${status}`,
  `createdAt: "${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}T00:00:00Z"`,
  ...(updatedAt ? [`updatedAt: "${updatedAt}"`] : []), ...(category ? [`category: ${category}`] : []), ...(enc ? [`encryptedBody: ${enc}`] : []),
  '---', '', visibility === 'members' ? '' : body, '',
].join('\n'));

// A fake GitHub: a directory listing for members/<u>/shares, then per-file Contents reads.
function fakeGitHub(folders) {
  return async (url) => {
    const m = url.match(/\/contents\/(.+?)\?ref=main/);
    const p = m ? decodeURIComponent(m[1]) : '';
    if (folders[p] && Array.isArray(folders[p])) return { ok: true, status: 200, json: async () => folders[p].map((name) => ({ type: 'file', name, path: `${p}/${name}` })) };
    for (const dir of Object.keys(folders)) {
      const name = p.startsWith(dir + '/') ? p.slice(dir.length + 1) : null;
      if (name && folders[dir].includes(name) && FILES[p]) return { ok: true, status: 200, json: async () => ({ content: FILES[p] }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}
const FILES = {
  'members/alice/shares/20260101-old.md': shareFile({ id: '20260101-old', author: 'alice', visibility: 'public', body: 'public old', category: 'devops' }),
  'members/alice/shares/20260301-new.md': shareFile({ id: '20260301-new', author: 'alice', enc: 'members/alice/_enc/share-20260301-new-body.enc', updatedAt: '2026-09-01T10:00:00Z' }),
  'members/alice/shares/20260201-gone.md': shareFile({ id: '20260201-gone', author: 'alice', visibility: 'public', status: 'draft', body: 'removed' }),
  'members/bob/shares/20260401-bobs.md': shareFile({ id: '20260401-bobs', author: 'bob', visibility: 'public' }),
};
const FOLDERS = { 'members/alice/shares': ['20260101-old.md', '20260301-new.md', '20260201-gone.md', 'notes.txt'], 'members/bob/shares': ['20260401-bobs.md'] };
const deps = (extra = {}) => ({ fetchImpl: fakeGitHub(FOLDERS), kv: null, getToken: async () => 'tok', upstream: 'gbti-network/gbti.network', ...extra });
const req = () => new Request('https://signup.gbti.network/membership/my-shares');

test('listMemberShares: one folder, newest first, drafts INCLUDED, members body pointer-only, the edit stamp and category carried', async () => {
  const items = await listMemberShares({}, 'alice', deps());
  assert.deepEqual(items.map((s) => s.id), ['20260301-new', '20260201-gone', '20260101-old']);
  assert.deepEqual(items.map((s) => s.status), ['published', 'draft', 'published']);
  const members = items[0];
  assert.equal(members.body, '');
  assert.equal(members.encryptedBody, 'members/alice/_enc/share-20260301-new-body.enc');
  assert.equal(members.updatedAt, '2026-09-01T10:00:00.000Z');
  assert.equal(items[2].category, 'devops');
  assert.equal(items[2].body.trim(), 'public old');
});

test('listMemberShares: no shares folder is an empty list; an off-shape login reads nothing; a GitHub failure throws', async () => {
  assert.deepEqual(await listMemberShares({}, 'carol', deps()), []);
  let calls = 0;
  assert.deepEqual(await listMemberShares({}, '../alice', deps({ fetchImpl: async () => { calls++; return { ok: true, status: 200, json: async () => [] }; } })), []);
  assert.equal(calls, 0);
  await assert.rejects(() => listMemberShares({}, 'alice', deps({ fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) })), /contents 500/);
});

test('listMyShares: the login is the verified session\'s, never a parameter; signed out is refused; GitHub down is 502', async () => {
  const alice = async () => ({ ok: true, githubId: '1', login: 'alice', status: 'paid' });
  const r = await listMyShares(new Request('https://signup.gbti.network/membership/my-shares?login=bob'), {}, deps({ authorize: alice }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items.map((s) => s.author), ['alice', 'alice', 'alice'], 'bob\'s folder is never listed for alice, whatever the query says');
  const out = await listMyShares(req(), {}, deps({ authorize: async () => ({ ok: false, status: 401, body: { error: 'unauthorized' } }) }));
  assert.equal(out.status, 401);
  const down = await listMyShares(req(), {}, deps({ authorize: alice, fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) }));
  assert.equal(down.status, 502);
  const noLogin = await listMyShares(req(), {}, deps({ authorize: async () => ({ ok: true, githubId: '1', status: 'paid' }) }));
  assert.equal(noLogin.status, 401, 'a session without a login cannot name a folder');
});

test('a free (non-paid) signed-in member can still list their own shares (reading, not publishing)', async () => {
  const free = async () => ({ ok: true, githubId: '2', login: 'alice', status: 'none' });
  const r = await listMyShares(req(), {}, deps({ authorize: free }));
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 3);
});

// ---------------------------------------------------------------------------------------------------------
// 2026-09-10: the folder comes back in ONE GraphQL call (listing + text). The owner's tab took 8 to 10 seconds
// on 46 sequential per-file reads; the count of fetches is the claim.
// ---------------------------------------------------------------------------------------------------------
function fakeGitHubGraphQL(folders) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET' });
    if (String(url).endsWith('/graphql')) {
      const dir = JSON.parse(init.body).query.match(/expression: "main:([^"]+)"/)[1];
      if (!folders[dir]) return { ok: true, json: async () => ({ data: { repository: { object: null } } }) };
      const entries = folders[dir].map((name) => ({ name, type: 'blob', object: FILES[`${dir}/${name}`] ? { text: Buffer.from(FILES[`${dir}/${name}`], 'base64').toString('utf8'), isBinary: false } : { text: 'not a share', isBinary: false } }));
      return { ok: true, json: async () => ({ data: { repository: { object: { entries } } } }) };
    }
    throw new Error('REST must not be used when GraphQL answers: ' + url);
  };
  impl.calls = calls;
  return impl;
}

test('listMemberShares: ONE GraphQL call returns the folder, newest first, drafts included; no REST read', async () => {
  const f = fakeGitHubGraphQL(FOLDERS);
  const items = await listMemberShares({}, 'alice', deps({ fetchImpl: f }));
  assert.equal(f.calls.length, 1, 'one call, not one per file');
  assert.equal(f.calls[0].method, 'POST');
  assert.deepEqual(items.map((i) => i.id), ['20260301-new', '20260201-gone', '20260101-old']);
  assert.equal(items.find((i) => i.id === '20260201-gone').status, 'draft', 'a draft still shows in the owner\'s own list');
});

test('listMemberShares: a member with no shares folder is an empty list from the same one call', async () => {
  const f = fakeGitHubGraphQL(FOLDERS);
  assert.deepEqual(await listMemberShares({}, 'nobody', deps({ fetchImpl: f })), []);
  assert.equal(f.calls.length, 1);
});

test('listMemberShares: when GraphQL is refused the REST path answers, reading files in parallel', async () => {
  const rest = fakeGitHub(FOLDERS);
  const seen = [];
  const impl = async (url, init) => {
    if (String(url).endsWith('/graphql')) return { ok: false, status: 403, json: async () => ({}) };
    seen.push(String(url));
    return rest(url, init);
  };
  const items = await listMemberShares({}, 'alice', deps({ fetchImpl: impl }));
  assert.equal(items.length, 3);
  assert.equal(seen.length, 4, 'the listing plus one read per share file, as before');
});
