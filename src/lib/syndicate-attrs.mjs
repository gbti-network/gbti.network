// sow-399: the data-gbti-* attributes of <gbti-syndicate-now> for a website content page.
//
// Manually syndicate moved from the extension's reader to the website's article, project, prompt and share pages
// (owner, 2026-09-24). The element reads everything it posts from these attributes, so the website fills them by
// the SAME rules the reader used (the `synd` block of client-ui/src/elements/gbti-reader.mjs, removed in the same
// change), or a manual post from the website would route to a different Discord channel, lose the author's
// handles, or pick the wrong template set. test/syndicate-attrs.test.mjs pins each rule, and pins that this helper
// sends every attribute the element reads.
//
// The rules, one per attribute:
//   slug      a share is "<author>/<id>"; everything else its own slug
//   url       a share points at the link it shares; everything else at its absolute page on the site
//   category  a share's flat topic; otherwise the FIRST segment of the category path (the raw top-level key)
//   category-path  the full path joined with commas (leaf-first routing); a share has none
//   visibility  "members" or "public" (the element picks the stub templates for members)
//   the author's public handles (discord, x, bluesky, mastodon, reddit, devto) from the profile's links
//   tags      the string tags, joined with commas
// An empty value is left out, as the reader left it out, so the element sees "absent" rather than "".
// Pure and node-free.

export const SYNDICATABLE_TYPES = ['post', 'project', 'prompt', 'share'];
const HANDLES = ['discord', 'x', 'bluesky', 'mastodon', 'reddit', 'devto'];

const str = (v) => (v == null ? '' : String(v));

/**
 * @param {object} p
 * @param {'post'|'project'|'prompt'|'share'} p.type
 * @param {string} [p.slug]        a content item's slug
 * @param {string} [p.id]          a share's id
 * @param {string} [p.author]      the owner's username (house content: 'gbti')
 * @param {string} [p.authorName]  the profile displayName
 * @param {string} [p.title]
 * @param {string} [p.blurb]       the item's shortDescription
 * @param {string} [p.url]         a share's shared link, or a content item's ABSOLUTE page URL
 * @param {string} [p.visibility]
 * @param {string[]} [p.categories] a content item's category path
 * @param {string} [p.category]    a share's flat topic
 * @param {string[]} [p.tags]
 * @param {object} [p.links]       the profile's links (discord, x, bluesky, mastodon, reddit, devto)
 * @param {string} [p.image]
 * @returns {Record<string,string>|null} the attributes, or null when the item cannot be syndicated by hand
 */
export function syndicateAttrs(p = {}) {
  const type = str(p.type);
  if (!SYNDICATABLE_TYPES.includes(type)) return null;
  const isShare = type === 'share';
  const slug = isShare ? (p.author && p.id ? `${p.author}/${p.id}` : '') : str(p.slug);
  if (!slug) return null;
  const cats = Array.isArray(p.categories) ? p.categories.filter((c) => typeof c === 'string' && c) : [];
  const tags = (Array.isArray(p.tags) ? p.tags : []).filter((t) => typeof t === 'string' && t.trim());

  const out = {
    'data-gbti-type': type,
    'data-gbti-slug': slug,
    'data-gbti-author': str(p.author),
    'data-gbti-title': str(p.title),
    'data-gbti-url': str(p.url),
    'data-gbti-visibility': str(p.visibility || 'public'),
  };
  const put = (k, v) => { if (v) out[k] = str(v); };
  put('data-gbti-author-name', p.authorName);
  put('data-gbti-blurb', p.blurb);
  put('data-gbti-category', isShare ? str(p.category) : (cats[0] || ''));
  put('data-gbti-category-path', isShare ? '' : cats.join(','));
  const links = p.links && typeof p.links === 'object' ? p.links : {};
  for (const h of HANDLES) put(`data-gbti-${h}`, links[h]);
  put('data-gbti-tags', tags.join(','));
  put('data-gbti-image', p.image);
  return out;
}
