// sow-427 B3: the superadmin route that PREPARES a listing (POST /membership/admin/prepared { op: 'save' } with no
// id). No network: KV, the gate, the GitHub lookups, the content tree and the house lists are fakes, except in the
// last test, which drives the real tree and house-file readers through a fake fetch (amendment 11: reuse them).
//
// The shape every refusal test checks is amendment 5: validate EVERYTHING first, write nothing on a refusal, and
// leave the superadmin's staged images where they were so a retry finds them.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { membershipPreparedPost } from '../workers/signup/membership-prepared-admin.mjs';
import { inviteKey, INVITE_STATE, inviteState } from '../membership/invites.mjs';
import { draftImageKey } from '../membership/draft-images.mjs';

const NOW = new Date('2026-10-01T12:00:00.000Z');
const ME = '2002207';
const b64 = (n) => Buffer.alloc(n, 3).toString('base64');

const COUPONS = JSON.stringify({
  generatedAt: NOW.toISOString(),
  coupons: [
    { code: 'CODEABLEYEAR', freeDays: 365, active: true, tier: 'member' },
    { code: 'RETIRED', freeDays: 30, active: false, tier: 'member' },
  ],
});
const TAXONOMY = { tree: { devops: { label: 'DevOps', children: { frameworks: { label: 'Frameworks' } } }, ai: { label: 'AI' } } };
const LICENSES = { licenses: { MIT: { url: 'https://spdx.org/licenses/MIT.html' }, Custom: {} } };

function fakeKv(seed = {}, { failPut = null } = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async get(key, type) {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' || type?.type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) {
      if (failPut && failPut(key)) throw new Error('kv put failed');
      store.set(key, value);
    },
    async delete(key) { store.delete(key); },
    async list({ prefix }) {
      return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
    },
  };
}

const staged = (name, bytes = 40, item = 'project:surfacedby') => [draftImageKey(ME, item, name), JSON.stringify({ dataBase64: b64(bytes), contentType: 'image/png', bytes })];
const seedKv = (extra = {}) => fakeKv({
  'coupons:config': COUPONS,
  ...Object.fromEntries([staged('icon.png'), staged('cover.webp'), staged('shot-1.png')]),
  ...extra,
});

const MIRROR_ROLES = { roles: { superadmins: [{ github_id: ME, login: 'atwellpub' }] } };
const okAuth = async () => ({ ok: true, githubId: ME, role: 'superadmin', mirror: MIRROR_ROLES });
const noAuth = async () => ({ ok: false, status: 403, body: { error: 'forbidden', message: 'superadmin access is required' } });

// A byte supply that differs on every call, so each mint (listing id, invite code) is fresh but reproducible.
function seqBytes() {
  let call = 0;
  return (n) => { call += 1; return Uint8Array.from({ length: n }, (_, i) => (call * 11 + i * 7) % 240); };
}

const lookupUser = async (_env, login) => (String(login).toLowerCase() === 'sam-dev'
  ? { ok: true, githubId: '5551234', login: 'Sam-Dev', name: 'Sam Rivera' }
  : { ok: false, status: 404, error: 'unknown_github_login', message: 'No personal GitHub account has that name.' });
function treeWith(slugs = []) {
  const calls = [];
  const fn = async (_env, opts) => {
    calls.push(opts);
    return { content: slugs.map((s) => ({ path: `members/hudson/projects/${s}/index.md`, type: 'project', slug: s, author: 'hudson' })), shares: [] };
  };
  fn.calls = calls;
  return fn;
}
const loadHouse = async (_f, _t, _u, path) => ({ ok: true, parsed: path.endsWith('taxonomy.yml') ? TAXONOMY : LICENSES, raw: '' });
const deps = (over = {}) => ({
  authorize: okAuth, now: NOW, randomBytes: seqBytes(), lookupUser, readTree: treeWith(['taken-slug']), loadHouse,
  getToken: async () => 'tok', siteBase: 'https://gbti.network', ...over,
});

