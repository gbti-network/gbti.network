// sow-171 (owner, 2026-10-01): a superadmin shares a news story to our channels from the extension. These tests hold
// the shared rules (the drafts, the links, the Discord message, the done record) and the Worker behind the panel:
// who may use it, what it reads back, what "Mark done" stores, and the superadmin's choice of Discord channel.
// The panel and the relays are in test/news-share-panel.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  NEWS_SHARE_CHANNELS, newsTargetSlug, newsShareUrl, newsShareDraft, newsRedditComment, newsHashtag, swapLink,
  formatNewsPost, newsShareDoneTask, newsShareTaskId,
} from '../membership/news-share.mjs';
import { newsTargetSlug as clientSlug } from '../client-ui/src/news.mjs';
import { newsTargetSlug as siteSlug } from '../src/lib/home-feed.mjs';
import { handleNewsShareGet, handleNewsShareDone } from '../workers/signup/membership-news-share.mjs';
import { membershipNewsPublish, NEWS_POSTED_KEY } from '../workers/signup/membership-news-publish.mjs';
import { handleSocialQueueGet } from '../workers/signup/social-queue-admin.mjs';
import { SOCIAL_TASK_KEY } from '../workers/signup/social-queue-store.mjs';

const STORY = {
  guid: 'https://techcrunch.com/?p=3061234',
  title: 'World’s first enhanced geothermal power plant completed in just 23 months',
  link: 'https://techcrunch.com/2026/09/30/fervo-geothermal/',
  source: 'techcrunch',
  category: 'Energy',
  excerpt: 'Fervo Energy completes world’s first enhanced geothermal power plant in under 2 years.',
};
const PUB = { publisher: 'TechCrunch' };

// ---- the shared rules ----

test('every hand-posted channel gets the approved draft, crediting the publication and linking out', () => {
  assert.deepEqual([...NEWS_SHARE_CHANNELS], ['x', 'bluesky', 'linkedin', 'reddit', 'dailydev']);
  const line = `${STORY.title}, via TechCrunch ${STORY.link}`;
  assert.equal(newsShareDraft('x', STORY, PUB), `${line} #Energy`);
  assert.equal(newsShareDraft('bluesky', STORY, PUB), `${line} #Energy`);
  assert.equal(newsShareDraft('dailydev', STORY, PUB), line, 'daily.dev carries no hashtag');
  assert.equal(newsShareDraft('reddit', STORY, PUB), `${STORY.title} (TechCrunch)`, 'Reddit returns the title only');
  assert.equal(newsShareDraft('linkedin', STORY, PUB),
    `${STORY.excerpt}\n\nRead the full story on TechCrunch:\n${STORY.link}\n\n#Energy`);
  assert.equal(newsShareDraft('linkedin', { ...STORY, excerpt: '' }, PUB).split('\n')[0], STORY.title, 'no summary: the title leads');
  assert.equal(newsShareDraft('devto', STORY, PUB), '', 'dev.to has no draft');
  assert.equal(newsShareDraft('x', STORY), `${STORY.title}, via techcrunch ${STORY.link} #Energy`, 'without a publisher name, the source stands in');
});

test('the hashtag comes from the category, joined into one word, and "Other" gets none', () => {
  assert.equal(newsHashtag('Energy'), '#Energy');
  assert.equal(newsHashtag('AI/ML'), '#AIML');
  assert.equal(newsHashtag('DevOps/Cloud'), '#DevOpsCloud');
  assert.equal(newsHashtag('Other'), '');
  assert.equal(newsHashtag('other'), '');
  assert.equal(newsHashtag(''), '');
  assert.ok(!newsShareDraft('x', { ...STORY, category: 'Other' }, PUB).includes('#'));
});

test('a draft over its limit shortens the TITLE, so the link and the hashtag always survive', () => {
  const long = { ...STORY, title: 'Geothermal '.repeat(60).trim() };
  for (const ch of ['x', 'bluesky', 'dailydev', 'reddit']) {
    const d = newsShareDraft(ch, long, PUB);
    const limit = ch === 'x' ? 280 : 300;
    assert.ok(d.length <= limit, `${ch}: ${d.length} > ${limit}`);
    assert.ok(d.includes('…'), `${ch} shows the cut`);
    if (ch !== 'reddit') assert.ok(d.includes(STORY.link), `${ch} lost the link`);
    if (ch === 'x' || ch === 'bluesky') assert.ok(d.endsWith(' #Energy'), `${ch} lost the hashtag`);
  }
  const li = newsShareDraft('linkedin', { ...STORY, excerpt: 'Long summary. '.repeat(400) }, PUB);
  assert.ok(li.length <= 3000 && li.includes(STORY.link) && li.endsWith('#Energy'));
});

