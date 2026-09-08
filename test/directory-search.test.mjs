// sow-177: one search field per directory page, in the hero, for prompts, articles and projects. Source pins for
// the wiring that each page's script depends on; the behaviour is driven on the built site.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(ROOT + p, 'utf8');
const count = (s, re) => (s.match(re) || []).length;

test('the shared component renders one search input with the caller\'s id and accessible name', () => {
  const c = read('src/components/DirectorySearch.astro');
  assert.match(c, /<input id=\{id\} type="search"[^>]*aria-label=\{label\}/);
  assert.match(c, /max-width: 440px/, 'the member directory\'s width');
  assert.match(c, /border-radius: var\(--r-pill\)/, 'and its pill corners');
});

test('prompts: the field moved out of the sidebar, same id, so the filter and the ?tag= deep link are untouched', () => {
  const p = read('src/pages/prompts/index.astro');
  assert.equal(count(p, /<DirectorySearch id="prompt-search"/g), 1, 'rendered once');
  assert.doesNotMatch(p, /ps-group--search/, 'the sidebar group is gone');
  assert.equal(count(p, /id="prompt-search"/g), 1, 'the id appears once, on the component call: no second input carries it');
  assert.doesNotMatch(p, /<input[^>]*id="prompt-search"/, 'the old sidebar input is gone');
  assert.match(p, /getElementById\('prompt-search'\)/, 'the script still reads it');
  assert.match(p, /if \(tag && searchEl\) \{ searchEl\.value = tag;/, 'the ?tag= write is untouched');
  const heroEnd = p.indexOf('<DirectorySearch id="prompt-search"');
  assert.ok(heroEnd > p.indexOf('id="author-hero"') && heroEnd < p.indexOf('class="prompts-layout"'), 'placed under whichever hero shows, above the layout');
});

test('articles: the field under the lead, and the chip filter composes with the query', () => {
  const a = read('src/pages/articles/index.astro');
  assert.equal(count(a, /<DirectorySearch id="article-search"/g), 1);
  assert.ok(a.indexOf('<DirectorySearch id="article-search"') < a.indexOf('class="filter-row"'), 'in the hero, above the chips');
  assert.match(a, /getElementById\('article-search'\)/);
  assert.match(a, /\(cat === 'all' \|\| card\.dataset\.category === cat\) && \(!query \|\| \(text\.get\(card\) \|\| ''\)\.includes\(query\)\)/, 'category AND query');
  assert.match(a, /id="post-empty"[^>]*hidden/, 'an empty line, hidden until nothing matches');
});

test('projects: the field in the hero, the directory told to skip its own, the script looking document-wide', () => {
  const p = read('src/pages/projects/index.astro');
  const d = read('src/components/projects/ProjectDirectory.astro');
  assert.equal(count(p, /<DirectorySearch id="project-search"[^>]*attr="data-search"/g), 1);
  assert.match(p, /<ProjectDirectory projects=\{projects\} heroSearch=\{true\} \/>/);
  assert.match(d, /\{!heroSearch && <div class="tsearch">/, 'the toolbar search renders only without a hero field');
  assert.match(d, /scope\.querySelector<HTMLInputElement>\('\[data-search\]'\) \|\| document\.querySelector<HTMLInputElement>\('\[data-search\]'\)/, 'the toolbar field wins when present, else the hero field');
  assert.match(d, /heroSearch = false/, 'default off, so any other embedding keeps its toolbar search');
});
