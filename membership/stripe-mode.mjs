// sow-314 follow-up: say which Stripe MODE a number came from, wherever a member count is reported.
//
// WHY THIS EXISTS, AND IT IS A MEASURED FAILURE RATHER THAN A PRECAUTION.
//
// The operator holds two TEST Stripe keys and one LIVE one, and `STRIPE_SECRET_KEY` is the variable name used
// by both the local `.env` and the CI secret. On 2026-09-07 a session ran reconcile locally, walked Stripe
// TEST mode, found 2 customers where production has 26, and reported that 22 grandfathered members had no
// Stripe Customer and could not be reached by email or by calendar invitation. All of it was false. The same
// wrong figure was then "confirmed" by three further scripts, every one of them reading the same variable, so
// the agreement between them carried no information at all.
//
// Nothing in the output said which mode produced the number, so there was nothing to notice. The error was
// caught by the owner remembering that the work had been done, which is not a control.
//
// THE FIX IS DELIBERATELY NOT A REFUSAL. A test-mode run is legitimate and useful; what is not acceptable is a
// member population reported without saying which world it came from. So this labels rather than blocks, and
// the label goes next to the COUNT, because that is the sentence a reader acts on.

/** 'live', 'test', or 'unknown' when there is no key to judge. Never throws, never sees more than a prefix. */
export function stripeMode(key) {
  const k = typeof key === 'string' ? key.trim() : '';
  if (!k) return 'unknown';
  // Stripe encodes the mode in the key prefix: sk_live_/rk_live_ against sk_test_/rk_test_. Only the prefix is
  // ever inspected, so no part of the secret beyond its first characters is read, compared or returned.
  if (/^[a-z]{2}_live_/.test(k)) return 'live';
  if (/^[a-z]{2}_test_/.test(k)) return 'test';
  return 'unknown';
}

/**
 * The suffix to append to any reported member count.
 *
 * LIVE IS LABELLED TOO, and that is the point rather than an oversight. A label that appears only when
 * something is wrong trains readers to skim past its absence, and the absence is exactly what happened here.
 * A count that never says its mode and a count from the wrong mode look identical.
 */
export function stripeModeNote(key) {
  const mode = stripeMode(key);
  if (mode === 'live') return ' [stripe: LIVE]';
  if (mode === 'test') return ' [stripe: TEST MODE, this is NOT your real membership]';
  return ' [stripe: mode UNKNOWN, treat this count as unverified]';
}
