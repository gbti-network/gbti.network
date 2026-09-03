// SOW-186 C2: the PURE view-model behind <gbti-notification-bell>. The website header bell shows "members I
// follow published something", computed ON READ (ruling R1 + the owner design handoff) from the follow list
// intersected with the public activity index, ranked newest-first, with unread measured against a localStorage
// watermark. No DOM, no client, so it is node-testable. The dormant server notification store is intentionally
// NOT read here (deliverNotification has no production writer yet); it stays for a future at-mention writer to
// merge in.

import { toMs } from './all-merge.mjs';

// The verb shown between the actor and the item title, by content type, to match the design row
// ("<b>actor</b> action <target>"). Anything unmapped reads as a plain "published".
export const NOTIFY_ACTION = {
  article: 'published',
  project: 'published',
  prompt: 'published',
  share: 'shared',
  news: 'curated',
};

export const MAX_BELL_ROWS = 30;

/** Build the bell view-model.
 *  - `follows`   = the getFollows() `following` array ([{ username }]).
 *  - `entries`   = the public activity-index entries ([{ author, type, title, url?, path?, publishedAt }]).
 *  - `watermark` = the ms timestamp of the last "mark all read" (0 = never, so everything is unread).
 *  Returns { rows (newest-first, capped at `max`), unread, followCount }. A non-array input is treated as
 *  empty; an entry whose author is not in the follow set is dropped. */
export function buildFollowingBell({ follows = [], entries = [], watermark = 0, max = MAX_BELL_ROWS } = {}) {
  const set = new Set(
    (Array.isArray(follows) ? follows : [])
      .map((f) => String(f?.username || '').toLowerCase())
      .filter(Boolean),
  );
  if (!set.size) return { rows: [], unread: 0, followCount: 0 };
  const mark = Number(watermark) || 0;
  const cap = Number(max) > 0 ? Number(max) : MAX_BELL_ROWS;
  const rows = (Array.isArray(entries) ? entries : [])
    .filter((e) => e && set.has(String(e.author || '').toLowerCase()))
    .map((e) => {
      const ts = toMs(e.publishedAt);
      const type = String(e.type || '');
      return {
        id: `${type}:${e.path || e.url || e.title || ''}`,
        actor: String(e.author || ''),
        action: NOTIFY_ACTION[type] || 'published',
        target: String(e.title || 'new activity'),
        url: String(e.url || ''),
        type,
        ts,
        unread: ts > mark,
      };
    })
    .sort((a, b) => b.ts - a.ts)
    .slice(0, cap);
  const unread = rows.reduce((n, r) => n + (r.unread ? 1 : 0), 0);
  return { rows, unread, followCount: set.size };
}

/** The badge label for an unread count (the design caps at "9+"). */
export function unreadLabel(n) {
  const c = Number(n) || 0;
  return c > 9 ? '9+' : String(c);
}
