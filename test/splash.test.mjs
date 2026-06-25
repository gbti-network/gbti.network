// SOW-063: the new-tab landing splash pure core (client-ui/src/splash.mjs) — the 12h quote rotation, the snooze
// decision, and the dest->hash mapping. No DOM, no chrome, like the feed-route tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUNDLED_QUOTES, enabledQuotes, pickQuote, shouldShowSplash, splashDestHash, normalizeBgMode, splashBgClass, normalizeBgOpacity, normalizeBgPattern, fitDimensions, GBTI_ASCII } from '../client-ui/src/splash.mjs';

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

// SOW-074: the user-uploaded splash-background normalizers + the ASCII art constant.
test('normalizeBgMode accepts off/content/full and defaults unknown to off', () => {
  for (const m of ['off', 'content', 'full']) assert.equal(normalizeBgMode(m), m);
  assert.equal(normalizeBgMode('FULL'), 'full');
  for (const bad of ['', 'wallpaper', null, undefined, 5]) assert.equal(normalizeBgMode(bad), 'off');
});

test('splashBgClass maps the mode to the splash CSS class', () => {
  assert.equal(splashBgClass('content'), 'bg-content');
  assert.equal(splashBgClass('full'), 'bg-full');
  assert.equal(splashBgClass('off'), '');
  assert.equal(splashBgClass('nope'), '');
});

test('normalizeBgOpacity clamps to 0..100 and falls back on non-numeric input', () => {
  assert.equal(normalizeBgOpacity(55), 55);
  assert.equal(normalizeBgOpacity('70'), 70);
  assert.equal(normalizeBgOpacity(-10), 0);
  assert.equal(normalizeBgOpacity(140), 100);
  assert.equal(normalizeBgOpacity(33.6), 34); // rounds
  assert.equal(normalizeBgOpacity('abc'), 55); // default
  assert.equal(normalizeBgOpacity(null, 40), 40); // custom fallback
});

test('normalizeBgPattern accepts the set and defaults unknown to none', () => {
  for (const p of ['none', 'ascii', 'dots', 'scanlines']) assert.equal(normalizeBgPattern(p), p);
  assert.equal(normalizeBgPattern('ASCII'), 'ascii');
  for (const bad of ['', 'plaid', null, undefined]) assert.equal(normalizeBgPattern(bad), 'none');
});

test('fitDimensions caps the longest side, preserves aspect, never up-scales, guards bad input', () => {
  assert.deepEqual(fitDimensions(3200, 1600, 1600), { w: 1600, h: 800 }); // landscape capped on width
  assert.deepEqual(fitDimensions(1000, 4000, 1600), { w: 400, h: 1600 }); // portrait capped on height
  assert.deepEqual(fitDimensions(800, 600, 1600), { w: 800, h: 600 }); // already small -> unchanged (no up-scale)
  assert.deepEqual(fitDimensions(0, 600, 1600), { w: 0, h: 0 }); // bad input
  assert.deepEqual(fitDimensions(100, 100, 0), { w: 0, h: 0 }); // bad max
});

test('GBTI_ASCII is a non-trivial multi-line art constant', () => {
  assert.equal(typeof GBTI_ASCII, 'string');
  assert.ok(GBTI_ASCII.split('\n').length >= 5);
});
