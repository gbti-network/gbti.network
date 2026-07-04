// SOW-111: the news detail-open engagement beacon. Distinct-opener counting, the configurable tier gate,
// the threshold auto-post through the shared post-once core, watermark idempotency, fail-open no-ops.
// Fake KV + fake Discord + injected authorize/findItem; no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { membershipNewsOpened, NEWS_OPENS_KEY, tierAdmits } from '../workers/signup/membership-news-opened.mjs';
import { postNewsItemOnce, NEWS_POSTED_KEY } from '../workers/signup/membership-news-publish.mjs';

const GUID = 'https://example.com/a';
const req = (body) => ({ method: 'POST', headers: { get: () => 'Bearer t' }, json: async () => body });
const memberAs = (githubId, status) => async () => ({ ok: true, githubId, login: `u${githubId}`, status });
const denied = async () => ({ ok: false, status: 403, body: { error: 'forbidden' } });
const fakeKv = (seed = {}) => {
  const m = new Map(Object.entries(seed));
  return { store: m, get: async (k, t) => (m.has(k) ? (t === 'json' ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => { m.set(k, v); } };
};
const CONFIG = (over = {}) => JSON.stringify({ enabled: true, news_engagement: { enabled: true, open_threshold: 2, tier: 'paid', comment_autopost: true, ...over } });
const ENV = { DISCORD_BOT_TOKEN: 'bot', NEWS_CHANNELS: JSON.stringify({ channels: [{ category: 'AI/ML', channelId: '777' }] }) };
const findItem = async () => ({ guid: GUID, title: 'Headline', link: 'https://example.com/a', category: 'AI/ML' });
const postOnceWith = (fi) => (e, args, deps) => postNewsItemOnce(e, args, { ...deps, findItem: fi });

test('tierAdmits: paid strictly paid; paid-trial adds trialing; signed-in admits any non-banned status', () => {
  assert.equal(tierAdmits('paid', 'paid'), true);
  assert.equal(tierAdmits('paid', 'trialing'), false);
  assert.equal(tierAdmits('paid-trial', 'trialing'), true);
  assert.equal(tierAdmits('paid-trial', 'none'), false);
  assert.equal(tierAdmits('signed-in', 'none'), true);
  assert.equal(tierAdmits('garbage', 'trialing'), false); // unknown tier falls back to paid
});

test('two distinct paid opens post EXACTLY once to the mapped channel; a third open posts nothing', async () => {
  const kv = fakeKv({ 'synd:config': CONFIG() });
  const posts = [];
  const discord = { postChannelMessage: async (channelId, content) => { posts.push({ channelId, content }); return { id: 'm1' }; } };
  const deps = (id) => ({ authorize: memberAs(id, 'paid'), kv, discord, now: () => 1000, postOnce: postOnceWith(findItem) });
  const r1 = await membershipNewsOpened(req({ guid: GUID }), ENV, deps('1'));
  assert.equal(r1.body.counted, true);
  assert.equal(r1.body.openers, 1);
  assert.equal(r1.body.posted, false);
  const r2 = await membershipNewsOpened(req({ guid: GUID }), ENV, deps('2'));
  assert.equal(r2.body.posted, true);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].channelId, '777');
  const record = await kv.get(NEWS_POSTED_KEY(GUID), 'json');
  assert.equal(record.by, 'auto:open');
  // a third member opens: counted, but the watermark + guid dedupe mean nothing posts again
  const r3 = await membershipNewsOpened(req({ guid: GUID }), ENV, deps('3'));
  assert.equal(r3.body.counted, true);
  assert.equal(r3.body.posted, false);
  assert.equal(posts.length, 1);
});

test('the same member re-opening never counts twice', async () => {
  const kv = fakeKv({ 'synd:config': CONFIG() });
  let posts = 0;
  const discord = { postChannelMessage: async () => { posts++; return { id: 'x' }; } };
  const deps = { authorize: memberAs('1', 'paid'), kv, discord, now: () => 1, postOnce: postOnceWith(findItem) };
  await membershipNewsOpened(req({ guid: GUID }), ENV, deps);
  const r = await membershipNewsOpened(req({ guid: GUID }), ENV, deps);
  assert.equal(r.body.openers, 1);
  assert.equal(posts, 0);
});

