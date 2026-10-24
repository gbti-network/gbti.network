// SOW-166: the PURE planning core for the weekly-digest member backfill. No IO, no crypto, no Date.now()
// inside (callers inject `now`), so the whole decision surface is unit-testable with plain objects. The
// runner (scripts/mail-enroll.mjs) does the Stripe walk, the HMAC and the KV writes around these transforms.
//
// TWO BACKFILLS, ONE POPULATION WALK. Enrolment writes `mail:subscriber:<hash>`; the follow backfill writes
// `follows:<github_id>`. They are planned together because they answer the same question about the same
// people and a second enumeration is how two counts start disagreeing.
//
// POPULATION (owner, 2026-08-21): every Stripe Customer carrying a github_id, MINUS banned. Paid, trial,
// free and lapsed are all IN. Lapsed are deliberately in scope: they are the ones a digest wins back.
//
// AUTO-ENROLMENT IS THE APPROVED DESIGN (sow-166 questions 3 and 4, resolved 2026-08-16), and it is approved
// WITH A RIDER: the opt-out is not deferrable. That rider is enforced here rather than trusted, in the one
// way a planner can enforce it: a suppressed address is NEVER re-enrolled, so somebody who has already
// unsubscribed cannot be swept back in by a later run of this backfill. The marker outlives the record
// precisely so this check has something to read (membership/mail-suppress.mjs).
//
// WHY UNREACHABLE IS A FIRST-CLASS RESULT AND NOT A SKIP. Override-only members (grandfathered, no Stripe
// Customer) carry `email: null` from gatherOverrideOnlyMembers (scripts/lib/reconcile-members.mjs). There is
// no address for them ANYWHERE in the system, so they cannot be enrolled by any means, and no amount of
// retrying changes that. A silent skip would be indistinguishable from success in every count the owner
// reads. They are returned BY NAME so the owner can decide per person.

import { normalizeFollows, applyFollow, followingUsernames, normalizeUsername } from '../../membership/member-follows.mjs';

/**
 * The two house accounts every member is backfilled to follow (owner, 2026-08-21).
 *
 * `gbti-labs` IS NOT A USERNAME and writing it is the trap this constant exists to close. The folder is
 * `members/gbtilabs`. USERNAME_RE in member-follows.mjs permits internal hyphens, so `gbti-labs` VALIDATES,
 * stores clean, and then resolves against the activity index to nothing, forever. The failure is silent in
 * both directions: the write reports success and the feed reports an empty follow.
 */
export const HOUSE_FOLLOW_TARGETS = Object.freeze(['atwellpub', 'gbtilabs']);

/** Why a member has no mail identity. `no-email` is per person; `no-key` is the whole run. */
export const IDENTITY_REASON = Object.freeze({ OK: 'ok', NO_EMAIL: 'no-email', NO_KEY: 'no-key' });

const idOf = (m) => String(m?.githubId ?? '').trim();
const isBanned = (m) => m?.effective?.status === 'banned';

/** The person-identifying fields carried into a report row. Never an email address. */
function who(m) {
  return {
    githubId: idOf(m),
    githubLogin: m?.githubLogin ?? null,
    username: m?.username ?? null,
    status: m?.effective?.status ?? null,
    // Which gather produced this member. The two unreachable populations are DIFFERENT PROBLEMS with
    // different fixes, and lumping them together is how a report describes one and hides the other:
    //   'override-only' -> a grandfather grant with no Stripe Customer. No address was ever collected.
    //                      Nothing in this system can fix it; somebody has to ask the person.
    //   'stripe'        -> a real Customer whose email field is empty. That IS fixable in Stripe.
    // The first version of this report asserted "they are override-only" as static copy, which happened to
    // be true and would have gone on reading true if it stopped being so.
    gather: m?._gather ?? 'unknown',
  };
}

/**
 * Plan the subscriber backfill.
 *
 * @param {object[]} members      reconcile gather output (memberEntryFor / gatherOverrideOnlyMembers)
 * @param {Map} identities        githubId -> { hash: string|null, reason }
 * @param {Set} suppressed        hashes carrying a `mail:suppress:<hash>` marker
 * @param {Set} enrolled          hashes that ALREADY have a `mail:subscriber:<hash>` record
 * @param {Set} enrolledGithubIds github ids that already have a MEMBER record, under ANY hash (sow-472)
 * @returns {object} the plan; `blocked` is true when the run cannot write anything at all
 */
