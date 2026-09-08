// sow-163: the WorkBench's corners follow the homepage scale and, from 880px of its own width, its tab strip is a
// left rail beside the content pane. Source pins for the two halves; the render is driven in the harness.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const src = readFileSync(ROOT + 'client-ui/src/elements/gbti-workspace.mjs', 'utf8');
const css = src.replace(/\/\*[\s\S]*?\*\//g, '');

test('corners: no squared 2px radius is left; surfaces take the shared token and controls the 8px step', () => {
  assert.equal((css.match(/border-radius:2px/g) || []).length, 0, 'the SOW-052 squared look is gone from the WorkBench');
  for (const sel of ['.tabs', '.profile', '.ov-hero', '.ov-trial', '.ov-tile']) {
    assert.match(css, new RegExp('\\n  ' + sel.replace('.', '\\.') + ' \\{[^\\n]*border-radius:var\\(--radius\\)'), `${sel} carries the token (12px, the homepage --r-lg)`);
  }
  assert.match(css, /\n  \.tab \{[^\n]*border-radius:8px/, 'a tab pill sits on the 8px step');
  assert.match(css, /\n  \.ov-trial \.ov-up \{[^\n]*border-radius:8px/, 'the upgrade button too');
});

test('the rail: one grid around the strip and the body, from 880px of inline size', () => {
  assert.match(src, /<div class="wb"><div class="tabs" role="tablist">\$\{tabs\}<\/div><div data-body>/, 'the strip keeps its class and role; routing is untouched');
  const rail = css.match(/@container \(min-width: 880px\) \{([\s\S]*?)\n  \}/);
  assert.ok(rail, 'the rail block exists');
  assert.match(rail[1], /\.wb \{ display:grid; grid-template-columns:200px minmax\(0,1fr\)/, 'a 200px rail and the pane');
  assert.match(rail[1], /\.tabs \{ flex-direction:column; align-items:stretch/, 'the strip stacks');
  assert.match(rail[1], /\.tab \{ display:flex; align-items:center; justify-content:space-between/, 'each tab full width, its badge on the right');
});

test('order: the phone block still exists and the rail block follows it (a container rule adds no specificity)', () => {
  const phone = css.indexOf('@container (max-width: 560px)');
  const rail = css.indexOf('@container (min-width: 880px)');
  const strip = css.indexOf('\n  .tabs {');
  assert.ok(phone > 0 && rail > phone && strip < phone, 'strip rules, then the phone block, then the rail block');
});
