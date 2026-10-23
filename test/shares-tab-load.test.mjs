// 2026-10-22: the extension's Shares tab took about 8 seconds to show anything, and said "No Shares yet." while it
// waited. The extension listed shares itself: one whole-repo tree call, then the 40 newest share files read one after
// another (measured 10.2 s). The website had moved to the signup Worker's GET /membership/shares on 2026-09-10; the
// extension had not. These tests pin the four pieces of the fix:
//   1. listShares asks the Worker first (one request, its tier gate) and falls back to the reader on any failure;
//   2. the reader fallback reads 8 files at a time, newest first;
//   3. the Worker answers a list older than a minute at once and re-reads it in the background;
//   4. the Shares tab says "Loading shares…" while loading and names a failure, instead of "No Shares yet.".
// No network, no secrets: every fetch is a fake.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { listShares } from '../client/src/operations.mjs';
import { workerListShares, SharesClientError } from '../client/src/member-shares-client.mjs';
import { createGithubReader } from '../client/src/github-reader.mjs';
import { enumerateShares, listSharesFeed, warmSharesFeed } from '../workers/signup/membership-shares.mjs';
import { sharesCacheKey, usableSharesCache, sharesCacheEntry, SHARES_CACHE_PREFIX } from '../extension/src/shares-cache.mjs';
import { sharesEmptyText } from '../client-ui/src/feed-route.mjs';

const ident = { username: 'alice', login: 'alice', githubId: '1' };
const share = (i, visibility = 'public') => ({ id: `2026${String(1000 + i).padStart(10, '0')}-s${i}`, author: 'alice', visibility, title: `s${i}` });
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const noReader = { listShares: async () => { throw new Error('the reader must not be touched when the Worker answers'); } };

function ctxWith({ fetch, token = 'tok', reader = noReader, membership = 'paid' } = {}) {
  return {
    fetch,
    identity: () => ident,
    reader,
    membership: () => membership,
    store: { get: (k) => (k === 'githubToken' ? token : null) },
  };
}

// ---- 1. the operation asks the Worker first ---------------------------------------------------------------------

test('listShares asks the Worker once, with the bearer token, and returns its items as they come', async () => {
  const calls = [];
  const items = [share(2, 'members'), share(1)];
  const fetch = async (url, init) => { calls.push({ url, auth: init?.headers?.Authorization }); return json({ ok: true, items, nextBefore: null }); };
  const r = await listShares(ctxWith({ fetch }));
  assert.deepEqual(r.items.map((s) => s.id), items.map((s) => s.id));
  assert.equal(calls.length, 1, 'one request replaces the tree call and the per-file reads');
  assert.match(calls[0].url, /\/membership\/shares\?limit=40$/);
  assert.equal(calls[0].auth, 'Bearer tok');
});

test('listShares follows the Worker cursor when more than one page is asked for, and stops at the end', async () => {
  const all = Array.from({ length: 60 }, (_, i) => share(60 - i));
  const urls = [];
  const fetch = async (url) => {
    urls.push(url);
    const u = new URL(url);
    const limit = Number(u.searchParams.get('limit'));
    const before = u.searchParams.get('before');
    const rest = before ? all.filter((s) => s.id < before) : all;
    const page = rest.slice(0, limit);
    return json({ ok: true, items: page, nextBefore: page.length === limit ? page[page.length - 1].id : null });
  };
  const r = await listShares(ctxWith({ fetch }), { limit: 100 });
  assert.equal(r.items.length, 60, 'everything the Worker holds, no duplicates');
  assert.equal(new Set(r.items.map((s) => s.id)).size, 60);
  assert.equal(urls.length, 2);
  assert.equal(new URL(urls[1]).searchParams.get('before'), all[39].id, 'the second page starts after the first');
});

test('listShares falls back to the reader on a Worker 503, and the tier filter still applies there', async () => {
  let readerCalls = 0;
  const reader = { listShares: async () => { readerCalls += 1; return [share(2, 'members'), share(1)]; } };
  const r = await listShares(ctxWith({ fetch: async () => json({ error: 'down' }, 503), reader, membership: 'none' }));
  assert.equal(readerCalls, 1);
  assert.deepEqual(r.items.map((s) => s.visibility), ['public'], 'a free caller still gets public shares only');
});

test('listShares falls back to the reader when the fetch throws or the answer has no items', async () => {
  const reader = { listShares: async () => [share(1)] };
  const thrown = await listShares(ctxWith({ fetch: async () => { throw new Error('offline'); }, reader }));
  assert.equal(thrown.items.length, 1);
  const shapeless = await listShares(ctxWith({ fetch: async () => json({ ok: true }), reader }));
  assert.equal(shapeless.items.length, 1);
});

