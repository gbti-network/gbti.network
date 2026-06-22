// SOW-057: the share upvote-counts sync (KV -> house/upvote-counts.yml). Mirrors favorite-counts.test.mjs.
// Asserts NO member identity reaches git: only per-target totals, share-only, with the composite slug.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateUpvoteCounts, countsEqual, syncUpvoteCounts, renderCountsFile,
} from '../scripts/lib/upvote-counts.mjs';

test('aggregateUpvoteCounts folds members into member-identity-free per-target totals (share-only)', () => {
  const counts = aggregateUpvoteCounts([
    { upvotes: [{ type: 'share', slug: 'alice/note-1', addedAt: 1 }], githubId: '111' },
    { upvotes: [{ type: 'share', slug: 'alice/note-1', addedAt: 2 }], githubId: '222' },
  ]);
  assert.deepEqual(counts, { 'share:alice/note-1': 2 });
  for (const v of Object.values(counts)) assert.equal(typeof v, 'number');
});

test('aggregateUpvoteCounts dedupes within a member and skips non-share + malformed entries', () => {
  const counts = aggregateUpvoteCounts([
    { upvotes: [{ type: 'share', slug: 'me/x' }, { type: 'share', slug: 'me/x' }] }, // dup -> once
    { upvotes: [{ type: 'post', slug: 'hello' }, { type: 'share', slug: 'bad slug' }, { type: 'share', slug: 'no-second-segment' }, null] },
  ]);
  assert.deepEqual(counts, { 'share:me/x': 1 }); // post excluded (v1 is share-only), bad slugs dropped
});

test('aggregateUpvoteCounts returns {} for empty input and sorts keys', () => {
  assert.deepEqual(aggregateUpvoteCounts([]), {});
  assert.deepEqual(aggregateUpvoteCounts(null), {});
  const counts = aggregateUpvoteCounts([{ upvotes: [{ type: 'share', slug: 'z/b' }, { type: 'share', slug: 'a/b' }] }]);
  assert.deepEqual(Object.keys(counts), ['share:a/b', 'share:z/b']);
});

test('syncUpvoteCounts skips when KV is unavailable and when unchanged', async () => {
  const off = await syncUpvoteCounts({ listActivities: async () => ({ available: false, reason: 'no creds' }) });
  assert.equal(off.synced, false);
  let opened = false;
  const github = { createPull: async () => { opened = true; return { number: 1 }; } };
  const same = await syncUpvoteCounts({
    github,
    listActivities: async () => ({ available: true, activities: [{ upvotes: [{ type: 'share', slug: 'a/b' }] }] }),
    readCurrentCounts: () => ({ 'share:a/b': 1 }),
  });
  assert.equal(same.synced, false);
  assert.match(same.reason, /unchanged/);
  assert.equal(opened, false);
});

test('syncUpvoteCounts opens + merges a PR when counts change, leaking no per-member field', async () => {
  const seen = {};
  const github = {
    getRef: async () => ({ object: { sha: 'base-sha' } }),
    createRef: async (b, s) => { seen.branch = b; seen.fromSha = s; },
    getContent: async () => ({ sha: 'old' }),
    putContent: async (p, opts) => { seen.path = p; seen.content = Buffer.from(opts.content, 'base64').toString('utf8'); },
    createPull: async (o) => { seen.pull = o; return { number: 7 }; },
    mergePull: async (n, o) => { seen.merged = { n, ...o }; },
  };
  const now = new Date('2026-06-22T00:00:00.000Z');
  const r = await syncUpvoteCounts({
    github, now,
    listActivities: async () => ({ available: true, activities: [
      { upvotes: [{ type: 'share', slug: 'a/b', addedAt: 9 }] },
      { upvotes: [{ type: 'share', slug: 'a/b' }] },
    ] }),
    readCurrentCounts: () => ({}),
  });
  assert.equal(r.synced, true);
  assert.equal(r.prNumber, 7);
  assert.equal(seen.path, 'house/upvote-counts.yml');
  assert.equal(seen.merged.method, 'squash');
  assert.match(seen.content, /share:a\/b: 2/);
  assert.ok(!/addedAt/.test(seen.content), 'no per-member addedAt leaked');
});

test('countsEqual + renderCountsFile behave for the share key shape', () => {
  assert.ok(countsEqual({ 'share:a/b': 1 }, { 'share:a/b': 1 }));
  assert.ok(!countsEqual({ 'share:a/b': 1 }, { 'share:a/b': 2 }));
  const out = renderCountsFile({ 'share:a/b': 3 }, new Date('2026-06-22T00:00:00.000Z'));
  assert.match(out, /^# SOW-057: aggregate share upvote counts/);
  assert.match(out, /share:a\/b: 3/);
});
