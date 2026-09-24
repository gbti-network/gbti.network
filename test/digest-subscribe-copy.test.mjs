// sow-202: the weekly-digest sign-up box's copy (src/lib/digest-subscribe-copy.mjs) and the component that shows
// it (src/components/mail/DigestSubscribe.astro): no promise the Worker's mode does not keep, and a notification
// settings link for signed-in members only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { subscribeSuccessMessage, inviteSuccessHeading, SUBSCRIBE_BLURB } from '../src/lib/digest-subscribe-copy.mjs';

const COMPONENT = readFileSync(new URL('../src/components/mail/DigestSubscribe.astro', import.meta.url), 'utf8');

test('success message: direct mode is true for a new, an existing and an opted-out address, and promises no welcome email', () => {
  // The Worker answers { ok: true, direct: true } whether the address was added, was already on the list, or had
  // unsubscribed (the opt-out is kept). One message covers all three, so it may not claim delivery outright.
  const direct = subscribeSuccessMessage({ ok: true, direct: true });
  assert.equal(direct, 'Thanks. This address now gets the GBTI Network weekly digest, unless it unsubscribed before.');
  assert.match(direct, /unless it unsubscribed before/);
  assert.doesNotMatch(direct, /welcome|confirm/i, 'an existing subscriber gets no welcome email and no confirmation');
});

test('success message: confirm mode, a missing flag or a non-boolean flag keeps the confirmation wording', () => {
  for (const body of [{ ok: true, direct: false }, { ok: true }, null, { ok: true, direct: 'true' }, { ok: true, direct: 1 }]) {
    assert.match(subscribeSuccessMessage(body), /confirmation email/, JSON.stringify(body));
  }
});

test('success message: no dashes and no contractions (writing rules)', () => {
  for (const body of [{ direct: true }, { direct: false }]) {
    const msg = subscribeSuccessMessage(body);
    assert.doesNotMatch(msg, /[–—]/);
    assert.doesNotMatch(msg, /\b\w+'(t|re|s|ll|ve|d)\b/i);
  }
});

test('box: the small print no longer promises a confirmation email', () => {
  const fine = COMPONENT.match(/<p class="dsub-fine">([\s\S]*?)<\/p>/);
  assert.ok(fine, 'the small print exists');
  assert.doesNotMatch(fine[1], /confirmation|not subscribed until/i);
  assert.match(fine[1], /Unsubscribe in one click from any issue\./);
});

test('box: the success message comes from the helper, not a hard-coded promise', () => {
  assert.match(COMPONENT, /import \{ subscribeSuccessMessage \} from '\.\.\/\.\.\/lib\/digest-subscribe-copy\.mjs';/);
  assert.match(COMPONENT, /say\(subscribeSuccessMessage\(body\), 'ok'\);/);
  assert.doesNotMatch(COMPONENT, /say\('Check your inbox\./);
});

test('box: a signed-in member gets a link to the digest switch INSTEAD of the form (sow-202, owner 2026-09-13)', () => {
  // The switch on /account/notifications/ acts on the account's own address, so the form would ask a member for an
  // email the account already has. Both halves are CSS on the member signal's class: no script, no Worker call.
  // Copy per owner, 2026-09-15: the sentence is just "You are signed in." and the link reads "Edit Notification Settings".
  assert.match(COMPONENT, /<p class="dsub-member" data-dsub-member>You are signed in\. <a href="\/account\/notifications\/">Edit Notification Settings<\/a><\/p>/);
  assert.match(COMPONENT, /\n  \.dsub-member \{ display: none;/);
  assert.match(COMPONENT, /\n  :global\(html\.is-gbti-member\) \.dsub-member \{ display: block; \}\n/);
  assert.match(COMPONENT, /\n  :global\(html\.is-gbti-member\) \.dsub-form \{ display: none; \}\n/);
  assert.doesNotMatch(COMPONENT, /dsub-mlink/, 'the old form-plus-link is gone');
  const member = COMPONENT.match(/<p class="dsub-member"[^>]*>([\s\S]*?)<\/p>/)[1];
  assert.doesNotMatch(member.replace(/<[^>]+>/g, ''), /[\u2013\u2014]|\b\w+'(t|re|s|ll|ve|d)\b/i, 'writing rules');
});

test('sow-388: the invitation\'s confirmation headline follows the same mode flag as the message', () => {
  assert.equal(inviteSuccessHeading({ ok: true, direct: true }), 'The next issue is Tuesday.');
  for (const body of [{ ok: true, direct: false }, { ok: true }, null, { ok: true, direct: 'true' }, { ok: true, direct: 1 }]) {
    assert.equal(inviteSuccessHeading(body), 'One more step.', JSON.stringify(body));
  }
  for (const body of [{ direct: true }, { direct: false }]) {
    assert.doesNotMatch(inviteSuccessHeading(body), /[\u2013\u2014]|\b\w+'(t|re|s|ll|ve|d)\b/i);
  }
});

test('sow-388: the small print carries an optional first sentence, and the default boxes are unchanged', () => {
  // A string expression, not a fragment: Astro strips the trailing space inside `<>{note} </>`, and the two
  // sentences ran together ("this form.Unsubscribe"), found by driving the built page.
  assert.match(COMPONENT, /\{note \? `\$\{note\} ` : ''\}Unsubscribe in one click from any issue\./);
});

test('the shared box line is the owner\'s wording (2026-09-23), within the writing rules', () => {
  assert.equal(SUBSCRIBE_BLURB, 'Never miss content by subscribing to our digest. Subscribing is completely free.');
  assert.doesNotMatch(SUBSCRIBE_BLURB, /[\u2013\u2014]|\b\w+'(t|re|s|ll|ve|d)\b/i);
});