test('listShares with no token never calls the Worker', async () => {
  let fetched = 0;
  const reader = { listShares: async () => [share(1)] };
  const r = await listShares(ctxWith({ fetch: async () => { fetched += 1; return json({}); }, token: null, reader }));
  assert.equal(fetched, 0);
  assert.equal(r.items.length, 1);
});

test('workerListShares refuses without a token and throws on a non-2xx', async () => {
  await assert.rejects(() => workerListShares({ signupBase: 'https://x' }), SharesClientError);
  await assert.rejects(() => workerListShares({ token: 't', signupBase: 'https://x', fetch: async () => json({}, 401) }), SharesClientError);
});

// ---- 2. the reader fallback reads in parallel ----------------------------------------------------------------------

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const shareText = (id, status = 'published') => `---\ntype: share\nid: "${id}"\nauthor: a\nvisibility: public\nstatus: ${status}\ncreatedAt: "2026-01-01T00:00:00Z"\n---\nnote\n`;

test('the GitHub reader reads share files 8 at a time, newest first, skipping drafts, stopping at the limit', async () => {
  const ids = Array.from({ length: 30 }, (_, i) => `2026${String(100000 + i).padStart(10, '0')}-x${i}`);
  const draft = ids[27]; // the third newest
  let inFlight = 0;
  let maxInFlight = 0;
  let reads = 0;
  const fetch = async (url) => {
    if (url.includes('/git/trees/')) return json({ tree: ids.map((id) => ({ type: 'blob', path: `members/a/shares/${id}.md` })) });
    reads += 1;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    const id = decodeURIComponent(url.match(/shares\/([^?]+)\.md/)[1]);
    return json({ type: 'file', content: b64(shareText(id, id === draft ? 'draft' : 'published')) });
  };
  const reader = createGithubReader({ upstream: 'gbti-network/gbti.network', token: 't', fetch });
  const items = await reader.listShares(12);
  assert.ok(maxInFlight > 1, 'reads overlap');
  assert.ok(maxInFlight <= 8, `at most 8 reads at once (saw ${maxInFlight})`);
  assert.equal(items.length, 12);
  const newestFirst = [...ids].reverse().filter((id) => id !== draft).slice(0, 12);
  assert.deepEqual(items.map((s) => s.id).sort().reverse(), newestFirst, 'the 12 newest published, draft skipped');
  assert.equal(reads, 16, 'two rounds of 8, then it stops');
});

// ---- 3. the Worker serves a stale list at once and refreshes it in the background ---------------------------------

const NOW = Date.parse('2026-10-22T12:00:00Z');
const ghFiles = { 'members/alice/shares/20261022000000-new.md': shareText('20261022000000-new') };
function fakeGitHub() {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('/git/trees/')) return json({ tree: Object.keys(ghFiles).map((path) => ({ path, type: 'blob' })) });
    if (url.endsWith('/graphql')) return json({}, 502); // force the REST path, which the fake answers
    const m = url.match(/\/contents\/(.+?)\?ref=/);
    const path = m ? decodeURIComponent(m[1]) : '';
    return ghFiles[path] ? json({ content: b64(ghFiles[path]) }) : json({}, 404);
  };
  return { fetchImpl, calls };
}
function fakeKv(entry) {
  const puts = [];
  return { kv: { get: async () => entry, put: async (k, v, o) => { puts.push({ k, v: JSON.parse(v), o }); } }, puts };
}
const cachedAt = (msAgo) => ({ generatedAt: new Date(NOW - msAgo).toISOString(), items: [{ id: 'cached', visibility: 'public' }] });

test('Worker: a list under a minute old is served with no GitHub call', async () => {
  const gh = fakeGitHub();
  const { kv } = fakeKv(cachedAt(30_000));
  const items = await enumerateShares({}, { fetchImpl: gh.fetchImpl, kv, getToken: async () => 't', now: NOW, waitUntil: () => assert.fail('nothing to refresh') });
  assert.deepEqual(items.map((s) => s.id), ['cached']);
  assert.equal(gh.calls.length, 0);
});

test('Worker: a list between a minute and three hours old is served at once and re-read through waitUntil', async () => {
  const gh = fakeGitHub();
  const { kv, puts } = fakeKv(cachedAt(5 * 60_000));
  const background = [];
  const items = await enumerateShares({}, { fetchImpl: gh.fetchImpl, kv, getToken: async () => 't', now: NOW, waitUntil: (p) => background.push(p) });
  assert.deepEqual(items.map((s) => s.id), ['cached'], 'the answer does not wait on GitHub');
  assert.equal(background.length, 1, 'one background refresh');
  await Promise.all(background);
  assert.ok(gh.calls.some((u) => u.includes('/git/trees/')), 'the refresh read GitHub');
  assert.equal(puts.length, 1);
  assert.deepEqual(puts[0].v.items.map((s) => s.id), ['20261022000000-new'], 'the fresh list replaced the cache');
  assert.equal(puts[0].o.expirationTtl, 3 * 3600, 'kept for three hours (2026-10-23; it was one)');
});

