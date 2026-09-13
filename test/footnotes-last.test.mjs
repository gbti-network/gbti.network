// Footnotes last (owner report, 2026-09-13, the Proxmox article): on an item with a members-only section the
// footnotes rendered ABOVE the locked box and the two ran together. They now render under it. This pins the split
// helper, and that every template placing a members-only section after a public body routes it through the helper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { splitTrailingFootnotes } from '../src/lib/footnotes-last.mjs';

// The markup Astro's markdown pipeline emits, copied from the live Proxmox article.
const FOOTNOTES = '<section data-footnotes="" class="footnotes"><h2 class="sr-only" id="footnote-label">Footnotes</h2>\n<ol>\n<li id="user-content-fn-cover">\n<p>Cover photo. <a href="#user-content-fnref-cover" data-footnote-backref="" class="data-footnote-backref">↩</a></p>\n</li>\n</ol>\n</section>';
const BODY = '<p>Happy to discuss.</p>\n<p>Cover image credit<sup><a href="#user-content-fn-cover" id="user-content-fnref-cover" data-footnote-ref="">1</a></sup></p>\n';

test('the trailing footnotes section is split from the body', () => {
  const r = splitTrailingFootnotes(BODY + FOOTNOTES + '\n');
  assert.equal(r.body, BODY);
  assert.equal(r.footnotes, FOOTNOTES);
});

test('a body with no footnotes comes back whole', () => {
  assert.deepEqual(splitTrailingFootnotes(BODY), { body: BODY, footnotes: '' });
});

test('footnotes that are not the last thing are left where they are', () => {
  const html = BODY + FOOTNOTES + '<p>after</p>';
  assert.deepEqual(splitTrailingFootnotes(html), { body: html, footnotes: '' });
});

test('an unbalanced section tail is left alone rather than cut mid-element', () => {
  const html = BODY + '<section data-footnotes="" class="footnotes"><section>' + '</section>';
  assert.deepEqual(splitTrailingFootnotes(html), { body: html, footnotes: '' });
});

test('an attribute that only starts with data-footnotes is not the footnotes section', () => {
  const html = BODY + '<section data-footnotes-x="">x</section>';
  assert.deepEqual(splitTrailingFootnotes(html), { body: html, footnotes: '' });
});

test('non-string input is an empty body, never a throw', () => {
  for (const v of [undefined, null, 42, {}]) assert.deepEqual(splitTrailingFootnotes(v), { body: '', footnotes: '' });
});

// Every place a members-only SECTION follows a public body. A new render site that places one outside
// <FootnotesLast> puts the footnotes back above the locked box.
const SITES = [
  'src/components/blog/ArticleJournal.astro',
  'src/components/blog/ArticleCard.astro',
  'src/components/blog/ArticleEditorial.astro',
  'src/pages/projects/[slug].astro',
  'src/pages/prompts/[slug].astro',
];

test('every members-only section is rendered between the body and its footnotes', () => {
  for (const f of SITES) {
    const src = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    const sections = [...src.matchAll(/<LockedBody\b[^>]*kind="section"/g)];
    assert.ok(sections.length > 0, `${f}: expected a members-only section render site`);
    for (const m of sections) {
      const open = src.lastIndexOf('<FootnotesLast', m.index);
      const close = src.lastIndexOf('</FootnotesLast>', m.index);
      assert.ok(open !== -1 && open > close, `${f}: the members-only section must sit inside <FootnotesLast>`);
    }
  }
});

test('no other template renders a members-only section', () => {
  const found = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.astro') && /<LockedBody\b[^>]*kind="section"/.test(fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'))) found.push(p);
    }
  };
  walk('src');
  assert.ok(found.length > 0, 'the sweep found no render sites at all, so it looked in the wrong place');
  assert.deepEqual(found.sort(), [...SITES].sort());
});
