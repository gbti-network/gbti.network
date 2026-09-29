// SOW-042 P3: the PURE aggregation behind <gbti-activity-bell>. The element fans out to the existing per-member
// reads (each fail-closed to []), normalizes them to a common notification shape { id, ts, title, sub, href }, and
// hands the four arrays here with the account's read record to compute the unread badge + grouped lists. No DOM,
// no client -> node-testable (the SOW P5 contract: an errored source contributes ZERO, never a phantom unread).
//
// Unread model (owner, 2026-09-29): which items were marked read, per group, on the member's account
// (membership/bell-seen.mjs), so a read on the website clears the same items here. It was a per-source ms watermark
// kept in one browser. A Locked/unknown
// account never reaches here (the element hides).
//
// sow-404 (owner, 2026-09-25): the "Your PRs" group is gone, for every account. "Users do not care about pull
// requests anymore": since sow-274 a member never opens one, and a superadmin found the "Accepted" rows noise. Its
// seen-SET of PR numbers (`prsSeen`) went with it; a copy already stored in a browser is simply never read.

import { toMs } from './all-merge.mjs';
import { unreadPredicate, markGroup } from '../../membership/bell-seen.mjs';

export const BELL_GROUPS = [
  // superadmin-only. sow-407 (owner, 2026-09-25): "To approve" listed every post waiting its hour before going to the
  // social channels, and those post on their own. Only the ones that genuinely need a superadmin show now.
  { key: 'approvals', label: 'Needs your approval' },
  { key: 'replies', label: 'Replies' },
  { key: 'following', label: 'Following' },
  // sow-404: 'Your PRs' is gone (see the header).
  // sow-274: the 'To review' group (incoming contributions) is gone with the contribution review surface.
];

/** The unread items of one group. `seen` is the account's read record ({ groups }, membership/bell-seen.mjs), which
 *  decides by which items were marked read, so a late arrival still badges; the old per-source ms watermark object
 *  is still understood. A non-array source is treated as empty. */
export function unreadItems(group, items, seen = {}) {
  const list = Array.isArray(items) ? items : [];
  if (seen && typeof seen === 'object' && seen.groups && typeof seen.groups === 'object') {
    const isUnread = unreadPredicate(seen.groups[group] ?? null);
    return list.filter((it) => isUnread({ id: it?.id, ts: toMs(it?.ts) }));
  }
  const since = Number(seen?.[group]) || 0;
  return list.filter((it) => toMs(it.ts) > since);
}

/** Owner, 2026-09-29: mark every group read in the account's record: each shown item by id, so the same item on the
 *  website (Following) is cleared there too, and a later arrival still badges. Returns the new record. */
export function markAllGroups(seen, sources = {}, now = Date.now()) {
  let next = seen;
  for (const g of BELL_GROUPS) {
    const items = (Array.isArray(sources[g.key]) ? sources[g.key] : []).map((it) => ({ id: String(it?.id ?? ''), ts: toMs(it?.ts) }));
    next = markGroup(next, g.key, items, now);
  }
  return next;
}

/** Build the bell view-model from the normalized source arrays + the read record. A missing/errored source
 *  is []. Returns { total, groups:[{ key, label, items(newest-first), unread }] }. */
export function buildBell(sources = {}, seen = {}) {
  const groups = BELL_GROUPS.map((g) => {
    const items = (Array.isArray(sources[g.key]) ? sources[g.key] : []).slice().sort((a, b) => toMs(b.ts) - toMs(a.ts));
    return { key: g.key, label: g.label, items, unread: unreadItems(g.key, items, seen).length };
  });
  return { total: groups.reduce((s, g) => s + g.unread, 0), groups };
}

// sow-407: how long past its hold a pending item may wait for the drain before the bell treats it as stuck. The drain
// runs on a cron, so an item a few minutes past its hour is normal; one half an hour past it did not go on its own.
export const SYNDICATION_OVERDUE_MS = 30 * 60 * 1000;

/**
 * The syndication items a superadmin must act on, from the queue's `pending` list. Two kinds:
 *   - FLAGGED: the moderation check flagged it, so it waits for an approval and never posts by itself;
 *   - OVERDUE: its hold ended more than SYNDICATION_OVERDUE_MS ago and it is still pending, so it is not going out by
 *     itself (approval is switched on, or it is stuck).
 * An ordinary item still inside its hold is left out: it posts on its own when the hour is up.
 * Returns [{ item, why: 'flagged' | 'overdue' }], in the queue's order.
 */
export function approvalsNeeded(pending, now = Date.now()) {
  const out = [];
  for (const it of Array.isArray(pending) ? pending : []) {
    if (!it || typeof it !== 'object') continue;
    if (Array.isArray(it.flags) && it.flags.length) { out.push({ item: it, why: 'flagged' }); continue; }
    const at = toMs(it.availableAt);
    if (at && now - at > SYNDICATION_OVERDUE_MS) out.push({ item: it, why: 'overdue' });
  }
  return out;
}
