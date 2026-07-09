// SOW-088: the superadmin "Manually Syndicate" rail. Fake KV + injected authorizer/poster; no network,
// no secrets. The gate, readiness, server-side render + sanitization, channel targeting, the adapter text
// override, the tracker record, and the no-body leak guard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleSyndicateNowInfo, handleSyndicateNow } from '../workers/signup/membership-syndicate-now.mjs';
import { SYND_CONFIG_KEY, SYND_CHANNELS_KEY } from '../workers/signup/syndication-store.mjs';

function fakeKV(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async get(key, type) { const v = store.get(key); return v === undefined ? null : (type === 'json' ? JSON.parse(v) : v); },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
    async list({ prefix = '' } = {}) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  };
}
const req = (body = null, method = 'POST') => ({ method, headers: { get: () => 'Bearer t' }, async json() { return body; } });
const superadmin = async () => ({ ok: true, githubId: '1', role: 'superadmin' });
const adminOnly = async () => ({ ok: true, githubId: '2', role: 'admin' });
const CFG = JSON.stringify({ syndication: { enabled: true, hold_minutes: 0, channels: { discord: true }, templates: { prompt: 'New prompt: {title} {url}' } } });
const CHANNELS = JSON.stringify({ channels: [{ category: 'ai', channelId: '111222333444555666' }] });
const ENV_DISCORD = { DISCORD_BOT_TOKEN: 'bot', DISCORD_CHANNEL_PROMPTS: '999' };
const ITEM = { source: 'prompt', targetSlug: 'ci-skill', targetType: 'prompt', author: 'atwellpub', title: 'CI Skill', url: 'https://gbti.network/prompts/ci-skill/', category: 'ai', visibility: 'public' };

test('both verbs are superadmin-only (an admin is 403)', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: CFG });
  const g = await handleSyndicateNowInfo(req(null, 'GET'), { SIGNUP_KV: kv }, { kv, authorize: adminOnly });
  assert.equal(g.status, 403);
  const p = await handleSyndicateNow(req({ destination: 'discord', item: ITEM, template: 'x', channelId: '111222333444555666' }), { SIGNUP_KV: kv }, { kv, authorize: adminOnly });
  assert.equal(p.status, 403);
});

test('GET: readiness (secrets decide), templates with defaults, the channel map, reddit pending', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: CFG, [SYND_CHANNELS_KEY]: CHANNELS });
  const r = await handleSyndicateNowInfo(req(null, 'GET'), { ...ENV_DISCORD, SIGNUP_KV: kv }, { kv, authorize: superadmin });
  assert.equal(r.status, 200);
  const byId = Object.fromEntries(r.body.destinations.map((d) => [d.id, d]));
  assert.equal(byId.discord.ready, true);
  assert.equal(byId.x.ready, false); // no X secrets in env
  assert.match(byId.reddit.reason, /SOW-088/);
  assert.equal(r.body.templates.prompt, 'New prompt: {title} {url}');
  assert.equal(r.body.templates.share, 'New {content-type} published by {member-discord-username}: "{title}" {url}'); // the SOW-088 default fills gaps
  assert.deepEqual(r.body.channelMap, [{ category: 'ai', channelId: '111222333444555666' }]);
  assert.equal(r.body.featured.prompt, '999');
});

test('POST discord: renders the edited template server-side (sanitized) and posts to the GIVEN channel', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: CFG });
  const calls = [];
  const postDiscord = async (channelId, item, { textOverride }) => { calls.push({ channelId, textOverride }); return { ok: true, id: 'm1', url: 'https://discord.com/x' }; };
  const evil = { ...ITEM, title: 'Ping @everyone <@123> now' };
  const r = await handleSyndicateNow(
    req({ destination: 'discord', item: evil, template: 'Hot: {title} -> {url}', channelId: '111222333444555666' }),
    { ...ENV_DISCORD, SIGNUP_KV: kv }, { kv, authorize: superadmin, now: () => 1000, postDiscord },
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.sent, true);
  assert.equal(calls[0].channelId, '111222333444555666');
  assert.match(calls[0].textOverride, /^Hot: /);
  assert.ok(!/@everyone\b/.test(calls[0].textOverride), 'mass ping neutralized');
  assert.ok(!/<@123>/.test(calls[0].textOverride), 'raw mention tokens stripped');
  // The tracker record landed as a terminal sent item with the manual actor + the channel record.
  const itemKey = [...kv.store.keys()].find((k) => k.startsWith('synd:item:'));
  const rec = JSON.parse(kv.store.get(itemKey));
  assert.equal(rec.status, 'sent');
  assert.equal(rec.trigger, 'manual');
  assert.equal(rec.manualBy, '1');
  assert.equal(rec.channels['discord:111222333444555666'].status, 'sent');
  assert.ok(!('body' in rec) && !('encryptedBody' in rec), 'no body ever reaches the tracker');
  // Dedupe pointer written once (absent before), so a later CI enqueue dedupes.
  assert.ok(kv.store.get('synd:dedupe:prompt:ci-skill'));
});