const DRAFT = (over = {}, fmOver = {}) => ({
  type: 'project', slug: 'surfacedby',
  frontmatter: {
    title: 'SurfacedBy', shortDescription: 'Finds where a product is mentioned.', icon: './images/icon.png',
    featuredImage: './images/cover.webp', categories: ['devops'], status: 'draft', visibility: 'members', ...fmOver,
  },
  body: 'It watches the web.\n\n![The dashboard](./images/shot-1.png)',
  ...over,
});
const SAVE = (over = {}) => ({
  op: 'save', campaign: 'codeableyear', recipientName: 'Sam', message: 'Hi Sam,\n\nWe wrote this up for you.',
  draft: DRAFT(), stagedItem: 'project:surfacedby', ...over,
});
const req = (body, method = 'POST') => new Request('https://x/membership/admin/prepared', {
  method, headers: { 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
});
const post = (kv, body, over = {}) => membershipPreparedPost(req(body), { SIGNUP_KV: kv }, deps(over));

const prepKeys = (kv) => [...kv.store.keys()].filter((k) => k.startsWith('invite:') || k.startsWith('invite-listing'));
const stagedKeys = (kv) => [...kv.store.keys()].filter((k) => k.startsWith('draftimg:')).sort();

test('a caller below superadmin is refused before anything is read or written', async () => {
  const kv = seedKv();
  const before = stagedKeys(kv);
  for (const op of ['save', 'revoke', 'resend', 'delete', 'nonsense']) {
    const r = await post(kv, { ...SAVE(), op, id: 'ABCDEFGHJKMNPQRS' }, { authorize: noAuth });
    assert.equal(r.status, 403, op);
  }
  assert.deepEqual(prepKeys(kv), []);
  assert.deepEqual(stagedKeys(kv), before);
});

test('the REAL gate refuses an admin: preparing a listing is superadmin only (owner decision 10)', async () => {
  const overrides = {
    generatedAt: new Date(Date.now() - 60_000).toISOString(),
    roles: { admins: [{ github_id: '777', login: 'an-admin' }], superadmins: [{ github_id: ME, login: 'atwellpub' }] },
    bans: { bans: [] },
  };
  const kv = seedKv({ 'overrides:mirror': JSON.stringify(overrides) });
  const request = new Request('https://x/y', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer admin-token' }, body: JSON.stringify(SAVE()),
  });
  const fetchUser = async (t) => (t === 'admin-token' ? { githubId: '777', login: 'an-admin' } : null);
  const { authorize: _drop, ...rest } = deps();
  const r = await membershipPreparedPost(request, { SIGNUP_KV: kv }, { ...rest, fetchUser });
  assert.equal(r.status, 403);
  assert.match(r.body.message, /superadmin/);
  assert.deepEqual(prepKeys(kv), [], 'nothing written for an admin');
});

test('create: one invite with the listing id and NO expiry, one listing, the images copied, the staged copies gone', async () => {
  const kv = seedKv();
  const r = await post(kv, SAVE());
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const { listing, code, link } = r.body;
  assert.equal(r.body.created, true);
  assert.match(listing.id, /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{16}$/);
  assert.equal(link, `https://gbti.network/claim/?code=${code}`);
  assert.equal(listing.state, 'prepared');
  assert.equal(listing.inviteState, 'issued');
  assert.equal(listing.title, 'SurfacedBy');
  assert.equal(listing.preparedByLogin, 'atwellpub', 'named from the mirror the gate read');
  assert.equal('message' in listing, false, 'the manager row never carries the personal message');

  const inv = JSON.parse(kv.store.get(inviteKey(code)));
  assert.equal(inv.listingId, listing.id);
  assert.equal(inv.expiresAt, null, 'a prepared invitation never expires (owner decision 8)');
  assert.equal(inv.campaign, 'CODEABLEYEAR');
  assert.equal(inv.issuedBy, ME);
  assert.equal(inv.boundGithubId, null, 'no login given: first-come, like every plain invite');
  assert.equal(inviteState(inv, NOW), INVITE_STATE.issued);

  const rec = JSON.parse(kv.store.get(`invite-listing:${listing.id}`));
  assert.equal(rec.code, code);
  assert.equal(rec.recipientName, 'Sam');
  assert.equal(rec.message, 'Hi Sam,\n\nWe wrote this up for you.');
  assert.equal(rec.frontmatter.status, undefined, 'server fields are stripped before storing');
  assert.equal(rec.frontmatter.visibility, undefined);
  assert.deepEqual(rec.images, ['icon.png', 'cover.webp', 'shot-1.png']);

  for (const n of rec.images) {
    const img = JSON.parse(kv.store.get(`invite-listing-img:${listing.id}:${n}`));
    assert.equal(img.dataBase64, b64(40), n);
  }
  assert.deepEqual(stagedKeys(kv), [], 'the staged copies are deleted, last');
});

