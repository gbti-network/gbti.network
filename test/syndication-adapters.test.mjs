// SOW-058: the channel adapters + the run resolver. Fake fetch / fake Discord client; no network, no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDiscordAdapter, createDiscordCategoryAdapter } from '../clients/syndication/discord-channel.mjs';
import { createMastodonAdapter } from '../clients/syndication/mastodon.mjs';
import { createBlueskyAdapter } from '../clients/syndication/bluesky.mjs';
import { createXAdapter } from '../clients/syndication/x.mjs';
import { createLinkedinAdapter } from '../clients/syndication/linkedin.mjs';
import { resolveAdapterRun } from '../membership/syndication-adapters.mjs';
import { syndicationConfigFromParsed } from '../membership/syndication-config.mjs';

const item = { source: 'share', author: 'alice', title: 'Read this', blurb: 'b', url: 'https://ex.com/a', mention: '<@123>' };

test('discord adapter posts to the per-source channel with a ping-safe author mention', async () => {
  const calls = [];
  const client = { postChannelMessage: async (channelId, content, opts) => { calls.push({ channelId, content, opts }); return { id: 'm1', channel_id: channelId }; } };
  const a = createDiscordAdapter({ env: { DISCORD_BOT_TOKEN: 't', DISCORD_CHANNEL_SHARES: 'chan-share' }, client });
  assert.equal(a.enabled(), true);
  const r = await a.post(item);
  assert.equal(r.ok, true);
  assert.equal(r.id, 'm1');
  assert.equal(calls[0].channelId, 'chan-share');
  assert.deepEqual(calls[0].opts.allowedMentions, { parse: [], users: ['123'] }); // only the author may be pinged
  assert.match(calls[0].content, /^<@123> /);
});

test('discord adapter fails cleanly when no channel is configured for the source', async () => {
  const a = createDiscordAdapter({ env: { DISCORD_BOT_TOKEN: 't' }, client: { postChannelMessage: async () => ({}) } });
  const r = await a.post({ source: 'post', author: 'x' });
  assert.equal(r.ok, false);
});

test('mastodon adapter posts a status and returns the url', async () => {
  let body;
  const fetchImpl = async (url, opts) => { body = JSON.parse(opts.body); return { ok: true, json: async () => ({ id: '99', url: 'https://m/@gbti/99' }) }; };
  const a = createMastodonAdapter({ env: { MASTODON_BASE_URL: 'https://m/', MASTODON_ACCESS_TOKEN: 't' }, fetchImpl });
  assert.equal(a.enabled(), true);
  const r = await a.post(item);
  assert.equal(r.ok, true);
  assert.equal(r.url, 'https://m/@gbti/99');
  assert.match(body.status, /Read this/);
});

test('bluesky adapter creates a session then a post record', async () => {
  const urls = [];
  const fetchImpl = async (url, opts) => {
    urls.push(url);
    if (url.includes('createSession')) return { ok: true, json: async () => ({ accessJwt: 'jwt', did: 'did:plc:me' }) };
    return { ok: true, json: async () => ({ uri: 'at://did:plc:me/app.bsky.feed.post/1' }) };
  };
  const a = createBlueskyAdapter({ env: { BLUESKY_HANDLE: 'gbti.bsky.social', BLUESKY_APP_PASSWORD: 'pw' }, fetchImpl });
  const r = await a.post(item);
  assert.equal(r.ok, true);
  assert.ok(urls[0].includes('createSession'));
  assert.ok(urls[1].includes('createRecord'));
});

test('x + linkedin adapters post via their endpoints (shape only)', async () => {
  const x = createXAdapter({ env: { X_API_KEY: 'a', X_API_SECRET: 'b', X_ACCESS_TOKEN: 'c', X_ACCESS_SECRET: 'd' }, fetchImpl: async () => ({ ok: true, json: async () => ({ data: { id: '7' } }) }) });
  assert.equal(x.enabled(), true);
  assert.equal((await x.post(item)).url, 'https://x.com/i/web/status/7');

  const li = createLinkedinAdapter({
    env: { LINKEDIN_ACCESS_TOKEN: 't', LINKEDIN_ORG_URN: 'urn:li:organization:1' },
    fetchImpl: async () => ({ ok: true, headers: { get: () => 'urn:li:share:5' } }),
  });
  assert.equal(li.enabled(), true);
  assert.equal((await li.post(item)).ok, true);
});

