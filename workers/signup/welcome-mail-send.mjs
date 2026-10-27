// sow-478: send ONE new member their welcome email, and keep the record that stops a second one.
//
// FAIL-SOFT BY CONTRACT, a sibling of listing-claimed-alert.mjs and built the same way: it runs after a sign-in
// has completed or a claim's pull request has MERGED, so a welcome that fails (or is unprovisioned) must never
// undo either, throw, or delay a response. Every caller fires it through ctx.waitUntil.
//
// TWO KEYS, and they do different jobs.
//
//   welcome-owed:<github_id>   THE ENTITLEMENT. Written at a genuinely new sign-in (`signup.created === true`)
//                              and at nothing else, so only a NEW member is ever welcomed. Deleted the moment
//                              one goes out. It is also the retry queue: the five-minute sweep finds anything
//                              still owed after an hour and sends the plain version, or the receipt version
//                              when the record carries an item (carriedFields; the 2026-10-27 backsend).
//   welcome-mail:<github_id>   THE RECORD, permanent. `sent` means never again, whatever else happens.
//
// WHY NOT ONE KEY. A prefix scan of `welcome-mail:` is not the "small key set" the sweep needs: it grows by one
// key per member for ever and the sweep runs every five minutes. `welcome-owed:` holds only the handful of
// invitation claimers between their sign-in and their merge, so the common tick lists nothing. This is the same
// shape as the digest's unwelcomed-subscriber sweep (compileWelcomeIssue), which short-circuits on one list.
//
// WHY `sending` EXISTS. The stamp is written as `sending` BEFORE the send and flipped to `sent` after. Two
// triggers firing in the same second then see each other, and a Worker that dies mid-send leaves a stamp that
// stops suppressing after SENDING_STALE_MS, so the owed key still gets its retry. Writing `sent` first would
// have made a failed send permanent, which is the exact hole this whole SOW exists to close.
//
// NEITHER KEY STORES THE ADDRESS. Every sender resolves it from the identity that triggered it, or from the
// member's Stripe customer, as the rest of the mail path does.
//
// WHAT IS NEVER LOGGED: the address, the name, the item title, the invitation code. The one warning here is a
// fixed sentence with nothing interpolated into it, for the reason listing-claimed-alert.mjs records.

import { createResendClient } from '../../clients/resend.mjs';
import { createStripeClient } from '../../clients/stripe.mjs';
import { welcomeMail, ITEM_ROUTES } from '../../membership/welcome-mail.mjs';
import { readCouponGrant } from './coupons.mjs';
import { resolveSiteUrl } from '../../membership/mail-click.mjs';

export const WELCOME_OWED_PREFIX = 'welcome-owed:';
export const welcomeOwedKey = (githubId) => `${WELCOME_OWED_PREFIX}${githubId}`;
export const welcomeStampKey = (githubId) => `welcome-mail:${githubId}`;

/** How long an owed welcome waits for its claim to merge before the sweep sends the plain version. */
export const OWED_GRACE_MS = 60 * 60 * 1000;
/** How long a `sending` stamp suppresses a second attempt. Past this it is treated as a crashed send. */
export const SENDING_STALE_MS = 10 * 60 * 1000;
/** The owed key outlives nothing: a welcome nobody could send in a week is not sent at all. */
const OWED_TTL_SECONDS = 7 * 24 * 3600;
/** The most owed welcomes one sweep tick will send, so a backlog drains over ticks instead of in one. */
const SWEEP_MAX_PER_TICK = 10;

/** A github id as the stores key them: digits, bounded. Anything else is refused rather than coerced. */
const isGithubId = (v) => /^[0-9]{1,20}$/.test(String(v ?? ''));

const boundedString = (v, max) => (typeof v === 'string' && v.trim().length <= max ? v.trim() : '');

/**
 * What an owed record may carry into the send: the greeting name, the status and the claimed item. Used when the
 * record is written and again when the sweep reads it, so a hand-written or older record is held to the same
 * shape. An item that does not fit is DROPPED, never repaired: the plain welcome is the safe direction, and the
 * builder's own guards (the slug check, the cover url pattern, escaping) still run on whatever passes here.
 *
 * Only the 2026-10-27 backsend writes a carry today (the seven invitation claimers who joined before the welcome
 * email existed). A new sign-in writes none, and the claim leg sends its receipt directly.
 */
export function carriedFields(carry) {
  const out = {};
  if (!carry || typeof carry !== 'object') return out;
  const name = boundedString(carry.name, 80);
  if (name) out.name = name;
  const status = boundedString(carry.status, 20);
  if (/^[a-z_]+$/.test(status)) out.status = status;
  const it = carry.item;
  if (it && typeof it === 'object' && Object.hasOwn(ITEM_ROUTES, it.type)) {
    const item = {
      type: it.type,
      title: boundedString(it.title, 200),
      slug: boundedString(it.slug, 120),
      folder: boundedString(it.folder, 80),
      image: boundedString(it.image, 300),
      creditTo: boundedString(it.creditTo, 40),
    };
    if (item.title && item.slug) out.item = item;
  }
  return out;
}

