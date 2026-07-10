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
/**
 * SOW-087: render a configured Discord post template over a queue item. Variables:
 *   {memberdiscord}  the resolved `<@id>` mention; when none resolves it falls back to the NO-PING full name
 *   {fullName}       the profile displayName (fallback @login text; sanitized, never pings)
 *   {author}         the @login text (sanitized, never pings)
 *   {member-url}     the member's public profile URL (gbti.network/members/<login>/)
 *   {short-description}  the item's shortDescription (carried as the queue item blurb)
 *   {shareurl} {url} the item's link
 *   {title} {category}  the item metadata
 * Every substitution EXCEPT the validated `<@id>` mention passes through sanitizeMentions, so an
 * author-controlled displayName/title can never fire a mass mention (the adapter's allowed_mentions guard
 * additionally caps pings to the author id). Unknown {tokens} render empty; whitespace collapses. Pure.
 */
export function renderTemplate(template, item = {}, { limit = 2000 } = {}) {
  const mention = /^<@!?\d+>$/.test(String(item.mention || '')) ? item.mention : null;
  const fullName = sanitizeMentions(item.authorName || (item.author ? `@${item.author}` : 'a member'));
  // {member-discord-username}: the member's Discord identity, best-first: a resolved <@id> mention, then
  // their public profile Discord handle (item.authorDiscord), then the GitHub username (owner-decided
  // fallback chain). Plain-text handles are sanitized and Discord's allowed_mentions caps pings anyway.
  // A profile's discord link is often an INVITE URL (discord.gg/...), which is not a username: only a
  // handle-shaped value (Discord usernames: 2-32 chars of letters/digits/underscore/period) is used;
  // anything else falls through to the GitHub username.
  const rawHandle = String(item.authorDiscord || '').trim().replace(/^@/, '');
  const discordHandle = /^[A-Za-z0-9._]{2,32}$/.test(rawHandle) && !/[\/:]/.test(rawHandle) ? rawHandle : '';
  const discordUsername = mention
    || sanitizeMentions(`@${discordHandle || item.author || 'a member'}`);
  const vars = {
    memberdiscord: mention || fullName, // the owner-decided fallback: full name, no ping
    memberdiscordusername: discordUsername,
    contenttype: TYPE_LABEL[item.source] || 'item', // {content-type}: article / product / prompt / link
    fullname: fullName,
    author: sanitizeMentions(item.author ? `@${item.author}` : 'a member'),
    shareurl: String(item.url || ''),
    url: String(item.url || ''),
    title: sanitizeMentions(item.title || ''),
    category: sanitizeMentions(item.category || ''),
    authornote: sanitizeMentions(item.authorNote || ''), // {author-note}: the from-the-author intro (public items only)
    memberurl: item.author ? `https://gbti.network/members/${encodeURIComponent(String(item.author))}/` : '', // {member-url}: the public profile
    shortdescription: sanitizeMentions(item.blurb || ''), // {short-description}: the item's shortDescription (the queue item's blurb)
  };
  // Hyphenated token names ({member-discord-username}, {content-type}) normalize to the same key.
  const text = String(template || '')
    .replace(/\{([a-zA-Z-]+)\}/g, (_, name) => vars[name.toLowerCase().replace(/-/g, '')] ?? '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return truncate(text, limit);
}

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