test('"Link to" chooses the article (without the extension UTM tags) or our own news page', () => {
  assert.equal(newsShareUrl(STORY, 'source'), STORY.link);
  assert.equal(newsShareUrl({ ...STORY, link: 'javascript:alert(1)' }, 'source'), '', 'only a web address is ever posted');
  assert.equal(newsShareUrl(STORY, 'gbti'), `https://gbti.network/news/item/?g=${encodeURIComponent(STORY.guid)}&s=techcrunch`);
  assert.ok(newsShareDraft('x', STORY, { ...PUB, linkTo: 'gbti' }).includes('https://gbti.network/news/item/?g='));
  // An edited draft keeps the edit: only the address inside it changes.
  const edited = `My take: ${STORY.link} is worth a read`;
  assert.equal(swapLink(edited, STORY.link, 'https://gbti.network/x'), 'My take: https://gbti.network/x is worth a read');
  assert.equal(swapLink(edited, '', 'https://gbti.network/x'), edited);
});

test('the Reddit first comment names the publication and is right about where the link goes', () => {
  assert.equal(newsRedditComment(STORY, PUB), 'Shared from the GBTI Network news feed. The reporting is by TechCrunch; the link above is the full story.');
  assert.equal(newsRedditComment(STORY, { ...PUB, linkTo: 'gbti' }), 'Shared from the GBTI Network news feed. The reporting is by TechCrunch; our page links to the full story.');
});

test('the Discord message and the news slug did not change when they moved here', () => {
  assert.equal(formatNewsPost({ title: 'Big AI news', source: 'Example', link: 'https://example.com/a' }), '📰 **Big AI news**\n_via Example_\nhttps://example.com/a');
  assert.equal(formatNewsPost({}), '📰 **News**');
  for (const [g, slug] of [['https://pytorch.org/?p=148439', 'news-1r5tn2pt'], ['', 'news-ztntfp0'], ['abc', 'news-7aigaz3']]) {
    assert.equal(newsTargetSlug(g), slug);
    assert.equal(clientSlug(g), slug, 'the client re-export is the same function');
    assert.equal(siteSlug(g), slug, "the website's pinned copy agrees");
  }
});

test('"Mark done" becomes a DONE Social Queue task, and anything else is refused', () => {
  const r = newsShareDoneTask({ guid: STORY.guid, channel: 'x', title: STORY.title, url: STORY.link, text: 'hello', category: 'Energy' }, { actor: { githubId: '1', login: 'atwellpub' }, now: 99 });
  assert.equal(r.ok, true);
  assert.equal(r.task.id, newsShareTaskId(STORY.guid, 'x'));
  assert.equal(r.task.id, `${newsTargetSlug(STORY.guid)}::x`);
  assert.equal(r.task.source, 'news');
  assert.equal(r.task.trigger, 'manual');
  assert.equal(r.task.status, 'done');
  assert.equal(r.task.doneAt, 99);
  assert.equal(r.task.doneBy, '1');
  assert.equal(r.task.doneByLogin, 'atwellpub');
  for (const channel of ['devto', 'discord', 'hashnode', '']) {
    assert.equal(newsShareDoneTask({ guid: STORY.guid, channel, url: STORY.link, text: 'x' }).ok, false, `${channel || 'no channel'} must be refused`);
  }
  assert.equal(newsShareDoneTask({ guid: '', channel: 'x', url: STORY.link, text: 'x' }).ok, false);
  assert.equal(newsShareDoneTask({ guid: STORY.guid, channel: 'x', url: 'javascript:alert(1)', text: 'x' }).ok, false);
  assert.equal(newsShareDoneTask({ guid: STORY.guid, channel: 'x', url: STORY.link, text: '   ' }).ok, false);
  const capped = newsShareDoneTask({ guid: STORY.guid, channel: 'x', url: STORY.link, text: 'y'.repeat(5000) });
  assert.equal(capped.task.text.length, 280);
  const rd = newsShareDoneTask({ guid: STORY.guid, channel: 'reddit', url: STORY.link, text: 'T', commentText: 'c'.repeat(20000) });
  assert.equal(rd.task.commentText.length, 9500);
  assert.equal(newsShareDoneTask({ guid: STORY.guid, channel: 'x', url: STORY.link, text: 'T', commentText: 'c' }).task.commentText, '', 'only Reddit keeps a comment');
});

// ---- the Worker ----