test('POST validations: reddit pending, unknown destination, missing template/channel, missing secrets', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: CFG });
  const deps = { kv, authorize: superadmin };
  assert.equal((await handleSyndicateNow(req({ destination: 'reddit', item: ITEM, template: 'x' }), { SIGNUP_KV: kv }, deps)).status, 400);
  assert.equal((await handleSyndicateNow(req({ destination: 'myspace', item: ITEM, template: 'x' }), { SIGNUP_KV: kv }, deps)).status, 400);
  assert.equal((await handleSyndicateNow(req({ destination: 'discord', item: ITEM, template: '' }), { SIGNUP_KV: kv }, deps)).status, 400);
  assert.equal((await handleSyndicateNow(req({ destination: 'discord', item: ITEM, template: 'x' }), { ...ENV_DISCORD, SIGNUP_KV: kv }, deps)).status, 400); // no channelId
  assert.equal((await handleSyndicateNow(req({ destination: 'discord', item: ITEM, template: 'x', channelId: '111222333444555666' }), { SIGNUP_KV: kv }, deps)).status, 409); // no bot token
  assert.equal((await handleSyndicateNow(req({ destination: 'x', item: ITEM, template: 'x' }), { SIGNUP_KV: kv }, deps)).status, 409); // no X secrets
  assert.equal((await handleSyndicateNow(req({ destination: 'discord', item: { ...ITEM, source: 'page' }, template: 'x', channelId: '111222333444555666' }), { ...ENV_DISCORD, SIGNUP_KV: kv }, deps)).status, 400); // bad type
});

test('POST text adapter: receives the pre-rendered override; a failed post records failed + 502', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: CFG });
  const seen = [];
  const adapters = { x: { name: 'x', enabled: () => true, post: async (it) => { seen.push(it.textOverride); return { ok: true, id: 't1', url: 'https://x.com/t1' }; } } };
  const env = { X_API_KEY: 'k', X_API_SECRET: 's', X_ACCESS_TOKEN: 'a', X_ACCESS_SECRET: 'a2', SIGNUP_KV: kv };
  const ok = await handleSyndicateNow(req({ destination: 'x', item: ITEM, template: '{title} {url}' }), env, { kv, authorize: superadmin, adapters });
  assert.equal(ok.status, 200);
  assert.match(seen[0], /^CI Skill https:/);
  const failing = { x: { name: 'x', enabled: () => true, post: async () => ({ ok: false, error: 'rate limited' }) } };
  const bad = await handleSyndicateNow(req({ destination: 'x', item: ITEM, template: '{title}' }), env, { kv, authorize: superadmin, adapters: failing });
  assert.equal(bad.status, 502);
  const failedRec = [...kv.store.keys()].filter((k) => k.startsWith('synd:item:')).map((k) => JSON.parse(kv.store.get(k))).find((r) => r.status === 'failed');
  assert.equal(failedRec.channels.x.status, 'failed');
});

