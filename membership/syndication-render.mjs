// SOW-121: the shared per-channel text builder. Produces the exact message a channel would post or queue:
// an already-sanitized manual override wins, else the configured channel template (stub-aware for a
// members-only item), else the generic "{title} {url}", rendered over the item and truncated to the channel
// cap. It is reused by the X adapter (SOW-120) AND the manual-assist enqueue paths (the drain + the manual
// Publish, SOW-121), so a Social Queue task carries the SAME text that would have auto-posted. Pure (no IO).
import { templateFor } from './syndication-config-core.mjs';
import { renderTemplate, buildChannelText } from './syndication-format.mjs';
import { channelLimit } from './syndication-channels.mjs';

export function renderChannelText(cfg, item = {}, channel, { textOverride, channelOnly = true } = {}) {
  const limit = channelLimit(channel);
  if (typeof textOverride === 'string' && textOverride.trim()) return textOverride.slice(0, limit);
  const stubish = item.membersOnly === true || String(item.visibility || '') === 'members';
  const text = cfg
    ? renderTemplate(templateFor(cfg, item.source, channel, { stub: stubish, channelOnly }) || '{title} {url}', item, { limit })
    : buildChannelText(item, { limit });
  return String(text || '').slice(0, limit);
}

// sow-260: Reddit is the one channel whose submission is not a single block of text. Every other manual
// channel (x, linkedin, dailydev) posts one message, so `renderChannelText` above is the whole task. A Reddit
// submission is a TITLE plus a URL plus a DESCRIPTION under the link, each templated separately, which is why
// the adapter resolved three templates rather than one (clients/syndication/reddit.mjs).
//
// Now that Reddit is manual-assist, a human pastes those parts by hand, so they have to be rendered somewhere
// and handed to the Social Queue. They are rendered HERE, server-side, rather than in the queue component,
// for the same reason `renderChannelText` exists: a task must carry the same text the automatic path would
// have posted, and duplicating template resolution in the UI is how those two drift apart.

/** The Reddit body cap. Reddit's own selftext limit is 40k; the adapter used 9500 and this matches it. */
export const REDDIT_BODY_LIMIT = 9500;

/**
 * The Reddit post TITLE. A Reddit title cannot contain a line break (SOW-223), and since the per-type
 * template fields became textareas an admin can type one in, so the strip happens here rather than by
 * special-casing the shared admin UI.
 */
export function renderRedditTitle(cfg, item = {}, { textOverride } = {}) {
  const limit = channelLimit('reddit');
  const strip = (v) => String(v || '').replace(/\s*\n+\s*/g, ' ').slice(0, limit);
  if (typeof textOverride === 'string' && textOverride.trim()) return strip(textOverride);
  const stubish = item.membersOnly === true || String(item.visibility || '') === 'members';
  // The fallback is '{title}' and NOT renderChannelText's generic '{title} {url}'. Reddit carries the link in
  // its own url field, so a title that also contains the URL duplicates it in the submission and wastes the
  // 300-char cap. The adapter had this right (clients/syndication/reddit.mjs used `|| '{title}'`); routing the
  // title through renderChannelText silently inherited the wrong default, and a live task showed the URL glued
  // onto the title before this was caught.
  const tpl = (cfg && templateFor(cfg, item.source, 'reddit', { stub: stubish, channelOnly: true })) || '{title}';
  return strip(renderTemplate(tpl, item, { limit }));
}

/**
 * The Reddit FIRST COMMENT: the author note, attributed to the member. Owner decision 2026-08-27.
 *
 * Reddit gives a MANUAL poster the link preview card OR body text, never both. The API could do both, which
 * is why the pre-ban automated posts carry a card AND a description (kind=link with selftext attached), but
 * the web composer has no such option and the OAuth app that reached the API is gone. The owner chose the
 * card, so the note lives in a comment posted right after the link.
 *
 * Empty is a legitimate result (an item with no author note, which is every share), and callers must treat it
 * as "there is no comment to post" rather than posting an empty string.
 */
export function renderRedditComment(cfg, item = {}) {
  if (!cfg) return '';
  const stubish = item.membersOnly === true || String(item.visibility || '') === 'members';
  const tpl = templateFor(cfg, 'reddit-comment', 'reddit', { stub: stubish }) || '';
  return String(renderTemplate(tpl, item, { limit: REDDIT_BODY_LIMIT }) || '').trim();
}

/**
 * The Reddit post BODY: the description under the link, used ONLY by the dormant adapter's kind=self path.
 * The MANUAL rail does not use it: a manual submission is a link post (for the card), which has no body, so
 * renderRedditComment carries the note instead. Empty is legitimate; treat it as "post no body".
 */
export function renderRedditBody(cfg, item = {}) {
  if (!cfg) return '';
  const stubish = item.membersOnly === true || String(item.visibility || '') === 'members';
  const tpl = templateFor(cfg, 'reddit-body', 'reddit', { stub: stubish }) || '';
  return String(renderTemplate(tpl, item, { limit: REDDIT_BODY_LIMIT }) || '').trim();
}
