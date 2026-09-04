// sow-293: the superadmin "make this public" control on the content edit page.
//
// Owner request, 2026-08-29: "Superadmins can one-click make content public from the content edit page."
// Owner answer 5 settles the MECHANISM: a pull request that rewrites the item's `visibility` frontmatter,
// with optimistic UI, NOT a KV override. Public content is editorial content and git stays canonical for it;
// a KV override would split the source of truth for what is public.
//
// This module is the DECISION only: may the control appear, and what does it say. It is extracted rather than
// left inline for the reason share-post-core.mjs, tier-cta.mjs and member-stream.mjs all record: a rule inside
// a component script is unreachable from `node --test`, and this project has been bitten by that four times.
//
// THE CONTROL IS AN AFFORDANCE, NEVER THE BOUNDARY. The Worker re-verifies the caller with authorizeSuperadmin
// on every publish, and the SOW-005 merge gate is the backstop behind that. Everything here decides what a
// superadmin SEES, so the worst a wrong answer causes is a control that should not be on screen, and the
// write behind it still refuses.

/** The states the control can be in. */
export const ONE_CLICK_STATES = Object.freeze(['hidden', 'available', 'already-public']);

/**
 * Should the "make public" control render, and in what state?
 *
 * @param isSuperadmin  whether the viewer is a superadmin. The editor already establishes this by probing
 *                      `client.authorTargets()`, which only ever succeeds for one (see gbti-content-editor).
 * @param visibility    the item's CURRENT visibility, as stored.
 * @param itemPath      the item's repo path. Absent means an unsaved or brand-new item.
 * @returns one of ONE_CLICK_STATES.
 */
export function oneClickPublicView({ isSuperadmin = false, visibility = null, itemPath = null } = {}) {
  // FAIL CLOSED ON THE ROLE. An unresolved superadmin probe (the capability is missing, the host has not
  // wired it, the call threw) is NOT a superadmin. This is the only clause where the safe direction is
  // obvious, and it is the one that matters.
  if (isSuperadmin !== true) return 'hidden';

  // Nothing to flip. A new item that has never been saved has no frontmatter to rewrite and no path to open a
  // pull request against; the author sets visibility in the form instead.
  if (typeof itemPath !== 'string' || !itemPath.trim()) return 'hidden';

  // Already public: report it rather than hiding, so a superadmin can tell "this control does not apply here"
  // apart from "this control did not load". A silently absent control reads as a bug.
  if (visibility === 'public') return 'already-public';

  // Everything else, INCLUDING an unresolved visibility, offers the control. This is deliberately not
  // fail-closed, and the asymmetry with the role check is the point: an unknown ROLE is a permission question
  // and must deny, while an unknown VISIBILITY is not. The worst case here is a superadmin opening a pull
  // request that sets `public` on something already public, which is a no-op diff, not an escalation.
  return 'available';
}

/**
 * The frontmatter change this control makes. ONE field, named once, so the caller cannot widen it by accident.
 *
 * It deliberately returns a patch rather than a whole frontmatter object: handing back a full object invites a
 * caller to spread it over the stored one and quietly carry along whatever else was in scope. A superadmin
 * making something public changes its visibility and nothing else.
 */
export function makePublicPatch() {
  return { visibility: 'public' };
}

/** The confirmation a superadmin reads before the write. Named here so the copy is testable with the rule. */
export function makePublicPrompt(title) {
  const name = typeof title === 'string' && title.trim() ? `"${title.trim()}"` : 'this item';
  return `Make ${name} public? This opens a pull request changing its visibility, and it goes live on the next deploy.`;
}
