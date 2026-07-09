// SOW-024: the favorite-counts sync (KV -> house/favorite-counts.yml). Tests the pure aggregator, the count
// comparison, the Cloudflare KV REST reader (fake fetch), and the sync orchestrator (fake github), all with no
// network and no secrets. The whole point of SOW-024 is that NO member identity reaches git, so the aggregator
// is asserted to carry only per-target totals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateFavoriteCounts, countsEqual, listAllActivityFromKv, syncFavoriteCounts, renderCountsFile,
  aggregateFavoritedBy, favoritedByEqual, renderFavoritedByFile, readPublicFavoritesOptIns,
} from '../scripts/lib/favorite-counts.mjs';

test('aggregateFavoriteCounts folds members into member-identity-free per-target totals', () => {
  const counts = aggregateFavoriteCounts([
    { favorites: [{ type: 'product', slug: 'radle', addedAt: 1 }, { type: 'post', slug: 'hello', addedAt: 2 }], githubId: '111' },
    { favorites: [{ type: 'product', slug: 'radle', addedAt: 3 }], githubId: '222' },
  ]);
  assert.deepEqual(counts, { 'post:hello': 1, 'product:radle': 2 });
  // No member identity leaked: the result is a flat string->number map only.
  for (const v of Object.values(counts)) assert.equal(typeof v, 'number');
});

test('aggregateFavoriteCounts dedupes within a single member and skips malformed entries', () => {
  const counts = aggregateFavoriteCounts([
    { favorites: [{ type: 'prompt', slug: 'a' }, { type: 'prompt', slug: 'a' }] }, // dup -> counts once
    { favorites: [{ type: 'widget', slug: 'x' }, { type: 'post', slug: 'Bad Slug' }, { type: 'post', slug: '../evil' }, null] }, // all invalid
  ]);
  assert.deepEqual(counts, { 'prompt:a': 1 });
});

test('aggregateFavoriteCounts returns {} for empty / non-array input and sorts keys', () => {
  assert.deepEqual(aggregateFavoriteCounts([]), {});
  assert.deepEqual(aggregateFavoriteCounts(null), {});
  const counts = aggregateFavoriteCounts([{ favorites: [{ type: 'post', slug: 'z' }, { type: 'post', slug: 'a' }] }]);
  assert.deepEqual(Object.keys(counts), ['post:a', 'post:z']);
});

test('countsEqual ignores order, zero/negative, and non-integers', () => {
  assert.ok(countsEqual({ 'post:a': 1, 'post:b': 2 }, { 'post:b': 2, 'post:a': 1 }));
  assert.ok(countsEqual({ 'post:a': 1, 'post:z': 0 }, { 'post:a': 1 })); // a 0 is dropped on normalize
  assert.ok(!countsEqual({ 'post:a': 1 }, { 'post:a': 2 }));
});

test('listAllActivityFromKv is a reported no-op without CF credentials', async () => {
  const r = await listAllActivityFromKv({ env: {}, fetchImpl: () => { throw new Error('should not fetch'); } });
  assert.equal(r.available, false);
  assert.match(r.reason, /CF_ACCOUNT_ID/);
  assert.deepEqual(r.activities, []);
});

test('listAllActivityFromKv paginates keys then reads each value', async () => {
  const env = { CF_ACCOUNT_ID: 'acct', CF_KV_NAMESPACE_ID: 'ns', CF_API_TOKEN: 'tok' };
  const store = {
    'activity:111': { favorites: [{ type: 'post', slug: 'a' }] },
    'activity:222': { favorites: [{ type: 'post', slug: 'a' }, { type: 'product', slug: 'radle' }] },
  };
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('/keys')) {
      // Two pages to exercise the cursor loop.
      if (!url.includes('cursor=')) {
        return { ok: true, json: async () => ({ result: [{ name: 'activity:111' }], result_info: { cursor: 'NEXT' } }) };
      }
      return { ok: true, json: async () => ({ result: [{ name: 'activity:222' }], result_info: { cursor: '' } }) };
    }
    // values endpoint
    const key = decodeURIComponent(url.split('/values/')[1]);
    return { ok: true, json: async () => store[key] };
  };
  const r = await listAllActivityFromKv({ env, fetchImpl });
  assert.equal(r.available, true);
  assert.equal(r.count, 2);
  assert.deepEqual(aggregateFavoriteCounts(r.activities), { 'post:a': 2, 'product:radle': 1 });
  assert.ok(calls.some((u) => u.includes('cursor=NEXT')), 'followed the pagination cursor');
});

