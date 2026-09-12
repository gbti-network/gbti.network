// sow-326: the Editorial article layout is retired as an option site-wide. Owner, 2026-09-12, after watching
// one article flip between layouts: "Yes Journal is the one we want. In fact we want to disable editorial as
// an option across the whole website."
//
// Retired at every ENTRY POINT rather than deleted: ArticleEditorial.astro, ARTICLE_SHELL.editorial and the
// art-e-* rules stay on disk, dormant and still held by their own drift tests, so re-offering the layout is a
// three-line change rather than a revert. What these tests pin is that nothing can reach it:
//
//   1. the two schemas COERCE a stored 'editorial' to journal (never reject: a schema error over a value we
//      know the answer for would fail the whole site build, and a stored value can still arrive from a saved
//      draft, a member's fork branch or an agent written against the old enum)
//   2. ARTICLE_LAYOUTS no longer lists it, which is the gate for UNPARSED frontmatter (the WorkBench preview
//      reads a draft record no schema has touched)
//   3. the page's layout map has no such key, so an item still carrying it renders as journal
//   4. neither authoring form offers it, and the editor's picker highlights journal by default
//
// Point 4 mattered on its own: the picker fell back to 'editorial' while the page rendered journal, so an
// item with no layout showed Editorial selected and publishing that untouched draft WROTE layout: editorial.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ARTICLE_LAYOUTS, ARTICLE_SHELL, articleShell } from '../src/lib/article-page.mjs';
import { schemaFor } from '../client/src/schemas.mjs';

const src = (rel) => fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

test('the declarable layouts are journal and card', () => {
  assert.deepEqual([...ARTICLE_LAYOUTS], ['journal', 'card']);
  assert.ok(!ARTICLE_LAYOUTS.includes('editorial'), 'the list is what gates an unparsed draft in the preview');
});

test('a stored editorial value coerces to journal through the client schema', () => {
  const post = { title: 'T', slug: 'a-slug', author: 'someone', layout: 'editorial' };
  const parsed = schemaFor('post').parse(post);
  assert.equal(parsed.layout, 'journal', 'an agent or a saved draft written against the old enum must still validate');
});

test('POSITIVE CONTROL: the coercion is not a blanket pass-through', () => {
  const post = { title: 'T', slug: 'a-slug', author: 'someone', layout: 'nonsense' };
  assert.throws(() => schemaFor('post').parse(post), 'an unknown layout must still be rejected, or this test proves nothing');
  const card = schemaFor('post').parse({ title: 'T', slug: 'a-slug', author: 'someone', layout: 'card' });
  assert.equal(card.layout, 'card', 'card still resolves to itself');
  const absent = schemaFor('post').parse({ title: 'T', slug: 'a-slug', author: 'someone' });
  assert.equal(absent.layout, 'journal', 'and an absent layout still defaults');
});

test('the site schema coerces the same way, in the same shape', () => {
  const s = src('src/content.config.ts');
  assert.match(s, /layout: z\.preprocess\(\(v\) => \(v === 'editorial' \|\| v == null \? 'journal' : v\), z\.enum\(\['journal', 'card'\]\)\)/,
    'the site build is the one place a hard reject would take the whole deploy down');
});

test('the article page can no longer resolve the editorial component', () => {
  const s = src('src/pages/articles/[slug].astro');
  assert.ok(!s.includes('ArticleEditorial'), 'neither the import nor the map key may survive');
  assert.match(s, /const LAYOUTS: Record<string, typeof ArticleCard> = \{ card: ArticleCard, journal: ArticleJournal \}/);
});

test('neither authoring form offers Editorial', () => {
  const ff = src('client/src/form-fields.mjs');
  const line = ff.split('\n').find((l) => l.includes("f('layout', 'Layout'"));
  assert.ok(line && !line.includes('editorial'), 'the npm CMS and MCP form still lists it');
  assert.ok(line.includes("options: ['journal', 'card']"));
  assert.ok(!line.includes('Editorial:'), 'the hint still describes it');

  const ed = src('client-ui/src/elements/gbti-content-editor.mjs');
  const picker = ed.slice(ed.indexOf("f.key === 'layout'"), ed.indexOf("f.key === 'sidebarPosition'"));
  assert.ok(picker.length > 200, 'the picker moved; this assertion measures nothing');
  assert.ok(!picker.includes("key: 'editorial'"), 'the Editorial card is still offered in the WorkBench');
  assert.match(picker, /const cur = v === 'card' \? 'card' : 'journal'/,
    'the highlighted fallback must agree with what the page renders, or an untouched draft publishes the wrong layout');
});

test('the dormant renderer is left intact on purpose, so this is reversible', () => {
  assert.ok(ARTICLE_SHELL.editorial, 'the shell contract stays, still covered by its drift test');
  assert.ok(fs.existsSync(fileURLToPath(new URL('../src/components/blog/ArticleEditorial.astro', import.meta.url))));
  assert.equal(articleShell('journal'), ARTICLE_SHELL.journal, 'and the resolver still answers for a live layout');
});

test('no committed content still declares the retired layout', () => {
  // Measured rather than assumed when this landed: 54 of 54 posts were journal. If one ever appears again it
  // renders as journal anyway, but it means a writer path reopened, and that is worth failing over.
  const root = fileURLToPath(new URL('..', import.meta.url));
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.git') walk(p); continue; }
      if (!e.name.endsWith('.md')) continue;
      const head = fs.readFileSync(p, 'utf8').slice(0, 2000);
      if (/^layout: *editorial *$/m.test(head)) hits.push(p.slice(root.length));
    }
  };
  for (const d of ['members', 'house']) walk(`${root}${d}`);
  assert.deepEqual(hits, [], 'a committed item declares the retired layout');
});
