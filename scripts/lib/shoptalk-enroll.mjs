// sow-314: the PURE planning core for Shop Talk calendar enrollment. No IO, no clock, no crypto: members and
// the live guest list in, a plan out. The runner does the Stripe walk and the Google writes around it.
//
// Modeled on scripts/lib/mail-enroll.mjs (sow-166), which solved the same problem for the weekly digest, and
// which had already learned two of the first three rules below the expensive way.
//
// WHAT IT IS FOR. The owner adds member addresses to the recurring Saturday event by hand so members can enter
// the Meet without knocking. This plans that automatically: paid and trial members are added, a lapse removes
// the seat.
//
// ============================================================================================
// FIVE RULES. EACH NAMES SOMETHING THAT BROKE, OR WOULD.
// ============================================================================================
//
// 1. NEVER REMOVE AN ATTENDEE WE DID NOT PLACE. The owner's calendar carries guests added by hand and may
//    carry people who are not members at all. A sweep that removes anything it cannot attribute would strip
//    every one of them on its FIRST REAL RUN, and a calendar removal mails an apparent cancellation to the
//    person removed. So removal is driven off `placed`, the record of what this system put there, and every
//    other attendee is reported as `foreign` and left alone. This is the sow-213 shape: a writer pointed at a
//    store it does not own.
//
// 2. A MEMBER WHO REMOVED THEMSELVES IS NEVER SWEPT BACK IN. membership/mail-suppress.mjs exists because the
//    digest backfill learned this, and its marker deliberately outlives the subscriber record so the check
//    has something to read. Without the equivalent here, "remove me" is undone by the next sweep and the
//    member gets a fresh invitation email within the hour, which reads as the site ignoring them.
//
// 3. UNREACHABLE IS A RESULT, NOT A SKIP. Override-only members (a grandfather grant with no Stripe Customer)
//    carry `email: null` at scripts/reconcile.mjs:488. There is no address for them in any store, so no
//    amount of retrying enrolls them. A silent skip is indistinguishable from success in every count the
//    owner reads, so they are returned BY NAME for the owner to handle person by person.
//
// 4. ABSENCE FROM THE ROSTER IS NOT A LAPSE. Learned on 2026-09-09: a targeted reconcile (the one-member run
//    a payment fires) handed this planner a roster of ONE, and the first version of the removal pass read
//    every other placed seat as "no longer belongs to an eligible member". Twenty-two members were mailed a
//    cancellation that night and a fresh invitation the next morning, and their RSVPs were reset. A seat now
//    comes off ONLY when its member is PRESENT in the roster and ineligible, or has opted out. A placed
//    address whose member is missing from the roster is left alone and reported as `unaccounted`, because a
//    short roster is a short read, not twenty-two lapses.
//
// 5. THE INVITATION GOES OUT ONCE (owner, 2026-09-10). Every member address the sweep has ever seen on the
//    guest list, or placed there, is remembered in `seen`. An address that has since left the event is NEVER
//    re-added by the sweep, whoever removed it: the owner by hand, a re-created series, a member deleting the
//    event. It is reported as `dropped`. Re-entry is the member's own act, the Rejoin button on the account
//    page, or the owner's hand. A lapse is the one exception: the sweep releases the address from `seen` when
//    it removes the seat itself, so a member who comes back after lapsing gets one fresh invitation.
//
// ============================================================================================

/** Effective statuses that earn a seat on the call (owner, 2026-09-04: paid AND trial, not free, not lapsed).
 *
 *  `trialing` is the literal STATUS.trialing from membership/derive-status.mjs and the spelling matters: the
 *  word used in conversation is "trial", and a planner written against that spelling would match nobody, add
 *  nobody, and report a clean run every time. */
export const ELIGIBLE_STATUSES = Object.freeze(new Set(['paid', 'trialing']));

