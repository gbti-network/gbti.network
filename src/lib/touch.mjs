// SOW-059 P1b: pre-signup touch-capture config + pure helpers, shared by the browser capture (TouchTracker.astro)
// and node tests (.mjs so `node --test` can import it). The CLIENT capture is OFF by default
// (TOUCH_CAPTURE_ENABLED = false): the bundled TouchTracker script early-returns, so it is inert until the SOW-059
// model is activated (flip this to true AND rebuild AND set the Worker's own TOUCH_CAPTURE_ENABLED env flag). A
// CONTENT touch is consent-gated (it follows the analytics-consent decision in consent.mjs); the invite (?ref) is an
// essential referral signal and is always sent when capture is enabled (first-wins is enforced server-side).

export const TOUCH_CAPTURE_ENABLED = false; // flip to activate the client capture (also set the Worker env flag)
export const TOUCH_ENDPOINT = 'https://signup.gbti.network/touch';
export const TOUCH_SID_COOKIE = 'gbti_sid'; // a rotating, opaque, first-party session id (NOT a stable identifier)
export const TOUCH_SID_DAYS = 90; // the attribution window
export const TOUCH_TYPES = new Set(['post', 'product', 'prompt']);

/** Mint a rotating, opaque session id that matches the Worker's /^[A-Za-z0-9_-]{16,128}$/ rule: 24 random bytes
 *  base64url-encoded -> 32 url-safe chars. Pure; the caller supplies the randomness (crypto.getRandomValues). */
export function sessionIdFromBytes(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = (typeof btoa === 'function') ? btoa(bin) : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Shape-check a content-touch signal: a known type + an owner (the resolved member github_id; the house account
 *  does not earn, so it is dropped upstream by passing no owner) + a slug. */
export function validTouchSignal({ owner, type, slug } = {}) {
  return !!(owner && TOUCH_TYPES.has(type) && slug);
}
