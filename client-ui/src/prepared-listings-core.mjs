// sow-427: the PREPARED LISTINGS manager, as data. A prepared listing is a project a superadmin wrote for someone who
// is not a member yet; it waits in KV with its own invitation until that person claims it under their own name.
// This module decides, for one manager row, what to call its state, which actions it offers, and the links it
// shows. Node-free and DOM-free, so the rules are unit-tested and the element (gbti-prepared-listings.mjs) is only
// markup and wiring.
//
// THE WORKER IS THE BOUNDARY. Every action here is re-checked by the superadmin-only route
// (workers/signup/membership-prepared-admin.mjs), which refuses an edit while a claim is publishing, a revoke of a
// claimed listing, a send again before a revoke, and so on. The action list below only keeps the manager from
// offering a button the Worker would refuse, so a superadmin never meets a refusal they could not have avoided.
//
// A row is the Worker's `listingSummary` (membership/prepared-listings.mjs): it never carries the personal message,
// the project body or an account number, and neither does anything this module returns.

import { claimLink, projectUrl, isListingId, LISTING_STATE } from '../../membership/prepared-listings-shared.mjs';

/** The public site the claim page and the project pages live on, whichever host renders the manager. */
export const PREPARED_SITE_BASE = 'https://gbti.network';

/** The WorkBench deep link that opens a blank project already in prepared mode (see parseWorkspacePrepare). */
export const PREPARE_NEW_HREF = '/workbench/#new=project&prepare=1';

/** The WorkBench deep link that reopens one listing for editing. Null for anything that is not a listing id. */
export function preparedEditHref(id) {
  return isListingId(id) ? `/workbench/#prepare=${id}` : null;
}

/** The label a superadmin reads for each listing state. `unknown` is a record the Worker could not read cleanly. */
export const PREPARED_STATE_LABELS = Object.freeze({
  [LISTING_STATE.prepared]: 'Prepared',
  [LISTING_STATE.publishing]: 'Publishing',
  [LISTING_STATE.claimed]: 'Claimed',
  [LISTING_STATE.revoked]: 'Revoked',
  [LISTING_STATE.unknown]: 'Unreadable',
});

/**
 * The manager's load decision for one render (sow-334). A client is asked ONCE: a load starts only when this client
 * has never been asked (`reset` when the client changed since the last load) or when Try again put the status back
 * to idle. A failed or empty answer is a status of its own, so it can never read as "not tried yet" and start the
 * next attempt from render(), which is the loop that made hundreds of reads a second against a failing route.
 * Returns `{ available, reset, load }`; `available` false means the client has no prepared methods (not a superadmin).
 */
export function preparedLoadPlan({ status = null, loadedFor = null, client = null } = {}) {
  const available = typeof client?.preparedList === 'function';
  if (!available) return { available, reset: false, load: false };
  const reset = loadedFor !== client;
  const st = reset ? 'idle' : (status || 'idle');
  return { available, reset, load: st === 'idle' };
}

/** The state a row is in, one of LISTING_STATE, fail closed to `unknown` for anything unrecognised. */
export function preparedRowState(row) {
  const s = row && typeof row === 'object' ? String(row.state || '') : '';
  return Object.prototype.hasOwnProperty.call(PREPARED_STATE_LABELS, s) && !row.corrupt ? s : LISTING_STATE.unknown;
}

export function preparedStateLabel(row) {
  return PREPARED_STATE_LABELS[preparedRowState(row)];
}

/** The action ids, in the order the row shows them. */
export const PREPARED_ACTION = Object.freeze({
  copy: 'copy', edit: 'edit', revoke: 'revoke', resend: 'resend', remove: 'delete', view: 'view',
  // sow-481: the superadmin sent the link, and the undo for pressing that by mistake. Copy link is NOT one of
  // these and never marks anything: the owner chose two separate actions (2026-10-26).
  markSent: 'mark-sent', unmarkSent: 'unmark-sent',
});

/** sow-481: true when this row's link has been sent, by a click or by the launch stamp. */
export function preparedIsSent(row) {
  return !!row && typeof row === 'object' && (Boolean(row.sentAt) || row.sentAtLaunch === true);
}

/**
 * sow-481: the manager's lanes, Option B of the 2026-10-23 design round.
 *
 * - `ready`:      a prepared invitation not yet sent, and a REVOKED one (owner, 2026-10-26: its next step is Send
 *                 again, which makes a fresh link that still has to be sent, so it waits on the left).
 * - `sent`:       a prepared invitation whose link has gone out and nobody has accepted yet.
 * - `landed`:     publishing (the recipient accepted; their pull request is open) and claimed.
 * - `unreadable`: a record the Worker could not read cleanly. Shown below the lanes, never dropped, because a
 *                 row that silently vanishes is a record nobody notices is broken.
 */
export const PREPARED_LANE = Object.freeze({ ready: 'ready', sent: 'sent', landed: 'landed', unreadable: 'unreadable' });

