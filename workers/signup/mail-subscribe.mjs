// SOW-166: the anonymous double-opt-in subscribe + confirm routes for the weekly digest.
//
// TWO ROUTES, ONE FLOW.
//   POST /mail/subscribe  a visitor submits an email. We validate it, gate abuse (rate limit + Turnstile), and
//                         write a PENDING opt-in (mail:optin:<hash>, the emailEnc envelope + a random nonce, a
//                         48h TTL), then send ONE transactional confirmation email carrying a confirm link. We
//                         create NO recipient here, so an address typed by a third party is never enrolled.
//   GET/POST /mail/confirm  the link from that email. GET renders a confirm page (never mutates, so a mail-client
//                         prefetch cannot auto-confirm and defeat the point of double opt-in); POST promotes the
//                         pending opt-in into a real active subscriber (mail:subscriber:<hash>) and deletes the
//                         pending record. Only after this is the address a recipient.
//
// ANTI-ENUMERATION. Every well-formed subscribe returns the SAME neutral response whether the address is new,
// already active, or previously suppressed. The side effect differs, but the requester cannot observe which one
// ran, so the endpoint cannot be used to probe who is subscribed. Only a MALFORMED input (400), a rate limit
// (429), or a failed challenge (403) returns a different status, and none of those reveal a subscriber's
// existence.
//
// THE ADDRESS NEVER LANDS IN KV IN PLAINTEXT. subscribe encrypts it under MAIL_EMAIL_KEY bound to the hash
// (mail-address.mjs) before writing the pending record, and confirm promotes that same opaque envelope into the
// subscriber record with no re-encryption, so no code path stores a raw '@' (the leak-guard the subscriber core
// already carries).
//
// FAIL-CLOSED ON A PRIOR OPT-OUT (owner policy call, filed). A suppressed address is NOT re-contacted and NOT
// re-subscribed by this route: the safe default honors the opt-out. Whether an explicit form resubmission should
// count as fresh consent and lift the suppression (via a confirm click) is the owner's decision; until it is
// made, the strict default stands, because silently re-contacting someone who unsubscribed is the worse error.
//
// SETTINGS TOGGLE: `optin.double` in house/digest-config.yml, read here from the digest:config mirror. Defaults
// OFF: a submit writes the ACTIVE subscriber immediately (no pending record, no confirmation email) and
// notifies the admin. The welcome sweep still greets the new subscriber (welcomedAt == null), so nothing
// downstream changes. Turned ON, a submit holds a pending opt-in for 48 hours and enrolls nobody until the
// confirmation link is clicked.
//
// sow-270 MOVED THIS SETTING AND REVERSED ITS FAIL DIRECTION, both deliberately. It used to be the Worker var
// MAIL_DOUBLE_OPTIN, which defaulted ON and needed a commit plus a deploy to change; that var is retired, and
// this mirror is now the only source. An unreadable mirror resolves OFF, the same as unset (owner ruling
// 2026-09-20, risk accepted on the record: with the switch ON and a broken sync, addresses are enrolled
// without confirming until it recovers). Off weakens proof-of-consent, which is the tradeoff the owner took;
// the suppression fail-close still holds in both modes.
//
// ADMIN NOTICE: on a genuinely new subscriber (direct-mode submit, or a confirm), the Worker fires a fail-soft
// new-subscriber notice to the owner (subscriber-alert.mjs). It never fires on an idempotent re-subscribe.
//
// INJECTABLE (kv, the abuse checks, the mail sender, the admin-alert sender, now) so the whole thing is
// unit-tested with a fake KV and no network. Everything is best-effort + fail-closed: an unprovisioned or
// erroring dependency yields the neutral response and enrolls nobody, never a 500 that leaks internals.

