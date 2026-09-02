// sow-161: the server-side admin mutation endpoint (workers/signup/membership-admin-author.mjs), increment 1:
// content moderation. All injectable (fake KV, URL-matching fetch, stubbed authorize/limiter/signJwt): no network,
// no secrets. The security-relevant paths mirror the adversarial review: non-staff denied, unsupported action,
// a GOVERNANCE-file path rejected (a moderator cannot rewrite roles.yml via this endpoint), the server-inserted
// caller github_id in the branch, the server-computed status flip, remove = delete, and the already-in-state no-op.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { membershipAdminAuthor, membershipAdminQuotePool, membershipAdminNewsSourcePool, membershipAdminCouponPool } from '../workers/signup/membership-admin-author.mjs';

const env = {
  GITHUB_APP_ID: '123', GITHUB_APP_INSTALLATION_ID: '999', GITHUB_APP_PRIVATE_KEY: 'PEM',
  UPSTREAM_REPO: 'gbti-network/gbti.network', MEMBERSHIP_AUTHOR_ENABLED: 'true',
};
const fakeKv = () => { const m = new Map(); return { store: m, async get() { return null; }, async put(k, v) { m.set(k, v); } }; };
// sow-213 Step 3: governance (ban/unban/grandfather/ungrandfather) is KV-native now, so the endpoint reads the
// overrides mirror from KV instead of a git file. This fake seeds that mirror (returned for OVERRIDES_KEY 'json')
// and records puts, so a gov test asserts the mirror mutation + NO git PR. A JSON round-trip on read keeps the
// seed immutable across calls.
const OVERRIDES_KEY = 'overrides:mirror';
const mirror = (over = {}) => ({ generatedAt: '2026-08-29T00:00:00.000Z', roles: {}, bans: { bans: [] }, grandfathered: { grandfathered: [] }, ...over });
function kvWithOverrides(seed) {
  const store = new Map();
  return {
    store,
    async get(k, type) {
      if (k === OVERRIDES_KEY) return seed == null ? null : (type === 'json' ? JSON.parse(JSON.stringify(seed)) : JSON.stringify(seed));
      const v = store.get(k);
      return v === undefined ? null : v;
    },
    async put(k, v) { store.set(k, v); },
  };
}
const signJwt = async () => 'fake.jwt.sig';
const allow = async () => ({ allowed: true });
const staffMod = async () => ({ ok: true, githubId: '3', role: 'moderator' }); // a moderator
const staffAdmin = async () => ({ ok: true, githubId: '2', role: 'admin' }); // an admin
const staffSuper = async () => ({ ok: true, githubId: '1', role: 'superadmin' }); // a superadmin
const denied = async () => ({ ok: false, status: 403, body: { error: 'forbidden', message: 'moderator access is required' } });
const req = (body) => ({ headers: { get: () => 'Bearer tok' }, json: async () => body });
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const deB64 = (s) => Buffer.from(String(s), 'base64').toString('utf8');

const ITEM = 'members/alice/posts/my-post/index.md';
const fileWithStatus = (status) => `---\ntitle: My Post\nauthor: alice\nstatus: ${status}\n---\n\nBody text.\n`;

/** URL-matching GitHub fake for the admin-author flow; records writes. `mainFile` is the current file text on main
 *  (or null -> 404). `onBranchSha` is the existing target sha on the work branch (undefined -> 404 there). */
