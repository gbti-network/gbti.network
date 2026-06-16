// SOW-017: the activity-index builder. Newest-first ordering, undated entries sink, and the cap holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildActivityIndex } from '../src/lib/activity.mjs';

const e = (slug, publishedAt) => ({ type: 'post', slug, title: slug, author: 'a', url: `/articles/${slug}/`, publishedAt });

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