import { mailHash, suppressKey } from '../../membership/mail-suppress.mjs';
import { encryptEmail, decryptEmail } from '../../membership/mail-address.mjs';
import { buildSubscriber } from '../../membership/mail-subscriber.mjs';
import { sendNewSubscriberAlert } from './subscriber-alert.mjs';
import { timingSafeEqual } from '../../membership/mail-unsub-token.mjs';
import { resolveDigestConfig, DIGEST_CONFIG_KV_KEY } from '../../membership/digest-config.mjs'; // sow-270: the opt-in setting
import {
  isValidEmailShape, optinKey, buildPendingOptIn, normalizePendingOptIn, OPTIN_TTL_SECONDS,
} from '../../membership/mail-optin.mjs';
import { getSubscriber, putSubscriber } from './mail-store.mjs';
import { verifyTurnstile, rateLimit } from './abuse.mjs';
import { createResendClient } from '../../clients/resend.mjs';
import { renderConfirmationEmail } from '../../membership/mail-transactional-render.mjs'; // sow-270: the branded confirmation body
import { pageResponse as page, panelResponse, PAGE_HEADERS, escapePage as escapeHtml } from './mail-pages.mjs'; // sow-270: the shared shell, and the tinted-panel page for the two endings

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

// Anonymous, no ambient credential (no cookie, no bearer), so a wildcard origin is safe: there is nothing for a
// cross-origin page to ride. Same posture as /touch.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** A machine-generated 64-hex mailHash. Validate before building a KV key from a URL-supplied hash. */
function isHashShape(h) {
  return typeof h === 'string' && h.length === 64 && !/[^0-9a-f]/.test(h);
}

/** A random bearer nonce for the confirm link (base64url, unpadded, 32 bytes of entropy). */
function randomNonce() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function wantsJson(request) {
  const accept = (request.headers.get('accept') || '').toLowerCase();
  const ct = (request.headers.get('content-type') || '').toLowerCase();
  return accept.includes('application/json') || ct.includes('application/json');
}

/** Read the email + Turnstile token from a JSON body or a urlencoded/multipart form body. */
async function readSubscribeInput(request) {
  const ct = (request.headers.get('content-type') || '').toLowerCase();
  try {
    if (ct.includes('application/json')) {
      const b = await request.json();
      return { email: b?.email, turnstileToken: b?.turnstileToken || b?.['cf-turnstile-response'] };
    }
    const form = await request.formData();
    return {
      email: form.get('email'),
      turnstileToken: form.get('cf-turnstile-response') || form.get('turnstileToken'),
    };
  } catch {
    return { email: null, turnstileToken: null };
  }
}

/** The single neutral subscribe outcome (JSON for a fetch, an HTML page for a no-JS form navigation). The copy
 *  differs by MODE (confirm vs direct), but within a mode it is byte-identical for a new, already-active, or
 *  suppressed address, so the anti-enumeration property holds. `direct` is set when the confirm step is off, in
 *  which case a submit activates immediately and there is no confirmation email to check for. */
function neutralResult(request, { direct = false } = {}) {
  if (wantsJson(request)) {
    // sow-202: `direct` tells the site's sign-up box which copy is true (subscribed now, or check your inbox). It is
    // configuration only, identical for every address within a mode, so it carries no enumeration signal.
    return new Response(JSON.stringify({ ok: true, direct: Boolean(direct) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS },
    });
  }
  if (direct) {
    // One page for a new, an existing and an opted-out address, so it must be true for all three (sow-202).
    return page('Subscribed',
      '<h1>Thanks for subscribing.</h1>'
      + '<p>This address now gets the GBTI Network weekly digest, unless it unsubscribed before. '
      + 'You can unsubscribe from any issue.</p>');
  }
  return page('Almost done',
    '<h1>Almost done. Please check your inbox.</h1>'
    + '<p>If this address is new to the GBTI Network digest, we just sent a confirmation email. '
    + 'Click the link in it to start receiving the weekly digest.</p>');
}

/** An error outcome that carries no subscriber information (JSON for a fetch, an HTML page otherwise). */
function errorResult(request, code, status) {
  if (wantsJson(request)) {
    return new Response(JSON.stringify({ ok: false, error: code }), {
      status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS },
    });
  }
  const msg = code === 'invalid_email' ? 'That does not look like a valid email address.'
    : code === 'rate_limited' ? 'Too many requests. Please try again in a few minutes.'
      : code === 'challenge_failed' ? 'We could not verify that request. Please try again.'
        : 'Your request could not be completed.';
  return page('Subscription not sent', `<h1>${escapeHtml(msg)}</h1>`, status);
}

