// sow-248: every wide block in an article body has a scroll container, and the two rendering guards sample
// pages by shape rather than by alphabet. Source-level pins for the two halves of that item: the CSS rule a
// tidy-up could drop, and the samplers a refactor could quietly put back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(ROOT + p, 'utf8');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('a prose table scrolls inside the column: block, natural width, capped, overflow-x auto', () => {
  const css = code(read('src/components/blog/Prose.astro'));
  const rule = css.match(/\.prose-gbti table \{([^}]*)\}/);
  assert.ok(rule, 'the table rule exists');
  for (const decl of ['display: block', 'width: max-content', 'max-width: 100%', 'overflow-x: auto']) {
    assert.ok(rule[1].includes(decl), `the table rule carries "${decl}"; without it a wide table pushes a phone page sideways`);
  }
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