test('Worker: a stale list with no waitUntil (the digest) or an hour old is read fresh, as before', async () => {
  for (const [label, entry, waitUntil] of [['no waitUntil', cachedAt(5 * 60_000), null], ['over three hours', cachedAt(4 * 3_600_000), () => assert.fail('not served stale')]]) {
    const gh = fakeGitHub();
    const { kv } = fakeKv(entry);
    const items = await enumerateShares({}, { fetchImpl: gh.fetchImpl, kv, getToken: async () => 't', now: NOW, waitUntil });
    assert.deepEqual(items.map((s) => s.id), ['20261022000000-new'], label);
  }
});

test('Worker: the tier filter still runs on every request when the list comes from the cache', async () => {
  const { kv } = fakeKv({ generatedAt: new Date(NOW - 5 * 60_000).toISOString(), items: [{ id: 'b', visibility: 'members' }, { id: 'a', visibility: 'public' }] });
  const deps = { kv, now: NOW, waitUntil: () => {}, getToken: async () => 't', fetchImpl: fakeGitHub().fetchImpl };
  const req = new Request('https://signup.gbti.network/membership/shares');
  const paid = await listSharesFeed(req, {}, { ...deps, authorize: async () => ({ ok: true, status: 'paid' }) });
  const free = await listSharesFeed(req, {}, { ...deps, authorize: async () => ({ ok: true, status: 'none' }) });
  assert.deepEqual(paid.body.items.map((s) => s.id), ['b', 'a']);
  assert.deepEqual(free.body.items.map((s) => s.id), ['a']);
});

test('the shares route hands the Worker its waitUntil', () => {
  const src = fs.readFileSync(new URL('../workers/signup/member-routes.mjs', import.meta.url), 'utf8');
  assert.match(src, /listSharesFeed\(request, env, \{ waitUntil: ctx\?\.waitUntil \? \(p\) => ctx\.waitUntil\(p\) : null \}\)/);
});

// ---- 4. the Shares tab says what is happening -------------------------------------------------------------------

test('sharesEmptyText: loading while the list is coming, a failure named, "No Shares yet." only when loaded', () => {
  assert.equal(sharesEmptyText({}), 'Loading shares…');
  assert.equal(sharesEmptyText({ failed: true }), 'Shares could not be loaded right now.');
  assert.equal(sharesEmptyText({ loaded: true }), 'No Shares yet.');
  assert.equal(sharesEmptyText({ loaded: true, failed: true }), 'No Shares yet.', 'a loaded list wins over an older failure');
});

test('the new tab uses that text and starts the shares fetch before the membership check', () => {
  const src = fs.readFileSync(new URL('../extension/src/newtab.mjs', import.meta.url), 'utf8');
  assert.match(src, /TYPE === 'share' \? sharesEmptyText\(\{ loaded: SHARES_LOADED, failed: SHARES_FAILED && !SHARES_INFLIGHT \}\)/);
  assert.doesNotMatch(src, /TYPE === 'share' \? 'No Shares yet\.'/);
  const init = src.slice(src.indexOf('function init()'));
  const early = init.indexOf('ensureSharesForFilter();');
  const status = init.indexOf('applyMembershipState()');
  assert.ok(early > -1 && status > -1 && early < status, 'the shares fetch starts before the status check returns');
});

// ---- 5. 2026-10-23: the timer keeps the Worker's list warm --------------------------------------------------------
// The owner's first Shares tab of the morning still took 6 s: nobody had read the list for over an hour, so the Worker
// rebuilt it cold (3.7 to 5.1 s measured). The 5-minute timer now re-reads it every half hour.

test('warmSharesFeed re-reads a list older than 30 minutes, or a missing one, and writes it with the 3-hour keep', async () => {
  for (const [label, entry] of [['31 minutes old', cachedAt(31 * 60_000)], ['missing', null], ['no readable time', { items: [] }]]) {
    const gh = fakeGitHub();
    const { kv, puts } = fakeKv(entry);
    const r = await warmSharesFeed({}, { kv, now: NOW, fetchImpl: gh.fetchImpl, getToken: async () => 't' });
    assert.equal(r.warmed, true, label);
    assert.ok(gh.calls.some((u) => u.includes('/git/trees/')), `${label}: it read GitHub`);
    assert.equal(puts.length, 1, label);
    assert.equal(puts[0].o.expirationTtl, 3 * 3600, label);
  }
});

