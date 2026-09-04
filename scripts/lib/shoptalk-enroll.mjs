// sow-314: the PURE planning core for Shop Talk calendar enrollment. No IO, no clock, no crypto: members and
// the live guest list in, a plan out. The runner does the Stripe walk and the Google writes around it.
//
// Modeled on scripts/lib/mail-enroll.mjs (sow-166), which solved the same problem for the weekly digest, and
// which had already learned two of the three rules below the expensive way.
//
// WHAT IT IS FOR. The owner adds member addresses to the recurring Saturday event by hand so members can enter
// the Meet without knocking. This plans that automatically: paid and trial members are added, a lapse removes
// the seat.
//
// ============================================================================================
// THREE RULES. EACH NAMES SOMETHING THAT BREAKS, NOT A DESIGN PREFERENCE.
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
// ============================================================================================

/** Effective statuses that earn a seat on the call (owner, 2026-09-04: paid AND trial, not free, not lapsed).
 *
 *  `trialing` is the literal STATUS.trialing from membership/derive-status.mjs and the spelling matters: the
 *  word used in conversation is "trial", and a planner written against that spelling would match nobody, add
 *  nobody, and report a clean run every time. */
export const ELIGIBLE_STATUSES = Object.freeze(new Set(['paid', 'trialing']));

/** Why a member could not be given a seat. Per person, never a property of the run. */
export const SKIP_REASON = Object.freeze({
  NO_EMAIL: 'no email address anywhere in the system',
  OPTED_OUT: 'removed themselves from the call',
});

const idOf = (m) => String(m?.githubId ?? '').trim();
const statusOf = (m) => m?.effective?.status ?? null;

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
 * @returns {object} the plan
 */
export function planShoptalkEnrollment({ members = [], attendees = [], placed = new Map(), optedOut = new Set(), preferred = new Map() } = {}) {
  const plan = {
    add: [],           // eligible, has an address, not on the list yet
    remove: [],        // an address WE placed that no longer belongs to an eligible member
    alreadyOn: [],     // eligible and already present: the common case, and a no-op
    optedOut: [],      // eligible but self-removed. Never re-added. See rule 2.
    unreachable: [],   // eligible but no address exists anywhere. See rule 3.
    foreign: [],       // on the event, placed by somebody else. NEVER touched. See rule 1.
  };

  const onEvent = new Set();
  for (const a of Array.isArray(attendees) ? attendees : []) {
    const addr = normalizeAddress(a);
    if (addr) onEvent.add(addr);
  }

  // Addresses we placed that this pass has justified keeping. Anything left over is a removal.
  const keep = new Set();

  for (const m of members) {
    const githubId = idOf(m);
    if (!githubId) continue;

    // A member's preferred address (a linked Google account, proved by sign-in) wins over the GitHub one,
    // because Meet identifies a participant by the Google account they are signed into.
    const address = normalizeAddress(preferred.get(githubId) ?? m?.email);

    if (!ELIGIBLE_STATUSES.has(statusOf(m))) {
      // Not eligible. Their seat comes off IF WE PLACED IT, and only then. A banned or lapsed member whose
      // address the owner added by hand is the owner's business, not ours.
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

    plan.add.push({ ...who(m), address });
  }

  // Removal pass. Driven ONLY off `placed`, never off the event, which is rule 1 made structural rather than
  // remembered: there is no code path here that can reach an address this system did not record placing.
  for (const [address, ownerId] of placed) {
    const addr = normalizeAddress(address);
    if (!addr || keep.has(addr)) continue;
    if (!onEvent.has(addr)) continue; // already gone: nothing to remove, and a removal call would be a no-op
    plan.remove.push({ githubId: String(ownerId ?? ''), address: addr });
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
    optedOut: n('optedOut'),
    unreachable: n('unreachable'),
    foreign: n('foreign'),
    changes: n('add') + n('remove'),
  };
}