async function readOptin(kv, hash) {
  const key = optinKey(hash);
  if (!kv || !key) return null;
  let raw = null;
  try { raw = await kv.get(key, 'json'); } catch { return null; }
  return normalizePendingOptIn(raw);
}

async function deleteOptin(kv, hash) {
  const key = optinKey(hash);
  if (!kv || !key) return;
  try { await kv.delete(key); } catch { /* best effort; the TTL prunes it */ }
}

/** Send the transactional double-opt-in confirmation email. Best-effort: returns false (never throws) when the
 *  send is unprovisioned or fails, so subscribe stays neutral and the pending record survives for a re-send.
 *
 *  sow-270: the body comes from membership/mail-transactional-render.mjs rather than being assembled here. It
 *  used to be a bare paragraph stack in a system font, which made the one message deciding whether anything is
 *  ever sent the only one that looked nothing like the sender it claims to be. The renderer returns null on a
 *  url it cannot vouch for, which is a second guard: a confirmation whose only purpose is a link is not worth
 *  delivering without one. */
async function sendConfirmationEmail({ env, to, confirmUrl, send }) {
  const from = str(env?.MAIL_FROM).trim();
  const apiKey = str(env?.RESEND_API_KEY).trim();
  if (!from || !to || !confirmUrl) return false;
  const mail = renderConfirmationEmail({ confirmUrl, siteUrl: str(env?.SITE_BASE_URL).trim() });
  if (!mail) return false;
  const sender = typeof send === 'function'
    ? send
    : (apiKey ? createResendClient({ apiKey }).sendEmail : null);
  if (!sender) return false;
  try { await sender({ from, to, subject: mail.subject, text: mail.text, html: mail.html }); return true; } catch { return false; }
}

/**
 * POST /mail/subscribe. Anonymous capture with abuse gating and double opt-in. Returns a Response (JSON or an
 * HTML page by content negotiation). Injectable deps default to the real store, abuse checks, and Resend.
 */
/**
 * sow-270: is the confirm step on? Reads the digest:config mirror and resolves it with the same pure function
 * the mail compile uses, so the switch cannot mean one thing here and another there.
 *
 * EVERY FAILURE IS OFF. resolveDigestConfig already treats an absent or non-boolean value as off; this adds
 * the two failures it cannot see, a missing KV binding and a throwing read, and lands them the same way.
 */
async function readOptinMode(kv) {
  let mirror = null;
  try {
    mirror = (await kv?.get(DIGEST_CONFIG_KV_KEY, 'json')) ?? null;
  } catch {
    mirror = null;
  }
  return resolveDigestConfig({ mirror }).optin.double === true;
}

