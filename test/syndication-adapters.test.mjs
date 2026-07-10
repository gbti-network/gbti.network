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
  // SOW-088: EVERY type now has the one owner-directed default template, mention-first.
  assert.equal(calls[0].content, 'New link published by <@123>: "Read this" https://ex.com/a');
  const postCalls = [];
  const clientB = { postChannelMessage: async (channelId, content, opts) => { postCalls.push({ content }); return { id: 'm2' }; } };
  const b = createDiscordAdapter({ env: { DISCORD_BOT_TOKEN: 't', DISCORD_CHANNEL_POSTS: 'chan-posts' }, client: clientB });
  await b.post({ ...item, source: 'post' });
  assert.equal(postCalls[0].content, 'New article published by <@123>: "Read this" https://ex.com/a');
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

// SOW-088: the LinkedIn adapter targets the versioned Posts API and posts a rich article card.
test('linkedin: versioned /rest/posts, org author, article card with url, none without, error snippet', async () => {
  const calls = [];
  const li = createLinkedinAdapter({
    env: { LINKEDIN_ACCESS_TOKEN: 'tok', LINKEDIN_ORG_URN: 'urn:li:organization:99' },
    fetchImpl: async (url, opts) => { calls.push({ url, opts, body: JSON.parse(opts.body) }); return { ok: true, headers: { get: (h) => (h === 'x-restli-id' ? 'urn:li:share:42' : null) } }; },
  });
  const r = await li.post({ ...item, textOverride: 'Edited text wins' });
  assert.equal(calls[0].url, 'https://api.linkedin.com/rest/posts');
  assert.equal(calls[0].opts.headers['X-Restli-Protocol-Version'], '2.0.0');
  assert.match(calls[0].opts.headers['LinkedIn-Version'], /^\d{6}$/);
  assert.equal(calls[0].body.author, 'urn:li:organization:99');
  assert.equal(calls[0].body.commentary, 'Edited text wins'); // the manual override wins
  assert.deepEqual(calls[0].body.content.article, { source: 'https://ex.com/a', title: 'Read this', description: 'b' });
  assert.equal(calls[0].body.visibility, 'PUBLIC');
  assert.equal(r.url, 'https://www.linkedin.com/feed/update/urn:li:share:42');
  // No url -> commentary only, no content block.
  await li.post({ source: 'share', author: 'alice', title: 'T' });
  assert.equal('content' in calls[1].body, false);
  // A refusal surfaces the response snippet so the popup says WHY.
  const bad = createLinkedinAdapter({
    env: { LINKEDIN_ACCESS_TOKEN: 'tok', LINKEDIN_ORG_URN: 'urn:li:organization:99' },
    fetchImpl: async () => ({ ok: false, status: 422, text: async () => '{"message":"ACCESS_DENIED: not permitted"}' }),
  });
  const err = await bad.post(item);
  assert.equal(err.ok, false);
  assert.match(err.error, /linkedin 422 .*ACCESS_DENIED/);
});

// SOW-088: the Reddit adapter (the Radle port) — refresh-then-submit, clean api_type=json parsing.
test('reddit: refreshes with Basic auth then submits a link post with the required UA', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes('/api/v1/access_token')) return { ok: true, status: 200, json: async () => ({ access_token: 'at1' }) };
    return { ok: true, status: 200, json: async () => ({ json: { errors: [], data: { id: 'abc123', url: 'https://www.reddit.com/r/GBTI_network/comments/abc123/x/' } } }) };
  };
  const env = { REDDIT_CLIENT_ID: 'id', REDDIT_CLIENT_SECRET: 'sec', REDDIT_REFRESH_TOKEN: 'rt', REDDIT_SUBREDDIT: 'GBTI_network' };
  const { createRedditAdapter } = await import('../clients/syndication/reddit.mjs');
  const rd = createRedditAdapter({ env, fetchImpl });
  assert.equal(rd.enabled(), true);
  const r = await rd.post({ ...item, textOverride: 'A natural Reddit title' });
  // Refresh call shape.
  assert.match(calls[0].url, /www\.reddit\.com\/api\/v1\/access_token/);
  assert.match(calls[0].opts.headers.Authorization, /^Basic /);
  assert.match(calls[0].opts.body, /grant_type=refresh_token/);
  // Submit call shape.
  assert.match(calls[1].url, /oauth\.reddit\.com\/api\/submit/);
  assert.equal(calls[1].opts.headers.Authorization, 'Bearer at1');
  assert.ok(calls[1].opts.headers['User-Agent'], 'Reddit requires a User-Agent');
  const p = new URLSearchParams(calls[1].opts.body);
  assert.equal(p.get('sr'), 'GBTI_network');
  assert.equal(p.get('kind'), 'link');
  assert.equal(p.get('title'), 'A natural Reddit title');
  assert.equal(p.get('url'), 'https://ex.com/a');
  assert.equal(p.get('api_type'), 'json');
  assert.equal(r.ok, true);
  assert.equal(r.url, 'https://www.reddit.com/r/GBTI_network/comments/abc123/x/');
});

