// The signed OAuth state that carries a signup or a Discord link across the external hops, its one-time consume,
// the per-browser nonce cookie, and the return-path check. Moved out of index.mjs at the 900-line limit (owner,
// 2026-09-30). index.mjs re-exports every name it exported before, so callers and tests may import from either.

import { wlog } from './wlog.mjs'; // SOW-124: Worker diagnostic logger (redacted, retained via [observability])
import { signSession, verifySession } from './session.mjs';
import { json, redirect } from './route-helpers.mjs';

// state is a signed blob carrying { ref, via, sid, nonce, githubId?, githubLogin? } between the OAuth hops. The HMAC
// signature over the blob prevents forgery/tampering; the embedded `nonce` (also set as a cookie at /signup/start)
// binds the state to the INITIATING browser, so a legitimately-signed state cannot be replayed into a victim's
// browser. The callback rejects unless the request's nonce cookie matches the state nonce (login-CSRF /
// session-fixation defense). A SameSite=Lax cookie survives the single GitHub hop now that Discord is deferred.
//
// We reuse signSession/verifySession as the signing primitive. signSession requires a non-empty
// github_id, so we pin it to a fixed marker ('state') and carry the real payload as JSON in the
// github_login slot. A short 600-second TTL bounds replay of an issued state token.
const STATE_SUBJECT = 'state';

// THE SIGNUP FUNNEL IS INSTRUMENTED (2026-08-13 incident). A real prospect could not complete signup, the owner
// asked "is this happening to other people?", and the honest answer was that we could not know: handleStart and
// handleGithubCallback made zero log calls between them, so the only record of a failed signup was the member
// saying so. A funnel with no denominator cannot answer a rate question, and that is the question that gets asked.
//
// WHY THIS IS WORTH THE RETENTION, given wlog.mjs says to log at genuine diagnostic points and NOT per request:
// these two endpoints are reached once per signup attempt, not once per page view, so the whole funnel costs a
// handful of lines a day. The denominator IS the point; sampling it would defeat the purpose.
//
// EVERY REJECTION REASON IS DISTINCT HERE, and that is the real content of this change. The callback answers a
// single opaque `bad_oauth_state` to SEVEN different causes, and sow-236 added to that pile rather than
// subtracting from it. The client response stays byte-identical (a caller must not learn which check it tripped);
// the log is where they separate. Without that, "the invite is broken" and "someone is replaying states" and "a
// browser dropped our cookie" are the same line.
//
// NOTHING IDENTIFYING GOES IN. No jti (it is a bearer value), no coupon CODE (per-invite codes are bearer
// secrets since sow-231, and the owner reversed their own ruling to allow those), no token, no email. Presence
// booleans and a github_id after it is established, which is the same key the rest of the system logs.
export const funnel = (event, data) => wlog('signup-funnel', event, data);

export async function packState(payload, env, ttlSeconds = 600) {
  return signSession({ githubId: STATE_SUBJECT, githubLogin: JSON.stringify(payload) }, env.SESSION_SECRET, {
    ttlSeconds,
  });
}
export async function unpackState(token, env) {
  const verified = await verifySession(token, env.SESSION_SECRET);
  if (!verified || verified.github_id !== STATE_SUBJECT) return null;
  try {
    return JSON.parse(verified.github_login);
  } catch {
    return null;
  }
}

// sow-236: the OAuth state's one-time consume. The 600s TTL was the only bound on replaying an issued state, and a
// TTL bounds the WINDOW, never the COUNT. Same construction as the Discord link token's jti (see /discord/link/start),
// with one deliberate difference: that consume is best-effort on the write, which is defensible for a token that only
// binds an account the caller already holds. This one guards signup itself, so it FAILS CLOSED on every uncertainty.
//
// The record's TTL deliberately EXCEEDS the 600s state TTL, so the evidence of a consume always outlives the token it
// guards. A shorter record would let a still-valid state become fresh again.
//
// HONEST RESIDUAL, stated rather than implied: Cloudflare KV is eventually consistent and caches reads per colo, so
// two callbacks racing from DIFFERENT colos can both observe a miss. Same-colo reads are read-your-writes, so the
// common case is caught immediately. This takes the attack from "unlimited redemptions for the state's whole TTL"
// down to "bounded by the cross-colo consistency window", which is a large reduction and not a closed door. The
// callback rate limit added alongside is what bounds that remainder. A strictly serialized consume needs a Durable
// Object; that is the escalation path if the residual ever justifies the infrastructure.
// It LOGS WHICH of its four denials fired, because this function is the only place that can tell them apart: the
// caller sees one `false` for a misconfigured binding, a pre-deploy state, a genuine replay and a KV outage, and
// those are four different operational facts with four different responses. The boolean contract is unchanged, so
// the security property and its tests are untouched; only the record improves. Note that "already redeemed" is
// NOT necessarily an attack: a back button, a refresh or a bfcache restore of the callback URL reaches here too,
// and looks identical to the member. If that turns out to be common, the fix is a friendlier page, not a weaker
// consume, and this log is how we would find out.
// sow-393: what the extension sign-in routes borrow from here, passed in so that module never imports this one.
export const EXT_SIGNIN_HELPERS = { json, redirect, packState, unpackState, consumeStateJti }; // function declarations, hoisted

export async function consumeStateJti(kv, jti) {
  if (!kv) { funnel('state consume denied', { reason: 'no_kv_binding' }); return false; }
  if (typeof jti !== 'string' || !jti) { funnel('state consume denied', { reason: 'no_jti' }); return false; } // pre-sow-236 state, or shape drift
  const key = `statejti:${jti}`;
  try {
    if (await kv.get(key)) { funnel('state consume denied', { reason: 'already_redeemed' }); return false; } // replay, OR a back/refresh
    await kv.put(key, '1', { expirationTtl: 900 }); // > the 600s state TTL
    return true;
  } catch (err) {
    // KV unreachable -> deny rather than fall through to "not used, therefore allowed". This one is an INCIDENT,
    // not a user error: it fails every signup in flight, and it used to be indistinguishable from a replay.
    funnel('state consume denied', { reason: 'kv_error', message: err?.message ?? null });
    return false;
  }
}

// SOW security fix: a per-flow nonce, set as a cookie at /signup/start AND embedded in the signed state, binds the
// state to the initiating browser. The callback requires both to match before minting a session, closing the
// login-CSRF / session-fixation hole (a signed-but-fungible state replayed into a victim's browser). A SameSite=Lax
// cookie survives the single external GitHub hop (Discord is deferred), so the old "nonce cannot survive" rationale
// no longer applies.
export const OAUTH_NONCE_COOKIE = 'gbti_oauth_nonce';
export function readOauthNonce(cookieHeader) {
  if (typeof cookieHeader !== 'string') return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === OAUTH_NONCE_COOKIE) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

// sow-158 Phase 2: validate a website-login return path. Only a same-site, root-relative path is allowed, so a
// value concatenated onto the fixed SITE_BASE_URL origin can never escape it. Rejects protocol-relative (//evil),
// backslash tricks (/\evil), any scheme/host, and control chars. '' means "no return_to" (use the signup default).
export function safeReturnTo(v) {
  if (typeof v !== 'string' || v.length === 0 || v.length > 512) return '';
  if (v[0] !== '/') return '';                 // must be root-relative (rejects https://evil, scheme:/…)
  if (v[1] === '/' || v[1] === '\\') return ''; // rejects //evil and /\evil (protocol-relative / backslash)
  if (/[\\\x00-\x1f\x7f]/.test(v)) return '';   // no backslash or control chars anywhere
  return v;
}
