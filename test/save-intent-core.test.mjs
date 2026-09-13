// sow-330: the pure decisions behind website-only saves. The remembered save must never be honoured unless it is
// well-formed, for this page, fresh and one-shot; the click decision must never show sign-in to a member whose
// session is still resolving; and a replay must never turn a favorite off. The browser half is proven separately by
// scripts/check-save-controls.mjs, which drives the built site.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PENDING_SAVE_KEY,
  PENDING_SAVE_TTL_MS,
  SAVE_TRIGGER_SELECTOR,
  intentFromControl,
  checkPendingSave,
  storePendingSave,
  takePendingSave,
  holdDecision,
  replayAction,
} from '../src/lib/save-intent-core.mjs';

const NOW = 1_800_000_000_000;
const PATH = '/projects/savepoint/';
const memoryStorage = (initial = {}) => {
  const m = new Map(Object.entries(initial));
  return { map: m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
};
const host = (tagName, type, slug) => ({ tagName, dataset: { gbtiTargetType: type, gbtiTargetSlug: slug } });

test('intentFromControl reads the kind from the element and the target from its data attributes', () => {
  assert.deepEqual(intentFromControl(host('GBTI-FAVORITE', 'project', 'savepoint')), { kind: 'favorite', type: 'project', slug: 'savepoint' });
  assert.deepEqual(intentFromControl(host('gbti-collection', 'share', 'ana/abc123')), { kind: 'collect', type: 'share', slug: 'ana/abc123' });
  assert.equal(intentFromControl(host('div', 'project', 'x')), null, 'only the two save controls');
  assert.equal(intentFromControl(host('gbti-favorite', 'profile', 'x')), null, 'an unknown content type');
  assert.equal(intentFromControl(host('gbti-favorite', 'post', '../../etc')), null, 'no traversal in a slug');
  assert.equal(intentFromControl(host('gbti-favorite', 'post', 'a b')), null, 'no spaces');
  assert.equal(intentFromControl(host('gbti-favorite', 'post', 'a/b/c')), null, 'at most author/id');
  assert.equal(intentFromControl(null), null);
  assert.equal(SAVE_TRIGGER_SELECTOR, 'gbti-favorite [data-signin], gbti-collection [data-signin]');
});

test('a remembered save round-trips for the same page and is taken exactly once', () => {
  const s = memoryStorage();
  assert.equal(storePendingSave(s, { kind: 'favorite', type: 'project', slug: 'savepoint' }, { path: PATH, now: NOW }), true);
  assert.ok(s.map.has(PENDING_SAVE_KEY));
  assert.deepEqual(takePendingSave(s, { path: PATH, now: NOW + 1000 }), { kind: 'favorite', type: 'project', slug: 'savepoint' });
  assert.equal(s.map.has(PENDING_SAVE_KEY), false, 'removed before it is returned');
  assert.equal(takePendingSave(s, { path: PATH, now: NOW + 2000 }), null, 'one-shot: a second read finds nothing');
});

test('a save remembered on another page is left for that page, not completed here', () => {
  const s = memoryStorage();
  storePendingSave(s, { kind: 'collect', type: 'prompt', slug: 'p1' }, { path: '/prompts/p1/', now: NOW });
  assert.equal(takePendingSave(s, { path: PATH, now: NOW }), null);
  assert.ok(s.map.has(PENDING_SAVE_KEY), 'kept, so returning to its own page can still complete it');
  assert.deepEqual(checkPendingSave(s.map.get(PENDING_SAVE_KEY), { path: PATH, now: NOW }), { reason: 'other-page', discard: false });
});

test('expired, future-dated and malformed values are discarded and never completed', () => {
  const at = (v) => JSON.stringify({ kind: 'favorite', type: 'project', slug: 'savepoint', path: PATH, at: v });
  const cases = [
    ['expired', at(NOW - PENDING_SAVE_TTL_MS - 1), 'expired'],
    ['future-dated', at(NOW + 5 * 60 * 1000), 'malformed'],
    ['not JSON', '{nope', 'malformed'],
    ['a string, not an object', JSON.stringify('favorite'), 'malformed'],
    ['unknown kind', JSON.stringify({ kind: 'unfavorite', type: 'project', slug: 'savepoint', path: PATH, at: NOW }), 'malformed'],
    ['unknown type', JSON.stringify({ kind: 'favorite', type: 'member', slug: 'savepoint', path: PATH, at: NOW }), 'malformed'],
    ['traversal slug', JSON.stringify({ kind: 'favorite', type: 'post', slug: '../x', path: PATH, at: NOW }), 'malformed'],
    ['relative path', JSON.stringify({ kind: 'favorite', type: 'post', slug: 'x', path: 'projects/x/', at: NOW }), 'malformed'],
    ['no timestamp', JSON.stringify({ kind: 'favorite', type: 'post', slug: 'x', path: PATH }), 'malformed'],
  ];
  for (const [label, raw, reason] of cases) {
    const s = memoryStorage({ [PENDING_SAVE_KEY]: raw });
    assert.equal(takePendingSave(s, { path: PATH, now: NOW }), null, `${label}: never completed`);
    assert.equal(s.map.has(PENDING_SAVE_KEY), false, `${label}: discarded`);
    assert.equal(checkPendingSave(raw, { path: PATH, now: NOW }).reason, reason, `${label}: reason`);
  }
  assert.ok(checkPendingSave(at(NOW - PENDING_SAVE_TTL_MS + 1000), { path: PATH, now: NOW }).intent, 'just inside the window still completes');
});

test('storage failures never throw and never pretend to succeed', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('denied'); } };
  assert.equal(storePendingSave(broken, { kind: 'favorite', type: 'post', slug: 'x' }, { path: PATH, now: NOW }), false);
  assert.equal(takePendingSave(broken, { path: PATH, now: NOW }), null);
  assert.equal(storePendingSave(null, { kind: 'favorite', type: 'post', slug: 'x' }, { path: PATH, now: NOW }), false);
  assert.equal(storePendingSave(memoryStorage(), { kind: 'favorite', type: 'post', slug: '../x' }, { path: PATH, now: NOW }), false, 'an invalid intent is not stored');
});

