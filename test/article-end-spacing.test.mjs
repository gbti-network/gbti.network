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

test('the rail\'s author box starts level with the title, with no divider above it for a reader', () => {
  const journal = readFileSync(new URL('../src/components/blog/ArticleJournal.astro', import.meta.url), 'utf8');
  assert.match(journal, /<div class="mt-3">\s*<ContentMeta /, 'a 12px margin, matching the title\'s');
  assert.doesNotMatch(journal, /class="mt-12"/, 'the 48px left over from the category label is gone');
  const css = readFileSync(new URL('../src/styles/gbti-v3-article.css', import.meta.url), 'utf8');
  const base = css.indexOf('.art-j-rail > * + * {'), reset = css.indexOf('.art-j-rail > [hidden] ~ div:first-of-type { padding-top: 0; border-top: 0; }');
  assert.ok(base > 0 && reset > base, 'the hidden-tools reset follows the divider rule it undoes');
});
