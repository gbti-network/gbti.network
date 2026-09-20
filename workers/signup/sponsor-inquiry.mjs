// sow-266 Phase 4: the anonymous sponsorship-inquiry route, and the superadmin read of what came in.
//
// POST /sponsorship/inquiry   a visitor asks about sponsoring the weekly digest. Rate limited, Turnstile gated,
//                             stored with a TTL, and emailed to the owner. Anonymous, so no cookie and no
//                             bearer, which is why a wildcard origin is safe here as it is on /touch: there is
//                             no ambient credential for a cross-origin page to ride.
// GET  /membership/admin/sponsor-inquiries   superadmin. Lists what came in, newest first.
//
// THE MAIL IS THE PRODUCT AND THE RECORD IS THE BACKUP, which is the reverse of the subscribe route beside it.
// So the ordering of the two matters: the record is written FIRST and the mail is sent after, because a stored
// inquiry with a failed notice is recoverable and a sent notice with a failed write is not, and the owner gets
// a mail either way. Both are fail-soft, and the response is the same whichever of them fell over: a person who
// filled in a form is told it was received when it was received, and told to write directly when it was not.
//
// NOT ANTI-ENUMERATION, and it does not need to be. There is nothing here to enumerate: no address is looked
// up, no existing record is consulted, and two submissions of the same address behave identically. The
// validation therefore says plainly which field is wrong, which a contact form should.
//
// INJECTABLE (kv, the abuse checks, the sender, the id source, now) so the whole thing is unit-tested with a
// fake KV and no network.

import { rateLimit, verifyTurnstile } from './abuse.mjs';
import { authorizeSuperadmin } from './membership-admin.mjs';
import { createResendClient } from '../../clients/resend.mjs';
import { mailHash } from '../../membership/mail-suppress.mjs';
import { encryptEmail, decryptEmail } from '../../membership/mail-address.mjs';
import {
  inquiryProblems, buildInquiry, inquiryKey, inquiryNotice, INQUIRY_TTL_SECONDS, INQUIRY_PREFIX, INQUIRY_LIMITS,
} from '../../membership/sponsor-inquiry.mjs';

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS },
});

/** A url-safe random id for the record and the reference a sender can quote back. */
function randomId() {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return [...b].map((n) => n.toString(16).padStart(2, '0')).join('');
}

/** Read the form from JSON or from a urlencoded/multipart post, so the page works with or without scripting. */
async function readInput(request) {
  const ct = (request.headers.get('content-type') || '').toLowerCase();
  try {
    if (ct.includes('application/json')) {
      const b = await request.json();
      return {
        name: b?.name, email: b?.email, organization: b?.organization, website: b?.website, message: b?.message,
        turnstileToken: b?.turnstileToken || b?.['cf-turnstile-response'],
      };
    }
    const f = await request.formData();
    return {
      name: f.get('name'), email: f.get('email'), organization: f.get('organization'),
      website: f.get('website'), message: f.get('message'),
      turnstileToken: f.get('cf-turnstile-response') || f.get('turnstileToken'),
    };
  } catch {
    return {};
  }
}

/**
 * The owner's copy. Fail-soft by contract, like every other alert on a capture path: the inquiry is already
 * stored by the time this runs, and a failed notice must not turn a received inquiry into an error.
 */
async function notifyOwner(env, record, email, sendEmail) {
  try {
    const to = str(env?.ADMIN_ALERT_EMAIL || env?.COUPON_ALERT_EMAIL).trim();
    const from = str(env?.MAIL_FROM || env?.RESEND_FROM).trim();
    const apiKey = str(env?.RESEND_API_KEY).trim();
    if (!to || !from) return { sent: false, reason: 'unconfigured' };
    const send = sendEmail || (apiKey ? createResendClient({ apiKey }).sendEmail : null);
    if (!send) return { sent: false, reason: 'unconfigured' };
    const { subject, text } = inquiryNotice(record, { email });
    // replyTo, so answering the notice answers the sponsor. Without it the owner copies an address by hand out
    // of a message they are already reading, which is exactly where a digit gets dropped.
    await send({ from, to, subject, text, replyTo: email || undefined });
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: 'error', message: err?.message ?? String(err) };
  }
}

/**
 * POST /sponsorship/inquiry.
 *
 * ORDER OF THE GATES, cheapest and most abusable first: method, rate limit, shape, then Turnstile. Turnstile is
 * last of the four because it costs a round trip to Cloudflare, and there is no reason to spend one on a
 * submission that is going to be refused for an empty message anyway.
 */