function ghFetch(record, { mainFile = fileWithStatus('published'), govFile = 'bans: []\n', onBranchSha = 'oldsha', branchExists = false } = {}) {
  return async (url, init = {}) => {
    const method = init.method || 'GET';
    if (/\/access_tokens$/.test(url)) return { ok: true, status: 201, async json() { return { token: 'ghs_inst', expires_at: new Date(Date.now() + 3600e3).toISOString() }; } };
    if (/\/contents\/house\/(?:bans|grandfathered|roles|quotes|news-sources|coupons)\.yml\?ref=main$/.test(url) && method === 'GET') { // the governance/config file (increments 2-4)
      return govFile == null ? { ok: false, status: 404, async json() { return {}; } } : { ok: true, status: 200, async json() { return { content: b64(govFile) }; } };
    }
    if (/\/contents\/.+\?ref=main$/.test(url) && method === 'GET') {
      return mainFile == null ? { ok: false, status: 404, async json() { return {}; } } : { ok: true, status: 200, async json() { return { content: b64(mainFile) }; } };
    }
    if (/\/git\/ref\/heads\/main$/.test(url)) return { ok: true, status: 200, async json() { return { object: { sha: 'mainsha' } }; } };
    if (/\/git\/refs$/.test(url) && method === 'POST') {
      record.push({ method, url, body: JSON.parse(init.body) });
      return branchExists ? { ok: false, status: 422, async json() { return {}; } } : { ok: true, status: 201, async json() { return {}; } };
    }
    if (/\/git\/refs\/heads\//.test(url) && method === 'PATCH') { record.push({ method, url, body: JSON.parse(init.body) }); return { ok: true, status: 200, async json() { return {}; } }; }
    if (/\/contents\/.+\?ref=/.test(url) && method === 'GET') { // existing file on the work branch
      return onBranchSha ? { ok: true, status: 200, async json() { return { sha: onBranchSha }; } } : { ok: false, status: 404, async json() { return {}; } };
    }
    if (/\/contents\//.test(url) && (method === 'PUT' || method === 'DELETE')) { record.push({ method, url, body: JSON.parse(init.body) }); return { ok: true, status: 201, async json() { return {}; } }; }
    if (/\/pulls$/.test(url) && method === 'POST') { record.push({ method, url, body: JSON.parse(init.body) }); return { ok: true, status: 201, async json() { return { number: 42, html_url: 'https://x/pull/42' }; } }; }
    return { ok: false, status: 500, async json() { return {}; } };
  };
}
const run = (body, { fetchImpl, authorize = staffMod, ...over } = {}) =>
  membershipAdminAuthor(req(body), env, { fetchImpl, authorize, kv: fakeKv(), limiter: allow, signJwt, ...over });

test('sow-161: a non-staff caller is denied (403) and writes NOTHING', async () => {
  const record = [];
  const r = await run({ action: 'deplatform', path: ITEM }, { fetchImpl: ghFetch(record), authorize: denied });
  assert.equal(r.status, 403);
  assert.equal(record.length, 0, 'no branch, no PR, no write for a denied caller');
});

test('sow-161: an unknown action is 400', async () => {
  const record = [];
  const r = await run({ action: 'frobnicate', path: ITEM }, { fetchImpl: ghFetch(record) });
  assert.equal(r.status, 400);
  assert.equal(record.length, 0);
});

test('sow-161: a GOVERNANCE or non-content path is rejected (a moderator cannot target roles.yml/bans.yml)', async () => {
  for (const path of ['house/roles.yml', 'house/bans.yml', 'members/alice/collections.yml', 'members/alice/posts/x/../../../house/roles.yml', 'CODEOWNERS', '.github/workflows/x.yml']) {
    const record = [];
    const r = await run({ action: 'remove', path }, { fetchImpl: ghFetch(record) });
    assert.equal(r.status, 400, `path ${path} must be rejected`);
    assert.equal(record.length, 0, `path ${path} must write nothing`);
  }
});

test('sow-161: deplatform flips status to draft, server-side, on a hosted-admin branch keyed to the VERIFIED caller id', async () => {
  const record = [];
  const r = await run({ action: 'deplatform', path: ITEM }, { fetchImpl: ghFetch(record) });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.number, 42);
  const createRef = record.find((c) => /\/git\/refs$/.test(c.url));
  assert.equal(createRef.body.ref, 'refs/heads/hosted-admin/3/deplatform-my-post', 'branch encodes the moderator id (3) from authorize, not the body');
  const put = record.find((c) => c.method === 'PUT');
  assert.match(deB64(put.body.content), /status: draft/, 'the status was flipped to draft SERVER-SIDE');
  assert.doesNotMatch(deB64(put.body.content), /status: published/);
});

test('sow-161: republish flips status to published; remove deletes the file', async () => {
  const rec1 = [];
  const rp = await run({ action: 'republish', path: ITEM }, { fetchImpl: ghFetch(rec1, { mainFile: fileWithStatus('draft') }) });
  assert.equal(rp.status, 200);
  assert.match(deB64(rec1.find((c) => c.method === 'PUT').body.content), /status: published/);

  const rec2 = [];
  const rr = await run({ action: 'remove', path: ITEM }, { fetchImpl: ghFetch(rec2) });
  assert.equal(rr.status, 200);
  assert.ok(rec2.some((c) => c.method === 'DELETE'), 'remove issues a DELETE');
});

test('sow-161: deplatforming an already-draft item is a clean no-op (200, no PR)', async () => {
  const record = [];
  const r = await run({ action: 'deplatform', path: ITEM }, { fetchImpl: ghFetch(record, { mainFile: fileWithStatus('draft') }) });
  assert.equal(r.status, 200);
  assert.equal(r.body.noop, true);
  assert.ok(!record.some((c) => /\/pulls$/.test(c.url)), 'a no-op opens no PR');
});

test('sow-161: a target missing on main is 404 (nothing to moderate)', async () => {
  const record = [];
  const r = await run({ action: 'deplatform', path: ITEM }, { fetchImpl: ghFetch(record, { mainFile: null }) });
  assert.equal(r.status, 404);
  assert.equal(record.length, 0);
});

test('sow-161: the endpoint is inert unless MEMBERSHIP_AUTHOR_ENABLED is true', async () => {
  const r = await membershipAdminAuthor(req({ action: 'deplatform', path: ITEM }), { ...env, MEMBERSHIP_AUTHOR_ENABLED: 'false' }, { fetchImpl: ghFetch([]), authorize: staffMod, kv: fakeKv(), limiter: allow, signJwt });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'author_disabled');
});

