// SOW-017 (+ SOW-111): the activity-index builder. Newest-first ordering, undated entries sink, and the cap
// holds PER TYPE (a prolific type can no longer crowd the others out of the river).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildActivityIndex } from '../src/lib/activity.mjs';

const e = (slug, publishedAt, type = 'post') => ({ type, slug, title: slug, author: 'a', url: `/articles/${slug}/`, publishedAt });

test('buildActivityIndex sorts newest-first, sinks undated, and caps', () => {
  const out = buildActivityIndex([e('old', 1000), e('new', 3000), e('mid', 2000), e('undated', null)], 3);
  assert.deepEqual(out.map((x) => x.slug), ['new', 'mid', 'old']); // newest first; undated dropped by the cap
  assert.equal(out.length, 3);
  // undated sinks below dated when within the cap
  const full = buildActivityIndex([e('undated', null), e('dated', 5)]);
  assert.deepEqual(full.map((x) => x.slug), ['dated', 'undated']);
  // does not mutate the input
  const input = [e('b', 2), e('a', 1)];
  buildActivityIndex(input);
  assert.deepEqual(input.map((x) => x.slug), ['b', 'a']);
});

// SOW-111: the cap is per type, so each type contributes its newest `limit` to the merged river.
test('buildActivityIndex caps PER TYPE and keeps the merged order newest-first', () => {
  const items = [
    e('p1', 100, 'prompt'), e('p2', 90, 'prompt'), e('p3', 80, 'prompt'),
    e('a1', 95, 'post'), e('a2', 60, 'post'), e('a3', 50, 'post'),
    e('x1', 85, 'product'),
  ];
  const out = buildActivityIndex(items, 2);
  // two prompts (newest two), two posts, one product; merged newest-first
  assert.deepEqual(out.map((x) => x.slug), ['p1', 'a1', 'p2', 'x1', 'a2']);
  assert.equal(out.filter((x) => x.type === 'prompt').length, 2);
  assert.equal(out.filter((x) => x.type === 'post').length, 2);
});