test('warmSharesFeed leaves a list under 30 minutes old alone, with no GitHub call', async () => {
  const gh = fakeGitHub();
  const { kv, puts } = fakeKv(cachedAt(29 * 60_000));
  const r = await warmSharesFeed({}, { kv, now: NOW, fetchImpl: gh.fetchImpl, getToken: async () => 't' });
  assert.equal(r.warmed, false);
  assert.equal(gh.calls.length, 0);
  assert.equal(puts.length, 0);
});

test('a failed warm-up read throws to the timer, which catches it and keeps draining', async () => {
  const { kv } = fakeKv(null);
  await assert.rejects(() => warmSharesFeed({}, { kv, now: NOW, fetchImpl: async () => json({}, 502), getToken: async () => 't' }));
  const src = fs.readFileSync(new URL('../workers/signup/cron.mjs', import.meta.url), 'utf8');
  const start = src.indexOf('async function drainFiveMinute');
  const end = src.indexOf('const CRON_JOBS');
  assert.ok(start > -1 && end > start, 'control: the drain function is found and bounded');
  const drain = src.slice(start, end);
  assert.match(drain, /try \{ shares = await warmSharesFeed\(env\); \} catch \(e\) \{ shares = \{ error:/, 'the 5-minute drain runs it, fail-soft');
  assert.match(drain, /return \{[^}]*\bshares \}/, 'and logs what it did');
});

// ---- 6. 2026-10-23: the new tab paints the account's last list at once ---------------------------------------------

test('the remembered list is keyed per account and never without one', () => {
  assert.equal(sharesCacheKey({ githubId: '125175036' }), `${SHARES_CACHE_PREFIX}125175036`);
  assert.equal(sharesCacheKey({ githubId: 42 }), `${SHARES_CACHE_PREFIX}42`);
  for (const id of [null, undefined, {}, { githubId: '' }, { githubId: 'alice' }, { login: 'alice' }]) assert.equal(sharesCacheKey(id), null);
});

test('a remembered list over a day old, empty, malformed or from the future is not shown', () => {
  const now = NOW;
  const items = [share(1)];
  assert.deepEqual(usableSharesCache({ at: now - 60_000, items }, now), items);
  assert.equal(usableSharesCache({ at: now - 25 * 3_600_000, items }, now), null);
  assert.equal(usableSharesCache({ at: now + 60_000, items }, now), null);
  assert.equal(usableSharesCache({ at: now, items: [] }, now), null);
  assert.equal(usableSharesCache({ at: 'x', items }, now), null);
  assert.equal(usableSharesCache(null, now), null);
});

test('the remembered entry holds the 40 newest summaries and a time, nothing else', () => {
  const e = sharesCacheEntry(Array.from({ length: 50 }, (_, i) => share(i)), NOW);
  assert.deepEqual(Object.keys(e).sort(), ['at', 'items']);
  assert.equal(e.at, NOW);
  assert.equal(e.items.length, 40);
});

test('the new tab reads the remembered list before fetching, writes it after a good fetch, and never counts it as loaded', () => {
  const src = fs.readFileSync(new URL('../extension/src/newtab.mjs', import.meta.url), 'utf8');
  const init = src.slice(src.indexOf('function init()'));
  const read = init.indexOf('readSharesCache()');
  const fetchEarly = init.indexOf('ensureSharesForFilter();');
  assert.ok(read > -1 && read < fetchEarly, 'read before the early fetch starts');
  const paint = init.slice(read, fetchEarly);
  assert.match(paint, /if \(cached && !SHARES_LOADED && !\(Array\.isArray\(SHARES\) && SHARES\.length\)\) \{ SHARES = cached; renderFeed/);
  assert.doesNotMatch(paint, /SHARES_LOADED = true/, 'a remembered list is not a load: the fetch still runs');
  const fetchFn = src.slice(src.indexOf('async function fetchShares'), src.indexOf('async function ensureSharesForFilter'));
  assert.match(fetchFn, /SHARES_LOADED = true;\n\s+SHARES_FAILED = false;\n\s+writeSharesCache\(SHARES\);/, 'written only after a successful fetch');
});

test('sign-out removes every remembered Shares list', () => {
  const src = fs.readFileSync(new URL('../extension/src/background.mjs', import.meta.url), 'utf8');
  const signout = src.slice(src.indexOf("msg?.type === 'signout'"), src.indexOf("msg?.type === 'open-page'"));
  assert.match(signout, /k\.startsWith\('gbti:shares:'\)/);
});
