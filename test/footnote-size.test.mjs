// sow-496, 2026-11-08: footnotes in smaller type (owner: "we want the footnotes to be smaller text. fitting for
// footnotes"). The published page already set them at 0.8em; the WorkBench preview, where a draft is reviewed, set
// nothing, because client/src/markdown.mjs emits its own classes (section.md-footnotes, a visible h2, a.md-fn-back) and
// Prose.astro styled only the site's section[data-footnotes]. Same class of gap as the callouts in sow-492. Both
// show a small "Footnotes" heading (owner, later the same day).
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

test('sow-496: every class the preview emits in its footnotes has a Prose rule, and both show a small "Footnotes" heading', () => {
  const html = renderMarkdown('A claim.[^1] Another.[^2]\n\n[^1]: First source.\n\n[^2]: Second source.\n');
  const section = (/<section class="md-footnotes">[\s\S]*?<\/section>/.exec(html) || [''])[0];
  assert.ok(section, 'the preview rendered no footnote section, so nothing below checks anything');
  const classes = [...new Set([...section.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)))];
  assert.ok(classes.length >= 2, `expected the section and back-arrow classes, got ${classes.join(', ')}`);
  for (const c of classes) assert.ok(prose.includes(`.prose-gbti .${c}`), `the preview's .${c} has no Prose rule`);
  assert.match(section, /<h2>Footnotes<\/h2>/, 'the preview ships its heading');
  // Owner, 2026-11-08: "we still want a headere above the footnotes that says Footnotes". The site's heading comes from
  // remark-gfm as class="sr-only", so the rule must undo the clip AND the clip-path (Tailwind's sr-only uses both: with only clip reset, the heading kept its
  // box and stayed invisible, caught on a screenshot), and it must be sized to the footnotes, not an h2.
  const h = rule(prose, '.prose-gbti section[data-footnotes] > h2, .prose-gbti .md-footnotes > h2 {');
  assert.ok(h, 'no shared heading rule for the site and the preview footnotes');
  for (const d of [/position:\s*static/, /width:\s*auto/, /height:\s*auto/, /clip:\s*auto/, /clip-path:\s*none/, /overflow:\s*visible/, /white-space:\s*normal/]) assert.match(h, d);
  assert.ok(em(h) != null && em(h) < 1.9, `the heading is ${em(h)}em of the footnote size, sized like an article h2`);
});

test('sow-496: the extension reader sets its footnotes smaller too', () => {
  const size = em(rule(reader, '.body .md-footnotes {'));
  assert.ok(size != null && size <= 0.8, `reader footnotes are ${size}em`);
});
