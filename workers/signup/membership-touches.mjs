// SOW-059 P1b: the pre-signup TOUCH-CAPTURE endpoint. ANONYMOUS: a rotating opaque session id keys the record (NOT a
// GitHub token), so it captures a not-yet-signed-in visitor's content touches + an optional invite code, stored in
// the deletable SIGNUP_KV record `touch:<session_id>` and read at conversion to freeze the distribution snapshot
// (membership/revenue-model.mjs). CONSENT-GATED: a content touch is recorded ONLY when the visitor has consented to
// attribution tracking (the pre-signup content-attribution GDPR surface, SOW-024); the invite code is an essential
// referral signal and is recorded regardless. DELETABLE: eraseTouches is a hard KV delete (right to erasure); the
// record also self-expires via a KV TTL set to the 90-day attribution window.
//
//   POST /touch  { session, touch?: { owner, type, slug }, invite?, consent? }  -> { ok }
//
// The pure transforms are membership/member-touches.mjs; this handler does only the session check + the KV
// read-modify-write, so it unit-tests with a fake KV (no network, no secrets). The route is gated by a deploy flag
// (TOUCH_CAPTURE_ENABLED) so it stays off until the SOW-059 model is activated; an anonymous writer also needs the
// signup Worker's abuse/rate-limit guard at the route (the capture is high-frequency + unauthenticated).

import { normalizeTouches, addTouch, setInvite, TouchError } from '../../membership/member-touches.mjs';

export const TOUCH_KEY = (session) => `touch:${session}`;
export const TOUCH_TTL_SECONDS = 90 * 24 * 60 * 60; // the attribution window; the record self-expires on top of DELETE

// A rotating, opaque, high-entropy session id (the client mints it; it is NOT a stable identifier).
const SESSION_RE = /^[A-Za-z0-9_-]{16,128}$/;

export async function handleTouch(request, env, { kv = env?.SIGNUP_KV, now = Date.now } = {}) {
  if (!kv) return { status: 500, body: { error: 'misconfigured', message: 'the touch store is not configured' } };
  if (request.method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } };

  let payload;
  try { payload = await request.json(); } catch { return { status: 400, body: { error: 'bad_request', message: 'a JSON body is required' } }; }
  const session = typeof payload?.session === 'string' ? payload.session.trim() : '';
  if (!SESSION_RE.test(session)) return { status: 400, body: { error: 'bad_request', message: 'a valid session id is required' } };

  const key = TOUCH_KEY(session);
  let rec = normalizeTouches(await kv.get(key, 'json'));
  let changed = false;

  // The invite code is an essential referral signal (first-wins); recorded regardless of consent.
  if (payload.invite) {
    try {
      const next = setInvite(rec, payload.invite, { now });
      if (next.invite !== rec.invite) { rec = next; changed = true; }
    } catch (err) { if (!(err instanceof TouchError)) throw err; /* a malformed invite is ignored, not fatal */ }
  }

  // A CONTENT touch is recorded ONLY with explicit consent (the pre-signup content-attribution GDPR surface).
  if (payload.touch != null) {
    if (payload.consent !== true) return { status: 200, body: { ok: true, recorded: false, reason: 'no_consent' } };
    try { rec = addTouch(rec, payload.touch, { now }); changed = true; }
    catch (err) { if (err instanceof TouchError) return { status: 400, body: { error: 'invalid', message: err.message } }; throw err; }
  }

  if (changed) await kv.put(key, JSON.stringify(rec), { expirationTtl: TOUCH_TTL_SECONDS });
  return { status: 200, body: { ok: true, recorded: changed } };
}

/** Read the frozen-snapshot inputs at conversion: the normalized touch record (its touch log feeds resolveTouches,
 *  its invite resolves to the inviting member). Returns an empty record for an unknown / missing session. */
export async function readTouches(env, session, { kv = env?.SIGNUP_KV } = {}) {
  if (!kv || !SESSION_RE.test(String(session || ''))) return normalizeTouches(null);
  return normalizeTouches(await kv.get(TOUCH_KEY(session), 'json'));
}

/** SOW-024 right-to-erasure: hard-delete a session's touch record. */
export async function eraseTouches(env, session, { kv = env?.SIGNUP_KV } = {}) {
  if (!kv || !session) return { ok: false };
  await kv.delete(TOUCH_KEY(String(session)));
  return { ok: true };
}
