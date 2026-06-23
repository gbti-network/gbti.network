// SOW-054 Phase 2: the pure browse category drill-down helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { primaryChips, subChips, filterByCategoryPath } from '../client-ui/src/browse-filter-core.mjs';

const items = [
  { categories: ['ai', 'agents'], categoryLabels: ['AI', 'Agents'] },
  { categories: ['ai', 'llms'], categoryLabels: ['AI', 'LLMs'] },
  { categories: ['ai'], categoryLabels: ['AI'] },
  { categories: ['devops', 'frameworks'], categoryLabels: ['DevOps', 'Frameworks'] },
  { categories: [], categoryLabels: [] }, // no category (e.g. a Share)
  {}, // malformed
];

test('primaryChips: distinct primaries with counts, sorted by label; uncategorized excluded', () => {
  assert.deepEqual(primaryChips(items), [
    { key: 'ai', label: 'AI', count: 3 },
    { key: 'devops', label: 'DevOps', count: 1 },
  ]);
  assert.deepEqual(primaryChips([]), []);
  assert.deepEqual(primaryChips(null), []);
});

test('subChips: subcategories under a selected primary, with counts; [] without a primary', () => {
  assert.deepEqual(subChips(items, 'ai'), [
    { key: 'agents', label: 'Agents', count: 1 },
    { key: 'llms', label: 'LLMs', count: 1 },
  ]);
  assert.deepEqual(subChips(items, 'devops'), [{ key: 'frameworks', label: 'Frameworks', count: 1 }]);
  assert.deepEqual(subChips(items, ''), []); // no primary selected
  assert.deepEqual(subChips(items, 'nope'), []); // primary with no items
});

test('subChips falls back to the key when a label is missing', () => {
  const noLabels = [{ categories: ['ai', 'agents'] }];
  assert.deepEqual(subChips(noLabels, 'ai'), [{ key: 'agents', label: 'agents', count: 1 }]);
});

test('filterByCategoryPath: prefix match; empty path = all; deeper path narrows', () => {
  assert.equal(filterByCategoryPath(items, []).length, 6); // all, including uncategorized
  assert.equal(filterByCategoryPath(items, ['ai']).length, 3); // the three ai items
  assert.equal(filterByCategoryPath(items, ['ai', 'agents']).length, 1);
  assert.equal(filterByCategoryPath(items, ['devops']).length, 1);
  assert.equal(filterByCategoryPath(items, ['nope']).length, 0);
  // an uncategorized item is only kept under the empty path
  assert.equal(filterByCategoryPath([{ categories: [] }], ['ai']).length, 0);
});
