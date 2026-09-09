// sow-188: the Related posts grid fits its columns to the item count and never lets a card grow past the
// three-up width. Source pins for the rule; the render is measured on the built site.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const src = readFileSync(ROOT + 'src/components/blog/RelatedPosts.astro', 'utf8');

test('the grid auto-fits with a 240px floor, capped to the count, centred', () => {
  assert.match(src, /\.rel-grid \{[^}]*grid-template-columns: repeat\(auto-fit, minmax\(240px, 1fr\)\)/, 'as many columns as fit, each at least 240px');
  assert.match(src, /max-width: calc\(var\(--n\) \* 340px \+ \(var\(--n\) - 1\) \* 32px\)/, 'n cards at the three-up width plus the gaps');
  assert.match(src, /\.rel-grid \{[^}]*margin: 0 auto/, 'centred under the heading');
  assert.match(src, /style=\{`--n:\$\{related\.length\}`\}/, 'the count the component already knows drives the cap');
});

test('the fixed three-column grid and the dead 1100px section cap are gone; scoring and the item cap are untouched', () => {
  assert.doesNotMatch(src, /lg:grid-cols-3/);
  assert.doesNotMatch(src, /max-width:1100px/);
  assert.match(src, /\.slice\(0, 3\)/, 'still at most three related items');
  assert.match(src, /\.filter\(isPublic\)/, 'still public only (sow-189 adds the stale filter separately)');
});