export async function handleSponsorInquiry(request, env, deps = {}) {
  const {
    kv = env?.SIGNUP_KV,
    rateLimitFn = rateLimit,
    verifyTurnstileFn = verifyTurnstile,
    sendEmail,
    newId = randomId,
    now = Date.now,
  } = deps;

  const method = str(request.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const ip = request.headers.get('CF-Connecting-IP') || '';
  // Tighter than the subscribe limiter (5 in 10 minutes): an inquiry is a thing a person sends once, and each
  // one spends a transactional send. A limiter error is NOT fatal, so a broken store cannot lock out a sponsor.
  try {
    const rl = await rateLimitFn({ kv, ip, limit: 3, windowSeconds: 900, prefix: 'rl:sponsorinq:' });
    if (rl && rl.allowed === false) return json({ ok: false, error: 'rate_limited' }, 429);
  } catch { /* non-fatal */ }

  const input = await readInput(request);
  const problems = inquiryProblems(input);
  if (problems.length) return json({ ok: false, error: 'invalid', problems }, 400);

  const tsSecret = str(env?.TURNSTILE_SECRET_KEY).trim();
  if (tsSecret) {
    const ok = await verifyTurnstileFn({ token: input.turnstileToken, secret: tsSecret, remoteIp: ip });
    if (!ok) return json({ ok: false, error: 'challenge_failed' }, 403);
  }

  const email = str(input.email).trim();
  // The address is encrypted under the same envelope the subscriber records use, bound to its hash. With the
  // keys unset the record is still written, WITHOUT the address, and the flag below tells the read view to say
  // so. Losing the inquiry would be the worse failure, and storing the address in the clear is not the
  // alternative: the owner's mail still carries it.
  let emailHash = '';
  let emailEnvelope = null;
  try {
    const suppressSecret = str(env?.MAIL_SUPPRESS_KEY).trim();
    const emailKey = str(env?.MAIL_EMAIL_KEY).trim();
    if (suppressSecret && emailKey) {
      emailHash = await mailHash(suppressSecret, email);
      emailEnvelope = await encryptEmail({ key: emailKey, hash: emailHash, email });
      if (!emailEnvelope) emailHash = ''; // an envelope that could not be made is not a hash worth keeping
    }
  } catch { emailHash = ''; emailEnvelope = null; }

  const record = buildInquiry({ ...input, id: newId(), at: new Date(now()), emailHash, emailEnvelope });
  const key = inquiryKey(record.id);

  let stored = false;
  try {
    if (kv && key) { await kv.put(key, JSON.stringify(record), { expirationTtl: INQUIRY_TTL_SECONDS }); stored = true; }
  } catch { stored = false; }

  const notice = await notifyOwner(env, record, email, sendEmail);

  // If NEITHER half worked, the inquiry is genuinely lost and saying "thank you" would be a lie. Everything
  // else is a success from the sender's side: one of the two channels has it.
  if (!stored && !notice.sent) return json({ ok: false, error: 'unavailable' }, 503);
  return json({ ok: true, reference: record.id });
}

/**
 * GET /membership/admin/sponsor-inquiries. Superadmin. What came in, newest first, with the address decrypted
 * for the one audience that needs to reply to it.
 *
 * KV LIST IS BOUNDED AND SO IS THIS. The TTL keeps the set small by construction, and the cap below keeps one
 * slow page from becoming a slow route as well. An inquiry past the cap has not been lost: it is in the owner's
 * inbox, which is the primary channel.
 */
export async function listSponsorInquiries(request, env, deps = {}) {
  const { kv = env?.SIGNUP_KV, authorize = authorizeSuperadmin, allowCookie = false, limit = 100 } = deps;
  const auth = await authorize(request, env, { ...deps, allowCookie });
  if (!auth.ok) return { status: auth.status, body: auth.body };
  if (!kv) return { status: 503, body: { error: 'unavailable', message: 'the inquiry store is not configured' } };

  let keys = [];
  try {
    const listed = await kv.list({ prefix: INQUIRY_PREFIX, limit });
    keys = Array.isArray(listed?.keys) ? listed.keys : [];
  } catch (e) {
    return { status: 503, body: { error: 'unavailable', message: `the inquiry store could not be read (${e?.message || 'unknown'})` } };
  }

  const emailKey = str(env?.MAIL_EMAIL_KEY).trim();
  const out = [];
  for (const k of keys) {
    let rec = null;
    try { rec = await kv.get(k.name, 'json'); } catch { rec = null; }
    if (!rec || typeof rec !== 'object') continue;
    let email = '';
    // A record written while the keys were unset has no envelope. That is reported as a state, not as a blank
    // field, so a superadmin does not read it as a sponsor who left the address out.
    if (emailKey && rec.emailEnvelope && rec.emailHash) {
      try { email = (await decryptEmail({ key: emailKey, hash: rec.emailHash, envelope: rec.emailEnvelope })) || ''; } catch { email = ''; }
    }
    const { emailEnvelope, emailHash, ...rest } = rec;
    out.push({ ...rest, email, emailStored: Boolean(emailEnvelope) });
  }
  out.sort((a, b) => str(b.at).localeCompare(str(a.at)));
  return { status: 200, body: { ok: true, inquiries: out, limits: { ...INQUIRY_LIMITS } } };
}