export function preparedLane(row) {
  switch (preparedRowState(row)) {
    case LISTING_STATE.prepared: return preparedIsSent(row) ? PREPARED_LANE.sent : PREPARED_LANE.ready;
    case LISTING_STATE.revoked: return PREPARED_LANE.ready;
    case LISTING_STATE.publishing:
    case LISTING_STATE.claimed: return PREPARED_LANE.landed;
    default: return PREPARED_LANE.unreadable;
  }
}

/**
 * sow-481: the rows grouped into the lanes, each keeping the Worker's order (newest prepared first). In Ready to send
 * the unsent invitations come before the revoked ones, because those two need different next steps and a revoked
 * row between two unsent ones reads as one more thing to send.
 */
export function preparedLanes(rows) {
  const out = { ready: [], revoked: [], sent: [], landed: [], unreadable: [] };
  for (const row of Array.isArray(rows) ? rows : []) {
    const lane = preparedLane(row);
    if (lane === PREPARED_LANE.ready && preparedRowState(row) === LISTING_STATE.revoked) out.revoked.push(row);
    else out[lane].push(row);
  }
  return { ready: [...out.ready, ...out.revoked], sent: out.sent, landed: out.landed, unreadable: out.unreadable };
}

/** sow-481: the one line under the heading, counting each lane. Counts only: nothing here is a warning. */
export function preparedLaneSummary(lanes) {
  const n = (k) => (Array.isArray(lanes?.[k]) ? lanes[k].length : 0);
  const parts = [`${n('ready')} ready to send`, `${n('sent')} sent and waiting`, `${n('landed')} landed`];
  if (n('unreadable')) parts.push(`${n('unreadable')} unreadable`);
  return parts.join(' \u00b7 ');
}

const DAY_MS = 24 * 60 * 60 * 1000;
const days = (n) => `${n} ${n === 1 ? 'day' : 'days'}`;

/**
 * sow-481: how long a sent invitation has waited, as PLAIN TEXT. The owner ruled on 2026-10-26 that a quiet
 * invitation is never flagged: no colour, no threshold, no "overdue". This returns words and nothing else, so
 * nothing downstream can turn it into a warning.
 *
 * A launch-stamped row has no real send date (the owner chose not to backfill one), so its age is counted from
 * when it was PREPARED and says so, rather than presenting the launch day as the day it was sent.
 * Returns '' for a row that is not in the sent lane or has no usable date.
 */
export function preparedWaited(row, now = new Date()) {
  if (preparedLane(row) !== PREPARED_LANE.sent) return '';
  const nowMs = (now instanceof Date ? now : new Date(now)).getTime();
  const launch = !row.sentAt && row.sentAtLaunch === true;
  const from = Date.parse(String(launch ? row.createdAt ?? '' : row.sentAt));
  if (!Number.isFinite(from) || !Number.isFinite(nowMs)) return '';
  let elapsed = nowMs;
  elapsed -= from;
  const n = Math.max(0, Math.floor(elapsed / DAY_MS));
  if (launch) return n === 0 ? 'Prepared today' : `${days(n)} since prepared`;
  return n === 0 ? 'Sent today' : `Waiting ${days(n)}`;
}

/**
 * Which actions a row offers, in display order.
 *
 * - prepared:   Copy link, Mark sent (sow-481, unsent only), Edit, Revoke, Not sent yet (sent only), Delete. The
 *               link is the one thing to send; Mark sent needs a link to have sent.
 * - revoked:    Edit, Send again, Delete. The old link is dead, so there is nothing to copy until it is sent again.
 * - publishing: Copy link only. The claimant's pull request is open; the Worker refuses edit, revoke and delete
 *               until it merges or closes, and the link still opens for the person reloading it.
 * - claimed:    View project, Delete. The project now lives in the member's folder; Delete clears the record.
 * - unknown:    nothing. A record that could not be read is not acted on from here (fail closed).
 *
 * A row without a well-formed listing id offers nothing, because every action addresses the listing by its id.
 */
export function preparedActions(row) {
  const st = preparedRowState(row);
  if (!isListingId(row?.id)) return [];
  const hasCode = typeof row.code === 'string' && row.code.length > 0;
  switch (st) {
    case LISTING_STATE.prepared: {
      const sent = preparedIsSent(row);
      return [
        ...(hasCode ? [PREPARED_ACTION.copy] : []),
        ...(!sent && hasCode ? [PREPARED_ACTION.markSent] : []),
        PREPARED_ACTION.edit, PREPARED_ACTION.revoke,
        ...(sent ? [PREPARED_ACTION.unmarkSent] : []),
        PREPARED_ACTION.remove,
      ];
    }
    case LISTING_STATE.revoked:
      return [PREPARED_ACTION.edit, PREPARED_ACTION.resend, PREPARED_ACTION.remove];
    case LISTING_STATE.publishing:
      return hasCode ? [PREPARED_ACTION.copy] : [];
    case LISTING_STATE.claimed:
      return [...(projectUrl(PREPARED_SITE_BASE, row.slug) ? [PREPARED_ACTION.view] : []), PREPARED_ACTION.remove];
    default:
      return [];
  }
}