export async function handleSubscribe(request, env, deps = {}) {
  const {
    kv = env?.SIGNUP_KV,
    verifyTurnstileFn = verifyTurnstile,
    rateLimitFn = rateLimit,
    send, // injectable Resend sender for tests (the confirmation email)
    sendAdminAlert, // injectable admin-notice sender for tests (the new-subscriber notice)
    now = Date.now,
  } = deps;

  const method = str(request.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (method !== 'POST') return errorResult(request, 'method_not_allowed', 405);

  const ip = request.headers.get('CF-Connecting-IP') || '';

  // Rate limit first (cheap; the endpoint spends a transactional send, so it is a spam vector). A limiter error
  // must not lock out a genuine subscriber, so it is non-fatal: the send is still config-gated below.
  try {
    const rl = await rateLimitFn({ kv, ip, limit: 5, windowSeconds: 600, prefix: 'rl:mailsub:' });
    if (rl && rl.allowed === false) return errorResult(request, 'rate_limited', 429);
  } catch { /* non-fatal */ }

  const { email, turnstileToken } = await readSubscribeInput(request);
  const addr = str(email).trim();
  if (!isValidEmailShape(addr)) return errorResult(request, 'invalid_email', 400);

  // Turnstile is required WHEN a secret is configured (production). Absent secret (local/test) skips it, and the
  // route is still behind the rate limit and the config-gated send.
  const tsSecret = str(env?.TURNSTILE_SECRET_KEY).trim();
  if (tsSecret) {
    const ok = await verifyTurnstileFn({ token: turnstileToken, secret: tsSecret, remoteIp: ip });
    if (!ok) return errorResult(request, 'challenge_failed', 403);
  }

  // sow-270: the confirm step is a superadmin setting in house/digest-config.yml, read from the mirror the
  // digest compile already reads. Every failure lands OFF: a missing binding, a missing key, an unparseable
  // body, a thrown read. That is the owner's ruling and it is the opposite of what the retired Worker var did,
  // so it is stated rather than inferred.
  const doubleOptIn = await readOptinMode(kv);

  // From here every path returns the SAME neutral response WITHIN A MODE (anti-enumeration). The copy differs
  // between the confirm and direct modes, which is not an enumeration signal: it depends only on configuration,
  // not on whether this particular address exists.
  const neutral = neutralResult(request, { direct: !doubleOptIn });

  const suppressSecret = str(env?.MAIL_SUPPRESS_KEY).trim();
  const emailKey = str(env?.MAIL_EMAIL_KEY).trim();
  if (!kv || !suppressSecret || !emailKey) return neutral; // inert until provisioned

  const hash = await mailHash(suppressSecret, addr);
  if (!hash) return neutral;

  // Fail-closed on a prior opt-out (owner policy call, filed): a suppressed address is not re-contacted here.
  try {
    const sk = suppressKey(hash);
    if (sk && (await kv.get(sk))) return neutral;
  } catch { return neutral; }

  // Idempotent: an already-active subscriber gets no second confirmation.
  try {
    const existing = await getSubscriber(kv, hash);
    if (existing && existing.status === 'active') return neutral;
  } catch { /* a read error must not block a genuine new subscribe */ }

  // Encrypt the address (bound to the hash). The same opaque envelope feeds either the pending opt-in (confirm
  // mode) or the active subscriber record (direct mode); a raw '@' never lands in KV on either path.
  const envelope = await encryptEmail({ key: emailKey, hash, email: addr });
  if (!envelope) return neutral;

  // DIRECT MODE (the confirm step off, which is the default): promote to an active subscriber now, skip the confirmation email, and
  // notify the admin of the new subscriber. buildSubscriber + putSubscriber are the exact two calls the confirm
  // path uses, so a direct enrollment is indistinguishable downstream from a confirmed one (welcomedAt == null,
  // greeted by the welcome sweep). The existing-active short-circuit above already made this fire only for a
  // genuinely new subscriber.
  if (!doubleOptIn) {
    let stored = null;
    try {
      const rec = buildSubscriber({ hash, source: 'anon', emailEnc: JSON.stringify(envelope) }, { now });
      stored = await putSubscriber(kv, rec);
    } catch (e) {
      console.warn(`mail-subscribe: direct subscriber write failed for ${hash}: ${e?.message || e}`);
      return neutral;
    }
    if (!stored) return neutral;
    // Fail-soft admin notice. Awaited (like the confirmation send it replaces) but never throws, so it cannot
    // break the neutral response; only fires on this genuinely new activation.
    await sendNewSubscriberAlert(env, { email: addr, source: 'anon', at: new Date(now()).toISOString() }, { sendEmail: sendAdminAlert });
    return neutral;
  }

  // CONFIRM MODE (default): write a fresh pending opt-in and send the confirmation email. Re-subscribing before
  // confirming overwrites the prior pending record with a new nonce + TTL, so the newest link is the one that works.
  const nonce = randomNonce();
  let pending;
  try {
    pending = buildPendingOptIn({ hash, emailEnc: JSON.stringify(envelope), nonce }, { now });
  } catch { return neutral; }
  const key = optinKey(hash);
  if (!key) return neutral;
  // A failed opt-in WRITE means confirmation can never succeed (there is no pending record to promote later). Keep
  // the response byte-identical (neutral is the anti-enumeration answer), but do NOT swallow the failure into an
  // indistinguishable "check your email": surface it so it is visible in the Worker logs, not found by a user who
  // never gets confirmed. (SecurityMaster, 2026-08-22.)
  try { await kv.put(key, JSON.stringify(pending), { expirationTtl: OPTIN_TTL_SECONDS }); }
  catch (e) { console.warn(`mail-subscribe: pending opt-in write failed for subscriber ${hash}: ${e?.message || e}`); return neutral; }

  // Send the confirmation (transactional, NOT the bulk digest send gate). The confirm link points back at THIS
  // Worker (PUBLIC_BASE_URL, falling back to the request origin), the same origin that serves /mail/confirm.
  const base = str(env?.PUBLIC_BASE_URL).trim().replace(/\/$/, '') || new URL(request.url).origin;
  const confirmUrl = `${base}/mail/confirm?h=${encodeURIComponent(hash)}&t=${encodeURIComponent(nonce)}`;
  // CAPTURE the confirmation-send outcome. sendConfirmationEmail returns false when RESEND_API_KEY / the sender is
  // absent, MAIL_FROM is unset, or the send throws. With this discarded (the old code did), a mail-provisioning gap
  // failed EVERY subscriber silently: they see the neutral "check your email" page, a pending opt-in sits in KV
  // until its TTL, and nothing reports it. The response stays neutral (the anti-enumeration property is unchanged);
  // the boolean is captured for a log so a broken provisioning is visible, not discovered by a missing email.
  const confirmed = await sendConfirmationEmail({ env, to: addr, confirmUrl, send });
  if (!confirmed) console.warn(`mail-subscribe: confirmation send did not complete for subscriber ${hash} (check RESEND_API_KEY / MAIL_FROM)`);
  return neutral;
}

/**
 * GET/POST /mail/confirm. GET renders a confirmation page (never mutates); POST promotes the pending opt-in into
 * an active subscriber. The nonce in the link is the authorization; it is compared timing-safe against the stored
 * pending record. Fail-closed on a malformed hash, an absent/expired opt-in, or a nonce mismatch.
 */
export async function handleConfirm(request, env, deps = {}) {
  const { kv = env?.SIGNUP_KV, now = Date.now, sendAdminAlert } = deps;

  const method = str(request.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: PAGE_HEADERS });
  if (method !== 'GET' && method !== 'POST') return page('Method not allowed', '<h1>Method not allowed</h1>', 405);

  const url = new URL(request.url);
  const hash = (url.searchParams.get('h') || '').trim();
  const token = (url.searchParams.get('t') || '').trim();

  const invalid = (status = 200) => page('Subscription link invalid',
    '<h1>This confirmation link is invalid or has expired.</h1>'
    + '<p class="muted">Confirmation links expire after 48 hours. If you still want the GBTI Network digest, '
    + 'subscribe again from the site.</p>', status);
  const notCompleted = () => page('Subscription not confirmed',
    '<h1>We could not confirm your subscription just now.</h1>'
    + '<p class="muted">Please try the link again in a moment. You have not been subscribed yet.</p>', 503);

  if (!isHashShape(hash)) return invalid(method === 'POST' ? 400 : 200);

  const pending = await readOptin(kv, hash);
  const valid = Boolean(pending) && timingSafeEqual(pending.nonce, token);

  if (method === 'GET') {
    if (!valid) return invalid();
    // The confirm button POSTs back to THIS exact URL (path + query), so the nonce rides the POST, not a hidden
    // field, and a prefetch of the GET never mutates.
    const action = escapeHtml(url.pathname + url.search);
    // sow-270 Phase 7: ONE CLICK. The form submits itself on load, so following the link from the email is the
    // whole of it, and the reader never presses a second button to agree to what they already agreed to.
    //
    // THE GUARD IS KEPT, and this is the part worth being precise about. The GET still mutates nothing: the
    // activation is the POST, and it is a script in a real browser that issues it. A mail client prefetching
    // the link runs no script, so it still cannot confirm on the reader's behalf, which is the whole point of
    // asking. A scripted scanner could, which narrows the hole rather than closing it (owner decision,
    // 2026-09-20).
    //
    // THE BUTTON IS THE FALLBACK, revealed by <noscript> when scripting is off, and by a timer if the script
    // ran but the submit did not take. The timer is armed BEFORE the submit is attempted, deliberately: a
    // reader who cannot confirm and cannot see a button has no way forward at all.
    //
    // THE COPY HAS TO BE TRUE IN BOTH STATES, which the first version was not: it read "one moment while we
    // add this address" above a button that had to be pressed, so the no-script reader was told something was
    // happening while nothing was. The heading works either way, and the sentence that assumes a press lives
    // inside the block that only appears when there is a press to make.
    const form = `<form id="cf" method="POST" action="${action}" style="display:none">`
      + `<p>Press the button to add this address to the GBTI Network weekly digest.</p>`
      + `<button type="submit">Confirm subscription</button></form>`
      + `<noscript><style>#cf{display:block!important}</style></noscript>`
      + `<script>(function(){var f=document.getElementById('cf');`
      + `setTimeout(function(){if(f)f.style.setProperty('display','block','important');},4000);`
      + `try{f.submit();}catch(e){f.style.setProperty('display','block','important');}})();</script>`;
    return panelResponse('Confirm your subscription', {
      heading: 'Confirm your subscription',
      lines: [],
      extra: form,
    });
  }

  // POST performs the activation.
  if (!valid) return invalid(400);

  // Belt and suspenders: if the address opted out between subscribe and confirm, do not activate it.
  try {
    const sk = suppressKey(hash);
    if (sk && (await kv.get(sk))) {
      await deleteOptin(kv, hash);
      return page('Subscription not confirmed',
        '<h1>This address has opted out.</h1>'
        + '<p class="muted">It was unsubscribed and will not be re-subscribed. Contact us if this is unexpected.</p>');
    }
  } catch { return notCompleted(); } // a suppression-check error fails closed: do not activate

  // Promote the pending opt-in into an active subscriber, reusing the stored emailEnc (no raw email at confirm).
  let stored = null;
  try {
    const rec = buildSubscriber({ hash, source: 'anon', emailEnc: pending.emailEnc }, { now });
    stored = await putSubscriber(kv, rec);
  } catch { stored = null; }
  if (!stored) return notCompleted();

  await deleteOptin(kv, hash); // best-effort: the subscriber is active; a stray opt-in expires on its TTL

  // Notify the admin of the new subscriber (fail-soft). Best-effort decrypt of the stored envelope for the notice;
  // a decrypt failure just omits the address. Only fires here on a genuinely new confirmation.
  let email = '';
  try {
    const envelope = JSON.parse(pending.emailEnc);
    email = (await decryptEmail({ key: str(env?.MAIL_EMAIL_KEY).trim(), hash, envelope })) || '';
  } catch { /* leave email blank; the notice still sends */ }
  await sendNewSubscriberAlert(env, { email, source: 'anon', at: new Date(now()).toISOString() }, { sendEmail: sendAdminAlert });

  // sow-270 Phase 6: the full stop. The headline already says it worked, so the lines underneath do the work
  // the reader cannot do for themselves: when it arrives, and what to do if it does not appear. Monday is a
  // fact rather than a hope, being the day the compile cron runs (Cloudflare reads the cron's `2` as Monday;
  // test/digest-send-day.test.mjs holds this copy to the cron).
  return panelResponse('Subscribed', {
    heading: 'Thank you, and welcome',
    lines: [
      'The GBTI Network digest goes out on Monday mornings, United States Central Time.',
      'If you cannot find it, look in your spam folder and mark it as not spam, so the next one arrives where you expect it.',
    ],
  });
}
