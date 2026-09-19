// sow-371: a news story prints the publication's NAME, not the slug we happen to store it under.
//
// The live defect: The Verge's source id is the literal string "object-object" in house/news-sources.yml, from a
// bad import, and four surfaces printed "NEWS · OBJECT-OBJECT" under its headlines. The weekly digest had already
// hit this and solved it on its own (membership/mail-render.mjs still carries the note about a delivered issue);
// the four reader-facing surfaces had not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';

import { newsSourceName, sourceNameMap } from '../membership/news-source-name.mjs';

const ROOT = new URL('../', import.meta.url);
const POOL = yaml.load(fs.readFileSync(new URL('house/news-sources.yml', ROOT), 'utf8'));

test('sow-371: the id everyone saw resolves to the publication behind it', () => {
  // The specimen, read from the real pool rather than a fixture, so this test dies with the data it describes
  // rather than passing forever on a made-up row.
  const verge = (POOL?.sources || []).find((s) => s?.id === 'object-object');
  assert.ok(verge, 'house/news-sources.yml no longer carries the object-object id; delete this case with it');
  assert.equal(verge.name, 'The Verge');
  assert.equal(newsSourceName('object-object', POOL.sources), 'The Verge');
});

test('sow-371: an id we do not know falls back to the id, and never to nothing', () => {
  // DELIBERATE, and the reason is in the helper: a source that has left the pool still has stories in the
  // 30-day window, and printing nothing under those headlines loses the attribution entirely. An ugly id beats
  // an unattributed story.
  assert.equal(newsSourceName('left-the-pool', POOL.sources), 'left-the-pool');
  assert.equal(newsSourceName('anything', null), 'anything');
  assert.equal(newsSourceName('anything', {}), 'anything');
  assert.equal(newsSourceName('anything', { sources: 'nonsense' }), 'anything');
  assert.equal(newsSourceName('anything', []), 'anything');
});

test('sow-371: no source at all prints nothing, rather than the word undefined', () => {
  for (const empty of [undefined, null, '', '   ', 0, {}]) {
    assert.equal(newsSourceName(empty, POOL.sources), '', JSON.stringify(empty));
  }
});

test('sow-371: the map takes both payload shapes and drops half-formed rows', () => {
  // The site fetches /news-sources.json ({ sources: [...] }) and the extension holds a bare array, so both are
  // accepted rather than making four call sites remember which they hold.
  const wrapped = sourceNameMap({ sources: [{ id: 'a', name: 'Alpha' }] });
  const bare = sourceNameMap([{ id: 'a', name: 'Alpha' }]);
  assert.equal(wrapped.get('a'), 'Alpha');
  assert.equal(bare.get('a'), 'Alpha');
  const partial = sourceNameMap([{ id: 'x' }, { name: 'No id' }, { id: ' y ', name: ' Why ' }, null, 'junk']);
  assert.equal(partial.size, 1, 'a row missing either half is dropped, not half-stored');
  assert.equal(partial.get('y'), 'Why', 'both halves are trimmed');
});

test('sow-371: a prebuilt map is reused rather than rebuilt per row', () => {
  // The feed renders 60 rows against a pool of 126 sources. Passing the Map through is what keeps that from
  // being 7,560 comparisons, so the contract that a Map is accepted is worth pinning.
  const map = sourceNameMap(POOL.sources);
  assert.ok(map instanceof Map && map.size > 50, `expected a real pool, got ${map.size}`);
  assert.equal(newsSourceName('object-object', map), 'The Verge');
});

test('sow-371: all four reader surfaces call the helper, and none keeps its own copy', () => {
  // The drift guard. sow-367 wrote exactly this guard for the summary rule over TWO files, and the homepage,
  // which was the third, kept its own copy and its own bug for another two months. So this one names four.
  const SURFACES = [
    'src/pages/news/item.astro',
    'src/components/feeds/FeedView.astro',
    'src/pages/index.astro',
    'client-ui/src/elements/gbti-news.mjs',
  ];
  for (const rel of SURFACES) {
    const src = fs.readFileSync(new URL(rel, ROOT), 'utf8');
    assert.match(src, /news-source-name\.mjs/, `${rel} should import the shared helper`);
    assert.match(src, /newsSourceName\(/, `${rel} should call it`);
    // The construction that shipped the defect, in all four: the raw id concatenated into the visible tag.
    assert.doesNotMatch(src, /'news' \+ \(it\.source \?/, `${rel} still prints the raw source id`);
  }
});

test('sow-371: every source name is fit to print, now that four surfaces print it', () => {
  // These names were imported as the RSS feed's own <title> and nothing read them, so nobody minded that one
  // carried an em dash our conventions ban in user-facing strings, and that two different publications were both
  // called RUBYLAND. Making them visible made them copy, and copy gets checked.
  const sources = (POOL?.sources || []).filter((s) => s?.enabled !== false);
  assert.ok(sources.length > 100, `expected the real pool, got ${sources.length}`);
  const byName = new Map();
  for (const s of sources) {
    const name = String(s.name || '');
    assert.ok(name.trim(), `${s.id} has no name, so it would print its id`);
    assert.doesNotMatch(name, /[—–]/, `"${name}" carries a dash our writing conventions do not use`);
    const key = name.toLowerCase();
    assert.ok(!byName.has(key), `"${name}" names both ${byName.get(key)} and ${s.id}; a reader cannot tell them apart`);
    byName.set(key, s.id);
  }
});

test('sow-371: the homepage joins the ONE summary rule sow-367 built', () => {
  // Found while fixing the source name: the homepage was the surface sow-367 missed, and its private copy of the
  // rule carried the very defect sow-367 fixed in the other two (the final dot of an ellipsis reading as a
  // finished sentence). The guard sow-367 wrote covered two files; this extends it to the third.
  const home = fs.readFileSync(new URL('src/pages/index.astro', ROOT), 'utf8');
  assert.match(home, /news-summary\.mjs/, 'the homepage should import the shared summary rule');
  assert.doesNotMatch(home, /\/\[\.!\?\]\["'\)\\\]\]\?\$\/\.test\(sum\)/, 'the homepage kept its own copy of the summary rule');
});
