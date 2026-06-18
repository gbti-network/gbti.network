// SOW-046 C: the curator-gated news -> Discord publish Worker endpoint + the authorizeCurator gate.
// The Discord bot token lives only in the Worker; the capability is re-checked server-side from the KV overrides
// mirror (admin/superadmin OR an explicit roles.yml curators: listing); the post is deduped on the news guid; an
// unmapped category fails closed (records nothing, posts nothing). Pure over injected deps; no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeCurator } from '../workers/signup/membership-admin.mjs';
import { membershipNewsPublish, NEWS_POSTED_KEY } from '../workers/signup/membership-news-publish.mjs';

const now = new Date('2026-06-18T00:00:00Z');
const req = (token, body) => ({
  headers: { get: (k) => (k === 'Authorization' && token ? `Bearer ${token}` : null) },
  json: async () => body,
});
// generatedAt just before `now` so the freshness check (age in [0, 48h]) passes.
const freshMirror = (overrides = {}) => ({
  generatedAt: new Date(now.getTime() - 60_000).toISOString(),
  roles: { superadmins: [{ github_id: '1' }], admins: [{ github_id: '2' }], moderators: [{ github_id: '3' }], curators: [{ github_id: '5' }] },
  bans: { bans: [] }, grandfathered: { grandfathered: [] },
  ...overrides,
});
const fetchUser = async (token) => {
  const map = { sa: '1', admin: '2', mod: '3', member: '9', curator: '5' };
  if (!map[token]) throw new Error('bad token');
  return { githubId: map[token], login: token };
};

// ---- authorizeCurator ----

test('authorizeCurator: admin/superadmin inherit it; an explicit curator passes; a plain member + moderator are forbidden', async () => {
  const env = { SIGNUP_KV: { get: async () => freshMirror() } };
  assert.equal((await authorizeCurator(req('sa'), env, { fetchUser, now })).ok, true);
  assert.equal((await authorizeCurator(req('admin'), env, { fetchUser, now })).ok, true);
  assert.equal((await authorizeCurator(req('curator'), env, { fetchUser, now })).ok, true);
  assert.equal((await authorizeCurator(req('mod'), env, { fetchUser, now })).status, 403);
  assert.equal((await authorizeCurator(req('member'), env, { fetchUser, now })).status, 403);
});

test('authorizeCurator: no token -> 401; a stale/missing/malformed mirror fails closed (403)', async () => {
  assert.equal((await authorizeCurator(req(null), { SIGNUP_KV: { get: async () => freshMirror() } }, { fetchUser, now })).status, 401);
  const stale = freshMirror({ generatedAt: new Date('2020-01-01').toISOString() });
  assert.equal((await authorizeCurator(req('curator'), { SIGNUP_KV: { get: async () => stale } }, { fetchUser, now })).status, 403);
  assert.equal((await authorizeCurator(req('curator'), { SIGNUP_KV: { get: async () => null } }, { fetchUser, now })).status, 403);
  const bad = freshMirror({ roles: [] }); // a bare array must not silently drop the gate
  assert.equal((await authorizeCurator(req('curator'), { SIGNUP_KV: { get: async () => bad } }, { fetchUser, now })).status, 403);
});

// ---- membershipNewsPublish ----

const okAuth = async () => ({ ok: true, githubId: '5', role: 'member', isCurator: true });
const denyAuth = async () => ({ ok: false, status: 403, body: { error: 'forbidden', message: 'news curator access is required' } });
const fakeKv = () => {
  const m = new Map();
  return { store: m, get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), put: async (k, v) => { m.set(k, v); } };
};
const NEWS_CHANNELS = JSON.stringify({ channels: [{ category: 'ai', channelId: '111222333444555666' }] });
// The CANONICAL upstream item (what the Worker resolves + trusts). The client posts only { guid, source }.
const canonical = { guid: 'https://example.com/a', category: 'ai', title: 'Big AI news', link: 'https://example.com/a', source: 'Example' };
const body = { guid: canonical.guid, source: 'Example' };
// findItem stub: returns the canonical item for its guid, else null (not in the feed window).
const findOk = async (_env, { guid }) => (guid === canonical.guid ? canonical : null);

test('membershipNewsPublish: a curator posts the CANONICAL item to its mapped channel and records the dedupe key', async () => {
  const kv = fakeKv();
  const posts = [];
  const discord = { postChannelMessage: async (channelId, content) => { posts.push({ channelId, content }); return { id: 'msg-1' }; } };
  const env = { NEWS_CHANNELS, DISCORD_BOT_TOKEN: 'bot' };
  const r = await membershipNewsPublish(req('curator', body), env, { authorize: okAuth, findItem: findOk, kv, discord, now: () => now.toISOString() });
  assert.equal(r.status, 200);
  assert.equal(r.body.posted, true);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].channelId, '111222333444555666');
  assert.match(posts[0].content, /Big AI news/);
  const rec = await kv.get(NEWS_POSTED_KEY(canonical.guid));
  assert.equal(rec.channelId, '111222333444555666');
  assert.equal(rec.messageId, 'msg-1');
  assert.equal(rec.by, '5');
});