/** The invitation link for a row, or null when there is none to show (no code, or a state with a dead link). */
export function preparedLinkFor(row, siteBase = PREPARED_SITE_BASE) {
  if (!preparedActions(row).includes(PREPARED_ACTION.copy)) return null;
  return claimLink(siteBase, row.code);
}

/** The published project page for a claimed row, or null. */
export function preparedProjectHref(row, siteBase = PREPARED_SITE_BASE) {
  if (preparedRowState(row) !== LISTING_STATE.claimed) return null;
  return projectUrl(siteBase, row.slug);
}

const day = (v) => (typeof v === 'string' && v.length >= 10 ? v.slice(0, 10) : '');
const at = (login) => (login ? `@${String(login).replace(/^@/, '')}` : '');

/**
 * The short facts under a row's title, as plain strings the element escapes. Who it greets, whether the invitation
 * is tied to one GitHub account, the campaign, and what has happened to it so far.
 */
export function preparedRowMeta(row) {
  // A record the Worker could not read cleanly states nothing: its fields are exactly what is in doubt (sow-481).
  if (!row || typeof row !== 'object' || preparedRowState(row) === LISTING_STATE.unknown) return [];
  const out = [];
  if (row.recipientName) out.push(`For ${row.recipientName}`);
  out.push(row.bound ? (row.boundLogin ? `Tied to ${at(row.boundLogin)}` : 'Tied to one GitHub account') : 'Open to whoever claims it first');
  if (row.campaign) out.push(`Campaign ${row.campaign}`);
  if (row.createdAt) out.push(`Prepared ${day(row.createdAt)}${row.preparedByLogin ? ` by ${at(row.preparedByLogin)}` : ''}`);
  const st = preparedRowState(row);
  // sow-481: who sent it and when (owner, 2026-10-26: record both). A launch stamp has neither, and says so.
  if (st === LISTING_STATE.prepared && row.sentAt) out.push(`Sent ${day(row.sentAt)}${row.sentByLogin ? ` by ${at(row.sentByLogin)}` : ''}`);
  else if (st === LISTING_STATE.prepared && row.sentAtLaunch === true) out.push('Counted as sent at launch');
  if (st === LISTING_STATE.revoked && row.revokedAt) out.push(`Revoked ${day(row.revokedAt)}`);
  if (st === LISTING_STATE.publishing) out.push(row.prNumber ? `Pull request #${row.prNumber} is open` : 'Opening the pull request');
  if (st === LISTING_STATE.claimed) out.push(`Claimed${row.claimedAt ? ` ${day(row.claimedAt)}` : ''}${row.claimedLogin ? ` by ${at(row.claimedLogin)}` : ''}`);
  if (row.redeemedByLogin && st !== LISTING_STATE.claimed) out.push(`Free year taken by ${at(row.redeemedByLogin)}`);
  const prior = Array.isArray(row.priorCodes) ? row.priorCodes.length : 0;
  if (prior) out.push(`Sent again ${prior === 1 ? 'once' : `${prior} times`}; earlier links no longer work`);
  return out;
}

/** The sentence the inline delete confirmation shows. Never names the recipient's message or the body. */
export function preparedDeleteConfirm(row) {
  const who = row?.recipientName ? ` for ${row.recipientName}` : '';
  const claimed = preparedRowState(row) === LISTING_STATE.claimed;
  return claimed
    ? `Delete the record of this claimed listing${who}? The published project stays where it is.`
    : `Delete this prepared listing${who}? The project and its images are removed and its invitation link stops working. This cannot be undone.`;
}

/**
 * The campaigns "Send again" may use: the active ones, as upper case codes, with the row's own campaign first when it
 * is still active. `coupons` is the coupon registry the manager already holds (`{ code, active }` entries).
 */
export function preparedResendCampaigns(coupons, row) {
  const active = (Array.isArray(coupons) ? coupons : [])
    .filter((c) => c && c.active !== false && c.code)
    .map((c) => String(c.code).toUpperCase());
  const unique = [...new Set(active)];
  const own = String(row?.campaign || '').toUpperCase();
  return unique.includes(own) ? [own, ...unique.filter((c) => c !== own)] : unique;
}

/**
 * Apply a Worker answer to the list the manager holds, without a second read. A revoke or a send again returns the
 * row's new summary; a delete returns the id it removed. Anything else leaves the list as it was.
 */
export function preparedApplyResult(rows, result, { deletedId = null } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (deletedId && result?.deleted === true) return list.filter((r) => r?.id !== deletedId);
  const next = result?.listing;
  if (!next || !isListingId(next.id)) return list;
  const i = list.findIndex((r) => r?.id === next.id);
  return i < 0 ? [next, ...list] : list.map((r, k) => (k === i ? next : r));
}
