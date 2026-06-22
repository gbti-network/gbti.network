// SOW-058: pure message formatting for the syndication adapters. A queue item carries ONLY public-safe metadata
// (title, blurb, url, image) — never a body — so formatting cannot leak a members-only body. Author-controlled
// text is sanitized so a crafted title cannot fire a mass mention from the brand account, and each channel's
// character cap is enforced. No IO; fully unit-tested.

const TYPE_LABEL = { post: 'article', product: 'product', prompt: 'prompt', share: 'link' };

/** The link host without www (for a lead line when there is no title). */
export function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/**
 * Neutralize author-controlled mention/ping syntax for the social channels (X/Mastodon/Bluesky/LinkedIn): insert a
 * zero-width space after a leading @ so "@everyone"/"@someone" cannot resolve to a real mention, and strip the
 * common Discord mass-ping tokens defensively. (Discord itself is additionally protected by allowed_mentions.)
 */
export function sanitizeMentions(text) {
  return String(text || '')
    .replace(/@(?=[A-Za-z0-9_])/g, '@​')
    .replace(/<@[!&]?\d+>/g, '') // raw Discord mention tokens
    .replace(/@here\b/gi, 'here')
    .replace(/@everyone\b/gi, 'everyone');
}

function truncate(text, limit) {
  const s = String(text || '');
  if (!Number.isFinite(limit) || s.length <= limit) return s;
  return s.slice(0, Math.max(0, limit - 1)).trimEnd() + '…';
}

/**
 * Build the message body for a queue item, sanitized + truncated to `limit`. `includeUrl` appends the link on its
 * own line (skip it for channels that attach the link via a separate facet/card). Pure.
 */
export function buildChannelText(item = {}, { limit = 280, includeUrl = true, sanitize = true } = {}) {
  const label = TYPE_LABEL[item.source] || item.source || 'update';
  const who = item.author ? `@${item.author}` : 'a member';
  const headline = item.title || (item.url ? hostOf(item.url) : '') || 'New from the GBTI co-op';
  const lead = item.source === 'share'
    ? `New ${label} shared by ${who} on the GBTI Network`
    : `New ${label} from ${who} on the GBTI Network`;
  const blurb = item.blurb ? `\n${item.blurb}` : '';
  // Sanitize the prose FIRST so length math reflects the inserted zero-width spaces; the URL tail is left intact
  // and reserved out of the limit so it always survives truncation.
  let head = `${lead}: ${headline}${blurb}`.trim();
  if (sanitize) head = sanitizeMentions(head);
  const tail = includeUrl && item.url ? `\n${item.url}` : '';
  let text = head + tail;
  if (text.length > limit) {
    head = truncate(head, Math.max(0, limit - tail.length));
    text = head + tail;
  }
  return text;
}
