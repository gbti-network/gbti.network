// sow-480: is the account a prepared invitation is TIED to already a member?
//
// The claim page used to tell every invitee "The invitation comes with a free year". For someone who already pays
// that is false: signing in skips the coupon for a paying account (payingListingClaimant in signup.mjs), so no year
// is granted. The owner ruled on 2026-10-27 that an invitation assigned to an existing member does not carry the
// line. The admin route asks this module once, when a tied listing is saved, and stores the answer on the listing;
// the public read then leaves the free-year terms out, and the page already drops the line when they are absent.
//
// THE SAME RULE AS THE SIGN-IN SKIP, from the same parts: Stripe through deriveMembershipFromCustomer, then a fresh
// overrides mirror through effectiveStatus, so staff and grandfathered accounts count as members. readFreshOverrides
// lives here and signup.mjs imports it, so the two answers cannot drift apart.
//
// THREE ANSWERS, NEVER A THROW: true (a member), false (not one), null (could not tell). A null leaves the line
// showing, which is what every invitation did before this, so an unreadable Stripe or mirror can never take a real
// offer away from a genuine newcomer. Nothing here logs: the answer is about a person.

import { createStripeClient } from '../../clients/stripe.mjs';
import { deriveMembershipFromCustomer } from '../../membership/derive-status.mjs';
import { effectiveStatus } from '../../membership/overrides-core.mjs';
import { overridesFromMirror } from '../../membership/usage-bucket.mjs';
import { buildEnvPriceTierMap } from '../../membership/tier-gate.mjs';
import { GITHUB_ID_RE } from '../../membership/prepared-listings-shared.mjs';
import { OVERRIDES_KV_KEY, MAX_OVERRIDES_AGE_MS } from './membership-content.mjs';

/**
 * The overrides mirror folded for effectiveStatus, or null when it is absent, stale or malformed. A KV error THROWS,
 * so each caller keeps its own failure answer (resolveSignupRole's catch answers `locked`).
 */
export async function readFreshOverrides(kv, now) {
  const mirror = await kv?.get(OVERRIDES_KV_KEY, 'json');
  if (!mirror?.generatedAt) return null;
  const ageMs = now.getTime() - new Date(mirror.generatedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > MAX_OVERRIDES_AGE_MS) return null;
  return overridesFromMirror(mirror);
}

/**
 * true when `githubId` is a member now (Stripe paid, staff or grandfathered), false when both sources were read and
 * say not (or banned), null when either source could not be read and the other did not settle it. `stripe` may be
 * injected (tests); otherwise one is built from STRIPE_SECRET_KEY, and its absence means Stripe could not be read.
 */
export async function recipientIsMember({ env = {}, kv = env?.SIGNUP_KV, githubId, now = new Date(), stripe } = {}) {
  const id = String(githubId ?? '');
  if (!GITHUB_ID_RE.test(id)) return null;

  let derived = null; // the Stripe status, or null when Stripe could not be read
  try {
    const client = stripe !== undefined ? stripe : (env?.STRIPE_SECRET_KEY ? createStripeClient({ apiKey: env.STRIPE_SECRET_KEY }) : null);
    if (client) {
      const customer = await client.searchCustomerByGithubId(id);
      derived = deriveMembershipFromCustomer(customer, { priceTierMap: buildEnvPriceTierMap(env), now }).status;
    }
  } catch { derived = null; }

  let overrides = null;
  try { overrides = await readFreshOverrides(kv, now); } catch { overrides = null; }
  // The mirror goes first when it can be read, because effectiveStatus applies the real precedence (a ban outranks
  // paying, then staff, then a grant, then Stripe). Without it, a paying Stripe customer is still a member.
  if (overrides) {
    const eff = effectiveStatus(id, derived ?? 'none', overrides, now);
    if (eff.status === 'banned') return false;
    if (eff.status === 'paid') return true;
  } else if (derived === 'paid') {
    return true;
  }
  // Not a member by either source that answered. Only a definite no from BOTH is a false.
  return derived !== null && overrides ? false : null;
}
