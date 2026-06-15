// SOW-031: pure helpers for the per-type content index endpoints (/blog-index.json, /products-index.json,
// /prompts-index.json) AND the reader read-route allowlist. Node-free so the Astro endpoints map collections
// into it and node --test covers the edge-case logic (house vs member owner, the nested <slug>/index.md layout,
// the read allowlist regex). Metadata only (no body, no behavioral data) -> same privacy posture as
// activity-index.json. The reader fetches bodies on demand via the token-holding worker, never from this JSON.

const SUBDIR = { post: 'posts', product: 'products', prompt: 'prompts' };
const URLBASE = { post: '/blog', product: '/products', prompt: '/prompts' };

/** Repo-relative index.md path for a content item: house/gbti owner -> house/<sub>/<slug>/index.md; a member
 *  owner -> members/<owner>/<sub>/<slug>/index.md. Null when the type/slug is unsupported. */
export function contentItemPath(type, owner, slug) {
  const sub = SUBDIR[type];
  if (!sub || !slug) return null;
  const o = String(owner || '').toLowerCase();
  if (!o || o === 'house' || o === 'gbti') return `house/${sub}/${slug}/index.md`;
  return `members/${o}/${sub}/${slug}/index.md`;
}

/** Map a content collection entry to a metadata index item (no body). The caller filters (isListed) + sorts. */
export function toIndexItem(entry, type) {
  const d = (entry && entry.data) || {};
  const slug = d.slug;
  const author = d.author || 'gbti';
  return {
    type,
    slug: slug || null,
    title: d.title || slug || '',
    author,
    excerpt: d.excerpt || d.shortDescription || '',
    url: `${URLBASE[type] || ''}/${slug}/`,
    path: contentItemPath(type, author, slug),
    publishedAt: d.publishedAt ? Number(d.publishedAt) : null,
    visibility: d.visibility || 'public',
  };
}

// The reader read-route allowlist: ONLY a content index.md in the three public subtrees, member or house, with
// no traversal. Keeps the member token from becoming a general repo-file oracle (no roles.yml, no house/pages,
// no .. escape). Cover with the unit test.
export const READ_PATH_RE = /^(members\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|house)\/(posts|products|prompts)\/[a-z0-9][a-z0-9-]*\/index\.md$/;

export function isReadablePath(path) {
  return typeof path === 'string' && !path.includes('..') && !path.includes('\\') && READ_PATH_RE.test(path);
}
