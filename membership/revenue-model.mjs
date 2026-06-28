// SOW-059: the PURE core of the SIMPLIFIED revenue model (the spec is .data/ops/revenue-ops/README.md). Replaces
// the link-based, owner-delegated model (SOW-007/008). Touch-based + fixed + automatic, frozen at conversion:
//   first-touch owner 30% + last-touch owner 10% (40% if the same item is both) + a fixed 5% collaboration pool
//   (split evenly across qualifying points) + a SEPARATE 10% manual-invite lane (paid from the retained share, no
//   double-dip) + the remainder retained by the platform/community (55% with no invite paid, 45% when it is).
//
// Node-free + side-effect-free (callers inject `now`), so it runs in the Worker, the payout job, and node tests.
// This module computes the SPLIT only; capturing touches, storing them (consent-gated + deletable, SOW-024),
// freezing the snapshot at conversion, the hold period, and the Stripe Connect transfers are the IO layers around it.
//
// ELIGIBILITY-AT-PAYOUT is the CALLER's job: pass only eligible owners + inviter (null if ineligible at payout)
// and only eligible collaboration points. An unpaid/ineligible share then falls into `retainedPct` automatically
// (retained = 100 - everything actually paid out), matching the README's "unpaid ineligible shares return to
// the platform/community retained share" + "the unused collaboration pool returns to retained".

export const FIRST_TOUCH_PCT = 30;
export const LAST_TOUCH_PCT = 10;
export const COLLAB_POOL_PCT = 5;
export const INVITE_PCT = 10; // SOW-059: the manual invite lane, paid from the retained share, no double-dip

/**
 * Resolve the first + last touch from a visitor's touch log within the attribution window. `touches` is a list of
 * eligible member-owned touches [{ owner, type, slug, at }] (at = epoch ms). Returns { firstTouch, lastTouch }
 * (each the touch object or null). Both are drawn from touches inside [conversionAt - windowMs, conversionAt]:
 * the EARLIEST in-window touch is the first touch (an earlier touch that has expired out of the window does not
 * count), the LATEST in-window touch before conversion is the last touch.
 */
export function resolveTouches(touches, { conversionAt, windowMs }) {
  const lo = conversionAt - windowMs;
  // Strictly BEFORE conversion (the spec: "the last touch must occur before the conversion event"), and inside the
  // window. A touch exactly at the conversion instant does not count.
  const inWindow = (Array.isArray(touches) ? touches : [])
    .filter((t) => t && Number.isFinite(t.at) && t.at < conversionAt && t.at >= lo)
    .sort((a, b) => a.at - b.at);
  if (!inWindow.length) return { firstTouch: null, lastTouch: null };
  return { firstTouch: inWindow[0], lastTouch: inWindow[inWindow.length - 1] };
}

const sameItem = (a, b) => a && b && a.owner === b.owner && a.type === b.type && a.slug === b.slug;

/**
 * Tally qualifying collaboration POINTS from comments + contributions on the first/last-touch items. `events` is
 * [{ member, item:{owner,type,slug}, kind:'comment'|'contribution', at, authorIntro? }]. A point qualifies when:
 * the item is the first-touch OR last-touch item; the actor is NOT that item's owner (self-comments/self-edits and
 * the author-intro never count); and it happened strictly before conversion. Returns [{ member, points }] (a
 * member may earn several). All qualifying contributions and comments count equally as 1 point each.
 */
export function qualifyingCollaboration({ firstTouch, lastTouch, events = [], conversionAt }) {
  const counts = new Map();
  for (const e of events) {
    if (!e || !e.item || !e.member) continue;
    if (!(sameItem(e.item, firstTouch) || sameItem(e.item, lastTouch))) continue; // only the two touch items
    if (e.member === e.item.owner) continue; // self-comment / self-edit / author-intro never qualifies
    if (e.authorIntro) continue; // belt and suspenders (an author-intro is always a self-comment anyway)
    if (!Number.isFinite(e.at) || e.at >= conversionAt) continue; // must be before conversion
    counts.set(e.member, (counts.get(e.member) || 0) + 1);
  }
  return [...counts.entries()].map(([member, points]) => ({ member, points }));
}