test('a bound login is stored as the account NUMBER plus the login, on both the invite and the listing', async () => {
  const kv = seedKv();
  const r = await post(kv, SAVE({ githubLogin: '@sam-dev' }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.listing.bound, true);
  assert.equal(r.body.listing.boundLogin, 'Sam-Dev', 'GitHub\'s own casing, from the lookup');
  const inv = JSON.parse(kv.store.get(inviteKey(r.body.code)));
  assert.equal(inv.boundGithubId, '5551234');
  assert.equal(inv.boundLogin, 'Sam-Dev');
  const rec = JSON.parse(kv.store.get(`invite-listing:${r.body.listing.id}`));
  assert.equal(rec.boundGithubId, '5551234');
});

test('an unknown or malformed login is a 400 and writes nothing; GitHub being down is a 502 and writes nothing', async () => {
  for (const [login, status, error, lookup] of [
    ['nobody-here', 400, 'unknown_github_login', lookupUser],
    ['not a login', 400, 'bad_github_login', lookupUser],
    ['sam-dev', 502, 'lookup_failed', async () => ({ ok: false, status: 502, error: 'lookup_failed', message: 'GitHub could not be reached.' })],
  ]) {
    const kv = seedKv();
    const before = stagedKeys(kv);
    const r = await post(kv, SAVE({ githubLogin: login }), { lookupUser: lookup });
    assert.equal(r.status, status, login);
    assert.equal(r.body.error, error, login);
    assert.deepEqual(prepKeys(kv), [], `${login}: nothing written`);
    assert.deepEqual(stagedKeys(kv), before, `${login}: the staged images are left for the retry`);
  }
});

test('a referenced image that was never staged is a 400 naming it, and nothing is written', async () => {
  const kv = fakeKv({ 'coupons:config': COUPONS, ...Object.fromEntries([staged('icon.png'), staged('cover.webp')]) });
  const r = await post(kv, SAVE());
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'image_missing');
  assert.deepEqual(r.body.missing, ['shot-1.png']);
  assert.deepEqual(prepKeys(kv), []);
  assert.equal(stagedKeys(kv).length, 2, 'the two images that were staged are still there');
});

test('thirteen images are refused (twelve is the most a claim can carry), and nothing is written', async () => {
  const names = Array.from({ length: 13 }, (_, i) => `shot-${i}.png`);
  const kv = fakeKv({ 'coupons:config': COUPONS, ...Object.fromEntries(names.map((n) => staged(n))) });
  const body = names.map((n) => `![s](./images/${n})`).join('\n');
  const r = await post(kv, SAVE({ draft: DRAFT({ body }, { icon: './images/shot-0.png', featuredImage: './images/shot-1.png' }) }));
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'invalid');
  assert.match(r.body.message, /at most 12 images/);
  assert.deepEqual(prepKeys(kv), []);
});

test('amendment 5: a permalink the site already uses is a 409, the tree is read UNCACHED, and the staged images survive', async () => {
  const kv = seedKv();
  const before = stagedKeys(kv);
  const readTree = treeWith(['surfacedby']);
  const r = await post(kv, SAVE(), { readTree });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'slug_taken');
  assert.equal(readTree.calls[0].useCache, false, 'a cached minute is exactly when two people pick the same name');
  assert.deepEqual(prepKeys(kv), [], 'no invite, no listing, no listing image');
  assert.deepEqual(stagedKeys(kv), before, 'the draftimg keys are intact, so the retry after a rename still finds them');
});

test('a permalink another UNCLAIMED prepared listing holds is a 409 too; a claimed one is left to the tree check', async () => {
  const kv = seedKv({ 'invite-listing:ABCDEFGHJKMNPQRS': JSON.stringify({ id: 'ABCDEFGHJKMNPQRS', slug: 'surfacedby', claimedAt: null }) });
  const r = await post(kv, SAVE());
  assert.equal(r.status, 409);
  assert.match(r.body.message, /Another prepared listing/);

  const kv2 = seedKv({ 'invite-listing:ABCDEFGHJKMNPQRS': JSON.stringify({ id: 'ABCDEFGHJKMNPQRS', slug: 'surfacedby', claimedAt: '2026-09-01T00:00:00.000Z' }) });
  assert.equal((await post(kv2, SAVE())).status, 200);
});

