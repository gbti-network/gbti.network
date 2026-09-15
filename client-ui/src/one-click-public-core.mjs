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
 * sow-323 Phase 3: THIS CONTROL NO LONGER EDITS THE FILE. It calls the editorial approval route, and the
 * Worker rebuilds the item.
 *
 * The editor version wrote `visibility: public` into the frontmatter it was about to submit, and that carried
 * three faults it had no way to fix from here. It left `publicStub` beside `public`, which the content check
 * refuses and the merge gate does not wait for, so the pull request merged and turned main red. It left the
 * encrypted body file behind, orphaned, with nothing pointing at it. And submitting the whole frontmatter
 * restamped the dates, against the owner's rule that an approved item keeps its original date.
 *
 * Only the Worker can do this properly, because only the Worker holds the content key: it decrypts the
 * members-only body, puts the item back together, re-encrypts a section the author marked members-only, and
 * commits the whole thing in one go. So this file now owns only the CONFIRMATION COPY and the request shape.
 */
export function makePublicRequest(itemPath) {
  const path = typeof itemPath === 'string' ? itemPath.trim() : '';
  return path ? { path, decision: 'approve' } : null;
}

/** The confirmation a superadmin reads before the approval. Named here so the copy is testable with the rule. */
export function makePublicPrompt(title) {
  const name = typeof title === 'string' && title.trim() ? `"${title.trim()}"` : 'this item';
  return `Approve ${name} for the public site? It goes live within a few minutes, and its author is told.`;
}

// ---- sow-323: the AUDIENCE control in the editor's Details rail -----------------------------------------------
//
// The owner collapsed the two paid plans on 2026-09-12 and made the audience the thing a superadmin decides:
// every member item starts members-only, and a superadmin approves what becomes public. So the Public / Members
// switch is no longer a free choice for most authors, and offering it to them would be a lie the Worker then
// refuses (pathsNeedingApproval in membership/hosted-author.mjs).
//
// THE CASE THAT MATTERS MOST IS THE THIRD ONE, and it is a trap rather than a feature. An item ALREADY public
// must keep submitting `visibility: public`, because the editor submits the whole frontmatter on every save. If
// its author edited an approved article while the control was locked to members, their own typo fix would take
// the live page down. The Worker admits an already-public path for exactly this reason; the editor has to agree
// with it or the two halves disagree in the direction that loses the author their page.
//
// An affordance, never the boundary: the Worker re-reads the submitted frontmatter and the state of main.

/** The states the audience control can render in. */
export const AUDIENCE_MODES = Object.freeze(['switch', 'locked-public', 'locked-members']);

/**
 * How should the audience control render, and what should it say?
 *
 * @param paidTier           the viewer's paid tier ('member' | 'creator' | ...), from client.status()
 * @param isSuperadmin       whether the Author rail resolved, which only a superadmin's adapter does
 * @param currentVisibility  the item's CURRENT visibility, from the loaded preset
 * @param existing           whether this item already exists in the repository (itemPath is set)
 * @returns { mode, value, note, publicStub }  `value` is what the hidden visibility input must submit. `publicStub`
 *          is what a LOCKED control submits for the locked page (undefined in switch mode, where the author's own
 *          toggle decides).
 */
export function audienceControl({ paidTier = null, isSuperadmin = false, currentVisibility = null, existing = false } = {}) {
  const vis = String(currentVisibility ?? '') === 'members' ? 'members' : 'public';
  // A trusted author (the silently granted tier) and a superadmin choose freely. meetsTier is not used here on
  // purpose: this compares the exact string, so an absent or unresolvable tier falls through to the locked
  // states rather than unlocking the switch. That is the safe direction for an affordance whose server side
  // refuses anyway, and it is the same disposition the share composer's nudge takes.
  if (isSuperadmin || paidTier === 'creator') {
    return { mode: 'switch', value: vis, note: '' };
  }
  if (existing && vis === 'public') {
    return {
      mode: 'locked-public',
      value: 'public',
      note: 'This is public, approved by a superadmin. Your edits stay public.',
      // A public item never carries the locked-page flag: the content check refuses the two together.
      publicStub: false,
    };
  }
  return {
    mode: 'locked-members',
    value: 'members',
    note: 'Members read this as soon as you publish. A superadmin reviews it before it appears on the public site.',
    // sow-323 Phase 3: the item KEEPS ITS OWN PAGE while it waits (owner, 2026-09-12: members read it there, a
    // signed-out visitor sees the locked card, and the superadmin approves from it). The locked control used to
    // submit no flag at all, so every member item was saved with no page, and an edit stripped the page from one
    // that had it.
    publicStub: true,
  };
}
