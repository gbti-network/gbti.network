// Owner, 2026-10-14: the article ends with the follow card (the contribution history is gone), the left rail ends level
// with it, and the extension banner below sits about 60px away on each side instead of under a band of empty space.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../src/pages/articles/[slug].astro', import.meta.url), 'utf8');

test('the article page no longer mounts the contribution history', () => {
  assert.doesNotMatch(page, /<OpenHistory\b/);
  assert.doesNotMatch(page, /import OpenHistory /);
  assert.match(page, /<ContentFooter slot="closing"/, 'control: the closing column still mounts');
});

test('the gap above and below the banner is the grid padding and the banner margin, not the 104px band', () => {
  assert.match(page, /:global\(\.art-shell\) \{ padding-bottom: 0; \}/);
  assert.match(page, /\.art-xbn \{ padding-bottom: 26px; \}/);
  assert.match(page, /\.art-rel :global\(\.rel-posts\) \{ margin-top: 16px; \}/);
  assert.match(page, /\.art-rel:not\(:has\(\.rel-posts\)\) \{ padding-bottom: 14px; \}/, 'the footer keeps room when there are no related posts');
});
