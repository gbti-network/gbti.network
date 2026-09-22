// sow-386: the members-only Worker read behind the bells' news rows, GET /membership/news-following. The store,
// the source list, the prefs record and the gate are injected, so these run with no network and no KV.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  membershipNewsFollowing, followedNewsRows, FOLLOWED_NEWS_WINDOW_DAYS, FOLLOWED_NEWS_MAX,
} from '../workers/signup/membership-news-following.mjs';
import { workerGetFollowedNews, NewsClientError } from '../client/src/news-client.mjs';
import { OVERRIDES_KV_KEY } from '../workers/signup/membership-content.mjs';

const NOW = Date.parse('2026-09-22T12:00:00Z');
const NOW_S = NOW / 1000;
const ENV = { NEWS_KV: {} };
const req = () => new Request('https://signup.gbti.network/membership/news-following', { headers: { Authorization: 'Bearer tok' } });
const paid = () => ({ ok: true, githubId: '42', status: 'paid' });
const refused = (status = 403) => () => ({ ok: false, status, body: { error: 'forbidden', message: 'an active paid membership is required' } });
const kvWith = (prefs) => { const reads = []; return { reads, get: async (k) => { reads.push(k); return prefs; } }; };
const store = (items) => { const calls = []; const fn = async (_env, filter) => { calls.push(filter); return { items, updatedAt: 1 }; }; fn.calls = calls; return fn; };
const names = async () => ({ sources: [{ id: 'techcrunch', name: 'TechCrunch' }, { id: 'xda', name: 'XDA' }] });
const story = (guid, source, hoursAgo, extra = {}) => ({ guid, source, title: `T ${guid}`, link: `https://${source}.test/${guid}`, publishedAt: NOW_S - hoursAgo * 3600, ...extra });

test('a free, banned or signed-out caller is refused and nothing is read', async () => {
  for (const status of [401, 403]) {
    const kv = kvWith({ followedChannels: ['techcrunch'] });
    const queryItems = store([story('a', 'techcrunch', 1)]);
    const r = await membershipNewsFollowing(req(), ENV, { authorize: refused(status), kv, queryItems, sourceList: names, now: () => NOW });
    assert.equal(r.status, status);
    assert.equal(kv.reads.length, 0, 'the prefs record is not read');
    assert.equal(queryItems.calls.length, 0, 'the store is not read');
  }
});

// Through the REAL gate (no injected authorize): a fake Stripe and a fresh overrides mirror, the same fixtures the
// membership-content tests use. This is the behaviour the owner asked for, "not available for the free tier users".
const freshMirror = (over = {}) => ({ generatedAt: new Date().toISOString(), roles: {}, bans: over.bans ?? { bans: [] }, grandfathered: over.grandfathered ?? { grandfathered: [] } });
const realKv = (mirror, prefs) => ({ get: async (k) => (k === OVERRIDES_KV_KEY ? mirror : k === 'prefs:1' ? prefs : null) });
const gateDeps = (customer) => ({ fetchUser: async () => ({ githubId: '1', githubLogin: 'u1' }), makeStripe: () => ({ findCustomerByGithubId: async () => customer }) });
const PAID_CUSTOMER = { id: 'c', metadata: { github_id: '1' }, subscriptions: { data: [{ status: 'active', created: 1 }] } };
const FREE_CUSTOMER = { id: 'c', metadata: { github_id: '1' }, subscriptions: { data: [] } };

test('through the real gate: a free account is refused, a paying one is served, a banned one is refused', async () => {
  const prefs = { followedChannels: ['techcrunch'] };
  const env = (mirror = freshMirror()) => ({ ...ENV, STRIPE_SECRET_KEY: 'rk_test', SIGNUP_KV: realKv(mirror, prefs) });
  const run = (e, customer) => membershipNewsFollowing(req(), e, {
    ...gateDeps(customer), queryItems: store([story('a', 'techcrunch', 1)]), sourceList: names, now: () => NOW,
  });
  assert.equal((await run(env(), FREE_CUSTOMER)).status, 403, 'free tier');
  assert.equal((await run(env(), null)).status, 403, 'no Stripe customer at all');
  const ok = await run(env(), PAID_CUSTOMER);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.items.map((i) => i.guid), ['a']);
  assert.equal((await run(env(freshMirror({ bans: { bans: [{ github_id: '1' }] } })), PAID_CUSTOMER)).status, 403, 'banned');
  assert.equal((await run(env(null), PAID_CUSTOMER)).status, 403, 'no overrides mirror fails closed');
});

