// SOW-046 D: reflect a news discussion onto its Discord post. Effective-paid; appends a one-time notice to the
// curator-posted message (guarded by discussionNoticedAt). No-op when the item was never posted to Discord.
// Pure over injected authorize/discord/kv; no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { membershipNewsDiscussed } from '../workers/signup/membership-news-discussed.mjs';
import { NEWS_POSTED_KEY } from '../workers/signup/membership-news-publish.mjs';

const req = (body) => ({ headers: { get: () => 'Bearer t' }, json: async () => body });
const paid = async () => ({ ok: true, githubId: '5' });
const denied = async () => ({ ok: false, status: 403, body: { error: 'forbidden', message: 'an active paid membership is required' } });
const GUID = 'https://example.com/a';
const fakeKv = (seed = {}) => {
  const m = new Map(Object.entries(seed));
  return { store: m, get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), put: async (k, v) => { m.set(k, v); } };
};
const postedRecord = (over = {}) => JSON.stringify({ channelId: '111', messageId: 'm1', guid: GUID, content: '📰 **Headline**', ...over });

test('news-discussed: appends a one-time notice to the Discord post and records discussionNoticedAt', async () => {
  const kv = fakeKv({ [NEWS_POSTED_KEY(GUID)]: postedRecord() });
  const edits = [];
  const discord = { editChannelMessage: async (channelId, messageId, content) => { edits.push({ channelId, messageId, content }); return { id: messageId }; } };
  const env = { DISCORD_BOT_TOKEN: 'bot' };
  const r = await membershipNewsDiscussed(req({ guid: GUID }), env, { authorize: paid, kv, discord, now: () => '2026-06-18T00:00:00Z' });
  assert.equal(r.body.reflected, true);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].channelId, '111');
  assert.equal(edits[0].messageId, 'm1');
  assert.match(edits[0].content, /Headline/);
  assert.match(edits[0].content, /discussing/i);
  const rec = await kv.get(NEWS_POSTED_KEY(GUID));
  assert.equal(rec.discussionNoticedAt, '2026-06-18T00:00:00Z');
});

test('news-discussed: a second call is idempotent (the notice is appended only once)', async () => {
  const kv = fakeKv({ [NEWS_POSTED_KEY(GUID)]: postedRecord() });
  let edits = 0;
  const discord = { editChannelMessage: async () => { edits++; return { id: 'm1' }; } };
  const env = { DISCORD_BOT_TOKEN: 'bot' };
  const deps = { authorize: paid, kv, discord, now: () => '2026-06-18T00:00:00Z' };
  await membershipNewsDiscussed(req({ guid: GUID }), env, deps);
  const r2 = await membershipNewsDiscussed(req({ guid: GUID }), env, deps);
  assert.equal(edits, 1, 'the Discord message is edited exactly once');
  assert.equal(r2.body.reflected, false);
  assert.equal(r2.body.already, true);
});

test('news-discussed: an item never posted to Discord is a clean no-op (no edit, no error)', async () => {
  const kv = fakeKv();
  let edits = 0;
  const discord = { editChannelMessage: async () => { edits++; return {}; } };
  const r = await membershipNewsDiscussed(req({ guid: GUID }), { DISCORD_BOT_TOKEN: 'bot' }, { authorize: paid, kv, discord });
  assert.equal(r.status, 200);
  assert.equal(r.body.reflected, false);
  assert.equal(edits, 0);
});

test('news-discussed: a non-paid caller is forbidden before any KV/Discord touch', async () => {
  let touched = false;
  const kv = { get: async () => { touched = true; return null; }, put: async () => { touched = true; } };
  const discord = { editChannelMessage: async () => { touched = true; return {}; } };
  const r = await membershipNewsDiscussed(req({ guid: GUID }), { DISCORD_BOT_TOKEN: 'bot' }, { authorize: denied, kv, discord });
  assert.equal(r.status, 403);
  assert.equal(touched, false);
});

test('news-discussed: a missing guid -> 400', async () => {
  const kv = fakeKv();
  const r = await membershipNewsDiscussed(req({}), { DISCORD_BOT_TOKEN: 'bot' }, { authorize: paid, kv, discord: { editChannelMessage: async () => ({}) } });
  assert.equal(r.status, 400);
});