// SOW-088 follow-ups: the author's REAL Discord mention resolves via github login -> github_id -> the
// Stripe registry's discord_user_id (fail-soft), and a secondary channel receives the Discord FORWARD of
// the original post (never un-sending the primary on a forward failure).
test('discord: the author mention resolves from the registry and the forward hits the secondary channel', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: CFG });
  const posts = [];
  const postDiscord = async (channelId, item, { textOverride }) => { posts.push({ channelId, textOverride, mention: item.mention }); return { ok: true, id: 'msg9', url: 'https://discord.com/m9' }; };
  const forwards = [];
  const makeDiscord = () => ({ forwardChannelMessage: async (to, ref) => { forwards.push({ to, ref }); return { id: 'fwd1' }; } });
  const fetchImpl = async (url) => {
    if (String(url).startsWith('https://api.github.com/users/')) return { ok: true, async json() { return { id: 2002207 }; } };
    throw new Error(`unexpected fetch ${url}`);
  };
  const makeStripe = () => ({ findCustomerByGithubId: async (id) => (id === '2002207' ? { metadata: { discord_user_id: '777888999000' } } : null) });
  const env = { ...ENV_DISCORD, STRIPE_SECRET_KEY: 'rk', DISCORD_GUILD_ID: 'g1', SIGNUP_KV: kv };
  const r = await handleSyndicateNow(
    req({ destination: 'discord', item: ITEM, template: 'By {member-discord-username}: {title}', channelId: '111222333444555666', forwardChannelId: '999888777666555444' }),
    env, { kv, authorize: superadmin, now: () => 1000, postDiscord, makeDiscord, makeStripe, fetchImpl },
  );
  assert.equal(r.status, 200);
  assert.equal(posts[0].mention, '<@777888999000>'); // the registry mention reached the renderer
  assert.match(posts[0].textOverride, /^By <@777888999000>: CI Skill$/);
  assert.deepEqual(forwards[0], { to: '999888777666555444', ref: { messageId: 'msg9', fromChannelId: '111222333444555666', guildId: 'g1' } });
  assert.deepEqual(r.body.forwarded, { channelId: '999888777666555444', id: 'fwd1' });
  const rec = JSON.parse(kv.store.get([...kv.store.keys()].find((k) => k.startsWith('synd:item:'))));
  assert.equal(rec.channels['discord-forward:999888777666555444'].status, 'sent');
});

test('discord: the GUILD member search resolves the mention when the registry has no customer', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: CFG });
  const posts = [];
  const postDiscord = async (channelId, item, { textOverride }) => { posts.push({ textOverride }); return { ok: true, id: 'm', url: 'u' }; };
  const makeDiscord = () => ({
    searchGuildMembers: async (guild, q) => (q === 'atwellpub' ? [{ user: { id: '424242424242', username: 'atwellpub' } }] : []),
    forwardChannelMessage: async () => ({ id: 'f' }),
  });
  const fetchImpl = async (url) => (String(url).startsWith('https://api.github.com/') ? { ok: true, async json() { return { id: 2002207 }; } } : (() => { throw new Error('no'); })());
  const makeStripe = () => ({ findCustomerByGithubId: async () => null }); // the registry misses (status: none)
  const env = { ...ENV_DISCORD, STRIPE_SECRET_KEY: 'rk', DISCORD_GUILD_ID: 'g1', SIGNUP_KV: kv };
  const r = await handleSyndicateNow(
    req({ destination: 'discord', item: ITEM, template: 'By {member-discord-username}', channelId: '111222333444555666' }),
    env, { kv, authorize: superadmin, now: () => 1000, postDiscord, makeDiscord, makeStripe, fetchImpl },
  );
  assert.equal(r.status, 200);
  assert.equal(posts[0].textOverride, 'By <@424242424242>'); // the guild search produced a REAL mention
});

test('discord: a mention-resolution miss falls back to the text username; a forward failure never un-sends', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: CFG });
  const posts = [];
  const postDiscord = async (channelId, item, { textOverride }) => { posts.push({ textOverride }); return { ok: true, id: 'msg1', url: 'u' }; };
  const makeDiscord = () => ({ searchGuildMembers: async () => [], forwardChannelMessage: async () => { throw new Error('missing access'); } });
  const fetchImpl = async () => ({ ok: false, status: 404 }); // the GitHub lookup misses
  const makeStripe = () => ({ findCustomerByGithubId: async () => null });
  const env = { ...ENV_DISCORD, STRIPE_SECRET_KEY: 'rk', SIGNUP_KV: kv };
  const r = await handleSyndicateNow(
    req({ destination: 'discord', item: ITEM, template: 'By {member-discord-username}', channelId: '111222333444555666', forwardChannelId: '999888777666555444' }),
    env, { kv, authorize: superadmin, now: () => 1000, postDiscord, makeDiscord, makeStripe, fetchImpl },
  );
  assert.equal(r.status, 200); // the primary send survives the forward failure
  assert.match(posts[0].textOverride, /^By @.?atwellpub$/);
  assert.match(r.body.forwarded.error, /missing access/);
  const rec = JSON.parse(kv.store.get([...kv.store.keys()].find((k) => k.startsWith('synd:item:'))));
  assert.equal(rec.status, 'sent');
  assert.equal(rec.channels['discord-forward:999888777666555444'].status, 'failed');
});
