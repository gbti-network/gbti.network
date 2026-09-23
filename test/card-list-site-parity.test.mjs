// sow-296: the extension's feed rows follow the WEBSITE's card look (owner, 2026-09-22: "sync style where
// extension follows public website"). The type tag colours are the one thing that cannot be shared as code: a
// shadow root cannot read src/styles/gbti-v3.css, so <gbti-card-list> carries its own copy of the .kt-* pairs.
// This pins the two together. A palette change on the site that is not carried across reds here, which is the
// only signal anyone gets before the two hosts quietly drift apart again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const site = readFileSync(new URL('../src/styles/gbti-v3.css', import.meta.url), 'utf8');
const card = readFileSync(new URL('../client-ui/src/elements/gbti-card-list.mjs', import.meta.url), 'utf8');

// the site class -> the extension chip class for the same content type
const PAIRS = [['.kt-article', '.chip.k-post'], ['.kt-product', '.chip.k-project'], ['.kt-prompt', '.chip.k-prompt'], ['.kt-news', '.chip.k-news']];
/** The declaration body of the one rule that ends in `<selector> {`, light or dark theme. Matched by line, not by
 *  a regular expression, because both files write one such rule per line. */
const decl = (css, selector, dark = false) => {
  const head = `${selector} {`;
  const line = css.split('\n').map((l) => l.trim().replace(/\s+/g, ' ')).find((s) => (
    s.endsWith('}') && s.includes(head) && (dark ? s.includes('[data-theme="dark"]') : !s.includes('[data-theme="dark"]'))
  ));
  assert.ok(line, `${dark ? 'dark ' : ''}${selector} not found`);
  return line.slice(line.indexOf('{') + 1, line.lastIndexOf('}'));
};
const colors = (block) => (block.match(/#[0-9a-f]{3,8}|rgba?\([^)]*\)/gi) || []).map((c) => c.toLowerCase().replace(/\s+/g, ''));

test('every type tag uses the website colours, light and dark', () => {
  for (const [siteCls, extCls] of PAIRS) {
    assert.deepEqual(colors(decl(card, extCls)), colors(decl(site, siteCls)), `${siteCls} light`);
    assert.deepEqual(
      colors(decl(card, extCls, true)), colors(decl(site, siteCls, true)),
      `${siteCls} dark`,
    );
  }
});

test('the detailed row reads like the website card: meta, then title, then excerpt, with the cover to the right', () => {
  const detailed = card.slice(card.indexOf('_detailed(items)'), card.indexOf('_card(items)'));
  const order = ['_meta(it)', '_chip(it)', 'class="title"', 'class="ex"'];
  let at = -1;
  for (const piece of order) {
    const i = detailed.indexOf(piece);
    assert.ok(i > at, `${piece} is out of order in the detailed row`);
    at = i;
  }
  assert.match(card, /\.row-d \.media \{[^}]*order:2/, 'the cover is ordered to the right of the body');
  assert.match(card, /\.row-d \.ex \{[^}]*-webkit-line-clamp:2/, 'the excerpt runs to two lines like the site');
});

test('the compact row stays one line: it names no author', () => {
  const compact = card.slice(card.indexOf('_compact(items)'), card.indexOf('_detailed(items)'));
  assert.match(compact, /_meta\(it, \{ named: false \}\)/);
});
