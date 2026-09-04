// sow-312: who receives the MEMBERS edition of the weekly digest.
//
// The compile runs once for the whole subscriber base and cannot ask Stripe about each person, so reconcile
// publishes the answer instead: it already resolves everybody's effective membership on its daily sweep, so
// this is a projection of a list it is holding anyway, not a second source of truth.
//
// THE PREDICATE IS NOT RESTATED HERE. `canReadMemberStream` (src/lib/member-stream.mjs) already answers "may
// this person see member-only shares", and three surfaces read it: the Worker's shares route, the account hub
// and the shares feed. The digest is the fourth. Restating "paid or trialing" here would be a fourth copy of
// a rule that has to move together, and the whole reason that module exists is that it must not drift.
//
// FAIL CLOSED IN ONE DIRECTION ONLY, and it is worth being explicit about which. Every failure here means
// somebody receives the PUBLIC issue: no list, an unreadable list, a malformed entry, an unresolved status.
// The cost of that error is a member missing one week of share titles. The cost of the opposite error is a
// members-only share reaching an inbox that should not have it, which is not recoverable, so every ambiguity
// resolves the same way.
import { canReadMemberStream } from '../src/lib/member-stream.mjs';

/** The KV key reconcile writes and the mail compile reads. */
export const DIGEST_ENTITLED_KV_KEY = 'digest:entitled';

/**
 * Project reconcile's member list into the entitlement blob.
 *
 * Ids are strings and are SORTED, so an unchanged membership base produces a byte-identical blob and the
 * mirror write is a no-op diff rather than churn.
 */
export function buildDigestEntitlement(members, now = new Date()) {
  const ids = [];
  const seen = new Set();
  for (const m of Array.isArray(members) ? members : []) {
    const githubId = String(m?.githubId ?? '').trim();
    if (!githubId || seen.has(githubId)) continue;
    // `effective.status` is the ban > staff > grandfather > Stripe answer reconcile already computed. Reading
    // `derived` instead would hand the members edition to a banned member with a live subscription.
    if (!canReadMemberStream(m?.effective?.status)) continue;
    seen.add(githubId);
    ids.push(githubId);
  }
  ids.sort();
  return { generatedAt: (now instanceof Date ? now : new Date(now)).toISOString(), ids };
}

/**
 * The entitled set from an already-read blob. PURE, so the partition is unit-tested with plain objects.
 *
 * Anything unusable yields an EMPTY set, which sends everybody the public issue. That is deliberately not
 * distinguishable from "nobody is entitled": both are the safe answer, and a caller that tried to tell them
 * apart would be building a reason to proceed without the list.
 */
export function entitledIdsFrom(blob) {
  const ids = blob && typeof blob === 'object' && !Array.isArray(blob) ? blob.ids : null;
  if (!Array.isArray(ids)) return new Set();
  const out = new Set();
  for (const id of ids) {
    const s = typeof id === 'string' ? id.trim() : (typeof id === 'number' && Number.isFinite(id) ? String(id) : '');
    if (s) out.add(s);
  }
  return out;
}

/**
 * Does this subscriber record receive the members edition?
 *
 * AN ANONYMOUS SUBSCRIBER CANNOT REACH THIS SET BY CONSTRUCTION, not by a check. A member record is required
 * to carry `githubId` (mail-subscriber.mjs refuses to build one without it) and an anonymous record is
 * required NOT to, so an anon subscriber has nothing to match against. The test asserts it anyway, because
 * "by construction" is a claim about code that can change.
 */
export function subscriberIsEntitled(sub, entitledIds) {
  const gid = String(sub?.githubId ?? '').trim();
  if (!gid) return false;
  return entitledIds instanceof Set ? entitledIds.has(gid) : false;
}
