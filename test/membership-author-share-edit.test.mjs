// sow-304: editing a share through the hosted author route. Three things: (1) isShareEdit decides "edit" from the
// FILES on main and fails closed; (2) an edit by a paid Network Member is exempt from the six-hour share slow
// mode while a new share is not, driven through membershipAuthor with a limiter that DENIES the share window
// (so an exemption that did not hold would surface as a 429); (3) the sow-293 members-only check now admits a
// members share's own ciphertext sibling under _enc/ (it refused the real file set before) and nothing else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { membershipAuthor, isShareEdit, isMembersOnlyShare } from '../workers/signup/membership-author.mjs';

const env = { GITHUB_APP_ID: '123', GITHUB_APP_INSTALLATION_ID: '999', GITHUB_APP_PRIVATE_KEY: 'PEM', UPSTREAM_REPO: 'gbti-network/gbti.network', MEMBERSHIP_AUTHOR_ENABLED: 'true' };
const fakeKv = () => { const m = new Map(); return { async get(k, t) { const v = m.get(k); return (t === 'json' || t?.type === 'json') && typeof v === 'string' ? JSON.parse(v) : v ?? null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } }; };
const signJwt = async () => 'fake.jwt.sig';
const memberOk = async () => ({ ok: true, githubId: '2002207', tier: 'member' });
const creatorOk = async () => ({ ok: true, githubId: '2002207', tier: 'creator' });
const userMe = async () => ({ githubLogin: 'atwellpub', githubId: '2002207' });
const req = (body) => ({ headers: { get: () => 'Bearer tok' }, json: async () => body });
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const INDEX_YML = 'members:\n  "2002207": atwellpub\n';
const ID = '20260901120000-a-members-share';
const stub = { path: `members/atwellpub/shares/${ID}.md`, content: `---\ntype: share\nid: ${ID}\nauthor: atwellpub\nstatus: published\nvisibility: members\nencryptedBody: members/atwellpub/_enc/share-${ID}-body.enc\ncreatedAt: 2026-09-01T12:00:00.000Z\n---\n` };
const enc = { path: `members/atwellpub/_enc/share-${ID}-body.enc`, content: '{"v":1,"kid":"1","iv":"AAAA","aad":"a","ct":"AAAA"}' };
const body = { itemId: `share-${ID}`, title: 'Update Share', files: [stub, enc] };

