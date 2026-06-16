// SOW-034: pure planning for syndicating PUBLISHED member content to Discord, per type, on publish. Generalizes
// the SOW-018 share-only path to post/product/prompt/share. No network, no fs -> unit-tested; the runner
// (scripts/syndicate-content.mjs) wires the reader, the Stripe-backed mention resolver, and the Discord client.
//
// We NEVER read or post a body: a public item posts a link that Discord unfurls (SOW-001 OG tags); a members-only
// / Mode A item (no public page) posts the TITLE only (plaintext frontmatter; the encrypted body is never read).

const DISCORD_MAX = 2000;
const SUBDIR_TYPE = { posts: 'post', products: 'product', prompts: 'prompt' };
const URL_BASE = { post: '/blog', product: '/products', prompt: '/prompts' };
const TYPE_LABEL = { post: 'article', product: 'product', prompt: 'prompt', share: 'Share' };

// members/<owner>/(posts|products|prompts)/<slug>/index.md  OR  house/(posts|products|prompts)/<slug>/index.md
const CONTENT_RE = /^(?:members\/[a-z0-9][a-z0-9-]*|house)\/(posts|products|prompts)\/([a-z0-9][a-z0-9-]*)\/index\.md$/;
// members/<owner>/shares/<id>.md (strict id charset, matching the workflow's diff filter)
const SHARE_RE = /^members\/[a-z0-9][a-z0-9-]*\/shares\/([a-z0-9][a-z0-9._-]*)\.(?:md|mdx)$/;

/** Classify a repo-relative path to { type, slug } (post|product|prompt|share), or null if not syndicatable. */
export function classifyContentPath(path) {
  if (typeof path !== 'string' || path.includes('..')) return null;
  const c = CONTENT_RE.exec(path);
  if (c) return { type: SUBDIR_TYPE[c[1]], slug: c[2] };
  const s = SHARE_RE.exec(path);
  if (s) return { type: 'share', slug: s[1] };
  return null;
}

/** SOW-016 semantics: a public page exists when published AND (public OR a Mode B stub). Shares have no page. */
export function hasPublicPage(fm = {}) {
  if (fm.status !== 'published') return false;
  if (fm.type === 'share') return false;
  return fm.visibility !== 'members' || fm.publicStub === true;
}

/** The canonical gbti.network URL for a public post/product/prompt; null for a members-only/Mode A or a share. */
export function publicUrlFor(item, siteOrigin = 'https://gbti.network') {
  if (!item || item.type === 'share' || !item.hasPublicPage) return null;
  const base = URL_BASE[item.type];
  return base && item.slug ? `${String(siteOrigin).replace(/\/$/, '')}${base}/${item.slug}/` : null;
}

/**
 * Build a syndication item from a classified path + the file's frontmatter. Metadata only (no body). Returns
 * { type, slug, author, title, visibility, hasPublicPage, shareUrl } or null when not publishable (draft / missing
 * title / type mismatch). `shareUrl` is the off-network link a Share carries (shares have no gbti.network page).
 */
export function buildSyndicationItem(path, frontmatter = {}) {
  const cls = classifyContentPath(path);
  if (!cls) return null;
  const fm = frontmatter || {};
  if (fm.status !== 'published') return null; // only a published add announces
  // Defensive: the file's declared type must match the path subtree (a stray type field cannot retarget a channel).
  if (fm.type && fm.type !== cls.type) return null;
  const title = (fm.title != null ? String(fm.title) : '').trim();
  if (cls.type !== 'share' && !title) return null; // posts/products/prompts need a title to announce
  return {
    type: cls.type,
    slug: cls.slug,
    author: fm.author ? String(fm.author) : 'gbti',
    title: title || (cls.type === 'share' ? 'New share' : ''),
    visibility: fm.visibility || 'public',
    hasPublicPage: hasPublicPage({ ...fm, type: cls.type }),
    shareUrl: cls.type === 'share' && typeof fm.url === 'string' ? fm.url : null,
  };
}

const trunc = (s) => (s.length > DISCORD_MAX ? s.slice(0, DISCORD_MAX - 1) + '…' : s);

/**
 * Format the Discord message. `mention` is a ready-to-post `<@id>` or a plain `@login` fallback. A public item
 * appends its unfurling URL; a members-only / Mode A item posts the title only with a "read in the client" note;
 * a Share posts its off-network link. Never includes a body.
 */
export function formatPublishMessage(item, { mention, siteOrigin = 'https://gbti.network' } = {}) {
  const label = TYPE_LABEL[item.type] || item.type;
  const who = mention || `@${item.author}`;
  const title = item.title ? `\n**${item.title.trim()}**` : '';
  if (item.type === 'share') {
    const head = item.hasPublicPage === false && item.visibility === 'members' ? `📣 New members-only Share from ${who} 🎉` : `📣 New Share from ${who} 🎉`;
    const link = item.shareUrl ? `\n${item.shareUrl}` : '';
    return trunc(`${head}${title}${link}`.trim());
  }
  const url = publicUrlFor(item, siteOrigin);
  if (url) return trunc(`📣 New ${label} published by network member ${who} 🎉${title}\n${url}`);
  // members-only / Mode A: title only, never the body, no public link.
  return trunc(`📣 New members-only ${label} by network member ${who} 🎉${title}\n_Members-only — open it in the GBTI client to read._`);
}

/** Resolve the Discord channel id for a content type from a { post, product, prompt, share } map. */
export function channelForType(type, channelMap = {}) {
  return channelMap[type] || null;
}

/**
 * The allowed_mentions for a post: allow ONLY the resolved author to be pinged (extracted from a `<@id>` mention),
 * and nothing else -- so author-controlled text (a title like "@everyone" or a `<@&role>` token) can never fire a
 * mass/role/cross-user ping. A plain `@login` text fallback resolves to no ping at all (`parse: []`).
 */
export function allowedMentionsFor(mention) {
  const m = /^<@!?(\d+)>$/.exec(String(mention || ''));
  return m ? { parse: [], users: [m[1]] } : { parse: [] };
}

/**
 * Plan the posts: map each { item, mention } to { channelId, message, allowedMentions }, dropping any whose type
 * has no configured channel. Pure; the runner resolves mentions (async, Stripe) before calling this and then posts
 * each entry with its allowedMentions (so only the author can be pinged, never @everyone/@here/a role).
 */
export function planContentSyndication(entries = [], channelMap = {}, opts = {}) {
  const out = [];
  for (const { item, mention } of entries) {
    if (!item) continue;
    const channelId = channelForType(item.type, channelMap);
    if (!channelId) continue;
    out.push({
      channelId,
      message: formatPublishMessage(item, { mention, siteOrigin: opts.siteOrigin }),
      allowedMentions: allowedMentionsFor(mention),
    });
  }
  return out;
}
