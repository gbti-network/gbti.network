// sow-376: the feed's card (grid) density shows an item's summary, and does not hide it.
//
// WHY THIS EXISTS. The card view carried `.feed-page[data-view="card"] .feed-ex { display: none; }`, with a
// later, more specific rule switching the summary back on for news rows only. On the homepage that read as a
// capture failure rather than a layout choice: two brand new shares both HAD a shortDescription in their
// frontmatter, both shipped it into the page, and neither drew it, while the news tiles beside them did. The
// owner reported it as "the latest two shares do not seem to have short descriptions".
//
// This asserts the shape of the decision, so restoring the hide rule reds rather than silently un-shipping the
// summary again. It cannot tell you the tile LOOKS right, which is a browser's job, so it deliberately asserts
// only what a stylesheet can settle: that the summary is drawn, and that the two clamps differ on purpose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CSS = fs.readFileSync(
  path.resolve(fileURLToPath(import.meta.url), '../../src/styles/gbti-v3.css'),
  'utf8',
);

/** The declaration block for exactly this selector, or null when the selector is not in the sheet. */
function blockFor(selector) {
  const i = CSS.indexOf(selector + ' {');
  if (i === -1) return null;
  const open = CSS.indexOf('{', i);
  const close = CSS.indexOf('}', open);
  return close === -1 ? null : CSS.slice(open + 1, close);
}

test('sow-376: a card in the grid draws its summary, clamped to two lines', () => {
  const block = blockFor('.feed-page[data-view="card"] .feed-ex');
  assert.ok(block, 'the card view no longer styles .feed-ex at all, so this guard is checking nothing');
  assert.equal(/display:\s*none/.test(block), false, 'the card view hides the summary again');
  assert.match(block, /-webkit-line-clamp:\s*2\b/, 'the card summary is no longer clamped to two lines');
  assert.match(block, /display:\s*-webkit-box/);
});

test('sow-376: a news tile keeps its own three-line clamp, and still outranks the card rule', () => {
  const news = blockFor('.feed-page[data-view="card"] .news-row .feed-ex');
  assert.ok(news, 'the news override is gone, so news tiles silently fell back to the two-line card clamp');
  assert.match(news, /-webkit-line-clamp:\s*3\b/);
  // One class deeper than the card rule, so it wins on specificity wherever it sits in the file. If that ever
  // stops being true the clamps collapse to one value and this pair of tests stops meaning anything.
  assert.ok(
    news.length > 0 && CSS.indexOf('.feed-page[data-view="card"] .news-row .feed-ex') > -1,
    'the news selector must stay more specific than the card selector',
  );
});