test('holdDecision: a member whose session is still resolving is never sent to sign-in', () => {
  assert.equal(holdDecision({ csrf: 'tok', sessionState: 'pending', controlsReady: false }), 'hold');
  assert.equal(holdDecision({ csrf: 'tok', sessionState: 'signed-in', controlsReady: false }), 'hold', 'signed in but the controls are still loading');
  assert.equal(holdDecision({ csrf: 'tok', sessionState: 'signed-out', controlsReady: false }), 'signin', 'a stale cookie that resolved signed out');
  assert.equal(holdDecision({ csrf: null, sessionState: 'pending', controlsReady: false }), 'signin', 'no cookie: nobody to wait for');
  assert.equal(holdDecision({ csrf: 'tok', sessionState: 'signed-in', controlsReady: true }), 'pass');
});

test('replayAction never turns a favorite off and never picks a collection', () => {
  assert.equal(replayAction({ kind: 'favorite', favorited: false }), 'favorite');
  assert.equal(replayAction({ kind: 'favorite', favorited: true }), 'none', 'already favorited: a replayed toggle would REMOVE it');
  assert.equal(replayAction({ kind: 'collect', pickerOpen: false }), 'open-picker');
  assert.equal(replayAction({ kind: 'collect', pickerOpen: true }), 'none');
  assert.equal(replayAction({ kind: 'unfavorite' }), 'none');
  for (const kind of ['favorite', 'collect', 'x']) for (const favorited of [true, false]) for (const pickerOpen of [true, false]) {
    assert.notEqual(replayAction({ kind, favorited, pickerOpen }), 'unfavorite');
  }
});
