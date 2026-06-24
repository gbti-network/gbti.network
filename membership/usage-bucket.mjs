// SOW-061: the effective TIER bucket for extension usage analytics, derived with the SAME precedence as the real
// access gate (ban > staff > grandfather > Stripe) via `effectiveStatus`, so an analytics cohort can NEVER drift
// from the access decision. Pure + node-free + PII-FREE: a github_id is used ONLY to look up overrides; the return
// is ONLY a tier string (never an id/login/anything joinable). Consumed by workers/signup/analytics.mjs (P2).

import { effectiveStatus, bansFromParsed, rolesFromParsed, grandfathersFromParsed } from './overrides-core.mjs';

// The CLOSED analytics event vocabulary. A value outside this set is never recorded (recordUsage drops it), so a
// typo can never create a junk dimension / unbounded cardinality.
export const USAGE_EVENTS = Object.freeze([
  'status_check', 'news_view', 'save', 'follow', 'browse_activity', 'publish_attempt',
]);

// The CLOSED tier vocabulary. 'paid'=member, 'trialing'=trial, 'expired'=expired-trial, 'cancelled'=retired-member,
// 'none'=non-member, plus 'banned', 'anonymous' (no/invalid token) and 'unknown' (the oracle-error sentinel) so an
// outage or a ban is never silently miscounted as a real tier.
export const USAGE_BUCKETS = Object.freeze([
  'paid', 'trialing', 'expired', 'cancelled', 'none', 'banned', 'anonymous', 'unknown',
]);

const STRIPE_DERIVED = new Set(['paid', 'trialing', 'expired', 'cancelled', 'none', 'unknown']);
const KNOWN_BUCKET = new Set(USAGE_BUCKETS);

/** True iff `e` is in the closed event vocabulary, so recordUsage can drop anything else (no junk dimensions). */
export function isUsageEvent(e) {
  return USAGE_EVENTS.includes(e);
}

/**
 * Build the { bans, roles, grandfathers } override Maps from the reconcile-written overrides mirror, using the EXACT
 * same shape the gate's resolveEffective consumes (mirror.bans / mirror.roles / mirror.grandfathered). Returns null
 * when the mirror is missing or a section is absent, so the caller falls back to the Stripe-derived bucket.
 */
export function overridesFromMirror(mirror) {
  if (!mirror || typeof mirror !== 'object') return null;
  const { bans, roles, grandfathered } = mirror;
  if (bans == null || roles == null || grandfathered == null) return null;
  return {
    bans: bansFromParsed(bans),
    roles: rolesFromParsed(roles),
    grandfathers: grandfathersFromParsed(grandfathered),
  };
}

/**
 * The analytics tier bucket. `derived` is the Stripe-derived status (paid|trialing|expired|cancelled|none|unknown).
 *   - no github_id (anonymous / invalid token)            -> 'anonymous'
 *   - with overrides -> effectiveStatus precedence: ban -> 'banned', staff/grandfather -> 'paid', else Stripe
 *   - without overrides (mirror unavailable)              -> the Stripe-derived status, falling back to 'unknown'
 * The result is always one of USAGE_BUCKETS.
 */
export function usageBucket(derived, { githubId = null, overrides = null, now } = {}) {
  if (!githubId) return 'anonymous';
  const base = STRIPE_DERIVED.has(derived) ? derived : 'unknown';
  if (!overrides) return base;
  const eff = effectiveStatus(githubId, base, overrides, now ?? new Date());
  return KNOWN_BUCKET.has(eff.status) ? eff.status : 'unknown';
}