const fakeKv = () => {
  const m = new Map();
  return {
    store: m,
    async get(k, type) { const v = m.get(k); return v == null ? null : type === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix = '' } = {}) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  };
};
const MIRROR_ROLES = { superadmins: [{ github_id: '1', login: 'atwellpub' }] };
const asRole = (role) => async () => ({ ok: true, githubId: '1', role, mirror: { roles: MIRROR_ROLES } });
const get = (qs) => ({ method: 'GET', url: `https://signup.gbti.network/membership/news-share?${qs}`, headers: { get: () => null } });
const post = (body) => ({ method: 'POST', url: 'https://signup.gbti.network/membership/news-share', headers: { get: () => null }, json: async () => body });
const NEWS_CHANNELS = JSON.stringify({ channels: [{ category: 'energy', channelId: '1100000000000000001' }] });

test('only a superadmin may read or record shares: a member, a moderator and an admin are refused', async () => {
  const kv = fakeKv();
  for (const role of ['member', 'moderator', 'admin']) {
    assert.equal((await handleNewsShareGet(get(`guid=${encodeURIComponent(STORY.guid)}`), { SIGNUP_KV: kv }, { kv, authorize: asRole(role) })).status, 403, role);
    assert.equal((await handleNewsShareDone(post({ guid: STORY.guid, channel: 'x', url: STORY.link, text: 'x' }), { SIGNUP_KV: kv }, { kv, authorize: asRole(role) })).status, 403, role);
  }
  assert.equal(kv.store.size, 0, 'a refused call wrote nothing');
  const anon = await handleNewsShareGet(get('guid=g'), { SIGNUP_KV: kv }, { kv, authorize: async () => ({ ok: false, status: 401, body: { error: 'unauthorized' } }) });
  assert.equal(anon.status, 401);
  assert.equal((await handleNewsShareGet(get('guid=g'), { SIGNUP_KV: kv }, { kv, authorize: asRole('superadmin') })).status, 200, 'control: a superadmin is let in');
});

test('GET says where the story has gone: Discord, the channel its category maps to, and every channel marked done', async () => {
  const kv = fakeKv();
  const env = { SIGNUP_KV: kv, NEWS_CHANNELS };
  const empty = await handleNewsShareGet(get(`guid=${encodeURIComponent(STORY.guid)}&category=Energy`), env, { kv, authorize: asRole('superadmin') });
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.discord, { posted: false, postedAt: null, channelId: null, mappedChannelId: '1100000000000000001' });
  assert.deepEqual(Object.keys(empty.body.channels), [...NEWS_SHARE_CHANNELS]);
  assert.ok(Object.values(empty.body.channels).every((v) => v === null));

  await kv.put(NEWS_POSTED_KEY(STORY.guid), JSON.stringify({ channelId: '1100000000000000001', postedAt: '2026-10-01T10:00:00Z' }));
  const done = await handleNewsShareDone(post({ guid: STORY.guid, channel: 'bluesky', title: STORY.title, url: STORY.link, text: 'hello' }), env, { kv, now: () => 1234, authorize: asRole('superadmin') });
  assert.equal(done.status, 200);
  assert.deepEqual(done.body.done, { doneAt: 1234, doneBy: 'atwellpub' });

  const after = await handleNewsShareGet(get(`guid=${encodeURIComponent(STORY.guid)}&category=Other`), env, { kv, authorize: asRole('superadmin') });
  assert.equal(after.body.discord.posted, true);
  assert.equal(after.body.discord.mappedChannelId, null, '"Other" maps to no channel');
  assert.deepEqual(after.body.channels.bluesky, { doneAt: 1234, doneBy: 'atwellpub' });
  assert.equal(after.body.channels.x, null);
});

test('a share marked done lists in the Social Queue under Manual done, as a News row', async () => {
  const kv = fakeKv();
  await handleNewsShareDone(post({ guid: STORY.guid, channel: 'reddit', title: STORY.title, url: STORY.link, text: 'Title', commentText: 'Comment' }), { SIGNUP_KV: kv }, { kv, now: () => 7, authorize: asRole('superadmin') });
  const stored = JSON.parse(kv.store.get(SOCIAL_TASK_KEY(newsShareTaskId(STORY.guid, 'reddit'))));
  assert.equal(stored.status, 'done');
  const q = await handleSocialQueueGet({ headers: { get: () => null } }, { SIGNUP_KV: kv }, { kv, authorize: asRole('superadmin') });
  assert.equal(q.body.pending.length, 0);
  assert.equal(q.body.done.length, 1);
  assert.equal(q.body.done[0].source, 'news');
  assert.equal(q.body.done[0].commentText, 'Comment');
});

