// sow-427 amendment 2: FINALIZE A CLAIM WITHOUT A WATCHER. A claimant can publish and close the tab, and a superadmin
// may not open the manager for weeks, so nothing on a page is guaranteed to notice that a claim's pull request merged
// (or closed). This sweep runs on the Worker's existing five-minute tick (drainFiveMinute in cron.mjs) and brings the
// publishing listings up to date, a rotating batch at a time, through the same finalizeIfMerged the page and the
// manager use.
//
// BOUNDED ON BOTH AXES:
//   - it does its work only on the tick at the top of each quarter hour (SWEEP_EVERY_MINUTES), because reading every
//     listing record to find the few being published is the cost, and a claim noticed within fifteen minutes is
//     plenty for a backstop: the claimant's own page finalizes within seconds while it is open;
//   - it finalizes at most SWEEP_MAX_PER_TICK listings per run (each is one or two GitHub reads), oldest lock first,
//     and leaves the rest for the next run.
//
// IT ROTATES, so a stuck claim cannot hold a slot for ever. A claim's pull request can stay open indefinitely (a gate
// run that errored, which nothing re-gates; a merge conflict; a failing check), and its lock lasts as long as the PR
// is open (amendment 10). Always taking the five oldest would let five such claims take every run, and a newer claim
// that merged after its claimant closed the tab would never be finalized: no owner notice, no minimizing, its images
// kept. So when more listings are publishing than one run takes, each window takes the NEXT run of them in the same
// oldest-first order (sweepBatch), and every publishing listing is checked within a few windows however many are
// stuck. It needs no stored cursor and no extra write: the window number is the cursor.
//
// It LOGS NOTHING ITSELF and returns COUNTS ONLY: scheduled() prints the tick's result object, so anything returned
// here is logged, and a listing carries a person's name while its code is a bearer secret. No id, title, code, login
// or error text is ever put in the result.
//
// Nothing here throws: a failure is a count, and the tick's other jobs (syndication, mail) never wait on it.

import { listListings } from './prepared-store.mjs';
import { readInvite } from './invites-store.mjs';
import { finalizeIfMerged, FINALIZE_STATE } from './prepared-claim-finalize.mjs';
import { sendListingClaimedAlert } from './listing-claimed-alert.mjs';
import { listingState, LISTING_STATE } from '../../membership/prepared-listings.mjs';

/** At most this many publishing listings are finalized per run. */
export const SWEEP_MAX_PER_TICK = 5;
/** The sweep works on the five-minute tick that opens each such window of minutes (0, 15, 30 and 45 past). */
export const SWEEP_EVERY_MINUTES = 15;
const TICK_MINUTES = 5;

/** Is this tick the one that opens a sweep window? Pure over the clock. */
export function sweepDue(now = new Date()) {
  const m = (now instanceof Date ? now : new Date(now)).getUTCMinutes();
  return Number.isInteger(m) && m % SWEEP_EVERY_MINUTES < TICK_MINUTES;
}

/**
 * Which of the publishing listings (already sorted oldest lock first) this run checks. Pure over the clock. With no
 * more than `max` of them, every one, oldest first. With more, `max` consecutive ones in that order, starting where
 * the window number puts the cursor and wrapping round, so consecutive windows walk the whole list.
 */
export function sweepBatch(publishing, max = SWEEP_MAX_PER_TICK, now = new Date()) {
  const list = Array.isArray(publishing) ? publishing : [];
  const n = list.length;
  if (n <= max) return list.slice();
  const t = (now instanceof Date ? now : new Date(now)).getTime();
  const win = Number.isFinite(t) ? Math.floor(t / (SWEEP_EVERY_MINUTES * 60 * 1000)) : 0;
  const start = ((win * max) % n + n) % n;
  return Array.from({ length: max }, (_, k) => list[(start + k) % n]);
}

/**
 * Finalize publishing prepared listings, a rotating batch of them per window (sweepBatch). Returns counts only:
 * `{ ran: false }` off the window, or `{ ran: true, scanned, publishing, checked, claimed, failed, open, notified,
 * errors }`, or `{ ran: true, unavailable: true }` when the store or its list could not be read.
 *
 * @param deps `{ now, kv, force, list, readInv, finalize, sendAlert, max }`, all injectable; `force` runs off the
 *             window (tests, and a manual run).
 */
export async function sweepPreparedClaims(env, deps = {}) {
  const now = deps.now ?? new Date();
  if (!deps.force && !sweepDue(now)) return { ran: false };
  const kv = deps.kv ?? env?.SIGNUP_KV;
  const list = deps.list ?? listListings;
  const readInv = deps.readInv ?? readInvite;
  const finalize = deps.finalize ?? finalizeIfMerged;
  const sendAlert = deps.sendAlert ?? sendListingClaimedAlert;
  const max = Number.isInteger(deps.max) && deps.max > 0 ? deps.max : SWEEP_MAX_PER_TICK;
  if (!kv) return { ran: true, unavailable: true };

  let all;
  try { all = await list(kv); } catch { all = null; }
  if (!Array.isArray(all)) return { ran: true, unavailable: true };

  const publishing = all
    .map(({ rec }) => rec)
    .filter((rec) => rec && listingState(rec) === LISTING_STATE.publishing)
    .sort((a, b) => String(a.claimPendingAt ?? '').localeCompare(String(b.claimPendingAt ?? '')));

  const out = { ran: true, scanned: all.length, publishing: publishing.length, checked: 0, claimed: 0, failed: 0, open: 0, notified: 0, errors: 0 };
  for (const listing of sweepBatch(publishing, max, now)) {
    out.checked += 1;
    try {
      const invite = await readInv(kv, listing.code);
      const f = await finalize(env, { listing, invite }, { kv, now });
      if (f?.state === FINALIZE_STATE.claimed) out.claimed += 1;
      else if (f?.state === FINALIZE_STATE.failed) out.failed += 1;
      else out.open += 1;
      if (f?.notify) {
        const sent = await sendAlert(env, f.notify);
        if (sent?.sent) out.notified += 1;
      }
    } catch {
      out.errors += 1;
    }
  }
  return out;
}
