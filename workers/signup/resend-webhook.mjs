// sow-324: auto-unsubscribe on email bounce. Resend POSTs delivery events (email.bounced,
// email.complained) to /resend/webhook; this module verifies the signature and turns a permanent bounce or a
// spam complaint into the SAME suppression marker a one-click unsubscribe writes, so the drain's existing
// send-time gate skips the address on every future send. A transient bounce (a full mailbox) is counted, not
// suppressed, and only suppresses after it repeats.
//
// Resend signs webhooks with the svix scheme, not Stripe's. The headers are svix-id, svix-timestamp and
// svix-signature; the secret is `whsec_<base64>`; the signed content is `${id}.${timestamp}.${body}`; the HMAC
// is SHA-256 over the base64-DECODED secret and the digest is compared in BASE64 (Stripe's is hex over the raw
// secret). So this mirrors workers/signup/webhook.mjs structurally but cannot share its hex helpers.
//
// MINIMIZATION: the suppression marker stays the bare SUPPRESS_VALUE (see membership/mail-suppress.mjs). The
// bounce reason is computed and logged to drive the action, but is NOT persisted, because the marker is
// deliberately a correlation-free boolean. Persisting a reason (for an admin view) is a separate, owner-gated
// change to that construction.

import { mailHash, suppressKey, subscriberKey, SUPPRESS_VALUE } from '../../membership/mail-suppress.mjs';
import { normalizeSubscriber, markUnsubscribed } from '../../membership/mail-subscriber.mjs';

const enc = new TextEncoder();

// A soft (transient) bounce suppresses only after this many failures for one address; one full mailbox never
// suppresses. The counter carries a TTL so a slow trickle of unrelated soft bounces never accumulates to the
// threshold across months.
export const SOFT_BOUNCE_THRESHOLD = 3;
const SOFT_BOUNCE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const MAIL_SOFTBOUNCE_PREFIX = 'mail:softbounce:';

export function softBounceKey(hash) {
  const h = String(hash ?? '').trim();
  if (!h) return null;
  return `${MAIL_SOFTBOUNCE_PREFIX}${h}`;
}