// ---- sow-161 increment 2: member status (ban / unban / grandfather / ungrandfather), ADMIN-tier ----

test('sow-161: a MODERATOR cannot ban (403 insufficient role) and writes nothing', async () => {
  const record = [];
  const r = await run({ action: 'ban', githubId: '999' }, { fetchImpl: ghFetch(record), authorize: staffMod });
  assert.equal(r.status, 403);
  assert.equal(record.length, 0, 'a moderator is rejected at the endpoint before any read/write');
});

test('sow-213: an admin ban is KV-native: it writes the overrides mirror and opens NO git PR (behaviour change, house/bans.yml is deleted)', async () => {
  // BEHAVIOUR CHANGE recorded, not edited green: through Phase 2b a ban wrote house/bans.yml on a hosted-admin
  // branch AND dual-wrote KV. Step 3 deletes the file, so a ban is KV-ONLY: no branch, no PR, the mirror is the
  // record. Person-keyed entitlement state must not live in the public repo.
  const record = [];
  const kv = kvWithOverrides(mirror());
  const r = await run({ action: 'ban', githubId: '999', reason: 'spam' }, { fetchImpl: ghFetch(record), kv, authorize: staffAdmin });
  assert.equal(r.status, 200);
  assert.equal(r.body.kvWritten, true);
  assert.ok(!record.some((c) => /\/pulls$/.test(c.url)), 'no PR is opened');
  assert.ok(!record.some((c) => /\/git\/refs$/.test(c.url)), 'no branch is created');
  const written = JSON.parse(kv.store.get(OVERRIDES_KEY));
  const banned = written.bans.bans.find((e) => String(e.github_id) === '999');
  assert.ok(banned, 'the target id is written into the mirror bans section');
  assert.equal(banned.reason, 'spam');
  assert.equal(banned.source, 'kv', 'the new ban is marked source: kv, so a later unban can remove it');
});

test('sow-161: a non-numeric github_id for a membership action is 400', async () => {
  const record = [];
  const r = await run({ action: 'ban', githubId: 'not-a-number' }, { fetchImpl: ghFetch(record), authorize: staffAdmin });
  assert.equal(r.status, 400);
  assert.equal(record.length, 0);
});

test('sow-213: grandfather writes the mirror grandfathered section; unban removes from the mirror bans (KV-native, no PR)', async () => {
  const g = [];
  const gkv = kvWithOverrides(mirror());
  const rg = await run({ action: 'grandfather', githubId: '77' }, { fetchImpl: ghFetch(g), kv: gkv, authorize: staffAdmin });
  assert.equal(rg.status, 200);
  assert.equal(rg.body.kvWritten, true);
  assert.ok(!g.some((c) => /\/pulls$/.test(c.url)), 'grandfather opens no PR');
  const grant = JSON.parse(gkv.store.get(OVERRIDES_KEY)).grandfathered.grandfathered.find((e) => String(e.github_id) === '77');
  assert.ok(grant, 'the grant is written into the mirror');
  assert.equal(grant.source, 'kv');

  const u = [];
  const ukv = kvWithOverrides(mirror({ bans: { bans: [{ github_id: '999', reason: 'spam', at: '2026-01-01T00:00:00.000Z', source: 'kv' }] } }));
  const ru = await run({ action: 'unban', githubId: '999' }, { fetchImpl: ghFetch(u), kv: ukv, authorize: staffAdmin });
  assert.equal(ru.status, 200);
  assert.ok(!u.some((c) => /\/pulls$/.test(c.url)), 'unban opens no PR');
  assert.equal(JSON.parse(ukv.store.get(OVERRIDES_KEY)).bans.bans.length, 0, 'the unbanned id is removed from the mirror');
});

