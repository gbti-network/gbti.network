// sow-171 (owner, 2026-10-01: "as superadmin looking at a news source within the extension we should have an ability to
// assisted post to our syndication targets"): the rules for sharing a NEWS story to our channels, shared by the
// extension's "Share to our channels" panel and the signup Worker that records each post, so the two cannot drift.
// Pure, no IO, node-testable.
//
// A news story is someone else's reporting. Every draft credits the publication and links out (or to our own news
// page, which links out), and never reads as though GBTI wrote it. The wording is the one the owner approved on the
// design canvas (https://claude.ai/artifact/RRJgnCYYhB3Q3hCZ8sT5FT, option A).

import { channelLimit } from './syndication-channels.mjs';
import { toHashtag } from './syndication-format.mjs';
import { buildSocialTask, applyTaskAction } from './social-queue.mjs';

/** The channels a superadmin posts a story to BY HAND (assisted), in the order the panel shows them. Discord is not
 *  here: it posts straight away through /membership/news-publish. dev.to is not here either: it crossposts a repo
 *  file, and a news story has none. */
export const NEWS_SHARE_CHANNELS = Object.freeze(['x', 'bluesky', 'linkedin', 'reddit', 'dailydev']);
export const NEWS_SHARE_LABELS = Object.freeze({
  x: 'X', bluesky: 'Bluesky', linkedin: 'LinkedIn', reddit: 'Reddit', dailydev: 'daily.dev', discord: 'Discord', devto: 'dev.to',
});
/** The cap on a Reddit first comment (the same as REDDIT_BODY_LIMIT in syndication-render.mjs). */
export const NEWS_COMMENT_LIMIT = 9500;
const SITE = 'https://gbti.network';

/**
 * SOW-046 D: a news item's guid is URL-shaped (not slug-safe), so derive a deterministic, slug-safe comment
 * targetSlug "news-<hash>" from it (FNV-1a 32-bit -> base36). Same guid -> same slug across every host, so the
 * reader, the comment-publish, the CI validator and (sow-171) the Worker's share records agree without sharing state.
 * Moved here from client-ui/src/news.mjs, which re-exports it; src/lib/home-feed.mjs keeps a pinned copy.
 */