test('membershipNewsPublish: the Worker ignores client-supplied metadata and posts the canonical title/category', async () => {
  const kv = fakeKv();
  const posts = [];
  const discord = { postChannelMessage: async (channelId, content) => { posts.push({ channelId, content }); return { id: 'm' }; } };
  const env = { NEWS_CHANNELS, DISCORD_BOT_TOKEN: 'bot' };
  // a curator tries to inject a fabricated title + a wrong category to mis-route; the Worker uses the canonical item
  const forged = { guid: canonical.guid, source: 'Example', title: 'FAKE @everyone breaking', category: 'blockchain', link: 'https://evil.example/x' };
  const r = await membershipNewsPublish(req('curator', forged), env, { authorize: okAuth, findItem: findOk, kv, discord, now: () => now.toISOString() });
  assert.equal(r.body.posted, true);
  assert.equal(posts[0].channelId, '111222333444555666', 'routed on the CANONICAL ai category, not the forged blockchain');
  assert.match(posts[0].content, /Big AI news/);
  assert.doesNotMatch(posts[0].content, /FAKE|evil\.example/, 'the forged title/link never reach Discord');
});

test('membershipNewsPublish: a guid not in the current feed -> 404, nothing posted', async () => {
  const kv = fakeKv();
  let calls = 0;
  const discord = { postChannelMessage: async () => { calls++; return { id: 'x' }; } };
  const env = { NEWS_CHANNELS, DISCORD_BOT_TOKEN: 'bot' };
  const r = await membershipNewsPublish(req('curator', { guid: 'https://example.com/ghost' }), env, { authorize: okAuth, findItem: findOk, kv, discord });
  assert.equal(r.status, 404);
  assert.equal(calls, 0);
});

test('membershipNewsPublish: a repeat publish of the same guid is idempotent (no second Discord post)', async () => {
  const kv = fakeKv();
  let calls = 0;
  const discord = { postChannelMessage: async () => { calls++; return { id: 'msg-1' }; } };
  const env = { NEWS_CHANNELS, DISCORD_BOT_TOKEN: 'bot' };
  const deps = { authorize: okAuth, findItem: findOk, kv, discord, now: () => now.toISOString() };
  await membershipNewsPublish(req('curator', body), env, deps);
  const r2 = await membershipNewsPublish(req('curator', body), env, deps);
  assert.equal(calls, 1, 'Discord is posted to exactly once for a guid');
  assert.equal(r2.body.posted, false);
  assert.equal(r2.body.alreadyPosted, true);
});

test('membershipNewsPublish: an unmapped (canonical) category fails closed (records nothing, posts nothing)', async () => {
  const kv = fakeKv();
  let calls = 0;
  const discord = { postChannelMessage: async () => { calls++; return { id: 'x' }; } };
  const env = { NEWS_CHANNELS, DISCORD_BOT_TOKEN: 'bot' };
  const bcItem = { ...canonical, category: 'blockchain' };
  const findBc = async () => bcItem;
  const r = await membershipNewsPublish(req('curator', { guid: bcItem.guid, source: 'Example' }), env, { authorize: okAuth, findItem: findBc, kv, discord, now: () => now.toISOString() });
  assert.equal(r.status, 200);
  assert.equal(r.body.posted, false);
  assert.equal(calls, 0);
  assert.equal(await kv.get(NEWS_POSTED_KEY(bcItem.guid)), null, 'nothing is recorded for an unmapped category');
});

test('membershipNewsPublish: a non-curator is forbidden before any feed/KV/Discord touch', async () => {
  let touched = false;
  const kv = { get: async () => { touched = true; return null; }, put: async () => { touched = true; } };
  const discord = { postChannelMessage: async () => { touched = true; return {}; } };
  const findItem = async () => { touched = true; return canonical; };
  const r = await membershipNewsPublish(req('member', body), { NEWS_CHANNELS, DISCORD_BOT_TOKEN: 'bot' }, { authorize: denyAuth, findItem, kv, discord });
  assert.equal(r.status, 403);
  assert.equal(touched, false);
});

test('membershipNewsPublish: a missing guid -> 400 (before the feed lookup)', async () => {
  const kv = fakeKv();
  let looked = false;
  const findItem = async () => { looked = true; return canonical; };
  const r = await membershipNewsPublish(req('curator', { source: 'Example' }), { NEWS_CHANNELS, DISCORD_BOT_TOKEN: 'bot' }, { authorize: okAuth, findItem, kv, discord: { postChannelMessage: async () => ({}) } });
  assert.equal(r.status, 400);
  assert.equal(looked, false);
});

test('membershipNewsPublish: a Discord failure -> 502 and no dedupe record (so a retry can still post)', async () => {
  const kv = fakeKv();
  const discord = { postChannelMessage: async () => { throw new Error('discord down'); } };
  const env = { NEWS_CHANNELS, DISCORD_BOT_TOKEN: 'bot' };
  const r = await membershipNewsPublish(req('curator', body), env, { authorize: okAuth, findItem: findOk, kv, discord, now: () => now.toISOString() });
  assert.equal(r.status, 502);
  assert.equal(await kv.get(NEWS_POSTED_KEY(canonical.guid)), null);
});
