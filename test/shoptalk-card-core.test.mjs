// sow-314: every state the account page's Shop Talk card can be in, from the Worker's answer.
import test from 'node:test';
import assert from 'node:assert/strict';

import { shoptalkCardState, shoptalkAfterAction } from '../src/lib/shoptalk-card-core.mjs';

const NEXT = '2026-09-12T16:00:00Z';

test('not eligible: says who the call is for, links to membership, offers no action', () => {
  const st = shoptalkCardState({ eligible: false, status: 'none', enrolled: null, address: null, optedOut: false });
  assert.match(st.body, /paid and trial membership/);
  assert.equal(st.action, null);
  assert.equal(st.href, '/membership/');
});

test('enrolled: names the address the invitation went to and offers Leave', () => {
  const st = shoptalkCardState({ eligible: true, status: 'paid', enrolled: true, address: 'stef@example.com', optedOut: false, nextCall: NEXT });
  assert.equal(st.headline, 'You are on the Saturday call');
  assert.match(st.body, /stef@example\.com/);
  assert.match(st.body, /without knocking/);
  assert.match(st.body, /The next call is/);
  assert.equal(st.action, 'leave');
});

test('eligible but not yet on the list: says the seat is being added, still offers Leave', () => {
  const st = shoptalkCardState({ eligible: true, status: 'trialing', enrolled: false, address: 'new@example.com', optedOut: false });
  assert.equal(st.headline, 'Your seat is being added');
  assert.match(st.body, /next nightly sweep/);
  assert.equal(st.action, 'leave');
});

test('opted out: offers Rejoin and names the address it would go to', () => {
  const st = shoptalkCardState({ eligible: true, status: 'paid', enrolled: false, address: 'stef@example.com', optedOut: true });
  assert.match(st.headline, /stepped off/);
  assert.equal(st.action, 'rejoin');
  assert.match(st.body, /stef@example\.com/);
});

test('calendar unreadable (enrolled null) reads as unconfirmed, never as "not on the list"', () => {
  const st = shoptalkCardState({ eligible: true, status: 'paid', enrolled: null, address: 'stef@example.com', optedOut: false });
  assert.match(st.body, /could not be read/);
  assert.doesNotMatch(st.body, /being added/);
  assert.equal(st.action, 'leave');
});

test('no address on file: explains it and offers nothing to press', () => {
  const st = shoptalkCardState({ eligible: true, status: 'paid', enrolled: null, address: null, optedOut: false });
  assert.match(st.body, /no email address/);
  assert.equal(st.action, null);
});

test('after an action: the Worker message wins; otherwise applied-now versus next-sweep wording', () => {
  assert.equal(shoptalkAfterAction({ ok: true, message: 'recorded; the change reaches the calendar on the next sweep' }, 'leave').note, 'recorded; the change reaches the calendar on the next sweep');
  assert.match(shoptalkAfterAction({ ok: true, applied: true }, 'leave').note, /Removed from the guest list/);
  assert.match(shoptalkAfterAction({ ok: true, applied: false }, 'leave').note, /next sweep/);
  assert.match(shoptalkAfterAction({ ok: true, applied: true }, 'rejoin').note, /sent again/);
});

test('junk in, a safe card out', () => {
  const st = shoptalkCardState(null);
  assert.equal(st.action, null);
  assert.equal(st.href, '/membership/');
});