test('the content tree being unreadable refuses the save rather than skipping the check', async () => {
  const kv = seedKv();
  const r = await post(kv, SAVE(), { readTree: async () => { throw new Error('git trees 502'); } });
  assert.equal(r.status, 502);
  assert.equal(r.body.error, 'tree_unavailable');
  assert.deepEqual(prepKeys(kv), []);
});

test('amendment 8: javascript: and data: links are refused at save, in every URL field', async () => {
  for (const fm of [
    { links: [{ label: 'Site', url: 'javascript:alert(1)' }] },
    { links: [{ label: 'Site', url: 'data:text/html,<script>alert(1)</script>' }] },
    { pricingUrl: 'javascript:alert(1)' },
    { video: 'data:text/html,x' },
    { newsFeed: 'http://example.com/feed.xml' },
  ]) {
    const kv = seedKv();
    const r = await post(kv, SAVE({ draft: DRAFT({}, fm) }));
    assert.equal(r.status, 400, JSON.stringify(fm));
    assert.equal(r.body.error, 'invalid');
    assert.ok(Array.isArray(r.body.issues) && r.body.issues.length, 'the issues are listed for the editor');
    assert.deepEqual(prepKeys(kv), []);
  }
});

test('members-only gating and a type other than project are refused', async () => {
  const kv = seedKv();
  assert.equal((await post(kv, SAVE({ draft: DRAFT({ body: 'Public.\n\n<!-- members-only -->\n\nSecret.' }) }))).body.error, 'invalid');
  assert.equal((await post(kv, SAVE({ draft: DRAFT({}, { encryptedBody: 'x.enc' }) }))).body.error, 'invalid');
  assert.equal((await post(kv, SAVE({ draft: DRAFT({ type: 'post' }) }))).body.error, 'unsupported_type');
  assert.equal((await post(kv, SAVE({ draft: DRAFT({ slug: 'Not A Slug' }) }))).body.error, 'bad_slug');
  assert.deepEqual(prepKeys(kv), []);
});

test('amendment 9: a listing too large to ever be claimed is refused at save with 413', async () => {
  const kv = seedKv();
  const r = await post(kv, SAVE({ draft: DRAFT({ body: `${'Long text. '.repeat(11_000)}\n\n![The dashboard](./images/shot-1.png)` }) }));
  assert.equal(r.status, 413);
  assert.equal(r.body.error, 'too_large');
  assert.deepEqual(prepKeys(kv), []);
});

test('the images together over the per-claim image budget are refused at save with 413', async () => {
  const names = ['a.png', 'b.png', 'c.png', 'd.png', 'e.png'];
  const kv = fakeKv({ 'coupons:config': COUPONS, ...Object.fromEntries(names.map((n) => staged(n, 1_000_000))) });
  const body = names.map((n) => `![s](./images/${n})`).join('\n');
  const r = await post(kv, SAVE({ draft: DRAFT({ body }, { icon: './images/a.png', featuredImage: './images/b.png' }) }));
  assert.equal(r.status, 413, JSON.stringify(r.body));
  assert.equal(r.body.error, 'too_large');
  assert.deepEqual(prepKeys(kv), []);
});

test('the category and licence are checked against the house lists; an unreadable list is a 503, not a pass', async () => {
  let kv = seedKv();
  let r = await post(kv, SAVE({ draft: DRAFT({}, { categories: ['devops', 'nope'] }) }));
  assert.equal(r.status, 400);
  assert.match(r.body.message, /not in the category tree/);

  kv = seedKv();
  r = await post(kv, SAVE({ draft: DRAFT({}, { license: 'WTFPL' }) }));
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'invalid');

  kv = seedKv();
  r = await post(kv, SAVE(), { loadHouse: async () => ({ ok: false, status: 502, body: {} }) });
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'house_unavailable');
  assert.deepEqual(prepKeys(kv), []);

  // No category and no licence: the house lists are not needed, and are not read.
  kv = seedKv();
  let reads = 0;
  r = await post(kv, SAVE({ draft: DRAFT({}, { categories: [] }) }), { loadHouse: async () => { reads += 1; return { ok: false }; } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(reads, 0);
});

