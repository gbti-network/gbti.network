// SOW-059 P1c: the pure CONVERSION SNAPSHOT composer. At conversion, FREEZE the attribution: resolve the visitor's
// touch record (member-touches) into the first/last-touch owners + items + invite, tally the qualifying collaboration
// points from the supplied events, and emit the inputs distributeSnapshot (revenue-model) consumes at payout. Pure +
// side-effect-free. The IO layers wrap this: reading the touch record at conversion (workers/signup), gathering the
// collaboration events from git, PERSISTING the frozen snapshot, and the eligibility-filtered payout. The snapshot is
// frozen ONCE (it pins firstOwner/lastOwner/points/inviter at the conversion instant) and never recomputed; only the
// eligibility filter is re-applied at payout, so a later ban/refund changes who is PAID, never the frozen attribution.
import { toTouchLog } from './member-touches.mjs';
import { resolveTouches, qualifyingCollaboration } from './revenue-model.mjs';

/**
 * Freeze the attribution snapshot at conversion.
 * @param {object}   a
 * @param {object}   a.touchRecord         the visitor's normalized touch record (member-touches: { items, invite })
 * @param {number}   a.conversionAt        the conversion instant (epoch ms)
 * @param {number}   a.windowMs            the attribution window (90 days)
 * @param {Array}    [a.collaborationEvents] [{ member, item:{owner,type,slug}, kind, at, authorIntro? }] on candidate items
 * @param {string}   [a.inviter]           override the invite code (defaults to touchRecord.invite); the ?ref github_id
 * @returns {{ firstOwner, lastOwner, firstItem, lastItem, points, inviter, conversionAt, windowMs }} the frozen snapshot
 */
export function freezeSnapshot({ touchRecord, conversionAt, windowMs, collaborationEvents = [], inviter = null } = {}) {
  const log = toTouchLog(touchRecord);
  const { firstTouch, lastTouch } = resolveTouches(log, { conversionAt, windowMs });
  const points = qualifyingCollaboration({ firstTouch, lastTouch, events: collaborationEvents, conversionAt });
  const item = (t) => (t ? { owner: t.owner, type: t.type, slug: t.slug } : null);
  return {
    firstOwner: firstTouch ? firstTouch.owner : null,
    lastOwner: lastTouch ? lastTouch.owner : null,
    firstItem: item(firstTouch),
    lastItem: item(lastTouch),
    points,
    // The invite is the inviter's github_id captured from ?ref (same keyspace as the touch owners), so the
    // no-double-dip check in computeDistribution (inviter === firstOwner || lastOwner) compares like for like.
    inviter: (inviter != null ? inviter : (touchRecord && touchRecord.invite)) || null,
    conversionAt,
    windowMs,
  };
}