test('news-discussed: a Discord failure -> 502 and the notice flag is NOT set (so a retry can still reflect)', async () => {
  const kv = fakeKv({ [NEWS_POSTED_KEY(GUID)]: postedRecord() });
  const discord = { editChannelMessage: async () => { throw new Error('discord down'); } };
  const r = await membershipNewsDiscussed(req({ guid: GUID }), { DISCORD_BOT_TOKEN: 'bot' }, { authorize: paid, kv, discord, now: () => 'x' });
  assert.equal(r.status, 502);
  const rec = await kv.get(NEWS_POSTED_KEY(GUID));
  assert.equal(rec.discussionNoticedAt, undefined);
});

// ---- SOW-111: the first comment on an UNPOSTED item auto-posts it, then the notice appends ----

const ENGAGEMENT_ON = JSON.stringify({ enabled: true, news_engagement: { enabled: true, comment_autopost: true, open_threshold: 2, tier: 'paid' } });

test('SOW-111: comment on an unposted item auto-posts (by auto:comment) and appends the notice in one request', async () => {
  const kv = fakeKv({ 'synd:config': ENGAGEMENT_ON });
  const posts = [];
  const edits = [];
  const discord = {
    postChannelMessage: async (channelId, content) => { posts.push({ channelId, content }); return { id: 'm9' }; },
    editChannelMessage: async (channelId, messageId, content) => { edits.push({ channelId, messageId, content }); return { id: messageId }; },
  };
  const env = { DISCORD_BOT_TOKEN: 'bot', NEWS_CHANNELS: JSON.stringify({ channels: [{ category: 'AI/ML', channelId: '777' }] }), SIGNUP_KV: null };
  // inject findItem through postOnce by wrapping the real core? Simpler: inject a postOnce-compatible fake feed
  // via the real core's findItem injection is not exposed here, so pass a custom postOnce built on the real one:
  const { postNewsItemOnce } = await import('../workers/signup/membership-news-publish.mjs');
  const findItem = async () => ({ guid: GUID, title: 'Headline', link: 'https://example.com/a', source: 'ex', category: 'AI/ML' });
  const postOnce = (e, args, deps) => postNewsItemOnce(e, args, { ...deps, findItem });
  const r = await membershipNewsDiscussed(req({ guid: GUID }), env, { authorize: paid, kv, discord, now: () => 'T1', postOnce });
  assert.equal(r.status, 200);
  assert.equal(r.body.posted, true);
  assert.equal(r.body.reflected, true);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].channelId, '777');
  assert.equal(edits.length, 1); // the notice appended to the fresh post
  const rec = await kv.get(NEWS_POSTED_KEY(GUID));
  assert.equal(rec.by, 'auto:comment');
  assert.equal(rec.discussionNoticedAt, 'T1');
  // a SECOND comment neither re-posts nor re-notices
  const r2 = await membershipNewsDiscussed(req({ guid: GUID }), env, { authorize: paid, kv, discord, now: () => 'T2', postOnce });
  assert.equal(r2.body.already, true);
  assert.equal(posts.length, 1);
  assert.equal(edits.length, 1);
});

test('SOW-111: engagement config off (or absent) keeps the legacy clean no-op; unmapped category is a no-op too', async () => {
  const { postNewsItemOnce } = await import('../workers/signup/membership-news-publish.mjs');
  const findItem = async () => ({ guid: GUID, title: 'H', category: 'AI/ML' });
  const postOnce = (e, args, deps) => postNewsItemOnce(e, args, { ...deps, findItem });
  let posts = 0;
  const discord = { postChannelMessage: async () => { posts++; return { id: 'x' }; }, editChannelMessage: async () => ({}) };
  // absent config (fail-closed default: enabled false)
  const offKv = fakeKv();
  const off = await membershipNewsDiscussed(req({ guid: GUID }), { DISCORD_BOT_TOKEN: 'bot' }, { authorize: paid, kv: offKv, discord, postOnce });
  assert.equal(off.body.reflected, false);
  assert.equal(posts, 0);
  // config on but the category is unmapped -> clean no-op (fail-closed routing)
  const onKv = fakeKv({ 'synd:config': ENGAGEMENT_ON });
  const unmapped = await membershipNewsDiscussed(req({ guid: GUID }), { DISCORD_BOT_TOKEN: 'bot', NEWS_CHANNELS: JSON.stringify({ channels: [] }) }, { authorize: paid, kv: onKv, discord, postOnce });
  assert.equal(unmapped.body.reflected, false);
  assert.equal(posts, 0);
});
