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
