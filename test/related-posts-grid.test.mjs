// sow-188: the Related posts grid fits its columns to the item count and never lets a card grow past the
// three-up width. Source pins for the rule; the render is measured on the built site.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const src = readFileSync(ROOT + 'src/components/blog/RelatedPosts.astro', 'utf8');

test('cards are a third of the section, half on a mid screen, full on a phone, centred, whatever the count', () => {
  // Owner, 2026-10-14: up to nine related posts, full width under the article (the extension banner's width).
  assert.match(src, /\.rel-grid \{ display: flex; flex-wrap: wrap; justify-content: center; gap: 32px; \}/, 'a short last row is centred');
  assert.match(src, /\.rel-grid > :global\(\*\) \{ flex: 0 0 calc\(\(100% - 64px\) \/ 3\); min-width: 0; \}/, 'three to a row, three fill it');
  const two = src.indexOf('@container (max-width: 783px)'), one = src.indexOf('@container (max-width: 511px)'), base = src.indexOf('.rel-grid > :global(*) { flex: 0 0');
  assert.ok(base > 0 && two > base && one > two, 'the narrower queries come after the base rule, widest first');
  assert.match(src, /\.rel-posts \{ margin-top: 64px; container-type: inline-size; \}/, 'the section is the container the queries measure');
  assert.doesNotMatch(src, /--n:/, 'the size no longer depends on the count');
});

test('the fixed three-column grid and the dead 1100px section cap are gone; scoring and the item cap are untouched', () => {
  assert.doesNotMatch(src, /lg:grid-cols-3/);
  assert.doesNotMatch(src, /max-width:1100px/);
  assert.match(src, /\.slice\(0, 9\)/, 'at most nine related items (owner, 2026-10-14)');
  assert.match(src, /\.filter\(isPublic\)/, 'still public only (sow-189 adds the stale filter separately)');
});