test('a paying member gets only their followed sources, newest first, named, in ms', async () => {
  const kv = kvWith({ followedChannels: ['TechCrunch'] }); // stored case differs from the item's source id
  const queryItems = store([story('a', 'techcrunch', 5), story('b', 'xda', 1), story('c', 'techcrunch', 2)]);
  const r = await membershipNewsFollowing(req(), ENV, { authorize: paid, kv, queryItems, sourceList: names, now: () => NOW });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items.map((i) => i.guid), ['c', 'a']);
  assert.equal(r.body.items[0].sourceName, 'TechCrunch');
  assert.equal(r.body.items[0].publishedAt, (NOW_S - 2 * 3600) * 1000);
  assert.deepEqual(kv.reads, ['prefs:42'], 'reads the CALLER\'s own prefs record');
  assert.equal(queryItems.calls[0].since, String(NOW_S - FOLLOWED_NEWS_WINDOW_DAYS * 86400));
});

test('stories older than the window, duplicates and non-http links are dropped', async () => {
  // Kept under the cap on purpose: with more rows than the cap, the oldest story is cut by the cap and a broken
  // window check would pass unseen (a mutation run caught exactly that).
  const since = NOW_S - FOLLOWED_NEWS_WINDOW_DAYS * 86400;
  const rows = followedNewsRows([
    story('old', 'techcrunch', FOLLOWED_NEWS_WINDOW_DAYS * 24 + 1),
    story('edge', 'techcrunch', FOLLOWED_NEWS_WINDOW_DAYS * 24),
    story('bad', 'techcrunch', 1, { link: 'javascript:alert(1)' }),
    story('dup', 'techcrunch', 1), story('dup', 'techcrunch', 1),
  ], ['techcrunch'], { sinceSec: since });
  assert.deepEqual(rows.map((r) => r.guid), ['dup', 'edge']);
});

test('the cap holds at the bell\'s row limit', async () => {
  const many = Array.from({ length: FOLLOWED_NEWS_MAX + 5 }, (_, i) => story(`m${i}`, 'techcrunch', 1 + i / 100));
  assert.equal(followedNewsRows(many, ['techcrunch']).length, FOLLOWED_NEWS_MAX);
});

test('no followed sources, or a malformed prefs record, answers empty without touching the store', async () => {
  for (const prefs of [null, { followedChannels: [] }, { followedChannels: 'techcrunch' }, 'garbage']) {
    const queryItems = store([story('a', 'techcrunch', 1)]);
    const r = await membershipNewsFollowing(req(), ENV, { authorize: paid, kv: kvWith(prefs), queryItems, sourceList: names, now: () => NOW });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.items, []);
    assert.equal(queryItems.calls.length, 0);
  }
});

test('a source list that cannot load falls back to the source id instead of emptying the bell', async () => {
  const r = await membershipNewsFollowing(req(), ENV, {
    authorize: paid, kv: kvWith({ followedChannels: ['techcrunch'] }), queryItems: store([story('a', 'techcrunch', 1)]),
    sourceList: async () => { throw new Error('down'); }, now: () => NOW,
  });
  assert.equal(r.body.items[0].sourceName, 'techcrunch');
});

test('an unbound news store fails closed', async () => {
  const r = await membershipNewsFollowing(req(), {}, { authorize: paid, kv: kvWith({ followedChannels: ['x'] }), now: () => NOW });
  assert.equal(r.status, 502);
});

test('the client names a 403 as a paid-membership refusal and returns the items on 200', async () => {
  const f403 = async () => new Response('{}', { status: 403 });
  await assert.rejects(workerGetFollowedNews({ token: 't', signupBase: 'https://s', fetch: f403 }), (e) => e instanceof NewsClientError && /paid membership/.test(e.message));
  let url = '';
  const f200 = async (u) => { url = u; return new Response(JSON.stringify({ ok: true, items: [{ guid: 'g' }] }), { status: 200 }); };
  const r = await workerGetFollowedNews({ token: 't', signupBase: 'https://s/', fetch: f200 });
  assert.equal(url, 'https://s/membership/news-following');
  assert.deepEqual(r.items, [{ guid: 'g' }]);
});
