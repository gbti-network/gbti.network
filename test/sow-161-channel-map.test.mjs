// sow-161 B: the SUPERADMIN channel-map manager surface on the WEBSITE host. Two halves, both security-relevant:
//   1. the six config WRITES through membershipAdminAuthor (flag terms + the syndication/engagement config), each
//      pinned SUPERADMIN so an admin is refused at the endpoint floor and writes nothing; a bad value is a clean
//      400 out of the pure core; an already-satisfied edit is a no-op that opens no PR;
//   2. the six pool READS, which default to authorizeSuperadmin (a moderation blocklist + syndication config must
//      not be read by an admin), pass an injected authorize's result straight through, and read nothing when denied.
// All injectable (URL-matching fetch, stubbed authorize/limiter/signJwt): no network, no secrets. The drift guard
// in test/path-rank.test.mjs separately proves rankForPath agrees with each new CONFIG_OP row's superadmin rank.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  membershipAdminAuthor,
  membershipAdminContentChannelPool, membershipAdminModerationFlagPool, membershipAdminSyndicationTemplatePool,
  membershipAdminNewsEngagement, membershipAdminContentEngagement, membershipAdminSyndicationSettings,
} from '../workers/signup/membership-admin-author.mjs';

const env = {
  GITHUB_APP_ID: '123', GITHUB_APP_INSTALLATION_ID: '999', GITHUB_APP_PRIVATE_KEY: 'PEM',
  UPSTREAM_REPO: 'gbti-network/gbti.network', MEMBERSHIP_AUTHOR_ENABLED: 'true',
};
const fakeKv = () => { const m = new Map(); return { store: m, async get() { return null; }, async put(k, v) { m.set(k, v); } }; };
const signJwt = async () => 'fake.jwt.sig';
const allow = async () => ({ allowed: true });
const staffAdmin = async () => ({ ok: true, githubId: '2', role: 'admin' });
const staffSuper = async () => ({ ok: true, githubId: '1', role: 'superadmin' });
const denied = async () => ({ ok: false, status: 403, body: { error: 'forbidden', message: 'superadmin access is required' } });
const req = (body) => ({ headers: { get: () => 'Bearer tok' }, json: async () => body });
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const deB64 = (s) => Buffer.from(String(s), 'base64').toString('utf8');

const FLAGS_YML = 'lists:\n  profanity:\n    - existingword\n  political:\n    - somephrase\n';
const SYND_YML = 'syndication:\n  enabled: false\n  hold_minutes: 30\n';

