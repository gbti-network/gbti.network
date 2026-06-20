// SOW-037: the pure helpers behind the member "Saved" view. No DOM, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildItemIndex, resolveItem, groupFavoritesByType, savedCount, indexFileFor, typeLabel, savedTypeCounts, savedTypeChips, filterSavedByType } from '../client-ui/src/saved-core.mjs';

test('indexFileFor / typeLabel map content types to their index + label', () => {
  assert.equal(indexFileFor('post'), 'blog-index.json');
  assert.equal(indexFileFor('product'), 'products-index.json');
  assert.equal(indexFileFor('prompt'), 'prompts-index.json');
  assert.equal(indexFileFor('bogus'), null);
  assert.equal(typeLabel('post'), 'Articles');
  assert.equal(typeLabel('prompt'), 'Prompts');
  // SOW-050 P3: Shares are a labelled type with no build-time index (resolveItem falls back to the slug).
  assert.equal(typeLabel('share'), 'Shares');
  assert.equal(indexFileFor('share'), null);
});

test('buildItemIndex keys by type:slug and resolveItem falls back to the slug when absent', () => {
  const idx = buildItemIndex({
    post: [{ slug: 'hello', title: 'Hello World', url: '/articles/hello/', path: 'house/posts/hello/index.md', thumb: '/_astro/x.webp' }],
    prompt: [{ slug: 'p1', title: 'Prompt One', url: '/prompts/p1/' }],
  });
  assert.equal(resolveItem(idx, 'post', 'hello').title, 'Hello World');
  assert.equal(resolveItem(idx, 'post', 'hello').path, 'house/posts/hello/index.md');
  assert.equal(resolveItem(idx, 'prompt', 'p1').title, 'Prompt One');
  // absent -> fallback to the slug, no url/path (e.g. a removed or Mode A item)
  const miss = resolveItem(idx, 'post', 'gone');
  assert.deepEqual(miss, { type: 'post', slug: 'gone', title: 'gone', url: null, path: null, thumb: null });
});

test('buildItemIndex skips malformed items', () => {
  const idx = buildItemIndex({ post: [null, {}, { slug: 'ok', title: 'OK' }] });
  assert.equal(idx.size, 1);
  assert.equal(resolveItem(idx, 'post', 'ok').title, 'OK');
});

test('groupFavoritesByType groups in a stable order and drops malformed', () => {
  const groups = groupFavoritesByType([
    { type: 'prompt', slug: 'a' },
    { type: 'post', slug: 'b' },
    { type: 'prompt', slug: 'c' },
    { type: 'product', slug: 'd' },
    null,
    { type: 'post' }, // no slug -> dropped
  ]);
  assert.deepEqual(groups.map((g) => g.type), ['post', 'product', 'prompt']);
  assert.equal(groups.find((g) => g.type === 'prompt').items.length, 2);
  assert.equal(groups.find((g) => g.type === 'post').items.length, 1);
});

test('groupFavoritesByType places unknown types after the known ones', () => {
  // 'share' is now a KNOWN type (sorts after prompt); use a genuinely unknown type to cover the tail ordering.
  const groups = groupFavoritesByType([{ type: 'news', slug: 'x' }, { type: 'post', slug: 'y' }]);
  assert.deepEqual(groups.map((g) => g.type), ['post', 'news']);
  // a Share sorts last among the known types
  const withShare = groupFavoritesByType([{ type: 'share', slug: 'me/x' }, { type: 'post', slug: 'y' }]);
  assert.deepEqual(withShare.map((g) => g.type), ['post', 'share']);
});

test('SOW-050 P2: savedTypeCounts + savedTypeChips tally favorites + collection items per type', () => {
  const activity = {
    favorites: [{ type: 'post', slug: 'a' }, { type: 'share', slug: 'me/n' }, { type: 'post', slug: 'b' }],
    collections: [{ items: [{ type: 'prompt', slug: 'p' }, { type: 'share', slug: 'me/n' }] }],
  };
  assert.deepEqual(savedTypeCounts(activity), { post: 2, share: 2, prompt: 1 });
  const chips = savedTypeChips(activity);
  assert.deepEqual(chips[0], { type: 'all', label: 'All', count: 5 }); // 'all' first, total count
  // known order: post, prompt, share (product has 0 -> no chip)
  assert.deepEqual(chips.slice(1).map((c) => c.type), ['post', 'prompt', 'share']);
  assert.equal(chips.find((c) => c.type === 'share').count, 2);
  // empty activity -> only the 'all' chip (count 0)
  assert.deepEqual(savedTypeChips({}), [{ type: 'all', label: 'All', count: 0 }]);
});

test('SOW-050 P2: filterSavedByType narrows favorites + collection items but keeps every collection', () => {
  const activity = {
    favorites: [{ type: 'post', slug: 'a' }, { type: 'share', slug: 'me/n' }],
    collections: [{ id: 'c1', name: 'Mix', items: [{ type: 'post', slug: 'a' }, { type: 'share', slug: 'me/n' }] }],
  };
  assert.equal(filterSavedByType(activity, 'all'), activity); // 'all' is a pass-through
  assert.equal(filterSavedByType(activity, null), activity);
  const shares = filterSavedByType(activity, 'share');
  assert.deepEqual(shares.favorites.map((f) => f.slug), ['me/n']);
  assert.equal(shares.collections.length, 1); // collection kept
  assert.deepEqual(shares.collections[0].items.map((i) => i.type), ['share']); // items narrowed
});

test('savedCount counts favorites + items across collections', () => {
  const c = savedCount({ favorites: [{ type: 'post', slug: 'a' }, { type: 'prompt', slug: 'b' }], collections: [{ items: [{ type: 'post', slug: 'a' }] }, { items: [] }, {}] });
  assert.deepEqual(c, { favorites: 2, inCollections: 1 });
  assert.deepEqual(savedCount({}), { favorites: 0, inCollections: 0 });
});