export function planMailEnrollment({ members = [], identities = new Map(), suppressed = new Set(), enrolled = new Set(), enrolledGithubIds = new Set() } = {}) {
  const plan = {
    enroll: [],
    alreadyEnrolled: [],
    suppressedSkips: [],
    unreachable: [],
    excludedBanned: [],
    blocked: false,
  };

  for (const m of members) {
    const githubId = idOf(m);
    if (!githubId) continue; // not a membership customer; the gather already filters these, belt and braces

    // A ban is a community ban and it is the one exclusion that happens before anything else is considered.
    // A banned account gets ZERO KV by the standing tier ruling, and a digest subscription is KV.
    if (isBanned(m)) { plan.excludedBanned.push(who(m)); continue; }

    // sow-472: ONE MEMBER, ONE RECORD, WHATEVER THEIR ADDRESS IS NOW. A record is keyed by the hash of the
    // address at the time it was written, and sign-in keeps the Stripe address current, so a member who changed
    // their GitHub email hashes to a NEW key while their record sits under the old one. Matching on the hash
    // alone then reads them as never enrolled, and a daily run would give them a second record (every issue
    // twice) or, if their record says `digestOff`, put them back on a digest they switched off. The record
    // carries githubId, so they are matched on that first. (An UNSUBSCRIBE leaves only a pseudonymous marker
    // under the old hash, so that case cannot be matched here; the run report counts the markers it could not
    // place, so the size of that blind spot is measured rather than assumed.)
    if (enrolledGithubIds.has(githubId)) { plan.alreadyEnrolled.push({ ...who(m), underEarlierAddress: true }); continue; }

    const ident = identities.get(githubId) ?? { hash: null, reason: IDENTITY_REASON.NO_EMAIL };

    // Recorded BEFORE the blocked check: a member with no address is unreachable whether or not a key is
    // configured, and the owner needs that list now rather than after provisioning.
    if (ident.reason === IDENTITY_REASON.NO_EMAIL) {
      plan.unreachable.push({ ...who(m), reason: 'no email address anywhere in the system' });
      continue;
    }

    if (ident.reason === IDENTITY_REASON.NO_KEY) {
      // MAIL_SUPPRESS_KEY is absent, so mailHash returns null and NO identity can be minted for anyone.
      // This is a property of the run, not of this member, so it stops the whole plan rather than
      // accumulating one indistinguishable "unreachable" row per member and looking like a data problem.
      plan.blocked = true;
      continue;
    }

    // Belt and braces: an identity map that omitted this member entirely, or handed back a blank hash under
    // an 'ok' reason, must still never become a subscriber record keyed on nothing.
    if (!ident.hash) { plan.unreachable.push({ ...who(m), reason: 'no email address anywhere in the system' }); continue; }

    // THE OPT-OUT RIDER, ENFORCED. Somebody who unsubscribed stays unsubscribed through a backfill.
    if (suppressed.has(ident.hash)) { plan.suppressedSkips.push({ ...who(m), hash: ident.hash }); continue; }

    // Idempotent: a second run of this backfill is a no-op rather than a rewrite, so re-running it after a
    // partial failure is safe and the counts stay meaningful.
    if (enrolled.has(ident.hash)) { plan.alreadyEnrolled.push({ ...who(m), hash: ident.hash }); continue; }

    plan.enroll.push({ ...who(m), hash: ident.hash });
  }

  return plan;
}

/**
 * Plan the follow backfill: the two house accounts into each member's `follows:<github_id>`.
 *
 * BACKFILL ONCE ONLY, NO AUTO-FOLLOW AT SIGNUP (owner, 2026-08-21, made against the router's recommendation
 * and recorded here so it is not "improved" later). The consequence is on the record: coverage decays from
 * the day this runs and nothing corrects it, because every member who joins afterwards has neither follow.
 *
 * A member who already follows a target keeps their existing entry untouched, including any `notify`
 * preference on it, since applyFollow is a no-op for a username already present.
 */