test('tier gate: a trial open is a clean no-op under paid, counts under paid-trial; banned is denied upstream', async () => {
  const kv = fakeKv({ 'synd:config': CONFIG() });
  const noPost = { postChannelMessage: async () => ({ id: 'x' }) };
  const trialUnderPaid = await membershipNewsOpened(req({ guid: GUID }), ENV, { authorize: memberAs('9', 'trialing'), kv, discord: noPost, postOnce: postOnceWith(findItem) });
  assert.equal(trialUnderPaid.status, 200);
  assert.equal(trialUnderPaid.body.counted, false);
  assert.equal(await kv.get(NEWS_OPENS_KEY(GUID), 'json'), null); // nothing written
  const kv2 = fakeKv({ 'synd:config': CONFIG({ tier: 'paid-trial' }) });
  const trialUnderTrial = await membershipNewsOpened(req({ guid: GUID }), ENV, { authorize: memberAs('9', 'trialing'), kv: kv2, discord: noPost, postOnce: postOnceWith(findItem) });
  assert.equal(trialUnderTrial.body.counted, true);
  // banned: authorizeMember denies before any KV write
  const kv3 = fakeKv({ 'synd:config': CONFIG({ tier: 'signed-in' }) });
  const banned = await membershipNewsOpened(req({ guid: GUID }), ENV, { authorize: denied, kv: kv3, discord: noPost, postOnce: postOnceWith(findItem) });
  assert.equal(banned.status, 403);
  assert.equal(await kv3.get(NEWS_OPENS_KEY(GUID), 'json'), null);
});

test('disabled config is a clean no-op; a bad guid is 400; a non-POST is 405', async () => {
  const kv = fakeKv({ 'synd:config': CONFIG({ enabled: false }) });
  const off = await membershipNewsOpened(req({ guid: GUID }), ENV, { authorize: memberAs('1', 'paid'), kv, postOnce: postOnceWith(findItem) });
  assert.equal(off.body.counted, false);
  const bad = await membershipNewsOpened(req({}), ENV, { authorize: memberAs('1', 'paid'), kv: fakeKv({ 'synd:config': CONFIG() }), postOnce: postOnceWith(findItem) });
  assert.equal(bad.status, 400);
  const get = await membershipNewsOpened({ method: 'GET', headers: { get: () => null } }, ENV, { kv: fakeKv() });
  assert.equal(get.status, 405);
});

test('an unmapped category at the threshold stamps the watermark (no re-resolve churn); a transient miss retries', async () => {
  // unmapped: postOnce returns ok:true 'unmapped' -> watermark stamps, later opens never re-resolve
  const kv = fakeKv({ 'synd:config': CONFIG() });
  let resolves = 0;
  const fiUnmapped = async () => { resolves++; return { guid: GUID, title: 'H', category: 'Unmapped Category' }; };
  const deps = (id) => ({ authorize: memberAs(id, 'paid'), kv, discord: { postChannelMessage: async () => ({ id: 'x' }) }, postOnce: postOnceWith(fiUnmapped) });
  await membershipNewsOpened(req({ guid: GUID }), ENV, deps('1'));
  const r2 = await membershipNewsOpened(req({ guid: GUID }), ENV, deps('2'));
  assert.equal(r2.body.posted, false);
  assert.equal(resolves, 1);
  await membershipNewsOpened(req({ guid: GUID }), ENV, deps('3'));
  assert.equal(resolves, 1); // watermarked: never resolved again
  // transient: the guid is momentarily off-feed -> NOT watermarked -> a later open retries and posts
  const kvB = fakeKv({ 'synd:config': CONFIG() });
  let attempt = 0;
  const flaky = async () => { attempt++; return attempt < 2 ? null : { guid: 'g2', title: 'H2', category: 'AI/ML' }; };
  const posts = [];
  const depsB = (id) => ({ authorize: memberAs(id, 'paid'), kv: kvB, discord: { postChannelMessage: async (c) => { posts.push(c); return { id: 'm' }; } }, postOnce: postOnceWith(flaky) });
  await membershipNewsOpened(req({ guid: 'g2' }), ENV, depsB('1'));
  const miss = await membershipNewsOpened(req({ guid: 'g2' }), ENV, depsB('2'));
  assert.equal(miss.body.posted, false); // the feed miss did not post and did not watermark
  const retry = await membershipNewsOpened(req({ guid: 'g2' }), ENV, depsB('3'));
  assert.equal(retry.body.posted, true);
  assert.equal(posts.length, 1);
});
