// sow-343: where a completed website sign-in lands. Kept out of index.mjs (over the size cap) and free of imports,
// so the caller validates the return path first (oauth-state.mjs safeReturnTo) and this only decides.

// sow-427 (owner decision 6, 2026-09-30): a new account that signed in from a prepared-listing invitation lands on
// its claim page FIRST, and meets the welcome steps straight after. Matched as the whole return path, anchored at both
// ends, so it cannot widen into "any return path skips the welcome": one query parameter, an invitation code in the
// coupon alphabet, nothing else. `welcome=1` tells the page the account is new; forged, it only chooses a later
// hand-off to /welcome/, so it grants nothing.
const CLAIM_RETURN = /^\/claim\/\?code=[A-Z0-9]{3,32}$/;

/**
 * sow-343: where a completed website sign-in lands, as a same-site path.
 *
 * A NEW account meets the welcome steps first (owner decision 2026-09-16), carrying where it was headed as `next`
 * so the welcome page can send it on. The exceptions are a sign-in headed to checkout (/membership/), which keeps
 * its destination: the person came to pay, and the WorkBench card will ask about setup later; and (sow-427) a
 * sign-in headed to a prepared-listing claim page, which keeps it and gains `&welcome=1`.
 *
 * A RETURNING account lands where it was headed, or on /account/. It used to land on /welcome/ whenever no return
 * path was carried (the invite pages carry none), so a returning member arriving that way was walked through the
 * welcome steps again; the WorkBench card covers unfinished setup for them now. `created` is signup's own answer.
 */
export function signinLanding({ created, returnTo = '' } = {}) {
  const rt = typeof returnTo === 'string' ? returnTo : ''; // already validated by the caller (safeReturnTo)
  if (created !== true) return rt || '/account/';
  if (/^\/membership(\/|\?|#|$)/.test(rt)) return rt;
  if (CLAIM_RETURN.test(rt)) return `${rt}&welcome=1`;
  if (!rt || rt === '/account/' || /^\/welcome(\/|\?|#|$)/.test(rt)) return '/welcome/';
  return `/welcome/?next=${encodeURIComponent(rt)}`;
}
