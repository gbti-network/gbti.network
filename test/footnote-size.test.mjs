// sow-496, 2026-11-08: footnotes in smaller type (owner: "we want the footnotes to be smaller text. fitting for
// footnotes"). The published page already set them at 0.8em; the WorkBench preview, where a draft is reviewed, set
// nothing, because client/src/markdown.mjs emits its own classes (section.md-footnotes, a visible h2, a.md-fn-back) and
// Prose.astro styled only the site's section[data-footnotes]. Same class of gap as the callouts in sow-492.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderMarkdown } from '../client/src/markdown.mjs';

const prose = fs.readFileSync(new URL('../src/components/blog/Prose.astro', import.meta.url), 'utf8');
const reader = fs.readFileSync(new URL('../client-ui/src/elements/gbti-reader.mjs', import.meta.url), 'utf8');
const rule = (css, selector) => {
  const at = css.indexOf(selector);
  return at < 0 ? '' : css.slice(at, css.indexOf('}', at) + 1);
};
const em = (decl) => { const m = /font-size:\s*([\d.]+)em/.exec(decl); return m ? Number(m[1]) : null; };

test('sow-496: the page and the preview set footnotes in one rule, at footnote size', () => {
  const r = rule(prose, '.prose-gbti section[data-footnotes], .prose-gbti .md-footnotes {');
  assert.ok(r, 'no shared footnote rule for the site and the preview in Prose.astro');
  const size = em(r);
  assert.ok(size != null && size <= 0.75, `footnotes are ${size}em; footnote size is at most 0.75em of the body`);
  assert.match(r, /line-height:\s*1\.6/);
});

test('sow-496: every class the preview emits in its footnotes has a Prose rule, and its heading is hidden like the site\'s', () => {
  const html = renderMarkdown('A claim.[^1] Another.[^2]\n\n[^1]: First source.\n\n[^2]: Second source.\n');
  const section = (/<section class="md-footnotes">[\s\S]*?<\/section>/.exec(html) || [''])[0];
  assert.ok(section, 'the preview rendered no footnote section, so nothing below checks anything');
  const classes = [...new Set([...section.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)))];
  assert.ok(classes.length >= 2, `expected the section and back-arrow classes, got ${classes.join(', ')}`);
  for (const c of classes) assert.ok(prose.includes(`.prose-gbti .${c}`), `the preview's .${c} has no Prose rule`);
  assert.match(section, /<h2>Footnotes<\/h2>/, 'the preview still ships its heading (hidden by CSS, read by screen readers)');
  assert.match(rule(prose, '.prose-gbti .md-footnotes > h2 {'), /position:\s*absolute;[^}]*clip:/, 'the preview heading is visually hidden');
});

test('sow-496: the extension reader sets its footnotes smaller too', () => {
  const size = em(rule(reader, '.body .md-footnotes {'));
  assert.ok(size != null && size <= 0.8, `reader footnotes are ${size}em`);
});
