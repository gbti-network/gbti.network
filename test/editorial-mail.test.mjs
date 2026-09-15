// sow-323 Phase 3: the two emails the review queue sends, and the one it deliberately does not.
//
// Both are FAIL-SOFT, and both fire after the thing they describe has already happened. So what is asserted
// here is not that they always arrive: it is that a failure is swallowed, logged, and never undoes the record
// or the publication behind it. The assertions read WHAT REACHES THE SENDER rather than what the builder
// returned, because the builder lives in another file and a correct-looking notice proves nothing about
// whether anything actually left.
import test from 'node:test';
import assert from 'node:assert/strict';
import { editorialQueueNotice, editorialApprovedNotice } from '../membership/editorial-notify.mjs';
import { sendEditorialQueueAlert, sendEditorialApprovedEmail } from '../workers/signup/editorial-alert.mjs';
import { newEntry, decideEntry } from '../membership/editorial-queue.mjs';

const NOW = new Date('2026-09-15T12:00:00.000Z');
const ENV = { MAIL_FROM: 'notices@gbti.network', RESEND_API_KEY: 'x', COUPON_ALERT_EMAIL: 'owner@example.com' };
const pending = (slug = 'hello', title = 'Hello') => newEntry({
  path: `members/ada/posts/${slug}/index.md`, type: 'post', slug, login: 'ada', githubId: '1', title, now: NOW,
});

test('the owner notice names the item, its author and its address', () => {
  const { subject, text, html } = editorialQueueNotice([pending()]);
  assert.match(subject, /Hello/);
  assert.match(subject, /ada/);
  assert.match(text, /https:\/\/gbti\.network\/articles\/hello\//, 'the owner must be able to go and read it');
  assert.match(text, /members\/ada\/posts\/hello\/index\.md/);
  assert.match(html, /Hello/);
  assert.match(text, /not public, not indexed/, 'it must say what state the item is in while it waits');
});

test('a publish carrying several items sends ONE notice, counted', () => {
  const { subject, text } = editorialQueueNotice([pending('a', 'A'), pending('b', 'B')]);
  assert.match(subject, /2 items/, 'one email per publish, not one per file');
  assert.match(text, /A/);
  assert.match(text, /B/);
});

test('a member-written title is escaped before it reaches an HTML email', () => {
  const { html } = editorialQueueNotice([pending('x', '<script>alert(1)</script>')]);
  assert.ok(!html.includes('<script>'), 'a title is text a member wrote, and this is an HTML email');
  assert.match(html, /&lt;script&gt;/);
});

test('the author notice says it is approved, where to find it, and that nothing more is needed', () => {
  const approved = decideEntry(pending(), { decision: 'approve', githubId: '9', now: NOW });
  const { subject, text } = editorialApprovedNotice(approved);
  assert.match(subject, /Approved/);
  assert.match(subject, /Hello/);
  assert.match(text, /https:\/\/gbti\.network\/articles\/hello\//);
  assert.match(text, /within a few minutes/, 'the deploy is not instant and the author should not refresh in confusion');
  assert.match(text, /keeps its original date/, "approval does not restamp the author's publication date");
});

test('the owner notice goes out on what was stored, and a send failure is swallowed', async () => {
  const sent = [];
  const ok = await sendEditorialQueueAlert(ENV, [pending()], { sendEmail: async (m) => { sent.push(m); } });
  assert.equal(ok.sent, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'owner@example.com');
  assert.equal(sent[0].from, 'notices@gbti.network');
  assert.ok(sent[0].text && sent[0].html, 'both bodies must reach the sender, or the html half is never exercised');

  const failed = await sendEditorialQueueAlert(ENV, [pending()], { sendEmail: async () => { throw new Error('Resend down'); } });
  assert.equal(failed.sent, false);
  assert.equal(failed.reason, 'error', 'the record is already stored: a failed notice must never throw into the publish');
});

test('nothing is sent when there is nothing waiting, or when mail is not provisioned', async () => {
  let calls = 0;
  const send = async () => { calls += 1; };
  assert.equal((await sendEditorialQueueAlert(ENV, [], { sendEmail: send })).reason, 'nothing_pending');
  assert.equal((await sendEditorialQueueAlert({}, [pending()], { sendEmail: send })).reason, 'unconfigured');
  assert.equal(calls, 0);
});

test('the author address comes from their Stripe customer, and a missing one is not a failure', async () => {
  const approved = decideEntry(pending(), { decision: 'approve', githubId: '9', now: NOW });
  const sent = [];
  const ok = await sendEditorialApprovedEmail(ENV, approved, {
    sendEmail: async (m) => { sent.push(m); },
    fetchMemberEmail: async (id) => { assert.equal(id, '1', 'the AUTHOR is written to, not the superadmin who approved'); return 'ada@example.com'; },
  });
  assert.equal(ok.sent, true);
  assert.equal(sent[0].to, 'ada@example.com');

  const none = await sendEditorialApprovedEmail(ENV, approved, {
    sendEmail: async () => { throw new Error('should not send'); },
    fetchMemberEmail: async () => null,
  });
  assert.equal(none.sent, false);
  assert.equal(none.reason, 'no_address', 'the item is public either way; the author simply was not told');

  // An approval with no author (a superadmin's own item, which never entered the queue) writes to nobody.
  const ownerless = await sendEditorialApprovedEmail(ENV, { ...approved, githubId: null }, {
    sendEmail: async () => { throw new Error('should not send'); },
    fetchMemberEmail: async () => { throw new Error('should not look'); },
  });
  assert.equal(ownerless.reason, 'no_address');
});

test('there is no dismissal email anywhere', async () => {
  // The owner ruled on 2026-09-15 that a superadmin can set an item aside silently: it stays members-only,
  // which is where every member item starts, so there is no bad news to deliver. A future notice would have
  // to be a deliberate decision, not something that appears because a function was named symmetrically.
  const { readFileSync } = await import('node:fs');
  const alert = readFileSync(new URL('../workers/signup/editorial-alert.mjs', import.meta.url), 'utf8');
  const notify = readFileSync(new URL('../membership/editorial-notify.mjs', import.meta.url), 'utf8');
  assert.ok(!/export (async )?function \w*Dismiss/i.test(alert + notify), 'a dismissal must send nothing');
});
