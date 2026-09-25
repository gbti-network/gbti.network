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
  { key: 'approvals', label: 'To approve' }, // superadmin-only: syndication items holding (early approval)
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
