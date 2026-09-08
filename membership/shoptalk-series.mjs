// sow-314: decide WHICH recurring series the Shop Talk enrollment should write to. Pure, node-free, no clock
// of its own: instances in, a decision out. The network lives in clients/google-calendar.mjs.
//
// WHY THIS IS NOT A CONFIG VALUE, WHICH IS THE WHOLE POINT OF THE MODULE.
//
// The owner's Saturday call is not one event. Measured on 2026-09-07, it is SEVENTEEN chained segments of the
// original series, produced by repeatedly editing "this and following events": each edit ends the running
// segment with an `UNTIL=` and mints a new one. Each segment is a separate event with its OWN guest list, and
// the measured guest counts across them (0, 4, 5, 6, 8, 9, 10, 10, 12, 12, 12, 12, 13, 12, 12, 13, 14) show
// they drift apart.
//
// So an event id written into config is correct only until the next such edit. After it, the stored id names a
// segment that has ENDED. Adding guests to it still returns 200, the sweep still reports success, and nobody
// is added to the call they were told they had joined. **Nothing errors and nothing reports it**, which is the
// failure this module exists to make impossible.
//
// The authority is Google's own expansion, not our RRULE parsing. Ask for instances from now, take the first
// one that is not cancelled, and read its `recurringEventId`. That is the series which owns the next
// occurrence, by definition, and it survives re-splitting for free.

/** Why no series could be chosen. Every one of these is an ERROR the sweep reports, never a quiet no-op. */
export const SERIES_PROBLEM = Object.freeze({
  NO_INSTANCES: 'no upcoming Shop Talk occurrences were returned',
  ALL_CANCELLED: 'every upcoming occurrence is cancelled',
  NO_SERIES_ID: 'the next occurrence is a one-off, not part of a recurring series',
});

const startOf = (i) => i?.start?.dateTime || i?.start?.date || null;

/**
 * Choose the series that owns the next occurrence.
 *
 * @param {object[]} items  Google `events.list` output with singleEvents=true, orderBy=startTime, timeMin=now
 * @returns {{ seriesId: string, startsAt: string, instanceId: string } | { problem: string }}
 */
export function seriesFromInstances(items) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return { problem: SERIES_PROBLEM.NO_INSTANCES };

  // A cancelled instance still appears in the list. Skipping it is not cosmetic: the first upcoming Saturday
  // may have been called off, and the series that owns the one AFTER it is the series we want.
  const live = list.filter((i) => i && i.status !== 'cancelled');
  if (live.length === 0) return { problem: SERIES_PROBLEM.ALL_CANCELLED };

  const next = live[0];
  // `recurringEventId` is present on an instance OF a series and absent on a standalone event. A standalone
  // event is not something to enroll members into forever, so it is refused rather than used.
  const seriesId = next.recurringEventId;
  if (!seriesId) return { problem: SERIES_PROBLEM.NO_SERIES_ID };

  return { seriesId, startsAt: startOf(next), instanceId: next.id };
}

/** True when the decision failed. Callers must branch on this rather than on a falsy seriesId. */
export function isSeriesProblem(result) {
  return !!result && typeof result.problem === 'string';
}

/**
 * A human line for the reconcile summary and the owner report.
 *
 * Deliberately says what it means rather than what happened: "found no Shop Talk series" reads as a quiet
 * nothing-to-do, and the whole hazard here is a sweep that enrolls nobody while looking healthy.
 */
export function describeSeries(result) {
  if (isSeriesProblem(result)) {
    return `Shop Talk enrollment CANNOT RUN: ${result.problem}. Nobody was added or removed. `
      + 'Check that the event still lives on the calendar this credential can reach.';
  }
  return `Shop Talk series ${result.seriesId} (next occurrence ${result.startsAt})`;
}