test('syncFavoriteCounts skips when KV is unavailable', async () => {
  const r = await syncFavoriteCounts({ listActivities: async () => ({ available: false, reason: 'no creds' }) });
  assert.equal(r.synced, false);
  assert.match(r.reason, /no creds/);
});

test('syncFavoriteCounts is a no-op when counts are unchanged (no churn PR)', async () => {
  let opened = false;
  const github = { createPull: async () => { opened = true; return { number: 1 }; } };
  const r = await syncFavoriteCounts({
    github,
    listActivities: async () => ({ available: true, activities: [{ favorites: [{ type: 'post', slug: 'a' }] }] }),
    readCurrentCounts: () => ({ 'post:a': 1 }),
  });
  assert.equal(r.synced, false);
  assert.match(r.reason, /unchanged/);
  assert.equal(opened, false);
});

test('syncFavoriteCounts opens + merges a PR when the counts changed', async () => {
  const seen = {};
  const github = {
    getRef: async (ref) => { seen.ref = ref; return { object: { sha: 'base-sha' } }; },
    createRef: async (branch, sha) => { seen.branch = branch; seen.fromSha = sha; },
    getContent: async () => ({ sha: 'old-file-sha' }),
    putContent: async (p, opts) => { seen.path = p; seen.content = Buffer.from(opts.content, 'base64').toString('utf8'); seen.putSha = opts.sha; },
    createPull: async (o) => { seen.pull = o; return { number: 42 }; },
    mergePull: async (n, o) => { seen.merged = { n, ...o }; },
  };
  const now = new Date('2026-06-13T00:00:00.000Z');
  const r = await syncFavoriteCounts({
    github, now,
    listActivities: async () => ({ available: true, activities: [
      { favorites: [{ type: 'post', slug: 'a' }] },
      { favorites: [{ type: 'post', slug: 'a' }, { type: 'product', slug: 'radle' }] },
    ] }),
    readCurrentCounts: () => ({}), // empty -> changed
  });
  assert.equal(r.synced, true);
  assert.equal(r.prNumber, 42);
  assert.equal(r.total, 2);
  assert.equal(seen.path, 'house/favorite-counts.yml');
  assert.equal(seen.putSha, 'old-file-sha');
  assert.equal(seen.merged.method, 'squash');
  // The written file carries totals + a timestamp, and NO per-member field (addedAt is the per-favorite field
  // that would leak if the aggregation passed records through; the published file must never contain it).
  assert.match(seen.content, /post:a: 2/);
  assert.match(seen.content, /product:radle: 1/);
  assert.match(seen.content, /generatedAt: '2026-06-13T00:00:00.000Z'/);
  assert.ok(!/addedAt/.test(seen.content), 'no per-member addedAt leaked into the published counts');
});