test('sow-213: banning an already-banned member is a clean no-op (200, no write, no PR)', async () => {
  const record = [];
  const kv = kvWithOverrides(mirror({ bans: { bans: [{ github_id: '999', reason: 'spam', at: '2026-01-01T00:00:00.000Z', source: 'kv' }] } }));
  const r = await run({ action: 'ban', githubId: '999' }, { fetchImpl: ghFetch(record), kv, authorize: staffAdmin });
  assert.equal(r.status, 200);
  assert.equal(r.body.noop, true);
  assert.equal(kv.store.get(OVERRIDES_KEY), undefined, 'a no-op writes nothing to the mirror (and never a moderation log)');
  assert.ok(!record.some((c) => /\/pulls$/.test(c.url)), 'a no-op opens no PR');
});

test('sow-213: an unavailable overrides mirror fails CLOSED (503), never silently resetting the bans', async () => {
  // BEHAVIOUR CHANGE: the source of truth is the KV mirror now, not a git file. A malformed mirror (no
  // generatedAt) is refused, never fabricated into a one-entry blob that would fail OPEN for everyone missing.
  const record = [];
  const kv = kvWithOverrides({ roles: {} }); // no generatedAt = malformed/unavailable
  const r = await run({ action: 'ban', githubId: '999' }, { fetchImpl: ghFetch(record), kv, authorize: staffAdmin });
  assert.equal(r.status, 503);
  assert.equal(kv.store.get(OVERRIDES_KEY), undefined, 'no write when the mirror is unavailable');
});

test('sow-213: a KV read that THROWS fails CLOSED (503), never wiping the bans', async () => {
  const record = [];
  const kv = { store: new Map(), async get() { throw new Error('kv down'); }, async put(k, v) { this.store.set(k, v); } };
  const r = await run({ action: 'ban', githubId: '999' }, { fetchImpl: ghFetch(record), kv, authorize: staffAdmin });
  assert.equal(r.status, 503);
  assert.equal(kv.store.get(OVERRIDES_KEY), undefined, 'a read throw writes nothing');
});

test('sow-213: an ABSENT mirror is REFUSED (503), NOT a fresh start (behaviour change: never fabricate an override set)', async () => {
  // BEHAVIOUR CHANGE recorded: with a git file, a 404 was a legitimate fresh start and the ban landed. With the
  // KV mirror as the sole source, an absent mirror must be refused: fabricating one would seed a blob holding a
  // single ban that every reader trusts as the COMPLETE override set, failing OPEN for everyone missing from it.
  const record = [];
  const kv = kvWithOverrides(null); // get returns null = no mirror
  const r = await run({ action: 'ban', githubId: '999' }, { fetchImpl: ghFetch(record), kv, authorize: staffAdmin });
  assert.equal(r.status, 503);
  assert.equal(kv.store.get(OVERRIDES_KEY), undefined, 'an absent mirror is not fabricated');
});

// ---- sow-161 increment 3: role assignment (house/roles.yml = ROOT OF TRUST), SUPERADMIN-tier ----

const ROLES_YML = 'superadmins: []\nadmins: []\nmoderators: []\n';

test('sow-161: an ADMIN cannot assign roles (403) and writes nothing (roles.yml is superadmin-only)', async () => {
  const record = [];
  const r = await run({ action: 'role', githubId: '55', role: 'moderator' }, { fetchImpl: ghFetch(record, { govFile: ROLES_YML }), authorize: staffAdmin });
  assert.equal(r.status, 403);
  assert.equal(record.length, 0, 'an admin is rejected at the endpoint before touching roles.yml');
});

test('sow-161: a superadmin assigns a role -> writes house/roles.yml on a caller-keyed branch', async () => {
  const record = [];
  const r = await run({ action: 'role', githubId: '55', role: 'moderator' }, { fetchImpl: ghFetch(record, { govFile: ROLES_YML }), authorize: staffSuper });
  assert.equal(r.status, 200);
  assert.equal(r.body.number, 42);
  const createRef = record.find((c) => /\/git\/refs$/.test(c.url));
  assert.equal(createRef.body.ref, 'refs/heads/hosted-admin/1/role-55', 'branch = the superadmin id (1) + role-<targetId>');
  const put = record.find((c) => c.method === 'PUT');
  assert.match(put.url, /house\/roles\.yml$/);
  assert.match(deB64(put.body.content), /github_id: '?55'?/, 'the target is written into roles.yml');
});

test('sow-161: an invalid role value is 400 (never reaches roles.yml)', async () => {
  const record = [];
  const r = await run({ action: 'role', githubId: '55', role: 'root' }, { fetchImpl: ghFetch(record, { govFile: ROLES_YML }), authorize: staffSuper });
  assert.equal(r.status, 400);
  assert.equal(record.length, 0);
});

test('sow-161: a non-numeric github_id for role assignment is 400', async () => {
  const record = [];
  const r = await run({ action: 'role', githubId: 'x', role: 'admin' }, { fetchImpl: ghFetch(record, { govFile: ROLES_YML }), authorize: staffSuper });
  assert.equal(r.status, 400);
  assert.equal(record.length, 0);
});

