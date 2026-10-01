// sow-427 C3: the owner notice when a prepared listing is claimed (workers/signup/listing-claimed-alert.mjs).
// Fail-soft by contract, sent to the owner alert address (amendment 15), both bodies reach the sender, and a failure
// is said out loud WITHOUT printing anything about the listing (amendment 14).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sendListingClaimedAlert } from '../workers/signup/listing-claimed-alert.mjs';
import { listingClaimedRecord } from '../membership/prepared-notify.mjs';

const RECORD = listingClaimedRecord({
  id: '23456789ABCDEFGH', slug: 'surfacedby', title: 'SurfacedBy', recipientName: 'Sam', preparedByLogin: 'atwellpub',
  claimedLogin: 'Sam-Dev', claimedFolder: 'sam', claimedAt: '2026-10-01T12:00:00.000Z', prNumber: 77, boundGithubId: '5551234',
  code: 'CODEABLE7K3M9Q2RXT', message: 'We built this page for you.',
});
const ENV = { ADMIN_ALERT_EMAIL: 'owner@example.test', COUPON_ALERT_EMAIL: 'coupons@example.test', MAIL_FROM: 'GBTI <ops@example.test>' };

test('the notice goes to ADMIN_ALERT_EMAIL with BOTH bodies, and never carries the code or the message', async () => {
  const sent = [];
  const r = await sendListingClaimedAlert(ENV, RECORD, { sendEmail: async (m) => { sent.push(m); } });
  assert.deepEqual(r, { sent: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'owner@example.test');
  assert.equal(sent[0].from, 'GBTI <ops@example.test>');
  assert.match(sent[0].subject, /SurfacedBy/);
  assert.ok(sent[0].text.length > 50 && sent[0].html.length > 50, 'text AND html reach the sender');
  assert.match(sent[0].text, /atwellpub/, 'it names the superadmin who prepared it');
  for (const part of [sent[0].subject, sent[0].text, sent[0].html]) {
    assert.doesNotMatch(part, /CODEABLE7K3M9Q2RXT|We built this page|5551234/);
  }
});

test('falls back to COUPON_ALERT_EMAIL; unprovisioned or empty is a quiet no-op', async () => {
  const sent = [];
  await sendListingClaimedAlert({ ...ENV, ADMIN_ALERT_EMAIL: '' }, RECORD, { sendEmail: async (m) => { sent.push(m); } });
  assert.equal(sent[0].to, 'coupons@example.test');
  assert.deepEqual(await sendListingClaimedAlert({ MAIL_FROM: 'x@example.test' }, RECORD, { sendEmail: async () => {} }), { sent: false, reason: 'unconfigured' });
  assert.deepEqual(await sendListingClaimedAlert({ ADMIN_ALERT_EMAIL: 'o@example.test', MAIL_FROM: 'x@example.test' }, RECORD), { sent: false, reason: 'unconfigured' });
  assert.deepEqual(await sendListingClaimedAlert(ENV, null, { sendEmail: async () => { throw new Error('never'); } }), { sent: false, reason: 'nothing_to_send' });
});

test('a failing sender never throws, and the one warning names nothing about the listing', async () => {
  const warned = [];
  const real = console.warn;
  console.warn = (...a) => warned.push(a.join(' '));
  let r;
  try {
    r = await sendListingClaimedAlert(ENV, RECORD, { sendEmail: async () => { throw new Error('rejected: Prepared listing claimed: SurfacedBy by Sam-Dev'); } });
  } finally {
    console.warn = real;
  }
  assert.deepEqual(r, { sent: false, reason: 'error' });
  assert.equal(warned.length, 1, 'swallowing is not saying nothing');
  assert.doesNotMatch(warned[0], /SurfacedBy|Sam|CODEABLE|surfacedby|5551234|rejected/, 'not even the provider error text');
});
