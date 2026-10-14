// Owner, 2026-10-14: "Project page should load more than 11 projects at one time." The /feeds/ tabs show 30 items per
// load before the Next button; the homepage feed keeps the list's default of 10.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chunkPages } from '../src/lib/home-feed.mjs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('the feed tabs pass 30 per load to the list, and the homepage passes none', () => {
  const view = read('src/components/feeds/FeedView.astro');
  assert.match(view, /^const FEED_PAGE_SIZE = 30;$/m);
  assert.match(view, /<FeedList [^>]*pageSize=\{FEED_PAGE_SIZE\} \/>/);
  const home = read('src/pages/index.astro');
  assert.match(home, /<FeedList [^>]*\/>/, 'control: the homepage still mounts the list');
  assert.doesNotMatch(home, /<FeedList [^>]*pageSize=/, 'the homepage keeps the default');
  assert.match(read('src/components/feeds/FeedList.astro'), /pageSize = 10,/, 'and that default is 10');
});

test('at 30 per load, the 19 public projects are one chunk with no Next', () => {
  const items = Array.from({ length: 19 }, (_, i) => ({ i }));
  assert.equal(chunkPages(items, 30).length, 1);
  assert.equal(chunkPages(items, 10).length, 2, 'control: the old size split them');
  assert.equal(chunkPages(Array.from({ length: 31 }, (_, i) => ({ i })), 30).length, 2, 'a 31st item brings Next back');
});
