// sow-372: the words that keep a story out of the news stream.
//
// Why this exists, measured rather than asserted: the pool is 126 general technology and security feeds and
// several carry national politics. Of the 60 stories live on 2026-09-19, three were American election coverage
// under a technology tag. The owner gave six words that day.
//
// The two properties worth most of these cases are WHOLE WORD (a trumpet is not a Trump story) and that the rule
// is enforced in BOTH places (ingest, so it is never stored, and read, so a word added today hides what is
// already in the window). Either one alone leaves an obvious hole.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';

import {
  readBanwords, normalizeBanword, banwordMatcher, blockedBy,
  addBanword, removeBanword, banwordInput, NewsBanwordError,
  BANWORD_LIMIT, BANWORD_MIN, BANWORD_MAX,
} from '../membership/news-banwords.mjs';
import { selectFresh } from '../workers/signup/news/src/ingest.mjs';
import { rankForPath, SUPERADMIN_HOUSE_FILES, ROLE_RANK } from '../membership/path-rank.mjs';

const ROOT = new URL('../', import.meta.url);
const DOC = yaml.load(fs.readFileSync(new URL('house/news-banwords.yml', ROOT), 'utf8'));

test('sow-372: the six words the owner gave are the six words in force', () => {
  assert.deepEqual(readBanwords(DOC), ['covid', 'democrat', 'maga', 'pandemic', 'republican', 'trump']);
});

test('sow-372: WHOLE WORD, which is the property that makes the list safe to use', () => {
  // The whole reason a substring match was not used. Each left-hand string must NOT be blocked.
  const m = banwordMatcher(readBanwords(DOC));
  for (const safe of [
    'She played the trumpet at the gala',
    'Ten magazines that changed design',
    'Magazine layout in CSS Grid',
    'Democratize machine learning',          // "democrat" inside "democratize"
    // A banned word at the END of a longer one. Found by mutation: removing the LEADING boundary left every
    // case above still passing, because all of them were word-plus-suffix and none was prefix-plus-word.
    'Prepandemic supply chains, revisited',  // "pandemic" at the end of "prepandemic"
    'The Eurotrump thesis, in code',         // "trump" at the end of "Eurotrump"
  ]) {
    assert.equal(blockedBy({ title: safe }, m), null, safe);
  }
  // And each of these IS blocked, because the boundary is any non-letter, non-digit character.
  for (const [text, word] of [
    ['Now Trump says he is creating an AI Force', 'trump'],
    ["Trump's tariffs hit the chip supply", 'trump'],
    ['COVID-19 modelling code goes open source', 'covid'],
    ['The #MAGA account network, mapped', 'maga'],
    ['(pandemic) retrospectives', 'pandemic'],
  ]) {
    assert.equal(blockedBy({ title: text }, m), word, text);
  }
});

test('sow-372: a POSSESSIVE blocks and a PLURAL does not, which is the rule, not an oversight', () => {
  // The distinction a superadmin has to know, so it is pinned rather than left to be discovered. An apostrophe
  // is not a letter, so "Trump's" blocks; an "s" is, so "Republicans" is a different word and does not. Whoever
  // wants the plural adds the plural. Stating the real behaviour beats stating the one that sounds right.
  const m = banwordMatcher(['republican']);
  assert.equal(blockedBy({ title: 'Republicans meet in Ohio' }, m), null, 'a plural is a different word to the matcher');
  assert.equal(blockedBy({ title: 'A republican, in Ohio' }, m), 'republican');
  const both = banwordMatcher(['republican', 'republicans']);
  assert.equal(blockedBy({ title: 'Republicans meet in Ohio' }, both), 'republicans');
});

test('sow-372: the headline and BOTH summaries are read, ours as well as theirs', () => {
  const m = banwordMatcher(['pandemic']);
  assert.equal(blockedBy({ title: 'Remote work tooling in 2026', summary: 'How teams changed after the pandemic.' }, m), 'pandemic');
  assert.equal(blockedBy({ title: 'Remote work tooling in 2026', digest: 'A retrospective on pandemic-era tooling.' }, m), 'pandemic');
  assert.equal(blockedBy({ title: 'Remote work tooling in 2026', summary: 'How teams changed.' }, m), null);
  // A word split across the two fields must not join up into a match.
  assert.equal(blockedBy({ title: 'pan', summary: 'demic' }, m), null);
});

