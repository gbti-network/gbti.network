// SOW-042 P3: the PURE aggregation behind <gbti-activity-bell>. The element fans out to the existing per-member
// reads (each fail-closed to []), normalizes them to a common notification shape { id, ts, title, sub, href }, and
// hands the four arrays here with the localStorage watermark to compute the unread badge + grouped lists. No DOM,
// no client -> node-testable (the SOW P5 contract: an errored source contributes ZERO, never a phantom unread).
//
// Unread model: replies / following use a per-source ms watermark (their items carry a real timestamp);
// Your-PRs has no reliable timestamp in both host modes (classic search-issues vs the App my-pulls proxy), so it
// uses a seen-SET of resolved PR numbers instead. A Locked/unknown account never reaches here (the element hides).

import { toMs } from './all-merge.mjs';

export const BELL_GROUPS = [
  { key: 'approvals', label: 'To approve' }, // superadmin-only: syndication items holding (early approval)
  { key: 'replies', label: 'Replies' },
  { key: 'following', label: 'Following' },
  { key: 'prs', label: 'Your PRs' },
  // sow-274: the 'To review' group (incoming contributions) is gone with the contribution review surface.
];

/** The unread items of one group given the seen watermark. PRs compare against a seen-SET of ids; the timestamped
 *  groups compare a normalized ms `ts` against the per-source ms mark. A non-array source is treated as empty. */
export function unreadItems(group, items, seen = {}) {
  const list = Array.isArray(items) ? items : [];
  if (group === 'prs') {
    const seenIds = new Set((seen.prsSeen || []).map(String));
    return list.filter((it) => !seenIds.has(String(it.id)));
  }
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

/** The watermark to persist when the panel opens or "Mark all read" is clicked: every currently-shown item becomes
 *  "seen". Every timestamped group advances to `now`; PRs record the current resolved set so only LATER resolutions
 *  re-badge. The groups come from BELL_GROUPS rather than a list written here: the approvals group was added without
 *  a watermark, so its held items stayed unread through every "Mark all read" (owner report, 2026-09-24). */
export function markSeen(sources = {}, now = Date.now()) {
  const seen = {};
  for (const g of BELL_GROUPS) if (g.key !== 'prs') seen[g.key] = now;
  seen.prsSeen = (Array.isArray(sources.prs) ? sources.prs : []).map((it) => String(it.id));
  return seen;
}

/** When a resolved PR's event happened, in ms: merged, else closed, else last updated; 0 when none is known, so the
 *  row shows no time. The bell once used the PR NUMBER here, which rendered as a 1970 date ("56 years ago"). */
export function prTime(p) {
  return toMs(p?.mergedAt) || toMs(p?.closedAt) || toMs(p?.updatedAt) || 0;
}