// ---- sow-161 increment 4: the QUOTES config manager (admin-tier; leading comment preserved) ----

const QUOTES_YML = '# Splash quotes (curated)\n# one per entry\nquotes: []\n';

test('sow-161: a MODERATOR cannot add a quote (403); config is admin-tier', async () => {
  const record = [];
  const r = await run({ action: 'quote-add', text: 'Hello world', author: 'Ada' }, { fetchImpl: ghFetch(record, { govFile: QUOTES_YML }), authorize: staffMod });
  assert.equal(r.status, 403);
  assert.equal(record.length, 0);
});

test('sow-161: an admin quote-add writes house/quotes.yml PRESERVING the leading comment, on a text-slug branch', async () => {
  const record = [];
  const r = await run({ action: 'quote-add', text: 'Hello world', author: 'Ada' }, { fetchImpl: ghFetch(record, { govFile: QUOTES_YML }), authorize: staffAdmin });
  assert.equal(r.status, 200);
  assert.equal(r.body.number, 42);
  const createRef = record.find((c) => /\/git\/refs$/.test(c.url));
  assert.equal(createRef.body.ref, 'refs/heads/hosted-admin/2/quote-add-hello-world', 'branch = admin id + quote-add-<textSlug>');
  const put = record.find((c) => c.method === 'PUT');
  assert.match(put.url, /house\/quotes\.yml$/);
  const content = deB64(put.body.content);
  assert.ok(content.startsWith('# Splash quotes (curated)'), 'the leading comment is preserved across the edit');
  assert.match(content, /Hello world/);
});

test('sow-161: an empty quote text is 400 (never touches quotes.yml)', async () => {
  const record = [];
  const r = await run({ action: 'quote-add', text: '   ' }, { fetchImpl: ghFetch(record, { govFile: QUOTES_YML }), authorize: staffAdmin });
  assert.equal(r.status, 400);
  assert.equal(record.length, 0);
});

test('sow-161: adding an already-present quote is a clean no-op (200, no PR)', async () => {
  const record = [];
  const r = await run({ action: 'quote-add', text: 'Hello world', author: 'Ada' }, { fetchImpl: ghFetch(record, { govFile: '# c\nquotes:\n  - text: Hello world\n    author: Ada\n    enabled: true\n' }), authorize: staffAdmin });
  assert.equal(r.status, 200);
  assert.equal(r.body.noop, true);
  assert.ok(!record.some((c) => /\/pulls$/.test(c.url)));
});

test('sow-161: quote-toggle disables an existing quote; quote-remove deletes it', async () => {
  const seed = '# c\nquotes:\n  - text: Hello world\n    author: Ada\n    enabled: true\n';
  const t = [];
  const rt = await run({ action: 'quote-toggle', text: 'Hello world', enabled: false }, { fetchImpl: ghFetch(t, { govFile: seed }), authorize: staffAdmin });
  assert.equal(rt.status, 200);
  assert.match(deB64(t.find((c) => c.method === 'PUT').body.content), /enabled: false/);
  const rm = [];
  const rr = await run({ action: 'quote-remove', text: 'Hello world' }, { fetchImpl: ghFetch(rm, { govFile: seed }), authorize: staffAdmin });
  assert.equal(rr.status, 200);
  assert.match(rm.find((c) => c.method === 'PUT').url, /house\/quotes\.yml$/);
});

test('sow-161: the quote-pool read is admin-gated and returns the FULL pool (incl. disabled)', async () => {
  const seed = '# c\nquotes:\n  - text: A\n    enabled: true\n  - text: B\n    enabled: false\n';
  const okr = await membershipAdminQuotePool(req({}), env, { fetchImpl: ghFetch([], { govFile: seed }), authorize: staffAdmin, signJwt });
  assert.equal(okr.status, 200);
  assert.equal(okr.body.quotes.length, 2, 'the disabled quote is included (the splash JSON omits it)');
  const denied = await membershipAdminQuotePool(req({}), env, { fetchImpl: ghFetch([], { govFile: seed }), authorize: staffMod ? (async () => ({ ok: false, status: 403, body: { error: 'forbidden' } })) : undefined, signJwt });
  assert.equal(denied.status, 403);
});

// ---- sow-161 increment 4 (sub-slice 2): the NEWS-SOURCE config manager (admin-tier; id/url keyed) ----

const NEWS_YML = '# News sources (curated)\nsources: []\n';

