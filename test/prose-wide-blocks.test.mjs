// sow-248: every wide block in an article body has a scroll container, and the two rendering guards sample
// pages by shape rather than by alphabet. Source-level pins for the two halves of that item: the CSS rule a
// tidy-up could drop, and the samplers a refactor could quietly put back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(ROOT + p, 'utf8');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// sow-470 changed the MECHANISM this guards, not the outcome. sow-248 bought the scroll with
// `display: block` on the table itself, which also stopped the table being a table (no filling its column,
// no column widths negotiated across rows). The scroll now comes from a wrapper built by
// src/lib/rehype-table-scroll.mjs. This test was rewritten rather than deleted, because the thing it
// protects (a wide table must not push a phone page sideways) is unchanged and was measured at 213px.
// The wrapper's own existence is covered by test/table-scroll-wrapper.test.mjs; this is the CSS half.
test('a prose table scrolls inside its wrapper: the wrapper scrolls, the table keeps its natural width', () => {
  const css = code(read('src/components/blog/Prose.astro'));
  const wrap = css.match(/\.prose-gbti \.table-scroll \{([^}]*)\}/);
  assert.ok(wrap, 'the .table-scroll rule exists; without it a wide table pushes a phone page sideways');
  assert.ok(wrap[1].includes('overflow-x: auto'), 'the wrapper is what scrolls');

  const rule = css.match(/\.prose-gbti table \{([^}]*)\}/);
  assert.ok(rule, 'the table rule exists');
  // Load-bearing: without a natural width the table shrinks to the wrapper and the CELLS wrap instead of
  // scrolling, which is the failure mode sow-248 names explicitly.
  assert.ok(rule[1].includes('width: max-content'), 'the table keeps its natural width so cells do not wrap instead of scrolling');
  assert.ok(rule[1].includes('min-width: 100%'), 'and fills the column when it is narrower than one');
  // The mechanism that was replaced must be gone, not sitting alongside the new one: `display: block` would
  // override the table layout the wrapper exists to give back.
  assert.ok(!rule[1].includes('display: block'), 'the old display:block mechanism is removed, not layered under the wrapper');
});

test('a prose table has cell padding and a header rule, which is the defect a member reported', () => {
  const css = code(read('src/components/blog/Prose.astro'));
  // Shipped state until sow-470: one rule, a scroll container, and nothing else. With no padding the columns
  // touch, which is what "36,254,891" running into "21.66%" on a live article actually was.
  const cells = css.match(/\.prose-gbti th, \.prose-gbti td \{([^}]*)\}/);
  assert.ok(cells, 'th/td carry a rule at all');
  const padding = /padding:\s*([^;]+)/.exec(cells[1]);
  assert.ok(padding, 'th/td carry padding');
  assert.ok(!/^\s*0(px|em|rem)?\s*$/.test(padding[1]), `th/td padding is "${padding[1].trim()}", so adjacent columns touch`);
  assert.match(css, /\.prose-gbti thead th \{[^}]*border-bottom/, 'the header row is separated from the body');
  assert.match(css, /\.prose-gbti tbody td \{[^}]*border-bottom/, 'rows are separated from each other');
});

test('the other wide blocks keep their containers: pre scrolls, inline code breaks, images cap', () => {
  const css = code(read('src/components/blog/Prose.astro'));
  assert.match(css, /\.prose-gbti pre \{[^}]*overflow-x: auto/);
  assert.match(css, /\.prose-gbti :not\(pre\) > code \{[^}]*overflow-wrap: anywhere/, 'a long unbreakable inline code run is the smaller second case');
  assert.match(css, /\.prose-gbti img \{[^}]*max-width: 100%/);
  // The second cause found by measuring after the table rule: bare URLs as link text. Inherited from the container.
  assert.match(css, /\.prose-gbti \{[^}]*overflow-wrap: anywhere/, 'long unbreakable link text (a bare URL) must break rather than push the page sideways');
});

test('both rendering guards take their pages from the shape sampler and neither keeps an alphabetical picker', () => {
  for (const guard of ['scripts/check-overflow.mjs', 'scripts/check-csp.mjs']) {
    const src = code(read(guard));
    assert.match(src, /from '\.\/lib\/page-sample\.mjs'/, `${guard} imports the sampler`);
    assert.match(src, /samplePages\(DIST\)/, `${guard} samples the built site`);
    assert.match(src, /coverageGaps\(sample\.coverage\)/, `${guard} fails on a present shape with no sampled page`);
    assert.doesNotMatch(src, /function firstSlug|firstArticleWithEmbed|firstShare/, `${guard} has no private alphabetical picker left`);
    assert.doesNotMatch(src, /page\/viewport checks/, 'the effort count is gone from the pass line');
  }
});
