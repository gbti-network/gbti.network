// SOW-186 C3: the PURE model behind the account notifications settings (the default matrix, the per-follow
// modal, and the follows-list summary). No DOM, no client, so it is node-testable. It reuses the AUTHORITATIVE
// resolver (membership/notify-resolve.mjs) rather than duplicating the precedence, so what the UI shows as
// "effective" is exactly what delivery computes: per channel, a per-follow override wins, then the member's
// global default, then the system default (in-app ON, email OFF). The design settled the model as one global
// default with sparse per-follow overrides; this core carries that shape.
import { resolveNotify, normalizeNotify, EMAIL_NOTIFICATIONS_ENABLED } from '../../membership/notify-resolve.mjs';

// sow-385 (owner ruling 2026-09-21): email notifications are switched off for now. Re-exported so both settings
// surfaces read the one switch, and the tooltip copy is the owner's wording, verbatim, in one place.
export { EMAIL_NOTIFICATIONS_ENABLED };
export const EMAIL_DISABLED_TIP = 'Email Notifications Disabled at this time';

/** sow-385: whether a settings channel is blocked from being turned on. Only email, and only while email
 *  notifications are off. Both surfaces render the blocked pill from this, so they cannot disagree. */
export function channelBlocked(channel, { emailEnabled = EMAIL_NOTIFICATIONS_ENABLED } = {}) {
  return channel === 'email' && !emailEnabled;
}

// sow-386 (owner ruling 2026-09-22): the News row brings new stories from the news sources a member follows into the
// bell, and it is a MEMBERS-only feature, "not available for the free tier users". A free account sees its switch
// locked, in the same style as a blocked Email pill, with this tooltip. The Worker read behind it is the real gate
// (/membership/news-following is authorizePaid); this only decides how the switch looks.
export const NEWS_MEMBERS_TIP = 'News alerts are for members';

/** The tooltip for a cell that cannot be switched on, or '' for a cell that can. Email while email notifications
 *  are off; the News row for anyone who is not a paying member. Both settings surfaces and both toggle guards read
 *  this, so the look and the behaviour cannot disagree. `paid` defaults to true so a caller that has no notion of
 *  tier (and the email-only tests) keeps the sow-385 behaviour. */
export function cellBlockedTip(key, channel, { emailEnabled = EMAIL_NOTIFICATIONS_ENABLED, paid = true } = {}) {
  if (channelBlocked(channel, { emailEnabled })) return EMAIL_DISABLED_TIP;
  if (key === 'news' && !paid) return NEWS_MEMBERS_TIP;
  return '';
}

// The five rows of the settings matrix, mapping the design labels to the stored event keys. `prompt` carries
// the design's merged "Prompts and skills". sow-386: `news` is new stories from the news SOURCES a member follows
// (members only), so it belongs to the page-wide grid alone; PERSON_ROWS below is the four rows a single followed
// member can send, which is what the per-person modal and the follows-list summaries use.
export const MATRIX_ROWS = Object.freeze([
  { key: 'article', label: 'Articles' },
  { key: 'project', label: 'Projects' },
  { key: 'prompt', label: 'Prompts and skills' },
  { key: 'share', label: 'Shares' },
  { key: 'news', label: 'News' }, // sow-385: was "News they curate" (owner, 2026-09-21)
]);

export const PERSON_ROWS = Object.freeze(MATRIX_ROWS.filter((r) => r.key !== 'news'));

/** Resolve the full matrix ({ [key]: { api, email } }) for a (follow, global) pair, each row via the shared
 *  resolver. `followNotify` undefined = the "use my default" case (every row falls to the global default).
 *
 *  sow-385: while email notifications are off, every row's email reads OFF, including for a member who stored it
 *  on before, because nothing will be sent and the page must not say otherwise. `emailEnabled` exists so the
 *  tests can keep proving the email behaviour for the day it returns. */
