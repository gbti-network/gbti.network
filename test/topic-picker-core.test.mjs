// SOW-054 Phase 3/5: the pure followed-topics picker helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { topicsFromJson, toggleTopic, selectedTopics } from '../client-ui/src/topic-picker-core.mjs';

test('topicsFromJson: clean list; drops malformed; label falls back to key', () => {
  assert.deepEqual(topicsFromJson({ topics: [{ key: 'ai', label: 'AI' }, { key: 'devops', label: 'DevOps' }] }),
    [{ key: 'ai', label: 'AI' }, { key: 'devops', label: 'DevOps' }]);
  assert.deepEqual(topicsFromJson({ topics: [{ key: 'x' }, { label: 'no key' }, null, 7] }), [{ key: 'x', label: 'x' }]);
  assert.deepEqual(topicsFromJson(null), []);
  assert.deepEqual(topicsFromJson({}), []);
});

test('toggleTopic: adds if absent, removes if present, returns a NEW array, de-dupes, order-stable', () => {
  assert.deepEqual(toggleTopic([], 'ai'), ['ai']);
  assert.deepEqual(toggleTopic(['ai'], 'devops'), ['ai', 'devops']);
  assert.deepEqual(toggleTopic(['ai', 'devops'], 'ai'), ['devops']); // remove
  assert.deepEqual(toggleTopic(['ai', 'ai'], 'devops'), ['ai', 'devops']); // de-dupe existing
  assert.deepEqual(toggleTopic(['ai'], ''), ['ai']); // falsy key -> no-op (deduped passthrough)
  // does not mutate the input
  const src = ['ai'];
  toggleTopic(src, 'devops');
  assert.deepEqual(src, ['ai']);
});

test('selectedTopics: normalizes a stored prefs.categories into a clean key set', () => {
  assert.deepEqual(selectedTopics(['ai', 'devops', 'ai', 7, '']), ['ai', 'devops']);
  assert.deepEqual(selectedTopics(null), []);
  assert.deepEqual(selectedTopics('ai'), []); // non-array -> []
});