/** A GitHub fake for the whole hosted flow; `existing` lists share paths that already live on main. */
function ghFetch(existing = [], { contentsThrow = false } = {}) {
  return async (url, init = {}) => {
    const method = init.method || 'GET';
    if (/\/access_tokens$/.test(url)) return { ok: true, status: 201, async json() { return { token: 'ghs_inst', expires_at: new Date(Date.now() + 3600e3).toISOString() }; } };
    if (/\/contents\/house\/members-index\.yml\?ref=main$/.test(url)) return { ok: true, status: 200, async json() { return { content: b64(INDEX_YML) }; } };
    if (/\/git\/ref\/heads\/main$/.test(url)) return { ok: true, status: 200, async json() { return { object: { sha: 'mainsha' } }; } };
    if (/\/git\/refs$/.test(url) && method === 'POST') return { ok: true, status: 201, async json() { return {}; } };
    if (/\/git\/refs\/heads\//.test(url) && method === 'PATCH') return { ok: true, status: 200, async json() { return {}; } };
    if (/\/contents\//.test(url) && method === 'GET') {
      if (contentsThrow) throw new Error('network down');
      const p = decodeURIComponent(url.split('/contents/')[1].split('?')[0]);
      return existing.includes(p) ? { ok: true, status: 200, async json() { return { sha: 'oldsha', content: b64('x') }; } } : { ok: false, status: 404, async json() { return {}; } };
    }
    if (/\/contents\//.test(url) && (method === 'PUT' || method === 'DELETE')) return { ok: true, status: 201, async json() { return {}; } };
    if (/\/pulls$/.test(url) && method === 'POST') return { ok: true, status: 201, async json() { return { number: 42, html_url: 'https://github.com/gbti-network/gbti.network/pull/42' }; } };
    return { ok: false, status: 500, async json() { return {}; } };
  };
}
/** A limiter that records every window it is asked about and DENIES the share slow mode. */
function denyShareWindow() {
  const asked = [];
  const limiter = async ({ prefix }) => { asked.push(prefix); return prefix === 'rl:share:' ? { allowed: false } : { allowed: true }; };
  return { limiter, asked };
}

test('isShareEdit: every share .md in the set exists on main -> true; otherwise, or on any failure, false', async () => {
  const base = { instToken: 't', upstream: 'gbti-network/gbti.network', folder: 'atwellpub' };
  assert.equal(await isShareEdit({ ...base, fetchImpl: ghFetch([stub.path]), files: [stub, enc] }), true);
  assert.equal(await isShareEdit({ ...base, fetchImpl: ghFetch([]), files: [stub, enc] }), false, 'a new share');
  assert.equal(await isShareEdit({ ...base, fetchImpl: ghFetch([stub.path], { contentsThrow: true }), files: [stub, enc] }), false, 'a thrown lookup fails closed');
  assert.equal(await isShareEdit({ ...base, fetchImpl: ghFetch([stub.path]), files: [enc] }), false, 'no share .md in the set');
  assert.equal(await isShareEdit({ ...base, fetchImpl: ghFetch([stub.path]), files: [stub, { path: 'members/atwellpub/shares/new-one.md', content: 'x' }] }), false, 'a set mixing in a new share is new');
});

test('the sow-293 members-only check admits the share\'s own _enc/ sibling and nothing else under _enc/', () => {
  assert.equal(isMembersOnlyShare([stub, enc], 'atwellpub'), true, 'the real file set the website sends');
  assert.equal(isMembersOnlyShare([stub], 'atwellpub'), true);
  assert.equal(isMembersOnlyShare([stub, { ...enc, path: 'members/atwellpub/_enc/share-other-id-body.enc' }], 'atwellpub'), false, 'a ciphertext for a share not in the set');
  assert.equal(isMembersOnlyShare([stub, { ...enc, path: 'members/atwellpub/_enc/post-x-body.enc' }], 'atwellpub'), false, 'a post ciphertext');
  assert.equal(isMembersOnlyShare([stub, { ...enc, path: `members/other/_enc/share-${ID}-body.enc` }], 'atwellpub'), false, 'another folder');
  assert.equal(isMembersOnlyShare([{ ...stub, content: stub.content.replace('visibility: members', 'visibility: public') }, enc], 'atwellpub'), false, 'a public share is not members-only');
  assert.equal(isMembersOnlyShare([enc], 'atwellpub'), false, 'ciphertext alone');
});

test('a paid Network Member EDITING an existing members share is exempt from the slow mode', async () => {
  const { limiter, asked } = denyShareWindow();
  const r = await membershipAuthor(req(body), env, { kv: fakeKv(), fetchImpl: ghFetch([stub.path]), signJwt, authorize: memberOk, fetchUser: userMe, limiter });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.number, 42);
  assert.ok(!asked.includes('rl:share:'), `the share window was never consulted: ${asked.join(',')}`);
});

test('the same member posting a NEW members share goes through the slow mode (and is throttled here)', async () => {
  const { limiter, asked } = denyShareWindow();
  const r = await membershipAuthor(req(body), env, { kv: fakeKv(), fetchImpl: ghFetch([]), signJwt, authorize: memberOk, fetchUser: userMe, limiter });
  assert.equal(r.status, 429);
  assert.equal(r.body.error, 'slow_mode');
  assert.ok(asked.includes('rl:share:'));
});

test('an existence check that fails closes the exemption: the request is throttled as new', async () => {
  const { limiter, asked } = denyShareWindow();
  const r = await membershipAuthor(req(body), env, { kv: fakeKv(), fetchImpl: ghFetch([stub.path], { contentsThrow: false }), signJwt, authorize: memberOk, fetchUser: userMe, limiter, shareEditCheck: async () => { throw new Error('lookup exploded'); } }).catch((e) => ({ status: 'threw', body: e.message }));
  // a throwing check is the caller's bug, but it must never read as "edit": either the route surfaces the error
  // or it throttles. It must not answer 200 having skipped the window.
  assert.notEqual(r.status, 200, JSON.stringify(r.body));
  const r2 = await membershipAuthor(req(body), env, { kv: fakeKv(), fetchImpl: ghFetch([stub.path]), signJwt, authorize: memberOk, fetchUser: userMe, limiter, shareEditCheck: async () => false });
  assert.equal(r2.status, 429, 'a check answering false is a new share');
  assert.ok(asked.includes('rl:share:'));
});

test('a Curator editing or posting is never asked about the share window', async () => {
  const { limiter, asked } = denyShareWindow();
  const r = await membershipAuthor(req(body), env, { kv: fakeKv(), fetchImpl: ghFetch([]), signJwt, authorize: creatorOk, fetchUser: userMe, limiter });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(!asked.includes('rl:share:'));
});