function b64ToBytes(b64) {
  const bin = atob(String(b64 ?? ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Constant-time compare of two equal-length strings. */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacSha256B64(keyBytes, message) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return bytesToB64(sig);
}

/**
 * Verify a Resend (svix) webhook signature over the RAW body. Returns the parsed event object on success, or
 * null on any failure (missing pieces, bad secret, stale timestamp, no matching signature, unparseable body).
 * Fail closed: null means "do not act on this request", exactly like verifyStripeSignature.
 *
 * @param {object} a
 * @param {string} a.id               the svix-id header.
 * @param {string} a.timestamp        the svix-timestamp header (unix seconds).
 * @param {string} a.signatureHeader  the svix-signature header (space-separated `v1,<base64sig>` entries).
 * @param {string} a.secret           RESEND_WEBHOOK_SECRET, the `whsec_<base64>` signing secret.
 * @param {string} a.body             the raw request body text (verify before JSON.parse).
 * @param {number} [a.toleranceSeconds] max age of the timestamp (default 300 = 5 minutes).
 * @param {number} [a.now]            epoch ms, for tests.
 */
export async function verifyResendSignature({ id, timestamp, signatureHeader, secret, body, toleranceSeconds = 300, now = Date.now() }) {
  if (!id || !timestamp || !signatureHeader || !secret || !body) return null;

  const tSec = Number(timestamp);
  if (!Number.isFinite(tSec)) return null;
  const ageSeconds = Math.floor(now / 1000) - tSec;
  if (Math.abs(ageSeconds) > toleranceSeconds) return null; // stale replay, or future-dated skew abuse

  let keyBytes;
  try {
    const raw = String(secret).startsWith('whsec_') ? String(secret).slice('whsec_'.length) : String(secret);
    keyBytes = b64ToBytes(raw);
  } catch {
    return null;
  }

  let expected;
  try {
    expected = await hmacSha256B64(keyBytes, `${id}.${timestamp}.${body}`);
  } catch {
    return null;
  }

  // svix-signature is a space-separated list of `v<version>,<base64sig>`; any v1 entry that matches passes.
  const matched = String(signatureHeader).split(' ').some((entry) => {
    const comma = entry.indexOf(',');
    if (comma < 0) return false;
    const scheme = entry.slice(0, comma);
    const sig = entry.slice(comma + 1);
    return scheme === 'v1' && timingSafeEqual(sig, expected);
  });
  if (!matched) return null;

  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

// The recipient list on a Resend delivery event. `to` is normally an array; tolerate a bare string.
function eventEmails(event) {
  const to = event?.data?.to;
  const list = Array.isArray(to) ? to : (to ? [to] : []);
  return list.map((e) => String(e ?? '').trim()).filter(Boolean);
}

/**
 * Decide what a verified Resend event means, as a pure function so the mapping to Resend's schema lives in ONE
 * place. Returns { action: 'suppress' | 'count' | 'ignore', reason, emails }.
 *
 * The exact bounce-classification field is confirmed against Resend's current webhook schema; today Resend
 * carries it as data.bounce.type ('Permanent' | 'Transient' | 'Undetermined'). We read that with fallbacks and
 * default an UNCLASSIFIED bounce to 'count' (the safe direction: an ambiguous bounce needs to repeat before it
 * suppresses, so a momentarily-failing live address is never removed on one event).
 */
export function classifyBounce(event) {
  const type = event?.type;
  const emails = eventEmails(event);
  if (!emails.length) return { action: 'ignore', reason: 'no-recipient', emails: [] };

  if (type === 'email.complained') {
    return { action: 'suppress', reason: 'complaint', emails };
  }

  if (type === 'email.bounced') {
    const raw = event?.data?.bounce?.type ?? event?.data?.bounceType ?? event?.data?.type ?? '';
    const cls = String(raw).trim().toLowerCase();
    if (cls === 'permanent') return { action: 'suppress', reason: 'hard-bounce', emails };
    // 'transient', 'undetermined', or anything unrecognized: count toward the threshold rather than suppress.
    return { action: 'count', reason: 'soft-bounce', emails };
  }

  return { action: 'ignore', reason: `unhandled:${type ?? 'none'}`, emails: [] };
}

// Write the (bare) suppression marker and best-effort flip the subscriber record to unsubscribed. The marker is
// the authoritative gate the drain checks; the record flip is cosmetic consistency and never blocks the marker.
async function suppressOne(kv, hash, now) {
  const key = suppressKey(hash);
  if (!key) return false;
  await kv.put(key, SUPPRESS_VALUE);
  try {
    const subKey = subscriberKey(hash);
    if (subKey) {
      const rec = normalizeSubscriber(await kv.get(subKey, 'json'));
      if (rec && rec.status === 'active') await kv.put(subKey, JSON.stringify(markUnsubscribed(rec, { now })));
    }
  } catch { /* best-effort: the marker already stops all sends and blocks re-enrollment */ }
  return true;
}

// Count one soft bounce; suppress once the address reaches the threshold. The counter is cleared when it
// converts to a suppression so a later re-subscribe starts clean.
async function countSoftBounce(kv, hash, now) {
  const key = softBounceKey(hash);
  if (!key) return { suppressed: false, count: 0 };
  let cur = 0;
  try { cur = Number((await kv.get(key, 'json'))?.n) || 0; } catch { cur = 0; }
  const n = cur + 1;
  if (n >= SOFT_BOUNCE_THRESHOLD) {
    await suppressOne(kv, hash, now);
    try { await kv.delete(key); } catch { /* the marker is written; a stale counter is harmless */ }
    return { suppressed: true, count: n };
  }
  await kv.put(key, JSON.stringify({ n }), { expirationTtl: SOFT_BOUNCE_TTL_SECONDS });
  return { suppressed: false, count: n };
}

/**
 * Apply a VERIFIED Resend event. Pure over injected kv so it is fixture-testable. `secret` is MAIL_SUPPRESS_KEY,
 * the HMAC that turns a plaintext bounced address into the same hash the digest keys everything by, so the
 * suppression marker reproduces exactly what a subscribe/unsubscribe would write. Returns a summary for logging.
 */
export async function handleResendBounceEvent({ event, kv, secret, now = Date.now }) {
  const { action, reason, emails } = classifyBounce(event);
  if (action === 'ignore' || !emails.length) return { ok: true, action: 'ignore', reason, suppressed: 0, counted: 0 };

  let suppressed = 0;
  let counted = 0;
  for (const email of emails) {
    const hash = await mailHash(secret, email);
    if (!hash) { console.error(`resend webhook: cannot hash a bounced address (MAIL_SUPPRESS_KEY set? reason=${reason})`); continue; }
    if (action === 'suppress') {
      if (await suppressOne(kv, hash, now)) suppressed += 1;
    } else if (action === 'count') {
      const r = await countSoftBounce(kv, hash, now);
      if (r.suppressed) suppressed += 1; else counted += 1;
    }
  }
  return { ok: true, action, reason, suppressed, counted };
}
