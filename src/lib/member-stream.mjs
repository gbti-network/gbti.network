// sow-312: who may see the members-only Shares stream.
//
// THREE SURFACES ASK THIS QUESTION and they must not drift: the Worker's `/membership/shares` route
// (READ_MEMBERS in workers/signup/membership-shares.mjs), the /account hub, and the shares feed view. The
// Worker is the BOUNDARY; the two website surfaces are affordances that decide what to render. Drift between
// them does not leak anything (the route gates server-side either way), it just shows somebody the wrong UI:
// a paid member told to "join to see them", or an empty stream shell for a free reader.
//
// It lives here rather than in a component script because a rule inside an .astro script is unreachable from
// `node --test`, which is the same reason share-post-core.mjs and tier-cta.mjs exist. The test beside this
// reads the Worker's set and asserts the two agree, so a change on either side fails rather than drifting.

/**
 * The membership states that may READ the members-only stream. Trial is included deliberately: a trial may
 * READ the community stream even though POSTING is paid-only (the tier table, CLAUDE.md).
 */
export const MEMBER_STREAM_STATES = Object.freeze(['paid', 'trialing']);

/**
 * May this member signal see the members-only stream?
 *
 * FAIL CLOSED: an absent signal, an unresolved membership, or any state outside the set above resolves to
 * false, which shows the locked count card. That is the narrow direction, and it is the right one here
 * because the alternative renders an empty stream shell to somebody who cannot load it.
 */
export function canReadMemberStream(signal) {
  const membership = signal && typeof signal === 'object' ? signal.membership : signal;
  return MEMBER_STREAM_STATES.includes(membership);
}
