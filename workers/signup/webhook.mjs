// OPTIONAL Stripe webhook (membership-and-access.md section 3, "small, real-time Discord only").
// Deferred but built: the batch reconcile is the source of truth, so this is a fast path for instant
// Discord role changes, not a requirement. It verifies the Stripe signature manually (Web Crypto,
// no SDK), dedupes by event id, and is idempotent. It NEVER trusts the payload before the signature
// verifies.
//
// Stripe signs the webhook with a header of the form:  t=<unix>,v1=<hexHmac>[,v0=...]
// The signed payload is `${t}.${rawBody}`; the HMAC is SHA-256 keyed by STRIPE_WEBHOOK_SECRET, hex.
// We reject stale timestamps (replay defense) and compare in constant time.
//
// Event handling:
//   invoice.payment_succeeded (first)     -> Discord: remove Trial role, add Member role
//   customer.subscription.deleted          -> Discord: remove Member role; signal SOW-005 to disable content
//   invoice.payment_failed                 -> no-op (grace handled by deriveStatus past_due window)

const enc = new TextEncoder();

/** Constant-time compare of two equal-length hex strings. */
function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bytesToHex(buf) {
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/** Parse the Stripe-Signature header into { t, v1: [..] }. Returns null if malformed. */
export function parseStripeSignatureHeader(header) {
  if (typeof header !== 'string') return null;
  let t = null;
  const v1 = [];
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === 't') t = v;
    else if (k === 'v1') v1.push(v);
  }
  if (t === null || v1.length === 0) return null;
  return { t, v1 };
}

async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return bytesToHex(sig);
}

/**
 * Verify a Stripe webhook signature over the RAW request body. Returns the parsed event object on
 * success, or null on any failure (bad signature, stale timestamp, malformed header or body). Fail
 * closed: a null result means "do not act on this request".
 *
 * @param {object} a
 * @param {string} a.payload       the raw request body text (verify before JSON.parse).
 * @param {string} a.signature     the Stripe-Signature header value.
 * @param {string} a.secret        STRIPE_WEBHOOK_SECRET.
 * @param {number} [a.toleranceSeconds]  max age of t (default 300 = 5 minutes).
 * @param {number} [a.now]         epoch ms, for tests.
 */