test('sow-161: a MODERATOR cannot add a news source (403)', async () => {
  const record = [];
  const r = await run({ action: 'news-source-add', name: 'Hacker News', url: 'https://hnrss.org/frontpage' }, { fetchImpl: ghFetch(record, { govFile: NEWS_YML }), authorize: staffMod });
  assert.equal(r.status, 403);
  assert.equal(record.length, 0);
});

test('sow-161: an admin news-source-add writes house/news-sources.yml preserving the leading comment', async () => {
  const record = [];
  const r = await run({ action: 'news-source-add', name: 'Hacker News', url: 'https://hnrss.org/frontpage' }, { fetchImpl: ghFetch(record, { govFile: NEWS_YML }), authorize: staffAdmin });
  assert.equal(r.status, 200);
  assert.equal(r.body.number, 42);
  const put = record.find((c) => c.method === 'PUT');
  assert.match(put.url, /house\/news-sources\.yml$/);
  const content = deB64(put.body.content);
  assert.ok(content.startsWith('# News sources (curated)'), 'leading comment preserved');
  assert.match(content, /hnrss\.org/);
});

test('sow-161: a non-http(s) feed URL is rejected (400), and a missing name+id too', async () => {
  const rec1 = [];
  const r1 = await run({ action: 'news-source-add', name: 'Bad', url: 'javascript:alert(1)' }, { fetchImpl: ghFetch(rec1, { govFile: NEWS_YML }), authorize: staffAdmin });
  assert.equal(r1.status, 400);
  assert.equal(rec1.length, 0, 'a non-http url writes nothing');
  const rec2 = [];
  const r2 = await run({ action: 'news-source-add', url: 'https://ok.example/feed' }, { fetchImpl: ghFetch(rec2, { govFile: NEWS_YML }), authorize: staffAdmin });
  assert.equal(r2.status, 400, 'a source with neither name nor id is rejected');
});

test('sow-161: an over-long news-source name / description is REJECTED at the endpoint (no silent truncation)', async () => {
  // The pure core caps name at 80 and description at 120; the endpoint must reject over-long input rather than let
  // the core silently truncate it (the same UX bug the quotes review caught).
  const recN = [];
  const rN = await run({ action: 'news-source-add', name: 'x'.repeat(81), url: 'https://ok.example/feed' }, { fetchImpl: ghFetch(recN, { govFile: NEWS_YML }), authorize: staffAdmin });
  assert.equal(rN.status, 400, 'a name over 80 chars is rejected');
  assert.equal(recN.length, 0, 'an over-long name writes nothing');
  const recD = [];
  const rD = await run({ action: 'news-source-add', name: 'OK', url: 'https://ok.example/feed', description: 'y'.repeat(121) }, { fetchImpl: ghFetch(recD, { govFile: NEWS_YML }), authorize: staffAdmin });
  assert.equal(rD.status, 400, 'a description over 120 chars is rejected');
  assert.equal(recD.length, 0, 'an over-long description writes nothing');
});

test('sow-161: news-source-toggle / remove act by id on the sources file', async () => {
  const seed = '# c\nsources:\n  - id: hn\n    name: Hacker News\n    url: https://hnrss.org/frontpage\n    enabled: true\n';
  const t = [];
  const rt = await run({ action: 'news-source-toggle', id: 'hn', enabled: false }, { fetchImpl: ghFetch(t, { govFile: seed }), authorize: staffAdmin });
  assert.equal(rt.status, 200);
  assert.match(deB64(t.find((c) => c.method === 'PUT').body.content), /enabled: false/);
  const rm = [];
  const rr = await run({ action: 'news-source-remove', id: 'hn' }, { fetchImpl: ghFetch(rm, { govFile: seed }), authorize: staffAdmin });
  assert.equal(rr.status, 200);
  assert.match(rm.find((c) => c.method === 'PUT').url, /house\/news-sources\.yml$/);
});

test('sow-161: the news-source pool read is admin-gated and returns the FULL pool (incl disabled)', async () => {
  const seed = '# c\nsources:\n  - id: a\n    enabled: true\n  - id: b\n    enabled: false\n';
  const okr = await membershipAdminNewsSourcePool(req({}), env, { fetchImpl: ghFetch([], { govFile: seed }), authorize: staffAdmin, signJwt });
  assert.equal(okr.status, 200);
  assert.equal(okr.body.sources.length, 2);
  const denied = await membershipAdminNewsSourcePool(req({}), env, { fetchImpl: ghFetch([], { govFile: seed }), authorize: async () => ({ ok: false, status: 403, body: {} }), signJwt });
  assert.equal(denied.status, 403);
});

// ---- sow-161 increment 4 review fixes: endpoint validation matches the pure-core limits ----

