// sow-314 follow-up: a member count must say which Stripe world it came from.
//
// The failure this guards is not hypothetical. A local run against TEST mode reported 22 members as having no
// Stripe Customer when production has them all, and three further scripts "confirmed" it by reading the same
// variable. Nothing in the output named the mode, so there was nothing to notice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripeMode, stripeModeNote } from '../membership/stripe-mode.mjs';

test('live and test keys are told apart, in both restricted and secret forms', () => {
  for (const k of ['sk_live_abc123', 'rk_live_abc123']) assert.equal(stripeMode(k), 'live', k);
  for (const k of ['sk_test_abc123', 'rk_test_abc123']) assert.equal(stripeMode(k), 'test', k);
});

test('anything unrecognisable is UNKNOWN, never assumed live', () => {
  // Guessing "live" on an odd key would restore the exact silence this exists to break.
  for (const k of ['', null, undefined, 42, 'sk_abc', 'whsec_x', 'pk_live_x_but_wrong_shape'.replace('pk_live_', 'zz')]) {
    assert.equal(stripeMode(k), 'unknown', String(k));
  }
});

test('a TEST-mode note says the count is not the real membership', () => {
  const note = stripeModeNote('rk_test_x');
  assert.match(note, /TEST MODE/);
  assert.match(note, /NOT your real membership/, 'the reader must not have to know what test mode implies');
});

test('LIVE is labelled too, so a missing label is conspicuous', () => {
  // A label that appears only on failure trains people to skim past its absence, and the absence was the bug.
  assert.match(stripeModeNote('rk_live_x'), /LIVE/);
  assert.notEqual(stripeModeNote('rk_live_x').trim(), '');
});

test('an unknown key is flagged as unverified rather than passed silently', () => {
  assert.match(stripeModeNote(''), /UNKNOWN/);
  assert.match(stripeModeNote(''), /unverified/);
});

test('the note never leaks the key beyond its mode', () => {
  const secret = 'rk_live_SUPERSECRETVALUE123456';
  const note = stripeModeNote(secret);
  assert.ok(!note.includes('SUPERSECRET'), 'a diagnostic must not carry the credential it describes');
  assert.ok(!note.includes(secret));
});

test('reconcile ACTUALLY attaches the note to its member count', () => {
  // The module being correct is worth nothing if the call site never uses it: that gap is what let the
  // original error through, so the wiring is asserted rather than assumed.
  const src = readFileSync(new URL('../scripts/reconcile.mjs', import.meta.url), 'utf8');
  const line = src.split('\n').find((l) => l.includes('membership customer(s)') && l.includes('console.log'));
  assert.ok(line, 'the member count line was not found: this test is broken, not the subject');
  assert.match(line, /stripeModeNote\(env\.STRIPE_SECRET_KEY\)/,
    'the count must carry its mode, and it must read the SAME variable the Stripe client does');
});
