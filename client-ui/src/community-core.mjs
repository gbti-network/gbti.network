// sow-494: the pure view rules for Community, shared by the list, the entry page, the discussion and the manager.
// Node-free and DOM-free, so test/community-core.test.mjs pins every label a member reads.
import { KIND_LABEL, isPollKind, LIMITS, REACTIONS, normalizeTyped, typedMax } from '../../membership/community-shared.mjs';

export { KIND_LABEL, isPollKind, LIMITS, REACTIONS, normalizeTyped, typedMax };

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Two letters for an avatar circle, from a GBTI name or GitHub login. */
export function initials(name) {
  const s = String(name || '').replace(/^@/, '').trim();
  if (!s) return '?';
  const parts = s.split(/[\s._-]+/).filter(Boolean);
  const two = parts.length > 1 ? parts[0][0] + parts[1][0] : s.slice(0, 2);
  return two.toUpperCase();
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-11-07" as "November 7". Read as a calendar date, so no time zone can move it a day. */
export function meetingDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return '';
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}` : '';
}

/** The meeting an entry belongs to: "Shop Talk, November 7", or "Between meetings". */
export function meetingText(meeting) {
  const label = String(meeting?.label || '').trim();
  if (!label) return 'Between meetings';
  const d = meetingDate(meeting?.date);
  return d ? `${label}, ${d}` : label;
}

/** The pill an entry carries, if any. */
export function statusPill(entry) {
  const poll = isPollKind(entry?.kind);
  switch (entry?.status) {
    case 'live': return { tone: 'live', text: 'Live' };
    case 'closed': return { tone: 'muted', text: poll ? 'Voting closed' : 'Closed' };
    case 'published': return { tone: 'outline', text: 'Results' };
    case 'draft': return { tone: 'muted', text: 'Draft' };
    default: return null;
  }
}

/** The line under a list row's title: the meeting, who started it, and where a poll stands. */
export function rowMeta(entry) {
  const parts = [meetingText(entry?.meeting)];
  if (entry?.author?.login) parts.push(entry.author.login);
  if (entry?.status === 'published') parts.push('results published');
  else if (entry?.status === 'closed' && isPollKind(entry.kind)) parts.push('voting closed');
  else if (entry?.status === 'draft') parts.push('only superadmins see it');
  if (entry?.access?.mode === 'chosen') parts.push(`shared with ${plural(entry.access.count ?? 0, 'member')}`);
  return parts.join(' · ');
}

/** The list's Discussion column: the post count, with answers or photos beneath. */
export function discussionCell(entry) {
  const c = entry?.counts || {};
  const posts = Number(c.posts) || 0;
  if (isPollKind(entry?.kind)) return { count: posts, sub: plural(Number(c.answers) || 0, 'answer') };
  const photos = Number(c.withImages) || 0;
  return { count: posts, sub: photos ? `${photos} with photos` : '' };
}

/** A published poll's one-line result for the list: "Results: Agents led with 52% of 23 answers". */
export function resultLine(entry) {
  const lead = entry?.lead;
  if (!lead || !lead.total || entry?.status !== 'published') return '';
  return `Results: ${lead.label} led with ${Math.round((lead.count / lead.total) * 100)}% of ${plural(lead.total, 'answer')}`;
}

export const entryHref = (id) => `/community/entry/?id=${encodeURIComponent(String(id || ''))}`;

/**
 * Result bars from a results block: label, count, a whole percent of the total, the leading group (or groups, on a
 * tie) and the viewer's own. An empty poll leads with nothing.
 */
export function barRows(results) {
  const groups = Array.isArray(results?.groups) ? results.groups : [];
  const total = Number(results?.total) || 0;
  const max = groups.reduce((m, g) => Math.max(m, Number(g.count) || 0), 0);
  return groups.map((g) => {
    const count = Number(g.count) || 0;
    return { key: g.key, label: g.label, count, pct: total ? Math.round((count / total) * 100) : 0, lead: max > 0 && count === max, mine: g.mine === true };
  });
}

/** Where a member stands on a poll. */
export function answerState(entry, mine) {
  if (!entry) return 'missing';
  if (entry.status === 'draft') return 'draft';
  if (entry.status === 'published') return 'published';
  if (entry.status === 'closed') return 'closed';
  return mine ? 'answered' : 'open';
}

/** How long the entry page waits before asking for changes: often while live and in view, rarely otherwise. */
export function pollDelay({ live, visible }) {
  if (!visible) return null;
  return live ? 4000 : 20000;
}

export function formatBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export const IMAGE_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** Why a picked file cannot be attached, as the two lines the composer shows, or null when it can. */
export function uploadProblem({ name, size, type } = {}) {
  const n = String(name || 'That file');
  if (!IMAGE_TYPES.includes(String(type || ''))) return { title: `${n} is not a picture we can show.`, detail: 'Use a PNG, JPG, WebP or GIF.' };
  if ((Number(size) || 0) > LIMITS.imageBytes) return { title: `${n} is ${formatBytes(size)}.`, detail: 'Images can be up to 1 MB. Save a smaller copy and add it again.' };
  return null;
}

/** The address of an image's bytes. The cookie rides along because the site and the Worker are the same site. */
export function imageSrc(base, entryId, imageId) {
  return `${String(base || '').replace(/\/$/, '')}/membership/community/image?id=${encodeURIComponent(entryId)}&img=${encodeURIComponent(imageId)}`;
}

/** "Shared with 6 members", or "Shared with all members". */
export function sharedLine(access) {
  if (!access || access.mode === 'all') return 'Shared with all members';
  return `Shared with ${plural(Number(access.count ?? access.members?.length ?? 0), 'member')}`;
}

/** Posts and replies in a discussion, for "9 posts · 23 replies". */
export function threadCounts(discussion) {
  const posts = Array.isArray(discussion?.posts) ? discussion.posts : [];
  let top = 0;
  let replies = 0;
  for (const p of posts) {
    if (!p.deleted) top++;
    replies += (p.replies || []).filter((r) => !r.deleted).length;
  }
  return { posts: top, replies };
}

/** The count line under a poll's answer card. */
export function answeredLine(entry) {
  const n = Number(entry?.counts?.answers) || 0;
  const who = n === 1 ? '1 member has answered' : `${n} members have answered`;
  if (entry?.status === 'published') return `${who}.`;
  return `${who}. Results appear here once they are published.`;
}

/** The newest rows first when a member opens the page, the way the list is ordered: live, then recent activity. */
export function sortEntries(entries) {
  return [...(entries || [])].sort((a, b) => (b.status === 'live') - (a.status === 'live') || (b.activityAt || 0) - (a.activityAt || 0));
}

/** The meeting choices a superadmin picks from: the next four Saturdays' Shop Talk and the last two. */
export function shoptalkMeetings(now = new Date(), { label = 'Shop Talk', back = 2, ahead = 4 } = {}) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const toSat = (6 - d.getDay() + 7) % 7;
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + toSat);
  const out = [];
  for (let i = -back; i < ahead; i++) {
    const s = new Date(next.getFullYear(), next.getMonth(), next.getDate() + i * 7);
    const ymd = `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}-${String(s.getDate()).padStart(2, '0')}`;
    out.push({ label, date: ymd, text: `${label}, Saturday ${meetingDate(ymd)}`, next: i === 0 });
  }
  return out;
}