/**
 * Record that this member is OWED a welcome. Called at a genuinely new sign-in and nowhere else.
 *
 * @param viaClaim true when the sign-in came from a prepared-listing claim page, so the send waits for the merge
 *                 and the email can carry the receipt. Informational on the record; the sweep ignores it.
 * @param carry    optional `{ name, status, item }` the sweep passes to the send (see carriedFields). The sign-in
 *                 leg writes none.
 * @returns true when the key was written. Never throws: a lost key costs a welcome, never a signup.
 */
export async function markWelcomeOwed(kv, githubId, { viaClaim = false, now = new Date(), carry = null } = {}) {
  if (!kv || !isGithubId(githubId)) return false;
  try {
    const stamp = await readWelcomeStamp(kv, githubId);
    if (stamp?.state === 'sent') return false; // already welcomed, once, ever
    const extra = carriedFields(carry);
    const rec = { at: now.toISOString(), viaClaim: viaClaim === true, ...(Object.keys(extra).length ? { carry: extra } : {}) };
    await kv.put(welcomeOwedKey(githubId), JSON.stringify(rec), {
      expirationTtl: OWED_TTL_SECONDS,
    });
    return true;
  } catch {
    return false;
  }
}

/** The permanent record, or null when there is none or it could not be read. */
export async function readWelcomeStamp(kv, githubId) {
  if (!kv || !isGithubId(githubId)) return null;
  try {
    const rec = await kv.get(welcomeStampKey(githubId), 'json');
    return rec && typeof rec === 'object' ? rec : null;
  } catch {
    return null;
  }
}

/** The entitlement record, or null. */
async function readOwed(kv, githubId) {
  if (!kv || !isGithubId(githubId)) return null;
  try {
    const rec = await kv.get(welcomeOwedKey(githubId), 'json');
    return rec && typeof rec === 'object' ? rec : null;
  } catch {
    return null;
  }
}

/**
 * Does the permanent record stop this send? `sent` always does; `sending` does for SENDING_STALE_MS, which is
 * the concurrent-trigger window and not a permanent state.
 */
function suppressedBy(stamp, nowMs) {
  if (stamp?.state === 'sent') return 'already';
  if (stamp?.state === 'sending') {
    const at = Date.parse(String(stamp.at ?? ''));
    if (Number.isFinite(at) && nowMs - at < SENDING_STALE_MS) return 'in_flight';
  }
  return null;
}

/**
 * Send one welcome email.
 *
 * @param env       MAIL_FROM/RESEND_FROM, RESEND_API_KEY, SIGNUP_KV, STRIPE_SECRET_KEY, SITE_URL
 * @param record    `{ githubId, email?, name?, status?, item? }`.
 *                  `email` is the address the trigger already holds (the sign-in leg has one from GitHub);
 *                  without it the member's Stripe customer is read. `status` is resolved from the coupon grant
 *                  when the caller does not state it. `item` is a claimed listing, or null for a plain sign-in.
 * @param deps      injectable seams for the tests: `{ kv, sendEmail, stripe, now }`.
 * @returns `{ sent, reason? }`. Never throws.
 */
