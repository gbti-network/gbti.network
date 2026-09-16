// sow-343: where a completed website sign-in lands. Kept out of index.mjs (over the size cap) and free of imports,
// so the caller validates the return path first (index.mjs safeReturnTo) and this only decides.

/**
 * sow-343: where a completed website sign-in lands, as a same-site path.
 *
 * A NEW account meets the welcome steps first (owner decision 2026-09-16), carrying where it was headed as `next`
 * so the welcome page can send it on. The one exception is a sign-in headed to checkout (/membership/), which keeps
 * its destination: the person came to pay, and the WorkBench card will ask about setup later.
 *
 * A RETURNING account lands where it was headed, or on /account/. It used to land on /welcome/ whenever no return
 * path was carried (the invite pages carry none), so a returning member arriving that way was walked through the
 * welcome steps again; the WorkBench card covers unfinished setup for them now. `created` is signup's own answer.
 */
export function signinLanding({ created, returnTo = '' } = {}) {
  const rt = typeof returnTo === 'string' ? returnTo : ''; // already validated by the caller (safeReturnTo)
  if (created !== true) return rt || '/account/';
  if (/^\/membership(\/|\?|#|$)/.test(rt)) return rt;
  if (!rt || rt === '/account/' || /^\/welcome(\/|\?|#|$)/.test(rt)) return '/welcome/';
  return `/welcome/?next=${encodeURIComponent(rt)}`;
}
