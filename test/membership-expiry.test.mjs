// SOW-119 QA: the coupon-expiry countdown decision (client-ui/src/membership-expiry.mjs). Pure, no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expiryPopupDecision, expiryPopupCopy, EXPIRY_POPUP_START_DAYS } from '../client-ui/src/membership-expiry.mjs';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-08-01T12:00:00.000Z').getTime();
const untilInDays = (d) => new Date(NOW + d * DAY).toISOString();

test('no usable grant date -> never shows', () => {
  assert.deepEqual(expiryPopupDecision({ until: null, now: NOW }), { show: false, daysLeft: null });
  assert.deepEqual(expiryPopupDecision({ until: 'garbage', now: NOW }), { show: false, daysLeft: null });
  assert.deepEqual(expiryPopupDecision({ now: NOW }), { show: false, daysLeft: null });
});

test('outside the window (29+ days out) -> silent, but daysLeft still reports', () => {
  const d = expiryPopupDecision({ until: untilInDays(29), now: NOW });
  assert.equal(d.show, false);
  assert.equal(d.daysLeft, 29);
});

test('the window opens at exactly START_DAYS out', () => {
  const d = expiryPopupDecision({ until: untilInDays(EXPIRY_POPUP_START_DAYS), now: NOW });
  assert.equal(d.show, true);
  assert.equal(d.daysLeft, 28);
});

test('a dismissal snoozes 7 days mid-window', () => {
  const until = untilInDays(14);
  // dismissed yesterday -> silent
  assert.equal(expiryPopupDecision({ until, dismissedAt: NOW - 1 * DAY, now: NOW }).show, false);
  // dismissed 6 days 23h ago -> still silent
  assert.equal(expiryPopupDecision({ until, dismissedAt: NOW - (7 * DAY - 60000), now: NOW }).show, false);
  // dismissed 7 days ago -> shows again
  assert.equal(expiryPopupDecision({ until, dismissedAt: NOW - 7 * DAY, now: NOW }).show, true);
});

test('the final week escalates to daily', () => {
  const until = untilInDays(5);
  // dismissed yesterday -> SHOWS anyway (daily cooldown inside the final 7 days)
  assert.equal(expiryPopupDecision({ until, dismissedAt: NOW - 1 * DAY, now: NOW }).show, true);
  // dismissed an hour ago -> silent (still within the daily cooldown)
  assert.equal(expiryPopupDecision({ until, dismissedAt: NOW - 60 * 60 * 1000, now: NOW }).show, false);
});

test('never after the grant end', () => {
  assert.deepEqual(expiryPopupDecision({ until: untilInDays(-1), now: NOW }), { show: false, daysLeft: null });
  assert.deepEqual(expiryPopupDecision({ until: new Date(NOW).toISOString(), now: NOW }), { show: false, daysLeft: null });
});

test('a never-dismissed member shows immediately inside the window', () => {
  assert.equal(expiryPopupDecision({ until: untilInDays(3), dismissedAt: null, now: NOW }).show, true);
});

test('expiryPopupCopy is calendar-aware: today / tomorrow / N days', () => {
  // Local-constructed dates so the calendar assertions hold in any test-runner timezone.
  const morning = new Date(2026, 7, 1, 9, 0).getTime();
  const today = expiryPopupCopy(1, new Date(2026, 7, 1, 15, 0), morning); // ends 3pm the SAME day
  assert.equal(today.headline, 'Your complimentary membership ends today');
  assert.equal(today.count, 0);
  const tomorrow = expiryPopupCopy(2, new Date(2026, 7, 2, 15, 0), morning); // 30h out: ceil says 2, the calendar says tomorrow
  assert.equal(tomorrow.headline, 'Your complimentary membership ends tomorrow');
  assert.equal(tomorrow.count, 1);
  const many = expiryPopupCopy(12, new Date(2026, 7, 13, 15, 0), morning);
  assert.ok(many.headline.includes('12 days'));
  assert.equal(many.count, 12);
  assert.ok(many.dateLabel.length > 0);
  const bad = expiryPopupCopy(2, 'garbage', morning); // unparseable date: fall back to the ceil count
  assert.equal(bad.dateLabel, '');
  assert.equal(bad.count, 2);
  assert.ok(bad.headline.includes('2 days'));
});
