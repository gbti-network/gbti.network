// sow-324: auto-unsubscribe on email bounce. Tests the Resend (svix) webhook verifier, the event
// classifier, and the KV effect. No network. The signature oracle is node:crypto (an INDEPENDENT
// implementation) so a valid signature is not merely the code under test agreeing with itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
  verifyResendSignature,
  classifyBounce,
  handleResendBounceEvent,
  softBounceKey,
  SOFT_BOUNCE_THRESHOLD,
} from '../workers/signup/resend-webhook.mjs';
import { mailHash, suppressKey, subscriberKey, SUPPRESS_VALUE } from '../membership/mail-suppress.mjs';
import { buildSubscriber, normalizeSubscriber } from '../membership/mail-subscriber.mjs';

const MAIL_SECRET = 'mail-suppress-test-key';
const WEBHOOK_SECRET = `whsec_${Buffer.from('resend-webhook-test-secret').toString('base64')}`;
const at = (t) => () => t;

// A Map-backed fake KV matching the shape the mail modules use: get(key, type), put(key, value, opts), delete.
function makeKV() {
  const m = new Map();
  return {
    map: m,
    async get(key, type) {
      const e = m.get(key);
      if (e === undefined) return null;
      return type === 'json' ? JSON.parse(e.value) : e.value;
    },
    async put(key, value, opts) { m.set(key, { value: String(value), opts: opts || null }); },
    async delete(key) { m.delete(key); },
  };
}

// Sign like svix does: HMAC-SHA256 over `${id}.${ts}.${body}` keyed by the base64-DECODED secret, base64 digest.
function svixSig(secret, id, ts, body) {
  const b64 = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  const key = Buffer.from(b64, 'base64');
  return `v1,${createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64')}`;
}

// --- verifyResendSignature (the security-critical part) --------------------------------------------------

test('verifyResendSignature accepts a correctly signed body and returns the parsed event', async () => {
  const id = 'msg_1';
  const ts = String(Math.floor(1_700_000_000));
  const body = JSON.stringify({ type: 'email.bounced', data: { to: ['a@example.com'] } });
  const event = await verifyResendSignature({
    id, timestamp: ts, signatureHeader: svixSig(WEBHOOK_SECRET, id, ts, body),
    secret: WEBHOOK_SECRET, body, now: 1_700_000_000 * 1000,
  });
  assert.deepEqual(event, { type: 'email.bounced', data: { to: ['a@example.com'] } });
});

test('verifyResendSignature rejects a tampered body (signature no longer matches) -> null', async () => {
  const id = 'msg_2';
  const ts = String(1_700_000_000);
  const signed = JSON.stringify({ type: 'email.bounced', data: { to: ['a@example.com'] } });
  const header = svixSig(WEBHOOK_SECRET, id, ts, signed);
  const tampered = JSON.stringify({ type: 'email.bounced', data: { to: ['attacker@example.com'] } });
  const event = await verifyResendSignature({
    id, timestamp: ts, signatureHeader: header, secret: WEBHOOK_SECRET, body: tampered, now: 1_700_000_000 * 1000,
  });
  assert.equal(event, null);
});

test('verifyResendSignature rejects a stale timestamp (replay) -> null', async () => {
  const id = 'msg_3';
  const ts = String(1_700_000_000);
  const body = JSON.stringify({ type: 'email.complained', data: { to: ['a@example.com'] } });
  const event = await verifyResendSignature({
    id, timestamp: ts, signatureHeader: svixSig(WEBHOOK_SECRET, id, ts, body),
    secret: WEBHOOK_SECRET, body, now: (1_700_000_000 + 3600) * 1000, // one hour later
  });
  assert.equal(event, null);
});

test('verifyResendSignature fails closed on a missing secret or missing headers -> null', async () => {
  const id = 'msg_4';
  const ts = String(1_700_000_000);
  const body = JSON.stringify({ type: 'email.bounced', data: { to: ['a@example.com'] } });
  const header = svixSig(WEBHOOK_SECRET, id, ts, body);
  const now = 1_700_000_000 * 1000;
  assert.equal(await verifyResendSignature({ id, timestamp: ts, signatureHeader: header, secret: '', body, now }), null);
  assert.equal(await verifyResendSignature({ id: '', timestamp: ts, signatureHeader: header, secret: WEBHOOK_SECRET, body, now }), null);
  assert.equal(await verifyResendSignature({ id, timestamp: ts, signatureHeader: '', secret: WEBHOOK_SECRET, body, now }), null);
});

test('verifyResendSignature rejects a signature made with a different secret -> null', async () => {
  const id = 'msg_5';
  const ts = String(1_700_000_000);
  const body = JSON.stringify({ type: 'email.bounced', data: { to: ['a@example.com'] } });
  const wrong = svixSig(`whsec_${Buffer.from('some-other-secret').toString('base64')}`, id, ts, body);
  const event = await verifyResendSignature({
    id, timestamp: ts, signatureHeader: wrong, secret: WEBHOOK_SECRET, body, now: 1_700_000_000 * 1000,
  });
  assert.equal(event, null);
});

// --- classifyBounce -------------------------------------------------------------------------------------

test('classifyBounce: permanent bounce suppresses; transient and unclassified count; complaint suppresses', () => {
  assert.deepEqual(
    classifyBounce({ type: 'email.bounced', data: { to: ['x@e.com'], bounce: { type: 'Permanent' } } }),
    { action: 'suppress', reason: 'hard-bounce', emails: ['x@e.com'] },
  );
  assert.deepEqual(
    classifyBounce({ type: 'email.bounced', data: { to: ['x@e.com'], bounce: { type: 'Transient' } } }),
    { action: 'count', reason: 'soft-bounce', emails: ['x@e.com'] },
  );
  assert.deepEqual(
    classifyBounce({ type: 'email.bounced', data: { to: ['x@e.com'] } }), // no classification -> safe default
    { action: 'count', reason: 'soft-bounce', emails: ['x@e.com'] },
  );
  assert.deepEqual(
    classifyBounce({ type: 'email.complained', data: { to: ['x@e.com'] } }),
    { action: 'suppress', reason: 'complaint', emails: ['x@e.com'] },
  );
});

