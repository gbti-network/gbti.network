// SOW-059 P1b: the pure pre-signup touch-capture config + helpers (src/lib/touch.mjs). No DOM. Guards the
// off-by-default invariant and the client/server session-id contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOUCH_CAPTURE_ENABLED, TOUCH_ENDPOINT, TOUCH_SID_COOKIE, sessionIdFromBytes, validTouchSignal } from '../src/lib/touch.mjs';

// The Worker (workers/signup/membership-touches.mjs) validates the session id with exactly this rule; the client
// MUST mint ids that pass it, or every capture 400s. Keep these two in lockstep.
const SERVER_SESSION_RE = /^[A-Za-z0-9_-]{16,128}$/;

test('capture is OFF by default (must never ship enabled without an explicit flip)', () => {
  assert.equal(TOUCH_CAPTURE_ENABLED, false);
});

test('config points at the prod Worker /touch endpoint + the session cookie', () => {
  assert.equal(TOUCH_ENDPOINT, 'https://signup.gbti.network/touch');
  assert.equal(TOUCH_SID_COOKIE, 'gbti_sid');
});

test('sessionIdFromBytes mints an id the Worker accepts (url-safe, 32 chars from 24 bytes)', () => {
  // a spread of byte patterns incl. ones that would produce + / = in plain base64
  for (const fill of [0, 1, 62, 63, 251, 255]) {
    const bytes = new Uint8Array(24).fill(fill);
    const sid = sessionIdFromBytes(bytes);
    assert.match(sid, SERVER_SESSION_RE, `fill=${fill} -> ${sid}`);
    assert.equal(sid.length, 32);
    assert.ok(!/[+/=]/.test(sid), 'no base64 chars that the rule rejects');
  }
});

test('sessionIdFromBytes is deterministic for given bytes', () => {
  const b = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
  assert.equal(sessionIdFromBytes(b), sessionIdFromBytes(b));
});

test('validTouchSignal: needs a known type + owner + slug', () => {
  assert.equal(validTouchSignal({ owner: '123', type: 'post', slug: 'a' }), true);
  assert.equal(validTouchSignal({ owner: '123', type: 'product', slug: 'a' }), true);
  assert.equal(validTouchSignal({ owner: '123', type: 'prompt', slug: 'a' }), true);
  assert.equal(validTouchSignal({ owner: '', type: 'post', slug: 'a' }), false);   // house / unindexed -> no owner
  assert.equal(validTouchSignal({ owner: '123', type: 'page', slug: 'a' }), false); // not an earning type
  assert.equal(validTouchSignal({ owner: '123', type: 'post', slug: '' }), false);
  assert.equal(validTouchSignal({}), false);
  assert.equal(validTouchSignal(), false);
});