export function planFollowBackfill({ members = [], followsByGithubId = new Map(), followsUnreadable = new Set(), targets = HOUSE_FOLLOW_TARGETS, now = Date.now } = {}) {
  const plan = { writes: [], alreadyComplete: [], excludedBanned: [], invalidTargets: [], unreadable: [] };

  // Validate the targets ONCE, loudly, before touching anybody. A bad target here would be written to every
  // member in the population and yield nothing forever, which is the `gbti-labs` failure at full scale.
  const clean = [];
  for (const t of targets) {
    const u = normalizeUsername(t);
    if (!u) { plan.invalidTargets.push({ target: t, reason: 'not a valid username' }); continue; }
    clean.push(u);
  }
  if (plan.invalidTargets.length) return plan; // fail closed: plan nothing rather than plan something wrong

  for (const m of members) {
    const githubId = idOf(m);
    if (!githubId) continue;
    if (isBanned(m)) { plan.excludedBanned.push(who(m)); continue; }

    // A follows record that EXISTS but could not be READ is left completely alone. Treating it as an empty
    // graph would make this backfill overwrite every follow the member had chosen, plus any per-follow
    // notify preference, with just the two house accounts. An unreadable record is a reason to skip
    // somebody, never a reason to conclude they follow nobody: the two are indistinguishable from the
    // absence of a value, and only one of them is safe to act on.
    if (followsUnreadable.has(githubId)) { plan.unreadable.push(who(m)); continue; }

    const before = normalizeFollows(followsByGithubId.get(githubId) ?? null);
    const have = new Set(followingUsernames(before));
    const add = clean.filter((u) => !have.has(u));
    if (!add.length) { plan.alreadyComplete.push(who(m)); continue; }

    let next = before;
    for (const username of add) next = applyFollow(next, { username, on: true }, { now });
    plan.writes.push({ ...who(m), add, next });
  }

  return plan;
}

/** Counts for the report header. Kept beside the planners so a new bucket cannot be forgotten in the tally. */
export function enrollmentCounts(mailPlan, followPlan) {
  return {
    toEnroll: mailPlan.enroll.length,
    alreadyEnrolled: mailPlan.alreadyEnrolled.length,
    suppressed: mailPlan.suppressedSkips.length,
    unreachable: mailPlan.unreachable.length,
    excludedBanned: mailPlan.excludedBanned.length,
    followWrites: followPlan.writes.length,
    followAlreadyComplete: followPlan.alreadyComplete.length,
  };
}

// ---- sow-472: the daily run ------------------------------------------------------------------------------
//
// The backfill above ran by hand once, on 2026-08-24/25, and nothing added a member to the digest afterwards
// except the member's own switch. The owner ruled on 2026-10-23 that everybody who signs in is added from now
// on, every accepted project claim included, so the same planner now runs once a day
// (.github/workflows/digest-enroll.yml). Three things it needs that a one-off did not:

/** A follow plan with nothing in it, for the daily run. Same shape planFollowBackfill returns. */
export function emptyFollowPlan() {
  return { writes: [], alreadyComplete: [], excludedBanned: [], invalidTargets: [], unreadable: [] };
}

/**
 * May this run add `toEnroll` subscribers? A ceiling, because a sudden jump far past what a day of sign-ups
 * produces is more likely a bad read (a gather that returned somebody else's customers, a suppression list
 * that came back empty) than real growth, and the cost of being wrong is an email to every person added.
 *
 * `maxAdditions` null means no ceiling (a by-hand run that previewed its number). Anything that is not a whole
 * number of zero or more is REFUSED rather than read as "no ceiling": a typo in the workflow must stop the run,
 * never lift the limit.
 */
export function ceilingVerdict(toEnroll, maxAdditions) {
  if (maxAdditions === null || maxAdditions === undefined) return { ok: true, max: null, reason: null };
  // Digits only. Number('') is 0 and Number(' 7 ') is 7, so a cleared or padded workflow input would otherwise
  // read as a real ceiling instead of a mistake.
  const raw = String(maxAdditions);
  if (!/^\d+$/.test(raw)) return { ok: false, max: null, reason: 'the ceiling is not a whole number' };
  const max = Number(raw);
  if (toEnroll > max) return { ok: false, max, reason: `${toEnroll} to add is over the ceiling of ${max}` };
  return { ok: true, max, reason: null };
}