/**
 * Compute the fixed distribution from the (eligibility-filtered) snapshot inputs. `firstOwner`/`lastOwner` are
 * member ids (null when absent or ineligible at payout); `points` is [{ member, points }] of ELIGIBLE collaboration
 * points. Returns { shares: { <member>: pct }, retainedPct, collaborationUsedPct }. Percentages are exact (not
 * rounded); money rounding happens at the transfer layer. The shares + retained always sum to 100.
 */
export function computeDistribution({ firstOwner = null, lastOwner = null, points = [], inviter = null } = {}) {
  const shares = {};
  const add = (member, pct) => { if (member && pct > 0) shares[member] = (shares[member] || 0) + pct; };

  add(firstOwner, FIRST_TOUCH_PCT);
  add(lastOwner, LAST_TOUCH_PCT); // when lastOwner === firstOwner, they accumulate to 40

  // Only well-formed points participate (a member + a FINITE POSITIVE count). This rejects null/missing entries, a
  // null/non-array `points`, and Infinity/NaN/negative counts that would otherwise crash the loop or poison the math.
  const valid = (Array.isArray(points) ? points : []).filter((p) => p && p.member && Number.isFinite(Number(p.points)) && Number(p.points) > 0);
  const totalPoints = valid.reduce((n, p) => n + Number(p.points), 0);
  if (totalPoints > 0) {
    const perPoint = COLLAB_POOL_PCT / totalPoints; // 1 point -> full 5%; N points -> even split
    for (const p of valid) add(p.member, perPoint * Number(p.points));
  }
  // The pool is fully distributed whenever there is at least one valid point (exactly 5), else it returns to
  // retained. Derived (not accumulated) so it is exact and never NaN.
  const collaborationUsedPct = totalPoints > 0 ? COLLAB_POOL_PCT : 0;

  // SOW-059 manual invite lane: a flat 10% paid from the RETAINED share (it is added to the inviter, so retained =
  // 100 - paid absorbs it; content shares are never reduced). NO DOUBLE-DIP: it pays ONLY when the inviter earns no
  // CONTENT share on this conversion (not the first-touch owner and not the last-touch owner). A member who invited
  // a visitor to their own content therefore earns the larger 30/40 content share, never also the 10% invite. A
  // COLLABORATION share does NOT block the invite (commenting on or improving an item is separate from owning the
  // touch). `firstOwner`/`lastOwner` here are the ACTUAL-earning owners (null when absent / ineligible / Mode A), so
  // an inviter whose own content earned nothing still gets the invite. The caller passes inviter=null if ineligible.
  const inviterEarnsContent = !!inviter && (inviter === firstOwner || inviter === lastOwner);
  const invitePaid = !!inviter && !inviterEarnsContent;
  if (invitePaid) add(inviter, INVITE_PCT);

  const paid = Object.values(shares).reduce((n, v) => n + v, 0);
  // Retained absorbs: the 55% base, the unused collaboration pool (no eligible points), any owner share whose owner
  // was ineligible at payout (passed as null), and the invite lane when it does NOT pay. retained = 100 - paid out.
  return { shares, retainedPct: 100 - paid, collaborationUsedPct, invitePaidPct: invitePaid ? INVITE_PCT : 0 };
}

/**
 * Convenience: a full resolution from the frozen snapshot. `eligible(member) -> bool` is applied at payout time
 * (an ineligible owner's share falls to retained; an ineligible collaborator's point is dropped, re-splitting the
 * pool across the survivors). Returns the computeDistribution result.
 */
export function distributeSnapshot({ firstOwner = null, lastOwner = null, points = [], inviter = null } = {}, { eligible = () => true } = {}) {
  return computeDistribution({
    firstOwner: firstOwner && eligible(firstOwner) ? firstOwner : null,
    lastOwner: lastOwner && eligible(lastOwner) ? lastOwner : null,
    points: (Array.isArray(points) ? points : []).filter((p) => p && eligible(p.member)),
    inviter: inviter && eligible(inviter) ? inviter : null,
  });
}
