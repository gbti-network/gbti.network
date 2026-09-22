// SOW-186 C2: the PURE view-model behind <gbti-notification-bell>. The website header bell shows "members I
// follow published something", computed ON READ (ruling R1 + the owner design handoff) from the follow list
// intersected with the public activity index, ranked newest-first, with unread measured against a localStorage
// watermark. No DOM, no client, so it is node-testable. The dormant server notification store is intentionally
// NOT read here (deliverNotification has no production writer yet); it stays for a future at-mention writer to
// merge in.
//
// sow-386: BOTH bells (this one and the extension's <gbti-activity-bell>) now pass every candidate through
// selectBellEntries, which applies the member's In app settings. Before it, the settings page stored them and
// nothing read them, so muting someone changed nothing. It also adds two sources the settings page already
// offered and no bell showed: public SHARES from people you follow (the site's /shares-index.json), and, for
// paying members, NEWS from the sources they follow (the Worker's members-only /membership/news-following).

import { toMs } from './all-merge.mjs';
import { resolveNotify, normalizeNotify } from '../../membership/notify-resolve.mjs';

// The verb shown between the actor and the item title, by content type, to match the design row
// ("<b>actor</b> action <target>"). Anything unmapped reads as a plain "published". A news row's actor is the
// publication, so it "published" too.
export const NOTIFY_ACTION = {
  article: 'published',
  project: 'published',
  prompt: 'published',
  share: 'shared',
  news: 'published',
};

export const MAX_BELL_ROWS = 30;

// sow-386: a list entry's type -> the settings row key it is governed by. The activity index calls an article
// `post`, the settings page calls it `article`, and a fix keyed on the raw type would have left every muted article
// showing. The email path keeps its OWN map (membership/mail-notify.mjs, which deliberately has no `share`, because
// shares send no email); test/notification-bell-core.test.mjs asserts the two agree on every type they share. An
// unknown future type falls through as itself, so it resolves against the system default (in app on) rather than
// vanishing.
export const BELL_EVENT_FOR_TYPE = Object.freeze({
  post: 'article',
  article: 'article',
  project: 'project',
  prompt: 'prompt',
  share: 'share',
  news: 'news',
});

export function bellEventFor(type) {
  const t = String(type || '');
  return BELL_EVENT_FOR_TYPE[t] || t;
}

/** Whether the in-app channel is on for one event, given a follow's own settings and the page-wide ones. The
 *  precedence is resolveNotify's, the same one the settings page shows: the follow, then the page-wide default,
 *  then the system default (in app ON). `global` undefined (a failed settings read) therefore shows everything. */
export function inAppOn({ event, follow, global } = {}) {
  return resolveNotify({ event, follow: normalizeNotify(follow), global: normalizeNotify(global) }).api === true;
}

/** Every entry the bell may show, filtered by the In app settings, newest first, UNCAPPED and without unread
 *  (the two bells cap and mark unread differently).
 *  - `follows` = the getFollows() `following` array ([{ username, notify? }]).
 *  - `entries` = the public activity-index entries ([{ author, type: post|project|prompt, title, url, path?, publishedAt }]).
 *  - `shares`  = the public shares-index entries (the same shape, type share).
 *  - `news`    = the members-only followed-news rows ([{ guid, source, sourceName, title, link, publishedAt(ms) }]);
 *                an empty array for anyone the Worker refused, which is how a free account gets none.
 *  - `global`  = the member's page-wide settings (prefs.notify), or undefined when the read failed.
 *  Each row: { id, kind: 'person'|'news', type, event, actor, action, target, url, path, ts }. */
export function selectBellEntries({ follows = [], entries = [], shares = [], news = [], global } = {}) {
  const notifyBy = new Map();
  for (const f of Array.isArray(follows) ? follows : []) {
    const u = String(f?.username || '').toLowerCase();
    if (u) notifyBy.set(u, f?.notify);
  }
  const people = [...(Array.isArray(entries) ? entries : []), ...(Array.isArray(shares) ? shares : [])]
    .filter((e) => e && notifyBy.has(String(e.author || '').toLowerCase()))
    .map((e) => {
      const type = String(e.type || '');
      return { e, type, event: bellEventFor(type) };
    })
    .filter(({ e, event }) => inAppOn({ event, follow: notifyBy.get(String(e.author || '').toLowerCase()), global }))
    .map(({ e, type, event }) => ({
      id: `${type}:${e.path || e.url || e.title || ''}`,
      kind: 'person',
      type,
      event,
      actor: String(e.author || ''),
      action: NOTIFY_ACTION[event] || 'published',
      target: String(e.title || 'new activity'),
      url: String(e.url || ''),
      path: e.path ? String(e.path) : '',
      ts: toMs(e.publishedAt),
    }));
  // News is not about a person, so no follow's settings apply: only the page-wide News row does.
  const newsOn = inAppOn({ event: 'news', global });
  const stories = (newsOn && Array.isArray(news) ? news : [])
    .filter((n) => n && n.guid && /^https?:\/\//i.test(String(n.link || '')))
    .map((n) => ({
      id: `news:${n.guid}`,
      kind: 'news',
      type: 'news',
      event: 'news',
      actor: String(n.sourceName || n.source || 'News'),
      action: NOTIFY_ACTION.news,
      target: String(n.title || 'a new story'),
      url: String(n.link),
      path: '',
      ts: toMs(n.publishedAt),
    }));
  return [...people, ...stories].sort((a, b) => b.ts - a.ts);
}

/** Build the website bell view-model: selectBellEntries capped at `max`, with unread measured against
 *  `watermark` (the ms timestamp of the last "mark all read"; 0 = never, so everything is unread).
 *  Returns { rows, unread, followCount }. */
export function buildFollowingBell({ follows = [], entries = [], shares = [], news = [], global, watermark = 0, max = MAX_BELL_ROWS } = {}) {
  const followCount = new Set(
    (Array.isArray(follows) ? follows : []).map((f) => String(f?.username || '').toLowerCase()).filter(Boolean),
  ).size;
  const mark = Number(watermark) || 0;
  const cap = Number(max) > 0 ? Number(max) : MAX_BELL_ROWS;
  const rows = selectBellEntries({ follows, entries, shares, news, global })
    .slice(0, cap)
    .map((r) => ({ ...r, unread: r.ts > mark }));
  const unread = rows.reduce((n, r) => n + (r.unread ? 1 : 0), 0);
  return { rows, unread, followCount };
}

/** The badge label for an unread count (the design caps at "9+"). */
export function unreadLabel(n) {
  const c = Number(n) || 0;
  return c > 9 ? '9+' : String(c);
}