test('sow-372: no words means nothing is blocked, and that is the pre-existing behaviour', () => {
  // FAIL OPEN, deliberately, and the opposite of every membership check. An unreadable list must not block the
  // whole feed: the failure mode of blocking too much is an empty news stream with no message.
  for (const empty of [null, undefined, [], {}, { words: null }, { words: 'trump' }, { words: [] }]) {
    const m = banwordMatcher(readBanwords(empty));
    assert.equal(m, null, JSON.stringify(empty));
    assert.equal(blockedBy({ title: 'Trump says' }, m), null);
  }
});

test('sow-372: a malformed entry is dropped at runtime and the rest still block', () => {
  const words = readBanwords({ words: ['trump', '', 'a', 'covid', 're*publican', 42, null, 'TRUMP', '  maga  '] });
  assert.deepEqual(words, ['covid', 'maga', 'trump'], 'case folded, duplicates merged, junk dropped');
});

test('sow-372: a bare number is not a blocked word, though digits inside one are fine', () => {
  // Found by a test rather than by reading: `- 42` in the YAML arrives as the NUMBER 42, became the string "42",
  // and would have silenced every story that mentions forty-two. Requiring one letter rules that out while
  // keeping the entries digits exist for.
  for (const n of [42, '42', '2026', '19']) assert.equal(normalizeBanword(n), '', String(n));
  assert.equal(normalizeBanword('covid-19'), 'covid-19');
  assert.equal(normalizeBanword('web3'), 'web3');
});

test('sow-372: a word is normalized to one stored form, or refused', () => {
  assert.equal(normalizeBanword('  TRUMP '), 'trump');
  assert.equal(normalizeBanword('White   House'), 'white house');
  assert.equal(normalizeBanword('covid-19'), 'covid-19');
  for (const bad of ['a', '', '   ', 'x'.repeat(BANWORD_MAX + 1), 'tru*mp', 'a_b', 'hello!', ' - lead', 'trail - ', '42']) {
    assert.equal(normalizeBanword(bad), '', JSON.stringify(bad));
  }
  assert.equal(normalizeBanword('x'.repeat(BANWORD_MAX)).length, BANWORD_MAX);
  assert.equal(normalizeBanword('x'.repeat(BANWORD_MIN)).length, BANWORD_MIN);
});

test('sow-372: adding and removing a word edits the document, idempotently', () => {
  const start = { words: ['covid'] };
  const added = addBanword(start, { word: 'Trump' }, { now: '2026-09-19T00:00:00Z', actor: { login: 'atwellpub', githubId: 7 } });
  assert.deepEqual(added.next.words, ['covid', 'trump'], 'stored lowercase and sorted, so the file diff is one line');
  assert.equal(added.changed, true);
  assert.equal(added.audit.action, 'news-banword-add');
  assert.equal(added.audit.target.word, 'trump');
  assert.equal(added.audit.actor.login, 'atwellpub');

  assert.equal(addBanword(added.next, { word: 'trump' }).changed, false, 'already listed');
  // Sorted, not appended. Found by mutation: the case above adds a word that already sorts last, so dropping
  // the sort changed nothing. A file whose diff is one line is the point; an append makes it two.
  assert.deepEqual(addBanword({ words: ['trump'] }, { word: 'covid' }).next.words, ['covid', 'trump']);
  const removed = removeBanword(added.next, { word: 'TRUMP' });
  assert.deepEqual(removed.next.words, ['covid']);
  assert.equal(removed.changed, true);
  assert.equal(removeBanword(removed.next, { word: 'trump' }).changed, false, 'not listed');

  for (const bad of [{}, { word: '' }, { word: 'a' }, { word: 'tru*mp' }]) {
    assert.throws(() => addBanword(start, bad), NewsBanwordError, JSON.stringify(bad));
    assert.throws(() => banwordInput(bad), NewsBanwordError, JSON.stringify(bad));
  }
  assert.deepEqual(banwordInput({ word: '  Trump ' }), { word: 'trump' });
});

test('sow-372: the list has a ceiling, because it is one regular expression over every story', () => {
  const full = { words: Array.from({ length: BANWORD_LIMIT }, (_, i) => `word${i}`) };
  assert.equal(readBanwords(full).length, BANWORD_LIMIT);
  assert.throws(() => addBanword(full, { word: 'onemore' }), NewsBanwordError);
  assert.equal(readBanwords({ words: Array.from({ length: BANWORD_LIMIT + 50 }, (_, i) => `word${i}`) }).length, BANWORD_LIMIT);
});