test('sow-161: a quote over the core cap (280 text / 80 author) is REJECTED, not silently truncated', async () => {
  const rec1 = [];
  const r1 = await run({ action: 'quote-add', text: 'x'.repeat(281) }, { fetchImpl: ghFetch(rec1, { govFile: '# c\nquotes: []\n' }), authorize: staffAdmin });
  assert.equal(r1.status, 400);
  assert.equal(rec1.length, 0);
  const rec2 = [];
  const r2 = await run({ action: 'quote-add', text: 'ok', author: 'a'.repeat(81) }, { fetchImpl: ghFetch(rec2, { govFile: '# c\nquotes: []\n' }), authorize: staffAdmin });
  assert.equal(r2.status, 400);
});

test('sow-161: a non-kebab source id (trailing/consecutive hyphen) is REJECTED at the endpoint', async () => {
  for (const id of ['a-', 'a--b', '-a', 'A_B', 'a'.repeat(65)]) {
    const rec = [];
    const r = await run({ action: 'news-source-remove', id }, { fetchImpl: ghFetch(rec, { govFile: '# c\nsources: []\n' }), authorize: staffAdmin });
    assert.equal(r.status, 400, `id ${id} must be rejected`);
    assert.equal(rec.length, 0);
  }
});

// ---- sow-161 increment 4: coupons config manager (house/coupons.yml, admin-tier) ----

// sow-291 Phase 2: coupons are KV-native. house/coupons.yml has left the public repository, so the endpoint reads
// and writes coupons:config in KV instead of opening a git PR (the same inversion sow-213 made for governance).
// This fake seeds coupons:config (returned for the key on a 'json' read) and records puts, so a coupon test
// asserts the KV mutation + NO git PR. A JSON round-trip on read keeps the seed immutable across calls.
const COUPONS_KEY = 'coupons:config';
const couponsBlob = (coupons, generatedAt = '2026-08-29T00:00:00.000Z') => ({ generatedAt, coupons });
const COUPON_SEED = [{ code: 'EXISTING', id: 'EXISTING', freeDays: 365, active: true, note: 'seed', maxRedemptions: null, expiresAt: null }];
function kvWithCoupons(seed) {
  const store = new Map();
  return {
    store,
    async get(k, type) {
      if (k === COUPONS_KEY) return seed == null ? null : (type === 'json' ? JSON.parse(JSON.stringify(seed)) : JSON.stringify(seed));
      const v = store.get(k);
      return v === undefined ? null : v;
    },
    async put(k, v) { store.set(k, v); },
  };
}
const couponPut = (kv) => { const v = kv.store.get(COUPONS_KEY); return v === undefined ? null : JSON.parse(v); };

test('sow-161: a MODERATOR cannot add a coupon (403, admin-tier), and writes NOTHING', async () => {
  const record = [];
  const kv = kvWithCoupons(couponsBlob(COUPON_SEED));
  const r = await run({ action: 'coupon-add', code: 'NEWCODE', freeDays: 90 }, { fetchImpl: ghFetch(record), authorize: staffMod, kv });
  assert.equal(r.status, 403);
  assert.equal(record.length, 0);
  assert.equal(couponPut(kv), null, 'a denied caller writes nothing to KV');
});

test('sow-291 Phase 2: an admin coupon-add writes coupons:config in KV (source:kv), and opens NO git PR', async () => {
  const record = [];
  const kv = kvWithCoupons(couponsBlob(COUPON_SEED));
  const r = await run({ action: 'coupon-add', code: 'newcode', freeDays: 90, note: 'launch promo' }, { fetchImpl: ghFetch(record), authorize: staffAdmin, kv });
  assert.equal(r.status, 200);
  assert.equal(r.body.kvWritten, true);
  assert.equal(record.length, 0, 'no branch, no ref, no PR: the coupon write is KV-native');
  const blob = couponPut(kv);
  const added = blob.coupons.find((c) => c.code === 'NEWCODE');
  assert.ok(added, 'the code is normalized to upper-case by the core and written to KV');
  assert.equal(added.source, 'kv', 'a KV-native coupon is marked so the git mirror cannot clobber it (mergeCouponsList keeps source:kv)');
  assert.equal(blob.generatedAt, '2026-08-29T00:00:00.000Z', 'the admin write leaves generatedAt to the 6-hourly sync, so it cannot make a dead sync look alive');
});

test('sow-291 Phase 2: coupon-add is REFUSED (503) when the KV registry is absent (no fabricated one-coupon blob)', async () => {
  // Fail closed: a one-coupon blob written over an unreadable registry would read as the WHOLE registry and make
  // redemption reject every code missing from it. So an absent registry refuses the write rather than seeding it.
  const kv = kvWithCoupons(null);
  const r = await run({ action: 'coupon-add', code: 'NEWCODE', freeDays: 90 }, { fetchImpl: ghFetch([]), authorize: staffAdmin, kv });
  assert.equal(r.status, 503);
  assert.equal(couponPut(kv), null, 'nothing is written when the registry cannot be read');
});

