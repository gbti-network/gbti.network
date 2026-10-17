// sow-314: every state the account page's Shop Talk card can be in, from the Worker's answer.
import test from 'node:test';
import assert from 'node:assert/strict';

import { shoptalkCardState, shoptalkAfterAction, shoptalkAddressLine } from '../src/lib/shoptalk-card-core.mjs';

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
  assert.match(shoptalkAfterAction({ ok: true, applied: true }, 'rejoin').note, /Invitation sent/);
  assert.match(shoptalkAfterAction({ ok: true, applied: false }, 'rejoin').note, /already on the guest list/, 'rule 5: no promise that a sweep will send it');
});

test('junk in, a safe card out', () => {
  const st = shoptalkCardState(null);
  assert.equal(st.action, null);
  assert.equal(st.href, '/membership/');
});

// 2026-09-10: the member decides. Two states in which the sweep will never mail them again on its own.
test('declined on the calendar: says so, promises no more mail, offers Rejoin', () => {
  const st = shoptalkCardState({ eligible: true, status: 'paid', enrolled: true, declined: true, address: 'm@x.com', optedOut: false, nextCall: NEXT });
  assert.match(st.headline, /declined/);
  assert.match(st.body, /Nothing more is sent unless you ask/);
  assert.match(st.body, /m@x\.com/);
  assert.equal(st.action, 'rejoin');
});

test('dropped (invited once, removed since): says the seat was removed, offers Rejoin, never "being added"', () => {
  const st = shoptalkCardState({ eligible: true, status: 'trialing', enrolled: false, dropped: true, address: 'm@x.com', optedOut: false, nextCall: NEXT });
  assert.match(st.headline, /off the Saturday call list/);
  assert.doesNotMatch(st.body, /next nightly sweep/);
  assert.equal(st.action, 'rejoin');
});

test('control: not on the list and never invited still reads as "being added"', () => {
  const st = shoptalkCardState({ eligible: true, status: 'paid', enrolled: false, dropped: false, address: 'm@x.com', optedOut: false });
  assert.match(st.headline, /being added/);
  assert.equal(st.action, 'leave');
});

// ---- sow-466: the address line --------------------------------------------------------------------------

test('a member who has NOT chosen is told the address is a guess from billing', () => {
  const line = shoptalkAddressLine({ eligible: true, address: 'billing@x.com', addressSource: 'billing' });
  assert.equal(line.value, 'billing@x.com');
  assert.match(line.hint, /billing record/);
  assert.match(line.hint, /Change it/, 'the hint has to say it can be changed, or it is just a fact they cannot act on');
});

test('a member who HAS chosen is told so, not told we guessed', () => {
  const line = shoptalkAddressLine({ eligible: true, address: 'calendar@x.com', addressSource: 'member' });
  assert.match(line.hint, /You chose this address/);
  assert.ok(!/billing/.test(line.hint));
});

test('with no address at all the form asks for one instead of pointing at Discord', () => {
  const line = shoptalkAddressLine({ eligible: true, address: null });
  assert.equal(line.value, '');
  assert.match(line.cta, /Send my invitation/);
  const st = shoptalkCardState({ eligible: true, address: null });
  assert.ok(!/Discord/.test(st.body), 'a member can fill this in themselves now');
});

test('a member who is not eligible gets no address form at all', () => {
  assert.equal(shoptalkAddressLine({ eligible: false }), null);
});

test('after a MOVE the note says the old address came off, not just "invitation sent"', () => {
  const { note } = shoptalkAfterAction({ applied: true, moved: true, address: 'new@x.com' }, 'rejoin');
  assert.match(note, /new@x\.com/);
  assert.match(note, /old address is off the list/);
});

test('a first invitation still reads as a first invitation', () => {
  const { note } = shoptalkAfterAction({ applied: true, address: 'a@x.com' }, 'rejoin');
  assert.match(note, /Invitation sent/);
  assert.ok(!/moved/.test(note));
});
