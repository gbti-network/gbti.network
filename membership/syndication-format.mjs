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
 * SOW-120 follow-up: extract a bare X handle from a profile value. Accepts a full x.com / twitter.com URL
 * (the last path segment), a bare "@handle", or a bare "handle"; returns '' for anything that is not a
 * plausible handle (X handles are 1-15 chars of letters/digits/underscore). Pure.
 */
export function xHandleFrom(value) {
  let s = String(value || '').trim();
  if (!s) return '';
  const m = s.match(/^https?:\/\/(?:www\.)?(?:x|twitter|mobile\.twitter)\.com\/([^/?#]+)/i);
  if (m) s = m[1];
  s = s.replace(/^@/, '').trim();
  return /^[A-Za-z0-9_]{1,15}$/.test(s) ? s : '';
}

/**
 * SOW-122 follow-up: extract a Bluesky handle from a profile value. Accepts a bsky.app profile URL
 * (`https://bsky.app/profile/<handle>`), a bare "@handle", or a bare "handle". A Bluesky handle is a
 * domain-shaped string (labels of letters/digits/hyphen separated by dots, e.g. `atwellpub.bsky.social` or a
 * custom domain). Returns '' for anything implausible. Pure.
 */
export function blueskyHandleFrom(value) {
  let s = String(value || '').trim();
  if (!s) return '';
  const m = s.match(/^https?:\/\/(?:www\.)?bsky\.app\/profile\/([^/?#]+)/i);
  if (m) s = m[1];
  s = s.replace(/^@/, '').trim();
  return /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?)+$/i.test(s) ? s : '';
}

/**
 * SOW-123: extract a Mastodon fediverse address (`user@instance`) from a profile value. Accepts an instance
 * profile URL (`https://<instance>/@<user>`), a bare "@user@instance", or a bare "user@instance". Returns ''
 * for anything implausible. The instance must be a domain; the user is letters/digits/underscore. Mastodon
 * renders "@user@instance" in status text as a native mention, so no facet is needed. Pure.
 */
export function mastodonHandleFrom(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const domain = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?)+$/i;
  const url = raw.match(/^https?:\/\/([^/]+)\/@([A-Za-z0-9_]+)\/?$/i);
  if (url && domain.test(url[1])) return `${url[2]}@${url[1].toLowerCase()}`;
  const parts = raw.replace(/^@/, '').split('@');
  if (parts.length === 2 && /^[A-Za-z0-9_]+$/.test(parts[0]) && domain.test(parts[1])) return `${parts[0]}@${parts[1].toLowerCase()}`;
  return '';
}

/**
 * Extract a Reddit username from a profile value. Accepts a reddit.com/user/<name> (or /u/<name>) URL, a
 * bare "u/name", "/u/name", "@name", or a bare "name"; returns '' for anything implausible (Reddit
 * usernames are 3-20 chars of letters/digits/underscore/hyphen). Pure.
 */
export function redditHandleFrom(value) {
  let s = String(value || '').trim();
  if (!s) return '';
  const m = s.match(/^https?:\/\/(?:www\.|old\.)?reddit\.com\/u(?:ser)?\/([^/?#]+)/i);
  if (m) s = m[1];
  s = s.replace(/^\/?u\//i, '').replace(/^@/, '').trim();
  return /^[A-Za-z0-9_-]{3,20}$/.test(s) ? s : '';
}

/**
 * SOW-120 follow-up: normalize a free-form tag or category label into a single hashtag token. Splits on any
 * non-alphanumeric run, capitalizes the first letter of each part (so a multi-word label survives as one
 * token and a single word keeps its casing, preserving acronyms), and prefixes '#'. Returns '' when nothing
 * usable remains. Examples: "agent skills" -> "#AgentSkills", "Claude-Code" -> "#ClaudeCode", "AI" -> "#AI".
 */
export function toHashtag(label) {
  const parts = String(label || '').split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!parts.length) return '';
  const body = parts.length === 1 ? parts[0] : parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
  return body ? `#${body}` : '';
}

/**
 * SOW-121: the FREE web-composer URL for a manual-assist channel, pre-filled with the rendered message so a
 * superadmin can post the item by hand (no paid API call). X opens the intent composer; other channels have
 * no simple pre-filled composer yet, so they return null (the Social Queue then offers copy-only). Pure.
 */
export function webComposeUrl(channel, text) {
  const t = String(text || '');
  if (channel === 'x') return `https://twitter.com/intent/tweet?text=${encodeURIComponent(t)}`;
  return null;
}

/** SOW-120 follow-up: a de-duplicated, space-joined hashtag string from a list of labels. Pure. */
function hashtagList(labels) {
  const seen = new Set();
  const out = [];
  for (const l of Array.isArray(labels) ? labels : []) {
    const h = toHashtag(l);
    const key = h.toLowerCase();
    if (h && !seen.has(key)) { seen.add(key); out.push(h); }
  }
  return out.join(' ');
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
 *   {member-x-handle}  the member's X handle as @handle (from profile links.x), else the full name (SOW-120)
 *   {member-bluesky-handle}  the member's Bluesky handle as @handle (from profile links.bluesky), else the full name (SOW-122)
 *   {member-mastodon-handle}  the member's Mastodon @user@instance (from profile links.mastodon), else the full name (SOW-123)
 *   {member-reddit-handle}  the member's Reddit username as u/name (from profile links.reddit), else the full name
 *   {category-hashtag}  the category as a single hashtag, e.g. #DevOps (SOW-120)
 *   {tags-hashtags}   the item's tags as hashtags, e.g. #AI #Prompts (SOW-120)
 *   {hashtags}       the category plus the tags, de-duplicated, as one hashtag set (SOW-120)
 *   {author-note-italic}  the intro with each line wrapped in markdown italics (for Reddit)
 *   A token written in ALL CAPS uppercases its value: {CONTENT-TYPE} -> "PROMPT" (mentions excluded).
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
    // {author-note-italic}: the intro in markdown ITALICS for channels that render it (Reddit does).
    // Markdown italics never span line breaks, so each non-empty LINE is wrapped, not the whole block.
    authornoteitalic: sanitizeMentions(item.authorNote || '')
      .split('\n')
      .map((l) => (l.trim() ? `*${l.trim()}*` : l))
      .join('\n'),
    memberurl: item.author ? `https://gbti.network/members/${encodeURIComponent(String(item.author))}/` : '', // {member-url}: the public profile
    shortdescription: sanitizeMentions(item.blurb || ''), // {short-description}: the item's shortDescription (the queue item's blurb)
    // SOW-120 follow-up: {member-x-handle} is the member's OWN validated X handle rendered as a real
    // @mention (X @mentions tag a user, they are not a mass broadcast like Discord, and xHandleFrom
    // strictly validates the shape), else the sanitized full name. {category-hashtag} / {tags-hashtags} /
    // {hashtags} are alphanumeric-only, so they carry no mention risk.
    memberxhandle: xHandleFrom(item.authorX) ? `@${xHandleFrom(item.authorX)}` : fullName,
    // SOW-122: {member-bluesky-handle} = the member's Bluesky @handle (from profile links.bluesky), else the
    // full name. On Bluesky a plain @handle is not a live mention; the bluesky adapter adds a resolved-DID
    // FACET over this handle so it links + notifies.
    memberblueskyhandle: blueskyHandleFrom(item.authorBluesky) ? `@${blueskyHandleFrom(item.authorBluesky)}` : fullName,
    // SOW-123: {member-mastodon-handle} = the member's Mastodon @user@instance (from profile links.mastodon),
    // else the full name. Mastodon renders @user@instance in status text as a native mention (no facet).
    membermastodonhandle: mastodonHandleFrom(item.authorMastodon) ? `@${mastodonHandleFrom(item.authorMastodon)}` : fullName,
    // {member-reddit-handle} = the member's Reddit username as u/name (from profile links.reddit), else the
    // full name. Reddit renders u/name as a profile link natively; redditHandleFrom strictly validates.
    memberreddithandle: redditHandleFrom(item.authorReddit) ? `u/${redditHandleFrom(item.authorReddit)}` : fullName,
    categoryhashtag: toHashtag(item.category),
    tagshashtags: hashtagList(item.tags),
    hashtags: hashtagList([item.category, ...(Array.isArray(item.tags) ? item.tags : [])]),
  };
  // Hyphenated token names ({member-discord-username}, {content-type}) normalize to the same key, and a
  // token written in ALL CAPS uppercases its value ({CONTENT-TYPE} -> "PROMPT"); a `<@id>` mention is
  // case-sensitive Discord syntax and is never case-shifted.
  const text = String(template || '')
    .replace(/\{([a-zA-Z-]+)\}/g, (_, name) => {
      const val = vars[name.toLowerCase().replace(/-/g, '')] ?? '';
      return name === name.toUpperCase() && /[A-Z]/.test(name) && !/^<@!?\d+>$/.test(val) ? val.toUpperCase() : val;
    })
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
