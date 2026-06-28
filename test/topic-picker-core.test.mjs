// SOW-054 Phase 3/5: the pure followed-topics picker helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { topicsFromJson, toggleTopic, selectedTopics, filterTopics, groupTopics } from '../client-ui/src/topic-picker-core.mjs';

test('topicsFromJson: clean list; drops malformed; label falls back to key', () => {
  assert.deepEqual(topicsFromJson({ topics: [{ key: 'ai', label: 'AI' }, { key: 'devops', label: 'DevOps' }] }),
    [{ key: 'ai', label: 'AI' }, { key: 'devops', label: 'DevOps' }]);
  assert.deepEqual(topicsFromJson({ topics: [{ key: 'x' }, { label: 'no key' }, null, 7] }), [{ key: 'x', label: 'x' }]);
  assert.deepEqual(topicsFromJson(null), []);
  // SOW-080: an optional group is carried through
  assert.deepEqual(topicsFromJson({ topics: [{ key: 'ai', label: 'AI', group: 'Tech' }] }), [{ key: 'ai', label: 'AI', group: 'Tech' }]);
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

// SOW-080: the larger-vocabulary picker affordances.
const LIST = [{ key: 'ai', label: 'AI' }, { key: 'home-network', label: 'Home Network' }, { key: 'cooking', label: 'Cooking' }];

test('filterTopics: case-insensitive label/key substring; blank query returns all', () => {
  assert.deepEqual(filterTopics(LIST, ''), LIST);
  assert.deepEqual(filterTopics(LIST, '  '), LIST);
  assert.deepEqual(filterTopics(LIST, 'net').map((t) => t.key), ['home-network']); // matches the label "Home Network"
  assert.deepEqual(filterTopics(LIST, 'COOK').map((t) => t.key), ['cooking']);
  assert.deepEqual(filterTopics(LIST, 'home-net').map((t) => t.key), ['home-network']); // matches the key
  assert.deepEqual(filterTopics(LIST, 'zzz'), []);
  assert.deepEqual(filterTopics(null, 'x'), []);
});

test('groupTopics: first-seen group order, ungrouped bucket last; a flat list -> one ungrouped bucket', () => {
  const grouped = groupTopics([
    { key: 'ai', label: 'AI', group: 'Tech' },
    { key: 'cooking', label: 'Cooking' }, // ungrouped
    { key: 'devops', label: 'DevOps', group: 'Tech' },
    { key: 'finance', label: 'Finance', group: 'Business' },
  ]);
  assert.deepEqual(grouped.map((g) => g.group), ['Tech', 'Business', '']); // ungrouped trails
  assert.deepEqual(grouped[0].topics.map((t) => t.key), ['ai', 'devops']);
  // a fully flat list -> a single ungrouped bucket (backward-compatible)
  assert.deepEqual(groupTopics(LIST), [{ group: '', topics: LIST }]);
});