test('sow-291 Phase 2: coupon-add of a DUPLICATE code is a 400 from the core (no KV write)', async () => {
  const kv = kvWithCoupons(couponsBlob(COUPON_SEED));
  const r = await run({ action: 'coupon-add', code: 'EXISTING', freeDays: 30 }, { fetchImpl: ghFetch([]), authorize: staffAdmin, kv });
  assert.equal(r.status, 400);
  assert.equal(couponPut(kv), null, 'a duplicate writes nothing');
});

test('sow-161: an over-long coupon note (>160) is REJECTED at the endpoint (no silent truncation)', async () => {
  const kv = kvWithCoupons(couponsBlob(COUPON_SEED));
  const r = await run({ action: 'coupon-add', code: 'NOTELONG', freeDays: 30, note: 'x'.repeat(161) }, { fetchImpl: ghFetch([]), authorize: staffAdmin, kv });
  assert.equal(r.status, 400);
  assert.equal(couponPut(kv), null);
});

test('sow-161: a bad coupon code shape is rejected (400) at the endpoint', async () => {
  for (const code of ['ab', 'has space', 'lower-hyphen', 'x'.repeat(33)]) {
    const kv = kvWithCoupons(couponsBlob(COUPON_SEED));
    const r = await run({ action: 'coupon-add', code, freeDays: 30 }, { fetchImpl: ghFetch([]), authorize: staffAdmin, kv });
    assert.equal(r.status, 400, `code "${code}" must be rejected`);
    assert.equal(couponPut(kv), null);
  }
});

test('sow-291 Phase 2: coupon-update deactivates an existing code in KV (source:kv), and opens NO git PR', async () => {
  const record = [];
  const kv = kvWithCoupons(couponsBlob(COUPON_SEED));
  const r = await run({ action: 'coupon-update', code: 'EXISTING', patch: { active: false } }, { fetchImpl: ghFetch(record), authorize: staffAdmin, kv });
  assert.equal(r.status, 200);
  assert.equal(r.body.kvWritten, true);
  assert.equal(record.length, 0);
  const updated = couponPut(kv).coupons.find((c) => c.code === 'EXISTING');
  assert.equal(updated.active, false);
  assert.equal(updated.source, 'kv', 'the updated entry is marked source:kv');
});

test('sow-161: coupon-update of an UNKNOWN code is a 400 (no KV write)', async () => {
  const kv = kvWithCoupons(couponsBlob(COUPON_SEED));
  const r = await run({ action: 'coupon-update', code: 'MISSINGCODE', patch: { active: false } }, { fetchImpl: ghFetch([]), authorize: staffAdmin, kv });
  assert.equal(r.status, 400);
  assert.equal(couponPut(kv), null);
});

test('sow-161: coupon-update with an empty/absent patch is a 400 (no KV write)', async () => {
  const kv = kvWithCoupons(couponsBlob(COUPON_SEED));
  const r = await run({ action: 'coupon-update', code: 'EXISTING' }, { fetchImpl: ghFetch([]), authorize: staffAdmin, kv });
  assert.equal(r.status, 400, 'no patch object -> rejected');
  assert.equal(couponPut(kv), null);
});

test('sow-291 Phase 2: the coupon pool read is admin-gated and returns the FULL registry from KV (incl inactive)', async () => {
  const kv = kvWithCoupons(couponsBlob([{ code: 'A', active: true }, { code: 'B', active: false }]));
  const okr = await membershipAdminCouponPool(req({}), env, { authorize: staffAdmin, kv });
  assert.equal(okr.status, 200);
  assert.equal(okr.body.coupons.length, 2);
  const denied = await membershipAdminCouponPool(req({}), env, { authorize: async () => ({ ok: false, status: 403, body: {} }), kv });
  assert.equal(denied.status, 403);
});

test('sow-291 Phase 2: the coupon pool read is NOT blanked by a stale registry (an admin must see it to fix it)', async () => {
  // A blob older than the 48h redemption gate would fail redemption CLOSED, but the manager reads it RAW so the
  // admin can still see and re-activate coupons precisely when the sync has gone stale.
  const stale = couponsBlob([{ code: 'A', active: true }], '2000-01-01T00:00:00.000Z');
  const okr = await membershipAdminCouponPool(req({}), env, { authorize: staffAdmin, kv: kvWithCoupons(stale) });
  assert.equal(okr.status, 200);
  assert.equal(okr.body.coupons.length, 1);
});
