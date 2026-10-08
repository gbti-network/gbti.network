// A news card names the publication, never its id. A story carries only its source id, and The Verge's id is
// `object-object`, so the extension's new tab and the Browse news tab printed "object-object" as the byline under every
// Verge headline (reported 2026-10-08). The website's story page and feed were fixed for this in sow-371; these two
// surfaces build their cards through newsToItem, which never had the name.
//
// Also here: the new tab's version indicator shows the build of the INSTALLED version. It showed the newest build in
// the changelog, so an install still on 0.5.3 read "v0.5.3 · build 40" when build 40 is 0.6.0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { newsToItem } from '../client-ui/src/news.mjs';
import { avatarFor } from '../client-ui/src/elements/gbti-card-list.mjs';
import { sourceNameMap } from '../membership/news-source-name.mjs';
import { buildForVersion } from '../extension/src/version-build.mjs';
import { allEntries, normalizeChangelog } from '../src/lib/changelog.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
// The real pool, so the test fails if the Verge row ever loses its name, not only if the code regresses.
const NAMES = sourceNameMap(yaml.load(read('house/news-sources.yml')));
const VERGE = { guid: 'https://www.theverge.com/?p=1008198', source: 'object-object', title: 'USA Today sues OpenAI',
  link: 'https://www.theverge.com/ai/1008198/usa-today-openai', publishedAt: 1791480000 };

test('the real sources list names The Verge', () => {
  assert.equal(NAMES.get('object-object'), 'The Verge');
});

test('newsToItem carries the publication name as the byline and keeps the id as the source', () => {
  const it = newsToItem(VERGE, { names: NAMES });
  assert.equal(it.sourceName, 'The Verge');
  assert.equal(it.author, 'The Verge');
  assert.equal(it.source, 'object-object', 'the follow state and the channel filter key on the id');
});

test('the card byline and avatar tooltip read the name', () => {
  const av = avatarFor(newsToItem(VERGE, { names: NAMES }));
  assert.equal(av.title, 'The Verge');
  assert.doesNotMatch(av.title, /object/);
});

test('without the names the byline falls back to the id, sourceName stays null, and a bare .map still works', () => {
  assert.equal(newsToItem(VERGE).author, 'object-object');
  assert.equal(newsToItem(VERGE).sourceName, null, 'unknown is null, never the id, so a reader can look further');
  assert.equal(newsToItem(VERGE, { names: new Map() }).sourceName, null);
  const [mapped] = [VERGE].map(newsToItem); // map passes the index as the second argument
  assert.equal(mapped.author, 'object-object');
  assert.equal(newsToItem({ title: 'x' }).author, 'News');
  assert.equal(newsToItem({ title: 'x' }).sourceName, null);
});

test('both surfaces that build news cards pass the names through', () => {
  const nt = read('extension/src/newtab.mjs');
  assert.match(nt, /NEWS\.map\(\(n\) => newsToItem\(n, \{ names: NEWS_NAMES \}\)\)/, 'the new tab feed');
  assert.match(nt, /fetch\(`\$\{SITE\}\/news-sources\.json`/, 'the new tab loads the names');
  assert.match(nt, /^\s*loadNewsNames\(\);$/m, 'and calls the loader at start-up');
  const gn = read('client-ui/src/elements/gbti-news.mjs');
  assert.match(gn, /raw\.map\(\(n\) => newsToItem\(n, \{ names: sourceNames \}\)\)/, 'the Browse news tab');
  assert.match(gn, /fetch\(`\$\{SITE\}\/news-sources\.json`/, 'which loads the names');
  assert.match(gn, /\[it\.sourceName \|\| newsSourceName\(it\.source/, 'and its reader names the publication too');
  const rd = read('client-ui/src/elements/gbti-news-reader.mjs');
  assert.match(rd, /pub\?\.name \|\| it\.sourceName \|\| it\.source/, 'the expanded reader falls back to the card name');
});

test('the version indicator shows the installed version\'s own build', () => {
  // A fixture, because the real changelog keeps growing: a build note reuses the current version, so a literal for
  // the current version goes stale on the next note.
  const entries = normalizeChangelog({ entries: [
    { version: '0.6.0', build: 41, date: '2026-10-09', type: 'build', title: 'a later build note', notes: ['x'] },
    { version: '0.6.0', build: 40, date: '2026-10-08', type: 'release', title: 'Version 0.6.0', notes: ['x'] },
    { version: '0.5.3', build: 39, date: '2026-09-30', type: 'release', title: 'Version 0.5.3', notes: ['x'] },
  ] });
  assert.equal(entries.length, 3, 'control: the fixture normalizes');
  assert.equal(buildForVersion(entries, '0.5.3'), 39, 'the reported case: not the newest build, 41');
  assert.equal(buildForVersion(entries, '0.6.0'), 41, 'a version with several builds shows its highest');
  assert.equal(buildForVersion(entries, '9.9.9'), 0);
  assert.equal(buildForVersion(null, '0.5.3'), 0);
  assert.equal(buildForVersion(entries, ''), 0);
});

test('on the real changelog, every version maps to its own highest build', () => {
  const entries = allEntries();
  assert.equal(buildForVersion(entries, '0.5.3'), 39, '0.5.3 is closed: builds only reuse the current version');
  for (const v of new Set(entries.map((e) => e.version))) {
    const want = Math.max(...entries.filter((e) => e.version === v).map((e) => e.build));
    assert.equal(buildForVersion(entries, v), want, v);
  }
});

test('the new tab reads the build per version, not the newest build', () => {
  const nt = read('extension/src/newtab.mjs');
  assert.match(nt, /buildForVersion\(data\?\.entries, version\)/);
  assert.doesNotMatch(nt, /Number\(data\?\.build\)/);
});