/** What happened to an accepted claim in this run. */
export const CLAIM_OUTCOME = Object.freeze({
  ENROL: 'added',
  ALREADY: 'already on the digest',
  SUPPRESSED: 'unsubscribed earlier, left off',
  UNREACHABLE: 'no verified email address',
  BANNED: 'banned, left off',
  NOT_GATHERED: 'not found among the members',
});

/**
 * Every accepted project claim and what this run did about it. The owner asked for claims by name ("make sure
 * that any new accepted claim member are retrospectively added"), so they are checked on their own rather than
 * assumed to follow from the population: a claimant missing from the gather would otherwise vanish from every
 * count without a line saying so.
 *
 * @param {object[]} listings  prepared-listing records (`invite-listing:<id>` values); only claimed ones count
 * @param {object} mailPlan    planMailEnrollment's result for the same run
 */
export function claimsReport(listings = [], mailPlan = {}) {
  const buckets = [
    [mailPlan.enroll, CLAIM_OUTCOME.ENROL],
    [mailPlan.alreadyEnrolled, CLAIM_OUTCOME.ALREADY],
    [mailPlan.suppressedSkips, CLAIM_OUTCOME.SUPPRESSED],
    [mailPlan.unreachable, CLAIM_OUTCOME.UNREACHABLE],
    [mailPlan.excludedBanned, CLAIM_OUTCOME.BANNED],
  ];
  const outcomeById = new Map();
  for (const [rows, outcome] of buckets) for (const r of rows ?? []) outcomeById.set(String(r?.githubId ?? ''), outcome);
  const rows = [];
  for (const l of listings) {
    if (!l || typeof l !== 'object' || !l.claimedAt) continue;
    const githubId = String(l.claimedBy ?? '').trim();
    rows.push({
      githubId,
      login: l.claimedLogin ?? null,
      claimedAt: String(l.claimedAt).slice(0, 10),
      outcome: (githubId && outcomeById.get(githubId)) || CLAIM_OUTCOME.NOT_GATHERED,
    });
  }
  return rows.sort((a, b) => a.claimedAt.localeCompare(b.claimedAt) || a.githubId.localeCompare(b.githubId));
}

/**
 * Where the daily run keeps its NAMED report. The repository is public and so are its Actions logs, so the log
 * carries counts only; the names (who could not be reached, what happened to each claim) go to KV, which is
 * where per-person state belongs. Overwritten by every run, so a person erased from the network drops out of
 * it at the next run without the erasure tool needing to know it exists.
 */
export const DIGEST_ENROLL_REPORT_KEY = 'digest-enroll:report';

/**
 * One run's whole plan, pure, so the daily run's two promises are tested where they are made rather than
 * inside the networked runner: a digest-only run plans no follow write, and the ceiling verdict travels with
 * the plan to the one place that may write (enactRun in scripts/mail-enroll.mjs).
 */
export function planRun({
  members = [], identities = new Map(), suppressed = new Set(), enrolled = new Set(), enrolledGithubIds = new Set(),
  subscribersUnreadable = 0, followsByGithubId = new Map(), followsUnreadable = new Set(), listings = [],
  digestOnly = false, maxAdditions = null, now = Date.now,
} = {}) {
  const mailPlan = planMailEnrollment({ members, identities, suppressed, enrolled, enrolledGithubIds });
  const followPlan = digestOnly ? emptyFollowPlan() : planFollowBackfill({ members, followsByGithubId, followsUnreadable, now });
  const counts = enrollmentCounts(mailPlan, followPlan);
  const ceiling = ceilingVerdict(counts.toEnroll, maxAdditions);
  // A subscriber record whose VALUE could not be read is a githubId this run cannot see, so the member it
  // belongs to could be added a second time, or put back after switching the digest off. The run refuses
  // rather than guess, exactly as it does past the ceiling.
  const unreadable = Number(subscribersUnreadable) || 0;
  const refusal = unreadable > 0
    ? `${unreadable} subscriber record(s) could not be read, so who is already on the list is not known`
    : (ceiling.ok ? null : ceiling.reason);
  const matchedMarkers = new Set(mailPlan.suppressedSkips.map((r) => r.hash));
  const unsubscribes = { onRecord: suppressed.size, matched: matchedMarkers.size, unmatched: suppressed.size - matchedMarkers.size };
  return { mailPlan, followPlan, counts, ceiling, refusal, unsubscribes, claims: claimsReport(listings, mailPlan) };
}
