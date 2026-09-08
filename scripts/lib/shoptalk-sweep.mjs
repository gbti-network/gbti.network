// sow-314: the Shop Talk enrollment sweep. Orchestration only, with every decision delegated to a pure module
// and every dependency injected, so the whole thing is testable without a network or a clock.
//
//   membership/shoptalk-series.mjs   picks WHICH series (never a config id, see that file)
//   scripts/lib/shoptalk-enroll.mjs  decides WHO is added and removed (the three safety rules)
//   clients/google-calendar.mjs      does the IO
//
// It sits beside enactDiscord in reconcile and follows the same shape: reconcile holds the service credential
// and calls the service directly. That was reconsidered rather than assumed: the earlier recommendation was to
// route this through a Worker endpoint so the Google credential had one home, and it was wrong, because
// reconcile already holds Stripe, GitHub, Discord and Resend credentials and enacts against each. A Worker hop
// would have been a new machine-auth surface that nothing else in this script needs, and DISCORD_BOT_TOKEN
// already lives in both the reconcile workflow and the Worker, so a credential in two places is the pattern
// here rather than an exception.
//
// DRY RUN IS THE DEFAULT, and it is a real dry run: it resolves the series and READS the guest list, so the
// numbers it reports are the numbers `--apply` would act on. A dry run that skipped the reads would print a
// plan computed from nothing.

import { seriesFromInstances, isSeriesProblem, describeSeries } from '../../membership/shoptalk-series.mjs';
import { planShoptalkEnrollment, enrollmentCounts, normalizeAddress } from './shoptalk-enroll.mjs';

/** The title fragment the series is found by. Matched by Google's own `q`, which is a full-text search. */
export const SHOPTALK_QUERY = 'Shop TALK';

/** KV document holding the addresses THIS SYSTEM placed: { "<address>": "<githubId>" }. */
export const SHOPTALK_PLACED_KEY = 'shoptalk:placed';

/**
 * Build the attendee list to write.
 *
 * Pure and separate from the IO on purpose, because this is where the destructive mistake would live. The new
 * list is the CURRENT list minus what we are removing plus what we are adding, so an attendee the sweep does
 * not know about is carried through untouched rather than being reconstructed from the member roster.
 */
export function nextAttendeeList(current, plan) {
  const drop = new Set((plan.remove || []).map((r) => normalizeAddress(r.address)));
  const out = [];
  const seen = new Set();
  for (const a of current || []) {
    const addr = normalizeAddress(a);
    if (!addr || drop.has(addr) || seen.has(addr)) continue;
    seen.add(addr);
    out.push(addr);
  }
  for (const r of plan.add || []) {
    const addr = normalizeAddress(r.address);
    if (!addr || seen.has(addr)) continue;
    seen.add(addr);
    out.push(addr);
  }
  return out;
}

/** Apply the plan to the placed record: additions claimed, removals released. Foreign entries are never here. */
export function nextPlacedRecord(placed, plan) {
  const next = new Map(placed || []);
  for (const r of plan.remove || []) next.delete(normalizeAddress(r.address));
  for (const r of plan.add || []) next.set(normalizeAddress(r.address), String(r.githubId));
  return next;
}

/**
 * Run the sweep.
 *
 * @param {object[]} members     reconcile gather output
 * @param {object}   cal         a google-calendar client (nextOccurrences, listAttendees, setAttendees)
 * @param {Map}      placed      address -> githubId, what this system put there
 * @param {Set}      optedOut    githubIds that removed themselves
 * @param {Map}      preferred   githubId -> chosen address
 * @param {boolean}  apply       false (default) reads and plans but writes nothing
 */
export async function runShoptalkSweep({
  members = [], cal, placed = new Map(), optedOut = new Set(), preferred = new Map(),
  apply = false, now = () => new Date(),
} = {}) {
  if (!cal) throw new Error('runShoptalkSweep: a calendar client is required');

  const instances = await cal.nextOccurrences(SHOPTALK_QUERY, { now });
  const series = seriesFromInstances(instances);

  // FAIL LOUD AND CHANGE NOTHING. "No series found" must never read as "nothing to do": the whole point of
  // resolving at run time is that a missing series means the event moved or was re-split, and enrolling
  // nobody while reporting success is the failure this design exists to prevent.
  if (isSeriesProblem(series)) {
    return { ok: false, error: series.problem, message: describeSeries(series), applied: false, counts: null };
  }

  const attendees = await cal.listAttendees(series.seriesId);
  if (attendees === null) {
    return {
      ok: false,
      error: 'series-vanished',
      message: `Shop Talk enrollment CANNOT RUN: series ${series.seriesId} could not be read back. Nobody was added or removed.`,
      applied: false, counts: null,
    };
  }

  const plan = planShoptalkEnrollment({ members, attendees, placed, optedOut, preferred });
  const counts = enrollmentCounts(plan);

  if (!apply || counts.changes === 0) {
    return { ok: true, applied: false, seriesId: series.seriesId, startsAt: series.startsAt, plan, counts };
  }

  const list = nextAttendeeList(attendees, plan);
  await cal.setAttendees(series.seriesId, list, { expectedEtag: undefined, sendUpdates: 'all' });

  return {
    ok: true, applied: true, seriesId: series.seriesId, startsAt: series.startsAt,
    plan, counts, placed: nextPlacedRecord(placed, plan),
  };
}

/** One line for the reconcile summary. A failed sweep must not read like a quiet success. */
export function describeSweep(result) {
  if (!result?.ok) return result?.message || 'Shop Talk enrollment failed for an unknown reason.';
  const c = result.counts;
  const verb = result.applied ? 'applied' : 'planned';
  return `Shop Talk ${verb}: +${c.add} guest(s), -${c.remove}, ${c.alreadyOn} already on, `
    + `${c.optedOut} opted out, ${c.unreachable} unreachable, ${c.foreign} left alone (not ours).`;
}
