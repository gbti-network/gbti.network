// sow-293: which call to action a membership tier card shows.
//
// Extracted from the inline script in src/components/membership/MembershipTiers.astro for the reason
// share-post-core.mjs records about the share composer: a decision inside a component script is unreachable
// from `node --test`, so the rule that matters most here had no way to be asserted. That rule is:
//
//   CONTENT CREATOR MUST NEVER REACH CHECKOUT.
//
// It became apply-only on 2026-08-29 and there is no price to check out against (owner answer 2: free on
// approval, priced later). A checkout hand-off for it would send a member to Stripe for a product that does
// not exist. The card is the only surface that offers it, so this function is where that is decided.
//
// Pure and node-free: no DOM, no fetch. The component renders whatever this returns.

/** The tier ladder, lowest first. Mirrors membership/tiers.mjs RANK without importing a Worker-side module. */
export const TIER_RANK = Object.freeze({ none: 0, member: 1, creator: 2 });

/** Where an application starts. One definition, so the card and the composer nudge cannot drift. */
export const CREATOR_APPLICATION_PATH = '/creator-application/';

/**
 * @param key       the card's tier key ('none' | 'member' | 'creator').
 * @param label     the card's display label, for the button text.
 * @param signedIn  whether a website session resolved.
 * @param myTier    the viewer's resolved paid tier, or 'none'/null when unresolved.
 * @returns `{ text, href, checkout, disabled, primary }`.
 *          `checkout` true means "hand off to Stripe for this tier"; `href` is a plain link. They are
 *          mutually exclusive, and `checkout` is NEVER true for creator.
 */
export function tierCta({ key, label = key, signedIn = false, myTier = 'none' } = {}) {
  const rank = TIER_RANK[key] ?? 99;
  const myRank = TIER_RANK[myTier] ?? 0;

  // The free card is a static "create a free account" link at every state.
  if (key === 'none') return { text: 'Create a free account', href: '/login/', checkout: false, disabled: false, primary: true };

  // Holding this tier, or a higher one, outranks everything below including the apply-only branch: somebody
  // who already IS a Content Creator must not be invited to apply for it.
  if (signedIn && myRank === rank) {
    return { text: 'Your current plan', href: null, checkout: false, disabled: true, primary: false };
  }
  if (signedIn && myRank > rank) {
    return {
      text: `Included in ${myTier === 'creator' ? 'Content Creator' : 'your plan'}`,
      href: null, checkout: false, disabled: true, primary: false,
    };
  }

  // sow-293: apply-only. Signed in or out, the answer is the application page, never a checkout. Signed-out
  // readers are sent there too rather than to /login/ first, because the intake page asks them to sign in
  // itself and explains why it needs to.
  if (key === 'creator') {
    return { text: `Apply to become a ${label}`, href: CREATOR_APPLICATION_PATH, checkout: false, disabled: false, primary: false };
  }

  if (signedIn) {
    return { text: myRank > 0 ? `Upgrade to ${label}` : `Join as ${label}`, href: null, checkout: true, disabled: false, primary: true };
  }
  // Signed out: create a free account, then return here pre-selected to finish checkout.
  return {
    text: `Join as ${label}`,
    href: `/login/?return_to=${encodeURIComponent(`/membership/?plan=${key}`)}`,
    checkout: false, disabled: false, primary: key === 'member',
  };
}