test('the campaign must be active, and the greeting and message are required', async () => {
  for (const [body, status, error] of [
    [SAVE({ campaign: 'RETIRED' }), 400, 'unknown_campaign'],
    [SAVE({ campaign: 'NOSUCH' }), 400, 'unknown_campaign'],
    [SAVE({ recipientName: '   ' }), 400, 'recipient_required'],
    [SAVE({ message: '\n\n' }), 400, 'message_required'],
  ]) {
    const kv = seedKv();
    const r = await post(kv, body);
    assert.equal(r.status, status, error);
    assert.equal(r.body.error, error);
    assert.deepEqual(prepKeys(kv), []);
  }
  const noRegistry = fakeKv(Object.fromEntries([staged('icon.png')]));
  assert.equal((await post(noRegistry, SAVE())).status, 503, 'an unreadable campaign registry refuses rather than guessing');
});

test('a listing write that fails revokes the invitation it just minted and clears its images', async () => {
  const kv = seedKv();
  const failing = fakeKv(Object.fromEntries(kv.store), { failPut: (k) => k.startsWith('invite-listing:') });
  const r = await post(failing, SAVE());
  assert.equal(r.status, 503);
  const invites = [...failing.store.keys()].filter((k) => k.startsWith('invite:'));
  assert.equal(invites.length, 1);
  assert.equal(inviteState(JSON.parse(failing.store.get(invites[0])), NOW), INVITE_STATE.revoked, 'no live free-year link without its listing');
  assert.deepEqual([...failing.store.keys()].filter((k) => k.startsWith('invite-listing')), []);
  assert.equal(stagedKeys(failing).length, 3, 'the staged copies stay for the retry');
});

test('a body that is not JSON, or an unknown op, is a 400', async () => {
  const kv = seedKv();
  const raw = new Request('https://x/y', { method: 'POST', body: 'nope' });
  assert.equal((await membershipPreparedPost(raw, { SIGNUP_KV: kv }, deps())).status, 400);
  assert.equal((await post(kv, { op: 'publish' })).status, 400);
  assert.equal((await membershipPreparedPost(req(SAVE()), {}, deps())).status, 503, 'no store: unavailable, never a throw');
});

// Amendment 11: the tree and the house lists are read with the EXISTING readers (readContentTree, loadHouseYaml),
// not ported copies. This drives both for real through a fake GitHub, so a change to either reader is felt here.
test('the real content-tree and house-file readers are the ones used, through the App token', async () => {
  const kv = seedKv();
  const seen = [];
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64'); // JSON is valid YAML
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    seen.push({ u, auth: init.headers?.Authorization });
    if (u.includes('/git/trees/main')) {
      return { ok: true, status: 200, json: async () => ({ tree: [{ type: 'blob', path: 'members/hudson/projects/other/index.md' }] }) };
    }
    if (u.includes('/contents/house/taxonomy.yml')) return { ok: true, status: 200, json: async () => ({ content: enc(TAXONOMY) }) };
    if (u.includes('/contents/house/licenses.yml')) return { ok: true, status: 200, json: async () => ({ content: enc(LICENSES) }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const { readTree: _t, loadHouse: _h, ...rest } = deps();
  const r = await membershipPreparedPost(req(SAVE({ draft: DRAFT({}, { license: 'MIT' }) })), { SIGNUP_KV: kv }, { ...rest, fetchImpl, upstream: 'gbti-network/gbti.network' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(seen.some((s) => s.u.endsWith('/repos/gbti-network/gbti.network/git/trees/main?recursive=1')));
  assert.ok(seen.some((s) => s.u.includes('/contents/house/taxonomy.yml?ref=main')));
  assert.ok(seen.some((s) => s.u.includes('/contents/house/licenses.yml?ref=main')));
  assert.ok(seen.every((s) => s.auth === 'Bearer tok'), 'every read carries the installation token');
  assert.equal(kv.store.has('network:tree:v1'), false, 'the uncached read neither reads nor writes the tree cache');
});
