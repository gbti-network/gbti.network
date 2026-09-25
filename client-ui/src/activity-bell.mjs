// SOW-042 P3: the PURE aggregation behind <gbti-activity-bell>. The element fans out to the existing per-member
// reads (each fail-closed to []), normalizes them to a common notification shape { id, ts, title, sub, href }, and
// hands the four arrays here with the localStorage watermark to compute the unread badge + grouped lists. No DOM,
// no client -> node-testable (the SOW P5 contract: an errored source contributes ZERO, never a phantom unread).
//
// Unread model: every group uses a per-source ms watermark (its items carry a real timestamp). A Locked/unknown
// account never reaches here (the element hides).
//
// sow-404 (owner, 2026-09-25): the "Your PRs" group is gone, for every account. "Users do not care about pull
// requests anymore": since sow-274 a member never opens one, and a superadmin found the "Accepted" rows noise. Its
// seen-SET of PR numbers (`prsSeen`) went with it; a copy already stored in a browser is simply never read.

import { toMs } from './all-merge.mjs';

export const BELL_GROUPS = [
  // superadmin-only. sow-407 (owner, 2026-09-25): "To approve" listed every post waiting its hour before going to the
  // social channels, and those post on their own. Only the ones that genuinely need a superadmin show now.
  { key: 'approvals', label: 'Needs your approval' },
  { key: 'replies', label: 'Replies' },
  { key: 'following', label: 'Following' },
  // sow-404: 'Your PRs' is gone (see the header).
  // sow-274: the 'To review' group (incoming contributions) is gone with the contribution review surface.
];

/** The unread items of one group given the seen watermark: a normalized ms `ts` against the per-source ms mark. A
 *  non-array source is treated as empty. */
export function unreadItems(group, items, seen = {}) {
  const list = Array.isArray(items) ? items : [];
  const since = Number(seen[group]) || 0;
  return list.filter((it) => toMs(it.ts) > since);
}

/** Build the bell view-model from the four normalized source arrays + the seen watermark. A missing/errored source
 *  is []. Returns { total, groups:[{ key, label, items(newest-first), unread }] }. */
export function buildBell(sources = {}, seen = {}) {
  const groups = BELL_GROUPS.map((g) => {
    const items = (Array.isArray(sources[g.key]) ? sources[g.key] : []).slice().sort((a, b) => toMs(b.ts) - toMs(a.ts));
    return { key: g.key, label: g.label, items, unread: unreadItems(g.key, items, seen).length };
  });
  return { total: groups.reduce((s, g) => s + g.unread, 0), groups };
}

/** The watermark to persist when the panel opens or "Mark all read" is clicked: every group advances to `now`, so
 *  every currently-shown item becomes "seen". The groups come from BELL_GROUPS rather than a list written here: the
 *  approvals group was added without a watermark, so its held items stayed unread through every "Mark all read"
 *  (owner report, 2026-09-24). `sources` is unused since sow-404 removed the one group that read it. */
export function markSeen(sources = {}, now = Date.now()) {
  const seen = {};
  for (const g of BELL_GROUPS) seen[g.key] = now;
  return seen;
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
