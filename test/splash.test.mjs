// SOW-063: the new-tab landing splash pure core (client-ui/src/splash.mjs) — the 12h quote rotation, the snooze
// decision, and the dest->hash mapping. No DOM, no chrome, like the feed-route tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUNDLED_QUOTES, enabledQuotes, pickQuote, shouldShowSplash, splashDestHash } from '../client-ui/src/splash.mjs';

const TWELVE_H = 12 * 60 * 60 * 1000;

test('BUNDLED_QUOTES is the seeded set, all well-formed', () => {
  assert.equal(BUNDLED_QUOTES.length, 9);
  for (const q of BUNDLED_QUOTES) { assert.ok(q.text.trim()); assert.ok(q.author.trim()); }
});

test('enabledQuotes drops disabled + blank + malformed, trims, and normalizes', () => {
  const out = enabledQuotes([
    { text: 'A', author: 'x', enabled: true },
    { text: '  B  ', author: '  y  ' }, // enabled defaults true; trimmed
    { text: 'C', author: 'z', enabled: false }, // disabled -> dropped
    { text: '', author: 'w' }, // blank text -> dropped
    { text: 'D', author: '' }, // blank author -> dropped
    null, undefined, 'nope',
  ]);
  assert.deepEqual(out, [{ text: 'A', author: 'x' }, { text: 'B', author: 'y' }]);
  assert.deepEqual(enabledQuotes(null), []);
  assert.deepEqual(enabledQuotes('x'), []);
});

test('pickQuote: deterministic within a 12h window, advances to the NEXT every 12h, wraps', () => {
  const qs = [{ text: 'q0', author: 'a' }, { text: 'q1', author: 'b' }, { text: 'q2', author: 'c' }];
  const base = 100 * TWELVE_H; // bucket 100 -> 100 % 3 = 1 -> q1
  assert.equal(pickQuote(qs, base).text, 'q1');
  assert.equal(pickQuote(qs, base + TWELVE_H - 1).text, 'q1', 'same within the 12h window');
  assert.equal(pickQuote(qs, base + TWELVE_H).text, 'q2', 'advances at the 12h boundary');
  assert.equal(pickQuote(qs, base + 2 * TWELVE_H).text, 'q0', 'wraps around the set');
});

test('pickQuote ignores disabled quotes and returns null on an empty/usable-less set', () => {
  const qs = [{ text: 'on', author: 'a' }, { text: 'off', author: 'b', enabled: false }];
  // Only one enabled -> always that one regardless of the bucket.
  assert.equal(pickQuote(qs, 5 * TWELVE_H).text, 'on');
  assert.equal(pickQuote(qs, 6 * TWELVE_H).text, 'on');
  assert.equal(pickQuote([], 0), null);
  assert.equal(pickQuote([{ text: '', author: '' }], 0), null);
  assert.equal(pickQuote(null, 0), null);
});

test('shouldShowSplash: no decision / lapsed window -> true; within window -> false; windowMs 0 -> always true', () => {
  const win = 30 * 60 * 1000;
  const now = 1_000_000_000;
  assert.equal(shouldShowSplash(null, now, win), true, 'no decision -> show');
  assert.equal(shouldShowSplash({ dest: 'news' }, now, win), true, 'decision with no timestamp -> show');
  assert.equal(shouldShowSplash({ dest: 'news', at: now - 60_000 }, now, win), false, 'within window -> skip');
  assert.equal(shouldShowSplash({ dest: 'news', at: now - win }, now, win), true, 'exactly lapsed -> show');
  assert.equal(shouldShowSplash({ dest: 'news', at: now - win - 1 }, now, win), true, 'past window -> show');
  assert.equal(shouldShowSplash({ dest: 'news', at: now - 60_000 }, now, 0), true, 'window 0 = always show');
});

test('splashDestHash maps the card destinations to the feed hash vocabulary', () => {
  assert.equal(splashDestHash('activity'), '#type=all');
  assert.equal(splashDestHash('news'), '#type=news');
  assert.equal(splashDestHash('anything-else'), '#type=all');
});