export function newsTargetSlug(guid) {
  const s = String(guid ?? '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // mix in the length so two short inputs that hash alike still differ, then base36 for a compact slug-safe tail
  return `news-${(h >>> 0).toString(36)}${(s.length % 36).toString(36)}`;
}

/** The web address a post links to: the article itself (no extension UTM tags, which would misattribute the
 *  visit), or our own news page for the story, which carries the summary, the discussion and the link out. */
export function newsShareUrl(story = {}, linkTo = 'source') {
  if (linkTo === 'gbti') {
    const g = String(story.guid || '');
    if (!g) return '';
    const s = String(story.source || '');
    return `${SITE}/news/item/?g=${encodeURIComponent(g)}${s ? `&s=${encodeURIComponent(s)}` : ''}`;
  }
  return isWebUrl(story.link) ? String(story.link) : '';
}

export function isWebUrl(u) {
  try { const x = new URL(String(u || '')); return x.protocol === 'https:' || x.protocol === 'http:'; } catch { return false; }
}

/** The story's category as one hashtag, or nothing for the catch-all "Other". */
export function newsHashtag(category) {
  const c = String(category || '').trim();
  if (!c || c.toLowerCase() === 'other') return '';
  return toHashtag(c);
}

// Shorten the TITLE so the whole line fits, never the tail, so the link and the hashtag always survive.
function fitTitle(title, tail, limit) {
  const full = `${title}${tail}`;
  if (full.length <= limit) return full;
  const room = limit - tail.length - 1; // one for the ellipsis
  if (room < 12) return full.slice(0, limit);
  return `${title.slice(0, room).trimEnd()}…${tail}`;
}

/**
 * The first draft of a post for one channel, ready for the superadmin to edit.
 *   story:     { guid, title, link, source, category, excerpt }
 *   publisher: the publication's display name (TechCrunch), falling back to the story's source
 *   linkTo:    'source' (the article) | 'gbti' (our news page)
 * Reddit returns its TITLE here; its link and first comment come from newsShareUrl and newsRedditComment.
 */
export function newsShareDraft(channel, story = {}, { linkTo = 'source', publisher = '' } = {}) {
  const title = String(story.title || 'News').replace(/\s+/g, ' ').trim();
  const pub = String(publisher || story.source || '').trim();
  const url = newsShareUrl(story, linkTo);
  const tag = newsHashtag(story.category);
  const via = pub ? `, via ${pub}` : '';
  const limit = channelLimit(channel);
  if (channel === 'x' || channel === 'bluesky') return fitTitle(title, `${via} ${url}${tag ? ` ${tag}` : ''}`, limit);
  if (channel === 'dailydev') return fitTitle(title, `${via} ${url}`, limit);
  if (channel === 'reddit') return fitTitle(title, pub ? ` (${pub})` : '', limit);
  if (channel === 'linkedin') {
    const lead = String(story.excerpt || '').trim() || title;
    const tail = `\n\nRead the full story${pub ? ` on ${pub}` : ''}:\n${url}${tag ? `\n\n${tag}` : ''}`;
    return fitTitle(lead, tail, limit);
  }
  return '';
}

/** The first comment under a Reddit link post. It says where the reporting comes from and where the link goes. */
export function newsRedditComment(story = {}, { linkTo = 'source', publisher = '' } = {}) {
  const pub = String(publisher || story.source || '').trim() || 'the publication';
  const where = linkTo === 'gbti' ? 'our page links to the full story.' : 'the link above is the full story.';
  return `Shared from the GBTI Network news feed. The reporting is by ${pub}; ${where}`;
}

/** Switching "Link to" keeps the superadmin's edits: the old address inside the text becomes the new one. */
export function swapLink(text, fromUrl, toUrl) {
  const t = String(text ?? '');
  return fromUrl && toUrl && fromUrl !== toUrl ? t.split(fromUrl).join(toUrl) : t;
}

/** SOW-046 C: the Discord message for a news story (moved here unchanged from membership-news-publish.mjs, so the
 *  panel's preview is exactly what posts). The Discord client defaults allowed_mentions to { parse: [] }, so no
 *  mention in any field is ever parsed. */
export function formatNewsPost(item) {
  const title = String(item?.title || 'News').slice(0, 280);
  const link = String(item?.link || '').slice(0, 500);
  const source = item?.source ? String(item.source).slice(0, 80) : '';
  return `📰 **${title}**${source ? `\n_via ${source}_` : ''}${link ? `\n${link}` : ''}`;
}

/**
 * Check a "Mark done" record from the panel and turn it into the DONE Social Queue task the Worker stores, so the
 * post lists under Manual done and every superadmin's panel shows the channel as posted. Returns { ok, task } or
 * { ok:false, message }. The text is what the superadmin posted, capped to the channel; nothing here is posted.
 */
export function newsShareDoneTask(body = {}, { actor = {}, now = 0 } = {}) {
  const guid = String(body.guid || '').trim().slice(0, 480);
  const channel = String(body.channel || '');
  if (!guid) return { ok: false, message: 'a news story guid is required' };
  if (!NEWS_SHARE_CHANNELS.includes(channel)) return { ok: false, message: `a news story cannot be recorded as posted to ${channel || 'that channel'}` };
  const url = String(body.url || '').trim();
  if (!isWebUrl(url)) return { ok: false, message: 'the post needs the web address it linked to' };
  const text = String(body.text || '').trim().slice(0, channelLimit(channel));
  if (!text) return { ok: false, message: 'the post text is empty' };
  const slug = newsTargetSlug(guid);
  const item = {
    id: slug, source: 'news', targetType: 'news', targetSlug: slug,
    title: String(body.title || 'News').slice(0, 300), url: url.slice(0, 1000),
    category: body.category ? String(body.category).slice(0, 80) : undefined,
  };
  const commentText = channel === 'reddit' ? String(body.commentText || '').trim().slice(0, NEWS_COMMENT_LIMIT) : '';
  const pending = buildSocialTask({ item, channel, text, commentText, trigger: 'manual', now });
  const { task } = applyTaskAction(pending, 'done', actor, now);
  return { ok: true, task: { ...task, guid, doneByLogin: actor.login ? String(actor.login) : null } };
}

/** The id of a story's done record for one channel (the same id newsShareDoneTask writes). */
export const newsShareTaskId = (guid, channel) => `${newsTargetSlug(String(guid || '').trim().slice(0, 480))}::${channel}`;