export async function sendWelcomeMail(env, record, deps = {}) {
  const kv = deps.kv ?? env?.SIGNUP_KV;
  const now = deps.now instanceof Date ? deps.now : new Date();
  try {
    const githubId = String(record?.githubId ?? '');
    if (!isGithubId(githubId)) return { sent: false, reason: 'nothing_to_send' };
    if (!kv) return { sent: false, reason: 'unconfigured' };

    // THE ENTITLEMENT FIRST. Only an account that signed in NEW is owed a welcome, so a returning member who
    // claims a second listing, or any other path that reaches here, sends nothing.
    const owed = await readOwed(kv, githubId);
    if (!owed) return { sent: false, reason: 'not_owed' };
    const stop = suppressedBy(await readWelcomeStamp(kv, githubId), now.getTime());
    if (stop) return { sent: false, reason: stop };

    const from = String(env?.MAIL_FROM || env?.RESEND_FROM || '').trim();
    const apiKey = String(env?.RESEND_API_KEY || '').trim();
    if (!from) return { sent: false, reason: 'unconfigured' };
    const send = deps.sendEmail || (apiKey ? createResendClient({ apiKey }).sendEmail : null);
    if (!send) return { sent: false, reason: 'unconfigured' };

    const to = String(record?.email || '').trim() || await billingAddress(env, githubId, deps);
    if (!to) return { sent: false, reason: 'no_address' };

    // The status decides which steps the email lists, through the same two gates the wizard uses. A new account
    // is `none` unless it holds a live coupon grant, which is what an invitation IS: one KV read, and the same
    // fast-path /membership/status reports, rather than a second copy of the effective-status rules here.
    const status = String(record?.status || '').trim()
      || ((await readCouponGrant(kv, githubId, now)) ? 'paid' : 'none');

    await writeStamp(kv, githubId, { state: 'sending', at: now.toISOString(), viaClaim: owed.viaClaim === true });
    const { subject, text, html } = welcomeMail({
      name: record?.name ?? '',
      status,
      item: record?.item ?? null,
      siteBase: resolveSiteUrl(env),
      upstream: String(env?.GITHUB_CONTENT_REPO || 'gbti-network/gbti.network'),
      postalAddress: String(env?.MAIL_POSTAL_ADDRESS || ''),
    });
    // BOTH bodies go to the sender, for the reason coupon-alert.mjs records: the builder lives in another file,
    // so a correct-looking email says nothing about whether the html actually left. The tests assert on `send`.
    await send({ from, to, subject, text, html });

    await writeStamp(kv, githubId, { state: 'sent', at: now.toISOString(), viaClaim: owed.viaClaim === true });
    try { await kv.delete(welcomeOwedKey(githubId)); } catch { /* the stamp already stops a second send */ }
    return { sent: true };
  } catch {
    // Swallow: the signup or the claim is already complete, so a lost welcome costs the member their nudge into
    // onboarding and never their account or their published work. The owed key survives, so the sweep retries.
    console.warn('welcome-mail: a new member\'s welcome FAILED to send. Their account is fine and the sweep will retry, but nobody was emailed yet.');
    return { sent: false, reason: 'error' };
  }
}

async function writeStamp(kv, githubId, value) {
  try { await kv.put(welcomeStampKey(githubId), JSON.stringify(value)); } catch { /* best effort */ }
}

/** The member's billing address from their Stripe customer, or '' when it cannot be read. */
async function billingAddress(env, githubId, deps = {}) {
  try {
    const stripe = deps.stripe ?? (env?.STRIPE_SECRET_KEY ? createStripeClient({ apiKey: env.STRIPE_SECRET_KEY }) : null);
    if (!stripe) return '';
    const customer = await stripe.searchCustomerByGithubId(githubId);
    return String(customer?.email || '').trim();
  } catch {
    return '';
  }
}

/**
 * THE SAFETY NET. Send the plain welcome to anyone still owed one after OWED_GRACE_MS.
 *
 * It is not optional. The claim finalize step that would otherwise send the receipt version is CURRENTLY
 * FAILING: on the first real prompt claim (2026-10-25, pull request #868 merged) the listing and invite records
 * are still pristine, so finalize never recorded the claim and never produced a notice. Without this sweep,
 * exactly the people who accept an invitation would get no welcome at all.
 *
 * Bounded: one prefix list of a set that is almost always empty, then at most SWEEP_MAX_PER_TICK sends.
 *
 * @returns `{ ran: true, owed, due, sent, errors }` or `{ ran: true, unavailable: true }`. Never throws.
 */
export async function sweepOwedWelcomes(env, deps = {}) {
  const kv = deps.kv ?? env?.SIGNUP_KV;
  const now = deps.now instanceof Date ? deps.now : new Date();
  const send = deps.send ?? sendWelcomeMail;
  const max = Number.isInteger(deps.max) && deps.max > 0 ? deps.max : SWEEP_MAX_PER_TICK;
  if (!kv) return { ran: true, unavailable: true };

  let listing;
  try { listing = await kv.list({ prefix: WELCOME_OWED_PREFIX, limit: 200 }); } catch { listing = null; }
  const keys = Array.isArray(listing?.keys) ? listing.keys : null;
  if (!keys) return { ran: true, unavailable: true };
  const out = { ran: true, owed: keys.length, due: 0, sent: 0, errors: 0 };
  if (!keys.length) return out;

  for (const k of keys) {
    if (out.due >= max) break;
    const githubId = String(k?.name ?? '').slice(WELCOME_OWED_PREFIX.length);
    if (!isGithubId(githubId)) continue;
    const rec = await readOwed(kv, githubId);
    const at = Date.parse(String(rec?.at ?? ''));
    // An unreadable or undated record is left alone rather than sent immediately: it is the one case where
    // "send now" and "this was written seconds ago" are indistinguishable, and a premature plain welcome would
    // take the receipt away from somebody whose claim is still merging.
    if (!Number.isFinite(at) || now.getTime() - at < OWED_GRACE_MS) continue;
    out.due += 1;
    try {
      // A carried name, status and item go through to the send; a record without one sends the plain welcome.
      const r = await send(env, { githubId, ...carriedFields(rec?.carry) }, { kv, now });
      if (r?.sent) out.sent += 1;
    } catch {
      out.errors += 1;
    }
  }
  return out;
}