test('renderCountsFile produces a stable header + sorted YAML', () => {
  const out = renderCountsFile({ 'post:a': 1, 'product:radle': 2 }, new Date('2026-06-13T00:00:00.000Z'));
  assert.match(out, /^# SOW-024: aggregate favorite counts/);
  assert.match(out, /counts:/);
  assert.match(out, /post:a: 1/);
});

// ---- SOW-114: the OPT-IN public favorited-by lists ----

const ENTRIES = [
  { githubId: '1', activity: { favorites: [{ type: 'post', slug: 'a' }, { type: 'prompt', slug: 'p' }] } },
  { githubId: '2', activity: { favorites: [{ type: 'post', slug: 'a' }] } },
  { githubId: '3', activity: { favorites: [{ type: 'post', slug: 'a' }, { type: 'bad type', slug: 'x!' }] } },
];
const INDEX = { 1: 'alice', 2: 'bob', 3: 'cara' };

test('aggregateFavoritedBy publishes ONLY opted-in members that resolve to a username', () => {
  const out = aggregateFavoritedBy(ENTRIES, { optedIn: new Set(['1', '3']), membersIndex: INDEX });
  // bob (id 2) never opted in; cara's malformed favorite is skipped but her valid one lands.
  assert.deepEqual(out, { 'post:a': ['alice', 'cara'], 'prompt:p': ['alice'] });
  // Nobody opted in -> nothing published, whatever the activity says.
  assert.deepEqual(aggregateFavoritedBy(ENTRIES, { optedIn: new Set(), membersIndex: INDEX }), {});
  // An opted-in id with NO members-index entry publishes nothing (no raw github_id ever leaks).
  const noIndex = aggregateFavoritedBy(ENTRIES, { optedIn: new Set(['1']), membersIndex: {} });
  assert.deepEqual(noIndex, {});
});

test('favoritedByEqual + renderFavoritedByFile: stable compare, consent header, no github_id in the file', () => {
  assert.equal(favoritedByEqual({ 'post:a': ['b', 'a'] }, { 'post:a': ['a', 'b'] }), true);
  assert.equal(favoritedByEqual({ 'post:a': ['a'] }, {}), false);
  const out = renderFavoritedByFile({ 'post:a': ['alice'] }, new Date('2026-07-08T00:00:00.000Z'));
  assert.match(out, /OPT-IN ONLY/);
  assert.match(out, /post:a:/);
  assert.match(out, /- alice/);
});

test('readPublicFavoritesOptIns fails CLOSED per key (missing creds, bad status, junk JSON)', async () => {
  // No creds -> empty set, no fetch.
  const none = await readPublicFavoritesOptIns({ env: {}, ids: ['1'], fetchImpl: () => { throw new Error('no fetch'); } });
  assert.equal(none.size, 0);
  const env = { CF_ACCOUNT_ID: 'acc', CF_KV_NAMESPACE_ID: 'ns', CF_API_TOKEN: 't' };
  const fetchImpl = async (url) => {
    if (url.includes(encodeURIComponent('prefs:1'))) return { ok: true, json: async () => ({ publicFavorites: true }) };
    if (url.includes(encodeURIComponent('prefs:2'))) return { ok: true, json: async () => ({ publicFavorites: 'yes' }) }; // junk never opts in
    if (url.includes(encodeURIComponent('prefs:3'))) return { ok: false, status: 404 };
    throw new Error('network down');
  };
  const opted = await readPublicFavoritesOptIns({ env, ids: ['1', '2', '3', '4'], fetchImpl });
  assert.deepEqual([...opted], ['1']);
});

test('syncFavoriteCounts writes favorited-by.yml alongside the counts in ONE PR, and opt-out removal syncs', async () => {
  const puts = [];
  const github = {
    getRef: async () => ({ object: { sha: 'base' } }),
    createRef: async () => {},
    getContent: async () => null,
    putContent: async (p, opts) => puts.push({ path: p, content: Buffer.from(opts.content, 'base64').toString('utf8') }),
    createPull: async () => ({ number: 7 }),
    mergePull: async () => {},
  };
  const r = await syncFavoriteCounts({
    github,
    now: new Date('2026-07-08T00:00:00.000Z'),
    listActivities: async () => ({ available: true, activities: ENTRIES.map((e) => e.activity), entries: ENTRIES }),
    readCurrentCounts: () => ({}),
    readCurrentFavoritedBy: () => ({}),
    readMembersIndex: () => INDEX,
    readOptIns: async () => new Set(['1']),
  });
  assert.equal(r.synced, true);
  assert.equal(r.publicTargets, 2);
  assert.deepEqual(puts.map((x) => x.path).sort(), ['house/favorite-counts.yml', 'house/favorited-by.yml']);
  const favBy = puts.find((x) => x.path === 'house/favorited-by.yml').content;
  assert.match(favBy, /- alice/);
  assert.ok(!/bob|cara/.test(favBy), 'non-opted-in members never appear');
  assert.ok(!/^\s*- '?[0-9]+'?\s*$/m.test(favBy), 'no raw numeric github_id ever appears as a list entry');

  // Opt-out removal: same activity, the member no longer opted in, disk still lists them -> favorited-by
  // changes (them dropped) even though counts are identical.
  const puts2 = [];
  const github2 = { ...github, putContent: async (p, opts) => puts2.push({ path: p, content: Buffer.from(opts.content, 'base64').toString('utf8') }) };
  const r2 = await syncFavoriteCounts({
    github: github2,
    listActivities: async () => ({ available: true, activities: ENTRIES.map((e) => e.activity), entries: ENTRIES }),
    readCurrentCounts: () => ({ 'post:a': 3, 'prompt:p': 1 }), // counts unchanged
    readCurrentFavoritedBy: () => ({ 'post:a': ['alice'], 'prompt:p': ['alice'] }),
    readMembersIndex: () => INDEX,
    readOptIns: async () => new Set(), // alice opted out (or was erased)
  });
  assert.equal(r2.synced, true);
  assert.deepEqual(puts2.map((x) => x.path), ['house/favorited-by.yml']); // only the changed file rides the PR
  assert.ok(!/alice/.test(puts2[0].content), 'the opted-out member drops off on the next sync');
});