/** Why a member could not be given a seat, or why a placed seat was left where it is. Per person. */
export const SKIP_REASON = Object.freeze({
  NO_EMAIL: 'no email address anywhere in the system',
  OPTED_OUT: 'removed themselves from the call',
  DROPPED: 'invited once already and since removed from the event; the sweep does not re-invite',
  UNACCOUNTED: 'not in this run\'s roster; absence is not a lapse, so the seat stays',
  STALE: 'the placed address is no longer the address on file; left alone rather than cancelled',
});

const idOf = (m) => String(m?.githubId ?? '').trim();
const statusOf = (m) => m?.effective?.status ?? null;
const eligible = (m) => ELIGIBLE_STATUSES.has(statusOf(m));

/** Lowercase and trim, the way Google compares attendee addresses. Anything else is not an address. */
export function normalizeAddress(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

/** The identifying fields carried into a report row. Deliberately carries the ADDRESS as well, unlike the mail
 *  planner: a calendar attendee IS an address, so a report that hides it cannot be acted on by the owner. */
function who(m) {
  return {
    githubId: idOf(m),
    githubLogin: m?.githubLogin ?? null,
    username: m?.username ?? null,
    status: statusOf(m),
  };
}

/**
 * Plan the guest list.
 *
 * @param {object[]} members    reconcile gather output (memberEntryFor / gatherOverrideOnlyMembers)
 * @param {string[]} attendees  the LIVE guest list read back from the event, as addresses
 * @param {Map} placed          normalized address -> githubId, the record of what THIS system put there
 * @param {Set} optedOut        githubIds that removed themselves. Keyed by member, not by address, so an
 *                              opt-out survives the member changing which address they use.
 * @param {Map} preferred       githubId -> address override (a linked Google account), when set
 * @param {Map} seen            normalized address -> githubId, every member address ever seen on the event
 *                              or placed there. Rule 5: an address in here is never added by the sweep.
 * @returns {object} the plan
 */
export function planShoptalkEnrollment({
  members = [], attendees = [], placed = new Map(), optedOut = new Set(), preferred = new Map(), seen = new Map(),
} = {}) {
  const plan = {
    add: [],           // eligible, has an address, never invited before, not on the list yet
    remove: [],        // an address WE placed whose member is PRESENT and no longer eligible, or opted out
    alreadyOn: [],     // eligible and already present: the common case, and a no-op
    dropped: [],       // eligible, invited before, since removed from the event. Never re-added. Rule 5.
    optedOut: [],      // eligible but self-removed. Never re-added. Rule 2.
    unreachable: [],   // eligible but no address exists anywhere. Rule 3.
    unaccounted: [],   // placed and on the event, but the member is not in this roster. Left alone. Rule 4.
    stale: [],         // placed and on the event, member present and eligible under a DIFFERENT address. Left alone.
    foreign: [],       // on the event, placed by somebody else. NEVER touched. Rule 1.
  };

  const onEvent = new Set();
  for (const a of Array.isArray(attendees) ? attendees : []) {
    const addr = normalizeAddress(a);
    if (addr) onEvent.add(addr);
  }

  const seenAddr = new Set();
  for (const a of seen instanceof Map ? seen.keys() : []) {
    const addr = normalizeAddress(a);
    if (addr) seenAddr.add(addr);
  }
  for (const a of placed instanceof Map ? placed.keys() : []) {
    const addr = normalizeAddress(a);
    if (addr) seenAddr.add(addr); // placed implies seen: the sweep put it there itself
  }

  // The roster by member, for the removal pass. Presence in it is what rule 4 turns on.
  const roster = new Map();
  for (const m of members) {
    const githubId = idOf(m);
    if (githubId) roster.set(githubId, m);
  }

  // Addresses we placed that this pass has justified keeping. Anything left over goes to the removal pass.
  const keep = new Set();

  for (const m of members) {
    const githubId = idOf(m);
    if (!githubId) continue;

    // A member's preferred address (a linked Google account, proved by sign-in) wins over the GitHub one,
    // because Meet identifies a participant by the Google account they are signed into.
    const address = normalizeAddress(preferred.get(githubId) ?? m?.email);

    if (!eligible(m)) {
      // Not eligible. Their seat comes off IF WE PLACED IT, and only then, in the removal pass below. A banned
      // or lapsed member whose address the owner added by hand is the owner's business, not ours.
      continue;
    }

    if (optedOut.has(githubId)) {
      plan.optedOut.push({ ...who(m), reason: SKIP_REASON.OPTED_OUT });
      continue; // and deliberately NOT added to `keep`, so a seat we placed before they opted out comes off
    }

    if (!address) {
      plan.unreachable.push({ ...who(m), reason: SKIP_REASON.NO_EMAIL });
      continue;
    }

    if (onEvent.has(address)) {
      plan.alreadyOn.push({ ...who(m), address });
      // Claim it so the removal pass does not treat it as an orphan. This is also what silently adopts the
      // people the owner already added by hand: they are on the event, they match a member, nothing happens.
      keep.add(address);
      continue;
    }

    if (seenAddr.has(address)) {
      // Rule 5. Invited once, gone now, and the sweep is not the one who gets to decide they come back.
      plan.dropped.push({ ...who(m), address, reason: SKIP_REASON.DROPPED });
      continue;
    }

    plan.add.push({ ...who(m), address });
  }

  // Removal pass. Driven ONLY off `placed`, never off the event (rule 1), and ONLY for a member this roster
  // can actually see (rule 4). There is no code path here that reaches an address this system did not record
  // placing, and none that removes a seat on the strength of a member being missing from a list.
  for (const [address, ownerId] of placed) {
    const addr = normalizeAddress(address);
    if (!addr || keep.has(addr)) continue;
    if (!onEvent.has(addr)) continue; // already gone: nothing to remove, and rule 5 keeps it gone
    const githubId = String(ownerId ?? '');
    const m = roster.get(githubId);
    if (!m) {
      plan.unaccounted.push({ githubId, address: addr, reason: SKIP_REASON.UNACCOUNTED });
      continue;
    }
    if (optedOut.has(githubId)) {
      // The Worker removes an opt-out at button time; this is the backstop for a calendar that was unreachable
      // then. The member asked for exactly this removal.
      plan.remove.push({ githubId, address: addr, why: 'opted-out' });
      continue;
    }
    if (!eligible(m)) {
      plan.remove.push({ githubId, address: addr, why: 'not-eligible', status: statusOf(m) });
      continue;
    }
    // Present, eligible, and the placed address is not the address the roster now carries for them. Their
    // address changed. Removing the old one mails a cancellation for a change of address, so it is left.
    plan.stale.push({ ...who(m), address: addr, reason: SKIP_REASON.STALE });
  }

  // Everything on the event that this system cannot account for. Reported so the owner can see what the sweep
  // is choosing not to touch, which is the only way rule 1 is visible rather than merely true.
  //
  // `keep` is subtracted deliberately: an address the owner added by hand that turns out to belong to a
  // current member has been ADOPTED, and it is already reported as alreadyOn. Listing it here as well would
  // count one guest in two buckets and make the report read as though the sweep were ignoring a member it is
  // in fact tracking.
  for (const addr of onEvent) {
    if (placed.has(addr) || keep.has(addr)) continue;
    plan.foreign.push({ address: addr });
  }

  return plan;
}

/** Flat counts for the reconcile summary line. `changes` is what a dry run reports as pending. */
export function enrollmentCounts(plan) {
  const p = plan ?? {};
  const n = (k) => (Array.isArray(p[k]) ? p[k].length : 0);
  return {
    add: n('add'),
    remove: n('remove'),
    alreadyOn: n('alreadyOn'),
    dropped: n('dropped'),
    optedOut: n('optedOut'),
    unreachable: n('unreachable'),
    unaccounted: n('unaccounted'),
    stale: n('stale'),
    foreign: n('foreign'),
    changes: n('add') + n('remove'),
  };
}