export function resolveMatrix(followNotify, globalNotify, { emailEnabled = EMAIL_NOTIFICATIONS_ENABLED, paid = true, rows = MATRIX_ROWS } = {}) {
  const f = normalizeNotify(followNotify);
  const g = normalizeNotify(globalNotify);
  const out = {};
  for (const r of rows) {
    const cell = resolveNotify({ event: r.key, follow: f, global: g });
    out[r.key] = emailEnabled ? cell : { ...cell, email: false };
    // sow-386: a free account's News row reads OFF, because nothing will arrive, whatever is stored.
    if (r.key === 'news' && !paid) out[r.key] = { api: false, email: false };
  }
  return out;
}

/** The matrix for the member's GLOBAL DEFAULT (each row = the stored global value, falling through to the
 *  system default per channel). Seeds the account page's "Default for everyone you follow" card. */
export function defaultMatrix(globalNotify, opts) {
  return resolveMatrix(undefined, globalNotify, opts);
}

/** Serialize an editable matrix back into the stored event-keyed notify object. Every row is written
 *  explicitly (the grid shows all rows), so a saved value is complete and does not silently drift when the
 *  global default later changes. */
export function matrixToNotify(matrix, { rows = MATRIX_ROWS, paid = true, global } = {}) {
  const out = {};
  for (const r of rows) {
    // sow-386: a free account's News row is shown OFF but was never theirs to change, so saving another row must
    // not write that display value over what is stored (a member who pays later would find News switched off).
    // The stored bag is carried through untouched, or left absent so it keeps falling to the default.
    if (r.key === 'news' && !paid) {
      const kept = normalizeNotify(global)?.news;
      if (kept) out.news = kept;
      continue;
    }
    const cell = (matrix && matrix[r.key]) || {};
    out[r.key] = { api: !!cell.api, email: !!cell.email };
  }
  return out;
}

/** Toggle one channel of one row, returning a NEW matrix (never mutates the input). sow-385: while email
 *  notifications are off, the email channel does not toggle. The surfaces also block the click; this is the
 *  second guard, so no path through the core can turn email on. */
export function toggleCell(matrix, key, channel, { emailEnabled = EMAIL_NOTIFICATIONS_ENABLED, paid = true, rows = MATRIX_ROWS } = {}) {
  const next = {};
  for (const r of rows) next[r.key] = { ...((matrix && matrix[r.key]) || {}) };
  if (cellBlockedTip(key, channel, { emailEnabled, paid })) return next;
  if (next[key] && (channel === 'api' || channel === 'email')) next[key][channel] = !next[key][channel];
  return next;
}

/** Whether a follow carries its own override (the Custom tag) vs following the global default. */
export function isCustomFollow(follow) {
  return !!normalizeNotify(follow && follow.notify);
}

/** The one-line summary of a follow's EFFECTIVE prefs, for the account follows list. Mirrors the design's
 *  summarise(): "Muted, nothing arrives" | "Everything, in app and by email" | "Everything, in app only" |
 *  "Articles, projects, email on". `follow` may be a default-mode follow (no notify) or a custom one. */
export function summarizeFollow(follow, globalNotify, opts) {
  // sow-386: a follow is a PERSON, and News comes from sources, so the summary is over the four person rows.
  const matrix = resolveMatrix(follow && follow.notify, globalNotify, opts);
  return summarizeMatrix(matrix, PERSON_ROWS);
}

/** The one-line summary of a resolved matrix, over `rows` (every row by default). */
export function summarizeMatrix(matrix, rows = MATRIX_ROWS) {
  const on = rows.filter((r) => matrix && matrix[r.key] && (matrix[r.key].api || matrix[r.key].email));
  if (!on.length) return 'Muted, nothing arrives';
  const anyMail = rows.some((r) => matrix && matrix[r.key] && matrix[r.key].email);
  if (on.length === rows.length) return anyMail ? 'Everything, in app and by email' : 'Everything, in app only';
  const names = on.map((r) => r.label.toLowerCase()).join(', ');
  return names.charAt(0).toUpperCase() + names.slice(1) + (anyMail ? ', email on' : '');
}

/** The notify value to save for a modal in `mode` with the given edited matrix: a full object for "custom", or
 *  null for "default" (which clears the per-follow override back to the global default, the "Use my default"
 *  action). The Worker + the pure follow core both read null/empty as "clear". */
export function notifyPayload(mode, matrix, opts) {
  return mode === 'custom' ? matrixToNotify(matrix, opts) : null;
}
