// sow-307: the panel's first-sync decision and its local toggle, pure.
import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeTagsOnFirstSync, toggleTagLocally } from '../src/lib/followed-tags-core.mjs';

test('first sync: the account wins whenever it holds anything, and nothing is pushed', () => {
  assert.deepEqual(mergeTagsOnFirstSync(['browser-only'], ['account-a']), { tags: ['account-a'], push: null });
  assert.deepEqual(mergeTagsOnFirstSync([], ['#Account-B']), { tags: ['account-b'], push: null }, 'normalized on the way in');
});

test('first sync: an empty account adopts the browser list, once, and pushes it up', () => {
  assert.deepEqual(mergeTagsOnFirstSync(['#Claude-Code', 'claude-code', 'x y'], []), { tags: ['claude-code'], push: ['claude-code'] });
  assert.deepEqual(mergeTagsOnFirstSync(['a'], undefined), { tags: ['a'], push: ['a'] }, 'a record that predates the field counts as empty');
});

test('first sync: nothing anywhere is nothing, with no write', () => {
  assert.deepEqual(mergeTagsOnFirstSync([], []), { tags: [], push: null });
  assert.deepEqual(mergeTagsOnFirstSync('junk', null), { tags: [], push: null });
});

test('local toggle: follows and unfollows with the Worker rule, and refuses past the cap', () => {
  assert.deepEqual(toggleTagLocally([], '#Rate-Limits', true), ['rate-limits']);
  assert.deepEqual(toggleTagLocally(['rate-limits'], 'rate-limits', true), ['rate-limits'], 'idempotent');
  assert.deepEqual(toggleTagLocally(['rate-limits', 'ai'], 'RATE-LIMITS', false), ['ai']);
  const full = Array.from({ length: 50 }, (_, i) => `t${i}`);
  assert.equal(toggleTagLocally(full, 'one-more', true), null, 'the panel shows the limit instead of dropping one');
  assert.deepEqual(toggleTagLocally(full, 't0', false).length, 49, 'unfollowing at the cap works');
  assert.deepEqual(toggleTagLocally(['a'], 'not a tag', true), ['a'], 'an invalid tag changes nothing');
});