// URL-matching GitHub fake serving BOTH the moderation-flags + syndication-config files on main; records writes.
function ghFetch(record, { flags = FLAGS_YML, synd = SYND_YML } = {}) {
  return async (url, init = {}) => {
    const method = init.method || 'GET';
    if (/\/access_tokens$/.test(url)) return { ok: true, status: 201, async json() { return { token: 'ghs_inst', expires_at: new Date(Date.now() + 3600e3).toISOString() }; } };
    if (/\/contents\/house\/moderation-flags\.yml\?ref=main$/.test(url) && method === 'GET') return { ok: true, status: 200, async json() { return { content: b64(flags) }; } };
    if (/\/contents\/house\/syndication-config\.yml\?ref=main$/.test(url) && method === 'GET') return { ok: true, status: 200, async json() { return { content: b64(synd) }; } };
    if (/\/contents\/house\/content-channels\.yml\?ref=main$/.test(url) && method === 'GET') return { ok: true, status: 200, async json() { return { content: b64('channels:\n  - category: ai\n    channelId: "123"\n') }; } };
    if (/\/git\/ref\/heads\/main$/.test(url)) return { ok: true, status: 200, async json() { return { object: { sha: 'mainsha' } }; } };
    if (/\/git\/refs$/.test(url) && method === 'POST') { record.push({ method, url, body: JSON.parse(init.body) }); return { ok: true, status: 201, async json() { return {}; } }; }
    if (/\/git\/refs\/heads\//.test(url) && method === 'PATCH') { record.push({ method, url, body: JSON.parse(init.body) }); return { ok: true, status: 200, async json() { return {}; } }; }
    if (/\/contents\/.+\?ref=/.test(url) && method === 'GET') return { ok: false, status: 404, async json() { return {}; } }; // no existing file on the work branch
    if (/\/contents\//.test(url) && method === 'PUT') { record.push({ method, url, body: JSON.parse(init.body) }); return { ok: true, status: 201, async json() { return {}; } }; }
    if (/\/pulls$/.test(url) && method === 'POST') { record.push({ method, url, body: JSON.parse(init.body) }); return { ok: true, status: 201, async json() { return { number: 42, html_url: 'https://x/pull/42' }; } }; }
    return { ok: false, status: 500, async json() { return {}; } };
  };
}
const run = (body, { fetchImpl, authorize = staffSuper, ...over } = {}) =>
  membershipAdminAuthor(req(body), env, { fetchImpl, authorize, kv: fakeKv(), limiter: allow, signJwt, ...over });
const putContent = (record) => { const p = record.find((c) => c.method === 'PUT'); return p ? deB64(p.body.content) : null; };

// ---- WRITES ----

test('flag-term-add (superadmin) adds the term server-side and opens a PR against moderation-flags.yml', async () => {
  const record = [];
  const r = await run({ action: 'flag-term-add', list: 'profanity', term: 'newword' }, { fetchImpl: ghFetch(record) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.number, 42);
  const put = record.find((c) => c.method === 'PUT');
  assert.match(put.url, /moderation-flags\.yml/);
  assert.match(putContent(record), /newword/, 'the new term is written');
  assert.match(putContent(record), /existingword/, 'the existing term is preserved');
});

test('flag-term-add is SUPERADMIN: an admin is refused at the floor and writes NOTHING', async () => {
  const record = [];
  const r = await run({ action: 'flag-term-add', list: 'profanity', term: 'newword' }, { fetchImpl: ghFetch(record), authorize: staffAdmin });
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.equal(record.length, 0, 'no branch, no PR, no write for an under-privileged caller');
});

test('flag-term-add is idempotent: re-adding an existing term is a 200 no-op with no PR', async () => {
  const record = [];
  const r = await run({ action: 'flag-term-add', list: 'profanity', term: 'existingword' }, { fetchImpl: ghFetch(record) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.noop, true);
  assert.equal(record.length, 0, 'an unchanged edit opens no PR');
});

test('flag-term-add into an UNKNOWN list is a clean 400 (the core rejects) and writes nothing', async () => {
  const record = [];
  const r = await run({ action: 'flag-term-add', list: 'not-a-list', term: 'x' }, { fetchImpl: ghFetch(record) });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.equal(record.length, 0);
});

test('news-engagement-set (superadmin) writes syndication-config.yml', async () => {
  const record = [];
  const r = await run({ action: 'news-engagement-set', enabled: true, openThreshold: 10, tier: 'paid' }, { fetchImpl: ghFetch(record) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const put = record.find((c) => c.method === 'PUT');
  assert.match(put.url, /syndication-config\.yml/);
  assert.match(putContent(record), /news_engagement/);
  assert.match(putContent(record), /open_threshold: 10/);
});

test('news-engagement-set is SUPERADMIN: an admin is refused and writes nothing', async () => {
  const record = [];
  const r = await run({ action: 'news-engagement-set', enabled: true }, { fetchImpl: ghFetch(record), authorize: staffAdmin });
  assert.equal(r.status, 403);
  assert.equal(record.length, 0);
});

test('news-engagement-set with an out-of-range threshold is a 400 from the core, no write', async () => {
  const record = [];
  const r = await run({ action: 'news-engagement-set', openThreshold: 99999 }, { fetchImpl: ghFetch(record) });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.equal(record.length, 0);
});

test('content-engagement-set (superadmin) writes syndication-config.yml', async () => {
  const record = [];
  const r = await run({ action: 'content-engagement-set', enabled: true, threshold: 5 }, { fetchImpl: ghFetch(record) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(putContent(record), /content_engagement/);
});

test('syndication-settings-set (superadmin) toggles a channel and writes the file', async () => {
  const record = [];
  const r = await run({ action: 'syndication-settings-set', enabled: true, channels: { discord: true } }, { fetchImpl: ghFetch(record) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const put = record.find((c) => c.method === 'PUT');
  assert.match(put.url, /syndication-config\.yml/);
  assert.match(putContent(record), /enabled: true/);
});

test('syndication-settings-set rejects an unknown channel (400 from the core)', async () => {
  const record = [];
  const r = await run({ action: 'syndication-settings-set', channels: { notarealchannel: true } }, { fetchImpl: ghFetch(record) });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.equal(record.length, 0);
});

test('syndication-templates-set (superadmin, BATCH) applies each edit to ONE file', async () => {
  const record = [];
  // A valid edit names a content TYPE (post/share/...) and a template; `channel` is optional (a per-channel override).
  const r = await run({ action: 'syndication-templates-set', edits: [{ type: 'post', template: 'Hello {title}' }, { type: 'share', channel: 'discord', template: 'Share: {title}' }] }, { fetchImpl: ghFetch(record) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const put = record.find((c) => c.method === 'PUT');
  assert.match(put.url, /syndication-config\.yml/);
  assert.match(putContent(record), /Hello \{title\}/);
  assert.match(putContent(record), /Share: \{title\}/, 'both batched edits landed in the one file');
});

test('syndication-templates-set with an EMPTY edits array is a 400 (nothing to do)', async () => {
  const record = [];
  const r = await run({ action: 'syndication-templates-set', edits: [] }, { fetchImpl: ghFetch(record) });
  assert.equal(r.status, 400);
  assert.equal(record.length, 0);
});

test('syndication-templates-set with a bad edit type is a 400 from the core, whole batch refused', async () => {
  const record = [];
  const r = await run({ action: 'syndication-templates-set', edits: [{ type: 'not-a-type', template: 'x' }] }, { fetchImpl: ghFetch(record) });
  assert.equal(r.status, 400);
  assert.equal(record.length, 0, 'no partial write: the file is serialized once, after all edits succeed');
});

// ---- READS ----

const poolReq = { headers: { get: () => 'Bearer tok' } };
const readEnv = { ...env };
const readDeps = (over = {}) => ({ fetchImpl: ghFetch([]), signJwt, ...over });

test('the six pool reads DEFAULT to authorizeSuperadmin (source guard: a moderation blocklist must not be admin-readable)', () => {
  const src = fs.readFileSync(fileURLToPath(new URL('../workers/signup/membership-admin-author.mjs', import.meta.url)), 'utf8');
  // All six reads route through loadForSuperadminRead; its authorize default is the single point of enforcement.
  const start = src.indexOf('async function loadForSuperadminRead(');
  assert.ok(start > -1, 'loadForSuperadminRead moved or was renamed');
  const head = src.slice(start, start + 400);
  assert.match(head, /authorize\s*=\s*authorizeSuperadmin/, 'the shared read helper must default to authorizeSuperadmin');
});

test('content-channel-pool read: superadmin gets the channels; a denied caller gets its status and reads nothing', async () => {
  const ok = await membershipAdminContentChannelPool(poolReq, readEnv, readDeps({ authorize: staffSuper }));
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.ok(Array.isArray(ok.body.channels));
  const record = [];
  const no = await membershipAdminContentChannelPool(poolReq, readEnv, { fetchImpl: ghFetch(record), signJwt, authorize: denied });
  assert.equal(no.status, 403);
});

test('moderation-flag-pool read returns the { lists } shape the manager renders', async () => {
  const r = await membershipAdminModerationFlagPool(poolReq, readEnv, readDeps({ authorize: staffSuper }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(r.body.lists).sort(), ['political', 'profanity']);
});

test('the syndication pool reads return their documented shapes', async () => {
  const tmpl = await membershipAdminSyndicationTemplatePool(poolReq, readEnv, readDeps({ authorize: staffSuper }));
  assert.equal(tmpl.status, 200);
  assert.ok(Array.isArray(tmpl.body.types) && Array.isArray(tmpl.body.channels));
  const news = await membershipAdminNewsEngagement(poolReq, readEnv, readDeps({ authorize: staffSuper }));
  assert.equal(news.status, 200);
  assert.ok(news.body.settings && Array.isArray(news.body.tiers));
  const ceng = await membershipAdminContentEngagement(poolReq, readEnv, readDeps({ authorize: staffSuper }));
  assert.equal(ceng.status, 200);
  assert.ok(Array.isArray(ceng.body.signals));
  const synd = await membershipAdminSyndicationSettings(poolReq, readEnv, readDeps({ authorize: staffSuper }));
  assert.equal(synd.status, 200);
  assert.ok(synd.body.settings && Array.isArray(synd.body.channelNames) && synd.body.settings.autoMatrix);
});