test('an adapter with missing secrets reports enabled() false', () => {
  assert.equal(createMastodonAdapter({ env: {} }).enabled(), false);
  assert.equal(createXAdapter({ env: { X_API_KEY: 'only-one' } }).enabled(), false);
});

test('resolveAdapterRun splits ready (configured) vs skipped (enabled-but-no-secret)', () => {
  const cfg = syndicationConfigFromParsed({ enabled: true, channels: { discord: true, x: true, mastodon: false } });
  const env = { DISCORD_BOT_TOKEN: 't' }; // discord configured; x enabled-but-no-secret
  const { ready, skipped } = resolveAdapterRun({ cfg, env });
  assert.deepEqual(ready.map((a) => a.name), ['discord']);
  assert.deepEqual(skipped, ['x']); // mastodon is not enabled in cfg, so it is omitted
});

// SOW-087: the second Discord post, routed by the item's category via the KV-mirrored map.
test('discord-category adapter posts to the mapped channel for the item category', async () => {
  const calls = [];
  const client = { postChannelMessage: async (channelId, content, opts) => { calls.push({ channelId, content, opts }); return { id: 'm2', channel_id: channelId }; } };
  const channelMap = { channels: [{ category: 'devops', channelId: '777' }] };
  const a = createDiscordCategoryAdapter({ env: { DISCORD_BOT_TOKEN: 't', DISCORD_CHANNEL_SHARES: 'chan-share' }, client, channelMap });
  assert.equal(a.name, 'discord-category');
  const r = await a.post({ ...item, category: 'DevOps' }); // case-insensitive match
  assert.equal(r.ok, true);
  assert.equal(calls[0].channelId, '777');
  assert.deepEqual(calls[0].opts.allowedMentions, { parse: [], users: ['123'] }); // same ping-safety as discord
});

test('discord-category adapter is a clean skip for an unmapped/absent category or a duplicate channel', async () => {
  let posted = 0;
  const client = { postChannelMessage: async () => { posted++; return { id: 'x' }; } };
  const channelMap = { channels: [{ category: 'devops', channelId: 'chan-share' }] };
  const a = createDiscordCategoryAdapter({ env: { DISCORD_BOT_TOKEN: 't', DISCORD_CHANNEL_SHARES: 'chan-share' }, client, channelMap });
  const unmapped = await a.post({ ...item, category: 'gardening' });
  assert.equal(unmapped.ok, true);
  assert.equal(unmapped.skipped, true);
  const noCategory = await a.post({ ...item, category: null });
  assert.equal(noCategory.skipped, true);
  // the mapped channel equals the per-type channel: never double-post one channel
  const dupe = await a.post({ ...item, category: 'devops' });
  assert.equal(dupe.skipped, true);
  assert.equal(posted, 0);
});

test('resolveAdapterRun readies discord-category off the same bot token and hands it the channel map', async () => {
  const cfg = syndicationConfigFromParsed({ syndication: { enabled: true, channels: { 'discord-category': true } } });
  const channelMap = { channels: [{ category: 'ai', channelId: '555' }] };
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'm9', channel_id: '555' }) }; };
  const { ready, skipped } = resolveAdapterRun({ cfg, env: { DISCORD_BOT_TOKEN: 't' }, fetchImpl, channelMap });
  assert.deepEqual(ready.map((a) => a.name), ['discord-category']);
  assert.deepEqual(skipped, []);
  const r = await ready[0].post({ ...item, category: 'ai' });
  assert.equal(r.ok, true);
  assert.ok(calls[0].url.includes('/channels/555/messages'));
});