test('classifyBounce ignores unrelated events and events with no recipient', () => {
  assert.equal(classifyBounce({ type: 'email.delivered', data: { to: ['x@e.com'] } }).action, 'ignore');
  assert.equal(classifyBounce({ type: 'email.bounced', data: { to: [] } }).action, 'ignore');
  assert.equal(classifyBounce({ type: 'email.bounced', data: {} }).action, 'ignore');
});

// --- handleResendBounceEvent (the KV effect) ------------------------------------------------------------

test('a permanent bounce writes the suppression marker at the same key the digest uses', async () => {
  const kv = makeKV();
  const email = 'dead@example.com';
  const event = { type: 'email.bounced', data: { to: [email], bounce: { type: 'Permanent' } } };
  const r = await handleResendBounceEvent({ event, kv, secret: MAIL_SECRET, now: at(1000) });
  assert.deepEqual(r, { ok: true, action: 'suppress', reason: 'hard-bounce', suppressed: 1, counted: 0 });

  const hash = await mailHash(MAIL_SECRET, email);
  assert.equal(await kv.get(suppressKey(hash)), SUPPRESS_VALUE, 'the bare marker is written at suppressKey(mailHash(secret,email))');
});

test('a permanent bounce flips an existing active subscriber record to unsubscribed', async () => {
  const kv = makeKV();
  const email = 'member@example.com';
  const hash = await mailHash(MAIL_SECRET, email);
  await kv.put(subscriberKey(hash), JSON.stringify(buildSubscriber({ hash, source: 'member', githubId: '42' }, { now: at(1) })));

  await handleResendBounceEvent({
    event: { type: 'email.bounced', data: { to: [email], bounce: { type: 'Permanent' } } },
    kv, secret: MAIL_SECRET, now: at(2000),
  });

  const rec = normalizeSubscriber(await kv.get(subscriberKey(hash), 'json'));
  assert.equal(rec.status, 'unsubscribed');
  assert.equal(await kv.get(suppressKey(hash)), SUPPRESS_VALUE);
});

test('a complaint suppresses immediately', async () => {
  const kv = makeKV();
  const email = 'reporter@example.com';
  const r = await handleResendBounceEvent({
    event: { type: 'email.complained', data: { to: [email] } }, kv, secret: MAIL_SECRET, now: at(1),
  });
  assert.equal(r.suppressed, 1);
  const hash = await mailHash(MAIL_SECRET, email);
  assert.equal(await kv.get(suppressKey(hash)), SUPPRESS_VALUE);
});

test('one soft bounce does not suppress; it reaches the threshold that does', async () => {
  const kv = makeKV();
  const email = 'fullbox@example.com';
  const hash = await mailHash(MAIL_SECRET, email);
  const event = { type: 'email.bounced', data: { to: [email], bounce: { type: 'Transient' } } };

  // First bounces below the threshold: counted, no marker.
  for (let i = 1; i < SOFT_BOUNCE_THRESHOLD; i++) {
    const r = await handleResendBounceEvent({ event, kv, secret: MAIL_SECRET, now: at(i) });
    assert.deepEqual(r, { ok: true, action: 'count', reason: 'soft-bounce', suppressed: 0, counted: 1 });
    assert.equal(await kv.get(suppressKey(hash)), null, 'no marker below threshold');
    assert.equal((await kv.get(softBounceKey(hash), 'json')).n, i, 'counter increments');
  }

  // The threshold bounce suppresses and clears the counter.
  const last = await handleResendBounceEvent({ event, kv, secret: MAIL_SECRET, now: at(99) });
  assert.equal(last.suppressed, 1);
  assert.equal(await kv.get(suppressKey(hash)), SUPPRESS_VALUE, 'marker written at threshold');
  assert.equal(await kv.get(softBounceKey(hash)), null, 'counter cleared once it converts to a suppression');
});

test('the soft-bounce counter carries a TTL so unrelated failures never accumulate forever', async () => {
  const kv = makeKV();
  const email = 'occasional@example.com';
  const hash = await mailHash(MAIL_SECRET, email);
  await handleResendBounceEvent({
    event: { type: 'email.bounced', data: { to: [email], bounce: { type: 'Transient' } } },
    kv, secret: MAIL_SECRET, now: at(1),
  });
  const stored = kv.map.get(softBounceKey(hash));
  assert.ok(stored.opts && Number(stored.opts.expirationTtl) > 0, 'the counter is written with an expirationTtl');
});

test('a missing MAIL_SUPPRESS_KEY cannot hash, so nothing is written (fail safe, no crash)', async () => {
  const kv = makeKV();
  const r = await handleResendBounceEvent({
    event: { type: 'email.bounced', data: { to: ['x@e.com'], bounce: { type: 'Permanent' } } },
    kv, secret: '', now: at(1),
  });
  assert.equal(r.suppressed, 0);
  assert.equal(kv.map.size, 0, 'no marker and no counter written when the identity cannot be computed');
});

test('an ignored event writes nothing', async () => {
  const kv = makeKV();
  const r = await handleResendBounceEvent({
    event: { type: 'email.delivered', data: { to: ['ok@example.com'] } }, kv, secret: MAIL_SECRET, now: at(1),
  });
  assert.equal(r.action, 'ignore');
  assert.equal(kv.map.size, 0);
});