export async function verifyStripeSignature({ payload, signature, secret, toleranceSeconds = 300, now = Date.now() }) {
  if (!payload || !secret) return null;
  const parsed = parseStripeSignatureHeader(signature);
  if (!parsed) return null;

  const tSec = Number(parsed.t);
  if (!Number.isFinite(tSec)) return null;
  const ageSeconds = Math.floor(now / 1000) - tSec;
  // Reject stale (replay) and also future-dated beyond tolerance (clock skew abuse).
  if (Math.abs(ageSeconds) > toleranceSeconds) return null;

  const expected = await hmacSha256Hex(secret, `${parsed.t}.${payload}`);
  const matched = parsed.v1.some((candidate) => timingSafeEqualHex(candidate, expected));
  if (!matched) return null;

  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

/**
 * Check whether an event id was already processed, WITHOUT marking it. Returns true if this id has
 * already been recorded as seen. On any KV error returns false (process the event) because
 * double-processing is safe given the idempotent handlers below.
 *
 * Important: this is a read-only check. The seen-mark is persisted separately by markEventSeen, and
 * ONLY after the handler succeeds. Marking before the handler runs would let a transient handler
 * failure look like a duplicate on Stripe's retry, silently dropping the role change. See FIX 2.
 */
export async function isDuplicateEvent({ kv, eventId }) {
  if (!kv || !eventId) return false;
  try {
    const seen = await kv.get(`evt:${eventId}`);
    return Boolean(seen);
  } catch {
    return false;
  }
}

/**
 * Persist the seen-mark for an event id with a TTL. Call this ONLY after handleStripeEvent has
 * succeeded, so a retried delivery is treated as a duplicate only once its side effects are durable.
 * Returns true if the mark was written, false on any KV error (the caller still returns success, and
 * a re-delivery just re-runs the idempotent handler).
 */
export async function markEventSeen({ kv, eventId, ttlSeconds = 60 * 60 * 24 }) {
  if (!kv || !eventId) return false;
  try {
    await kv.put(`evt:${eventId}`, '1', { expirationTtl: ttlSeconds });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the github_id for an event from its customer object via the github_id -> customer_id KV
 * index reverse lookup is not stored, so we read the Stripe Customer by id and pull metadata.
 * Returns { discordUserId, githubId } or null. Fail closed: null means we cannot act on Discord.
 */
async function resolveDiscordTarget({ customerId, stripe }) {
  if (!customerId) return null;
  let customer;
  try {
    customer = await stripe.getCustomer(customerId);
  } catch {
    return null;
  }
  const discordUserId = customer?.metadata?.discord_user_id;
  const githubId = customer?.metadata?.github_id;
  if (!discordUserId) return null;
  // Return the full customer too (SOW-059 P1c needs its touch_session / referred_by metadata to freeze the snapshot).
  return { discordUserId: String(discordUserId), githubId: githubId ? String(githubId) : null, customer };
}

/**
 * Handle a VERIFIED Stripe event. Pure routing over injected collaborators so it is fixture-testable.
 * Returns an action summary string for logging. Idempotent: re-handling the same event reaches the
 * same end state (add/remove role calls are naturally idempotent on Discord's side).
 *
 * @param {object} a
 * @param {object} a.event     the verified event object.
 * @param {object} a.stripe    frozen Stripe client (getCustomer).
 * @param {object} a.discord   frozen Discord client (addRole, removeRole).
 * @param {object} a.config    { guildId, trialRoleId, memberRoleId }.
 * @param {function} [a.signalDisable]  optional callback for subscription.deleted (SOW-005 signal).
 */
export async function handleStripeEvent({ event, stripe, discord, config, signalDisable, onConversion }) {
  const type = event?.type;
  const obj = event?.data?.object ?? {};
  const customerId = typeof obj.customer === 'string' ? obj.customer : obj.customer?.id;

  if (type === 'invoice.payment_succeeded') {
    // FIX 3: only the FIRST invoice (the conversion) upgrades Trial -> Member. Annual renewals also
    // fire invoice.payment_succeeded, and they carry billing_reason "subscription_cycle". Swapping
    // roles on every renewal is wasted churn (the member already holds the Member role), so gate the
    // swap on the first invoice. Stripe stamps the first invoice with billing_reason
    // "subscription_create".
    if (obj.billing_reason !== 'subscription_create') {
      return `payment_succeeded: renewal (billing_reason=${obj.billing_reason ?? 'unknown'}), no role change`;
    }
    // SOW: Discord is deferred, so the common case is a Customer with a github_id but NO discord_user_id at
    // conversion. DECOUPLE the two effects: the SOW-059 conversion freeze needs only github_id + touch_session
    // (never Discord) and MUST run for every first-invoice conversion; the Trial->Member role swap needs Discord.
    let customer = null;
    try { customer = customerId ? await stripe.getCustomer(customerId) : null; } catch { customer = null; }
    const githubId = customer?.metadata?.github_id ? String(customer.metadata.github_id) : null;
    const discordUserId = customer?.metadata?.discord_user_id ? String(customer.metadata.discord_user_id) : null;

    // SOW-059 P1c: freeze + persist the attribution snapshot at this paid conversion. FAIL-SOFT (a freeze failure
    // must never block the role swap or fail the webhook -> Stripe retry); flag-gated + idempotent (absent-only).
    // Runs for ANY first-invoice conversion with a github_id, with or WITHOUT a linked Discord. Use the invoice
    // paid timestamp as the conversion instant (NOT now), so the 90-day attribution window is exact.
    if (typeof onConversion === 'function' && githubId) {
      const paidAtSec = obj.status_transitions?.paid_at ?? obj.created ?? event?.created;
      const conversionAt = Number.isFinite(paidAtSec) ? paidAtSec * 1000 : undefined;
      try { await onConversion({ githubId, customer, conversionAt }); }
      catch { /* freeze is best-effort; the role swap + webhook success must not depend on it */ }
    }

    // Trial -> Member role swap: ONLY when Discord is linked. A GitHub-only member gets the swap once they link
    // Discord (or via reconcile), so a missing discord_user_id is SKIPPED, not an error.
    if (discordUserId) {
      await discord.addRole(config.guildId, discordUserId, config.memberRoleId);
      await discord.removeRole(config.guildId, discordUserId, config.trialRoleId);
      return `payment_succeeded: upgraded ${discordUserId} to member${githubId ? ' (snapshot frozen)' : ''}`;
    }
    return `payment_succeeded: conversion frozen${githubId ? '' : ' (no github_id)'}, no Discord linked yet`;
  }

  if (type === 'customer.subscription.deleted') {
    const target = await resolveDiscordTarget({ customerId, stripe });
    if (target) {
      await discord.removeRole(config.guildId, target.discordUserId, config.memberRoleId);
    }
    // Signal SOW-005 to disable content (flip status to draft via a reconcile dispatch). Fail soft.
    if (typeof signalDisable === 'function' && target?.githubId) {
      try {
        await signalDisable(target.githubId);
      } catch {
        // the daily reconcile heals a missed signal
      }
    }
    return `subscription.deleted: downgraded ${target?.discordUserId ?? 'unknown'}, signalled disable`;
  }

  if (type === 'invoice.payment_failed') {
    return 'payment_failed: no-op (grace handled by deriveStatus past_due window)';
  }

  return `ignored event: ${type}`;
}
