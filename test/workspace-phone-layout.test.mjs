// sow-168: the WorkBench on a phone. Source pins for the container-query rules a tidy-up could drop (the row
// that reflows to two lines, the tab strip that scrolls sideways) and unit tests for the pure helper that
// keeps the active tab in view without moving the page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { tabScrollLeft } from '../client-ui/src/workspace-core.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const src = readFileSync(ROOT + 'client-ui/src/elements/gbti-workspace.mjs', 'utf8');
const css = src.replace(/\/\*[\s\S]*?\*\//g, '');
const phone = css.match(/@container \(max-width: 560px\) \{([\s\S]*?)\n  \}/);

test('the element is a container, so the phone rules key off the width it is GIVEN, not the viewport', () => {
  assert.match(css, /:host \{[^}]*container-type:inline-size/, 'without container-type the @container block never matches anywhere');
  assert.ok(phone, 'the 560px container block exists');
});

test('a phone row reflows: the actions drop to a second full-width line and the title may wrap before it clips', () => {
  const rules = phone[1];
  assert.match(rules, /\.row \{[^}]*flex-wrap:wrap/);
  assert.match(rules, /\.row \.right \{[^}]*flex:1 1 100%/, 'the pills and buttons take their own line; that is what gives the title its width back');
  assert.match(rules, /\.row \.right \{[^}]*justify-content:flex-start/, 'left-aligned under the title, not pushed to the right edge');
  assert.match(rules, /\.row \.t b \{[^}]*-webkit-line-clamp:2/, 'two lines of title before an ellipsis, so "R.." cannot come back');
  assert.doesNotMatch(rules, /\.row \.right \{[^}]*display:none/, 'nothing is hidden behind a menu (owner decision 2026-09-08)');
});

test('the tab strip stops wrapping and scrolls sideways instead', () => {
  const rules = phone[1];
  assert.match(rules, /\.tabs \{[^}]*flex-wrap:nowrap/);
  assert.match(rules, /\.tabs \{[^}]*overflow-x:auto/);
  assert.match(rules, /\.tab \{[^}]*flex:none/, 'a tab that could shrink would squash its label instead of scrolling');
  assert.match(src, /this\._revealTab\(\);/, 'render() brings the active tab into view after the strip paints');
});

test('tabScrollLeft: moves the strip only when the active tab is out of view, and never the page', () => {
  // The strip does not scroll: nothing to do, whatever the tab position.
  assert.equal(tabScrollLeft({ scrollLeft: 0, clientWidth: 400, scrollWidth: 400, left: 300, width: 80 }), null);
  // Already visible: leave it alone (a re-render on data arrival must not jitter the strip).
  assert.equal(tabScrollLeft({ scrollLeft: 100, clientWidth: 300, scrollWidth: 800, left: 150, width: 80 }), null);
  // Past the right edge: scroll just enough to show its right edge.
  assert.equal(tabScrollLeft({ scrollLeft: 0, clientWidth: 300, scrollWidth: 800, left: 500, width: 80 }), 280);
  // Past the left edge: scroll back to its left edge.
  assert.equal(tabScrollLeft({ scrollLeft: 400, clientWidth: 300, scrollWidth: 800, left: 120, width: 80 }), 120);
  // Junk in: no move.
  assert.equal(tabScrollLeft(), null);
  assert.equal(tabScrollLeft({ scrollLeft: 0, clientWidth: 300, scrollWidth: 800, left: 500, width: 0 }), null);
});
