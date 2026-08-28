// sow-174: the `/feeds/?cat=<key>` drilldown that product and article breadcrumbs point at.
// The logic lives in src/lib/feed-filter.mjs rather than inside FeedView.astro's bundled <script>
// precisely so it can be tested here; logic left in the .astro is unreachable from node --test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { catKey, catsAttr, rowMatchesCat } from '../src/lib/feed-filter.mjs';

test('sow-174: a row carries EVERY segment of its path, so any crumb depth can match', () => {
  // This is the whole defect. A two-crumb product is `devops > ide-plugins`; if the row stored only the
  // top segment the leaf crumb would be dead, and if it stored only the leaf the top crumb would be.
  const attr = catsAttr(['devops', 'ide-plugins']);
  assert.equal(attr, 'devops ide-plugins');
  assert.ok(rowMatchesCat(attr, 'devops'), 'top crumb must filter');
  assert.ok(rowMatchesCat(attr, 'ide-plugins'), 'LEAF crumb must filter');
});

test('sow-174: a leaf key with no sidebar control still matches, which is the prompts bug not repeated', () => {
  // /prompts/?cat=skill rendered a full unfiltered page because the handler dropped any key without a
  // matching sidebar button. The feed matches against DATA, so there is no control to be missing.
  const attr = catsAttr(['ai', 'prompts', 'skill']);
  assert.ok(rowMatchesCat(attr, 'skill'));
});

test('sow-174: matching is whole-token, so a prefix or substring never filters by accident', () => {
  const attr = catsAttr(['devops']);
  assert.equal(rowMatchesCat(attr, 'dev'), false, 'a prefix must not match');
  assert.equal(rowMatchesCat(attr, 'evop'), false, 'an infix must not match');
  assert.equal(rowMatchesCat(attr, 'devopsx'), false, 'a longer key must not match');
  assert.ok(rowMatchesCat(attr, 'devops'));
});

test('sow-174: keys normalize, so a crumb href and a row attribute agree on case and spacing', () => {
  assert.equal(catKey('  DevOps '), 'devops');
  assert.equal(catsAttr([' DevOps ', 'IDE-Plugins']), 'devops ide-plugins');
  assert.ok(rowMatchesCat(catsAttr(['DevOps']), 'DEVOPS'));
});

test('sow-174: duplicate segments collapse rather than repeating in the attribute', () => {
  assert.equal(catsAttr(['ai', 'ai', 'prompts']), 'ai prompts');
});

test('sow-174: an uncategorized row and an empty query both match NOTHING, never everything', () => {
  // The fail-open shape to avoid: an empty cat treated as "no filter" here would make a typo'd crumb
  // silently show the unfiltered feed, which is the exact user-visible symptom this SOW is fixing.
  assert.equal(catsAttr([]), '');
  assert.equal(catsAttr(undefined), '');
  assert.equal(rowMatchesCat('', 'devops'), false, 'an uncategorized row matches no category');
  assert.equal(rowMatchesCat('devops', ''), false, 'an empty query matches no row');
  assert.equal(rowMatchesCat('devops', '   '), false, 'a whitespace query matches no row');
});
