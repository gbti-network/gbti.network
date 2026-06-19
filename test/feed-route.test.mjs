// The pure new-tab feed routing helpers (client-ui/src/feed-route.mjs): hash -> type -> rail-key. These back the
// rail/feed switching fixes — a bare newtab.html is the all-types river (rail key 'activity'), a #type=<X>
// narrows + lights its Browse item, and the activity bell's legacy #tab=<X> deep-link resolves the same. No DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TYPE_FILTERS, parseTypeFromHash, typeForHash, railKeyForType, feedSources } from '../client-ui/src/feed-route.mjs';

test('parseTypeFromHash reads a known type from #type=<X> (leading # optional)', () => {
  assert.equal(parseTypeFromHash('#type=post'), 'post');
  assert.equal(parseTypeFromHash('type=product'), 'product');
  assert.equal(parseTypeFromHash('#type=prompt'), 'prompt');
  assert.equal(parseTypeFromHash('#type=share'), 'share');
  assert.equal(parseTypeFromHash('#type=news'), 'news');
  assert.equal(parseTypeFromHash('#type=all'), 'all');
});

test('parseTypeFromHash also reads the activity bell legacy #tab=<X>&read=<path> shape', () => {
  assert.equal(parseTypeFromHash('#tab=post&read=members%2Falice%2Fposts%2Fx'), 'post');
  assert.equal(parseTypeFromHash('#tab=share'), 'share');
});

test('parseTypeFromHash returns null for a bare/typeless/unknown hash', () => {
  assert.equal(parseTypeFromHash(''), null);
  assert.equal(parseTypeFromHash('#'), null);
  assert.equal(parseTypeFromHash('#read=members%2Falice%2Fposts%2Fx'), null); // a read-only deep link, no type
  assert.equal(parseTypeFromHash('#type=bogus'), null);
  assert.equal(parseTypeFromHash(null), null);
  assert.equal(parseTypeFromHash(undefined), null);
});

test('typeForHash falls back to the all-types river when the hash carries no type', () => {
  // The Activity rail item is a BARE newtab.html: it must deterministically resolve to 'all' (Bug 2 fix), never
  // a persisted/previous filter.
  assert.equal(typeForHash(''), 'all');
  assert.equal(typeForHash('#'), 'all');
  assert.equal(typeForHash('#read=members%2Fbob%2Fproducts%2Fy'), 'all');
  assert.equal(typeForHash('#type=prompt'), 'prompt');
  assert.equal(typeForHash('#tab=share'), 'share');
});

test('railKeyForType maps each TYPE to its rail item; all -> activity (Activity IS the All river)', () => {
  assert.equal(railKeyForType('all'), 'activity');
  assert.equal(railKeyForType('post'), 'articles');
  assert.equal(railKeyForType('product'), 'products');
  assert.equal(railKeyForType('prompt'), 'prompts');
  assert.equal(railKeyForType('share'), 'shares');
  assert.equal(railKeyForType('news'), 'news');
});

test('railKeyForType falls back to activity for an unknown type (rail never goes dark)', () => {
  assert.equal(railKeyForType('mystery'), 'activity');
  assert.equal(railKeyForType(undefined), 'activity');
  assert.equal(railKeyForType(null), 'activity');
});

test('there is no "all" rail key: the Browse "All" item was dropped', () => {
  // Activity is the single home river; railKeyForType('all') must point at the Activity rail item, not a
  // now-removed 'all' item.
  assert.notEqual(railKeyForType('all'), 'all');
});

test('TYPE_FILTERS is the canonical set the feed + chips share', () => {
  assert.deepEqual([...TYPE_FILTERS].sort(), ['all', 'news', 'post', 'product', 'prompt', 'share']);
});

test('feedSources: Activity (all) blends member content + Shares but NO news', () => {
  assert.deepEqual(feedSources('all'), { wantNews: false, wantShares: true, narrow: false });
});

test('feedSources: News blends news + member content + Shares (member activity injected, not narrowed)', () => {
  assert.deepEqual(feedSources('news'), { wantNews: true, wantShares: true, narrow: false });
});

test('feedSources: Shares loads Shares then narrows to that type', () => {
  assert.deepEqual(feedSources('share'), { wantNews: false, wantShares: true, narrow: true });
});

test('feedSources: a single content type narrows, no Shares, no news', () => {
  for (const t of ['post', 'product', 'prompt']) {
    assert.deepEqual(feedSources(t), { wantNews: false, wantShares: false, narrow: true }, t);
  }
});

test('feedSources: only the News view wants news; only all/news are blended (not narrowed)', () => {
  for (const t of [...TYPE_FILTERS]) {
    assert.equal(feedSources(t).wantNews, t === 'news', `wantNews for ${t}`);
    assert.equal(feedSources(t).narrow, !(t === 'all' || t === 'news'), `narrow for ${t}`);
  }
});