test('POST refuses a bad record with a 400 and stores nothing', async () => {
  const kv = fakeKv();
  for (const body of [{ guid: STORY.guid, channel: 'devto', url: STORY.link, text: 'x' }, { guid: STORY.guid, channel: 'x', url: 'ftp://x', text: 'x' }, { guid: STORY.guid, channel: 'x', url: STORY.link, text: '' }, { channel: 'x', url: STORY.link, text: 'x' }]) {
    const r = await handleNewsShareDone(post(body), { SIGNUP_KV: kv }, { kv, authorize: asRole('superadmin') });
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  assert.equal(kv.store.size, 0);
  assert.equal((await handleNewsShareGet(get(''), { SIGNUP_KV: kv }, { kv, authorize: asRole('superadmin') })).status, 400, 'a GET needs the story');
});

test('a store that cannot be read is an error, never "not posted anywhere"', async () => {
  const kv = { async get() { throw new Error('kv down'); } };
  const r = await handleNewsShareGet(get(`guid=${encodeURIComponent(STORY.guid)}`), { SIGNUP_KV: kv }, { kv, authorize: asRole('superadmin') });
  assert.equal(r.status, 503);
  assert.equal(r.body.channels, undefined);
});

// ---- the superadmin's choice of Discord channel ----

const findOk = async (_env, { guid }) => (guid === STORY.guid ? { ...STORY, category: 'energy' } : null);
const discordSpy = () => { const posts = []; return { posts, client: { postChannelMessage: async (channelId, content) => { posts.push({ channelId, content }); return { id: 'm1' }; } } }; };
const guild = (channels) => async () => ({ ok: true, channels });
const GUILD = [{ id: '2200000000000000002', name: 'news', type: 0 }, { id: '3300000000000000003', name: 'Section', type: 4 }];
const pubReq = (body) => ({ headers: { get: () => null }, json: async () => body });
const publishEnv = { NEWS_CHANNELS, DISCORD_BOT_TOKEN: 'bot' };

test('a superadmin can send a story to a Discord channel of our guild that they picked', async () => {
  const kv = fakeKv();
  const { posts, client } = discordSpy();
  const r = await membershipNewsPublish(pubReq({ guid: STORY.guid, channelId: '2200000000000000002' }), publishEnv,
    { authorize: async () => ({ ok: true, githubId: '1', role: 'superadmin' }), findItem: findOk, kv, discord: client, guildChannels: guild(GUILD) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(posts[0].channelId, '2200000000000000002');
  assert.equal(posts[0].content, formatNewsPost({ ...STORY, category: 'energy' }), 'the panel preview is exactly what posts');
});

test('a chosen channel is refused for a curator, for a category group, for a channel not in our guild, and when the list cannot be read', async () => {
  const cases = [
    { role: 'admin', channelId: '2200000000000000002', status: 403, list: guild(GUILD) },
    { role: 'superadmin', channelId: '3300000000000000003', status: 400, list: guild(GUILD) },
    { role: 'superadmin', channelId: '9999999999999999999', status: 400, list: guild(GUILD) },
    { role: 'superadmin', channelId: 'general', status: 400, list: guild(GUILD) },
    { role: 'superadmin', channelId: '2200000000000000002', status: 502, list: async () => ({ ok: false, message: 'discord 500' }) },
  ];
  for (const c of cases) {
    const kv = fakeKv();
    const { posts, client } = discordSpy();
    const r = await membershipNewsPublish(pubReq({ guid: STORY.guid, channelId: c.channelId }), publishEnv,
      { authorize: async () => ({ ok: true, githubId: '2', role: c.role, isNewsEditor: true }), findItem: findOk, kv, discord: client, guildChannels: c.list });
    assert.equal(r.status, c.status, JSON.stringify(c));
    assert.equal(posts.length, 0, `nothing posted: ${JSON.stringify(c)}`);
    assert.equal(kv.store.size, 0);
  }
});

test('without a chosen channel, publishing routes by category exactly as before (and never reads the guild list)', async () => {
  const kv = fakeKv();
  const { posts, client } = discordSpy();
  const r = await membershipNewsPublish(pubReq({ guid: STORY.guid }), publishEnv,
    { authorize: async () => ({ ok: true, githubId: '5', role: 'member', isNewsEditor: true }), findItem: findOk, kv, discord: client,
      guildChannels: async () => { throw new Error('the guild list must not be read'); } });
  assert.equal(r.status, 200);
  assert.equal(posts[0].channelId, '1100000000000000001');
});