test('sow-372: INGEST refuses a blocked story before it is stored or classified', () => {
  const banned = banwordMatcher(['trump']);
  const parsed = [
    { guid: 'a', source: 's1', title: 'Rust 2.0 lands' },
    { guid: 'b', source: 's1', title: 'Trump signs the chip order' },
    { guid: 'c', source: 's1', title: 'A trumpet, restored' },
  ];
  const seen = [];
  const fresh = selectFresh(parsed, { banned, now: 10, onBlock: (w, it) => seen.push([w, it.guid]) });
  assert.deepEqual(fresh.map((f) => f.guid), ['a', 'c']);
  assert.deepEqual(seen, [['trump', 'b']], 'and every block is reported, so over-blocking is visible in the log');
});

test('sow-372: a blocked story does not spend a down-weighted source its quota', () => {
  // The ordering that makes this true: the block is checked BEFORE the per-source cap is charged. Reversed, a
  // source capped at one would spend its single slot on a story nobody ever sees.
  const banned = banwordMatcher(['trump']);
  const parsed = [
    { guid: 'a', source: 'slow', title: 'Trump signs the chip order' },
    { guid: 'b', source: 'slow', title: 'Rust 2.0 lands' },
  ];
  const fresh = selectFresh(parsed, { banned, capFor: new Map([['slow', 1]]), now: 10 });
  assert.deepEqual(fresh.map((f) => f.guid), ['b']);
});

test('sow-372: with no list, ingest selects exactly what it selected before', () => {
  const parsed = [{ guid: 'a', source: 's', title: 'Trump signs the chip order' }];
  assert.deepEqual(selectFresh(parsed, { now: 1 }).map((f) => f.guid), ['a']);
  assert.deepEqual(selectFresh(parsed, { banned: null, now: 1 }).map((f) => f.guid), ['a']);
});

test('sow-372: the READ path filters too, which is what makes a new word take effect today', () => {
  // Enforced by reading the store rather than by a fixture, because the whole value of the second guard is that
  // it exists at all. Without it, seeding this list would have left a month of matching stories in the window.
  const store = fs.readFileSync(new URL('workers/signup/news/src/store.mjs', ROOT), 'utf8');
  assert.match(store, /banwordMatcher\(await loadBanwords\(env\)\)/, 'queryItems must build the matcher');
  assert.match(store, /!blockedBy\(it, banned\)/, 'queryItems must apply it per item');
  const ingest = fs.readFileSync(new URL('workers/signup/news/src/ingest.mjs', ROOT), 'utf8');
  assert.match(ingest, /saveBanwords\(env, banwords\)/, 'the ingest must mirror the list to KV for that read to find');
  assert.match(ingest, /sourcesOrigin === 'remote'/, 'and only from the published artifact, never from a stale cache');
});

test('sow-372: the file is pinned to superadmin in all three places that decide it', () => {
  // Lockstep. One of these disagreeing is the difference between a blocked-word edit being a superadmin action
  // and being anybody-with-admin, and nothing else would report it.
  assert.ok(SUPERADMIN_HOUSE_FILES.has('house/news-banwords.yml'));
  assert.equal(rankForPath('house/news-banwords.yml'), ROLE_RANK.superadmin);
  const owners = fs.readFileSync(new URL('CODEOWNERS', ROOT), 'utf8');
  assert.match(owners, /^\/house\/news-banwords\.yml\s+@atwellpub @gbtilabs$/m);
  const author = fs.readFileSync(new URL('workers/signup/membership-admin-author.mjs', ROOT), 'utf8');
  for (const action of ['news-banword-add', 'news-banword-remove']) {
    assert.match(author, new RegExp(`'${action}': \\{ path: 'house/news-banwords\\.yml', rank: ROLE_RANK\\.superadmin`), action);
  }
});

test('sow-372: the published artifact carries the list, and the worker reads it from there', () => {
  const artifact = fs.readFileSync(new URL('src/pages/news-sources.json.ts', ROOT), 'utf8');
  assert.match(artifact, /sources, banwords/, 'the artifact body must include the words');
  const sources = fs.readFileSync(new URL('workers/signup/news/src/sources.mjs', ROOT), 'utf8');
  assert.match(sources, /banwords: \[\], origin: 'bundled'/, 'a bundled fallback blocks nothing rather than guessing');
});