// SOW-088 Radle-style post kinds: an explicit redditKind=self makes a TEXT post whose body is the
// Worker-rendered bodyText; a link post carries a provided bodyText as body text under the link.
test('reddit: redditKind self posts text with the body, and a link post carries bodyText', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes('/api/v1/access_token')) return { ok: true, status: 200, json: async () => ({ access_token: 'at1' }) };
    return { ok: true, status: 200, json: async () => ({ json: { errors: [], data: { id: 'x1', url: 'https://r/x1' } } }) };
  };
  const env = { REDDIT_CLIENT_ID: 'id', REDDIT_CLIENT_SECRET: 'sec', REDDIT_REFRESH_TOKEN: 'rt', REDDIT_SUBREDDIT: 'GBTI_network' };
  const { createRedditAdapter } = await import('../clients/syndication/reddit.mjs');
  const rd = createRedditAdapter({ env, fetchImpl });
  await rd.post({ ...item, textOverride: 'T', redditKind: 'self', bodyText: 'Body https://ex.com/a' });
  let p = new URLSearchParams(calls[1].opts.body);
  assert.equal(p.get('kind'), 'self');
  assert.equal(p.get('text'), 'Body https://ex.com/a');
  assert.equal(p.get('url'), null, 'a self post sends no url param');
  // A link post's body goes out as the FIRST COMMENT (/api/submit drops text on kind=link).
  const r2 = await rd.post({ ...item, textOverride: 'T', redditKind: 'link', bodyText: 'extra context' });
  p = new URLSearchParams(calls[3].opts.body);
  assert.equal(p.get('kind'), 'link');
  assert.equal(p.get('url'), 'https://ex.com/a');
  assert.equal(p.get('text'), null, 'a link post submits no text param');
  assert.match(calls[4].url, /oauth\.reddit\.com\/api\/comment/);
  const cp = new URLSearchParams(calls[4].opts.body);
  assert.equal(cp.get('thing_id'), 't3_x1');
  assert.equal(cp.get('text'), 'extra context');
  assert.ok(r2.comment && !r2.comment.error, 'the comment result is surfaced');
  // A url-less item can never be a link post regardless of the requested kind.
  await rd.post({ ...item, url: null, textOverride: 'T', redditKind: 'link' });
  p = new URLSearchParams(calls[6].opts.body);
  assert.equal(p.get('kind'), 'self');
});

test('reddit: a dead refresh token and json.errors both surface readable failures', async () => {
  const { createRedditAdapter } = await import('../clients/syndication/reddit.mjs');
  const env = { REDDIT_CLIENT_ID: 'id', REDDIT_CLIENT_SECRET: 'sec', REDDIT_REFRESH_TOKEN: 'rt', REDDIT_SUBREDDIT: 'GBTI_network' };
  const dead = createRedditAdapter({ env, fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({}) }) });
  const r1 = await dead.post(item);
  assert.equal(r1.ok, false);
  assert.match(r1.error, /refresh token may be revoked/);
  const errs = createRedditAdapter({ env, fetchImpl: async (url) => (url.includes('access_token')
    ? { ok: true, status: 200, json: async () => ({ access_token: 'at' }) }
    : { ok: true, status: 200, json: async () => ({ json: { errors: [['SUBREDDIT_NOTALLOWED', 'not allowed to post there', 'sr']] } }) }) });
  const r2 = await errs.post(item);
  assert.equal(r2.ok, false);
  assert.match(r2.error, /SUBREDDIT_NOTALLOWED/);
});
