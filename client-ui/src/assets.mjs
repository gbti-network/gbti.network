// SOW-031: resolve a content thumbnail/cover URL emitted by the per-type index JSON (toIndexItem.thumb) into a
// fully-qualified URL the in-extension UI can put in an <img src>. The index emits a SITE-relative
// `/_astro/...` build-optimized path (or, defensively, an already-absolute URL); the UI prefixes the gbti.network
// origin for the relative case. Pure + node-testable. Returns null for an empty/invalid value (the caller then
// renders no image, never a broken one).

const SITE = 'https://gbti.network';

/** The public content repo (jsDelivr serves committed images from it; the media convention). */
export const CONTENT_REPO = 'gbti-network/gbti.network';

/**
 * Rewrite repo-relative image srcs in RAW MARKDOWN to absolute jsDelivr URLs, using the item's repo path
 * as the base (members/<u>/posts/<slug>/index.md -> .../posts/<slug>/images/x.webp). The site build
 * resolves these relatives itself; the in-extension reader renders raw markdown, so without this pass a
 * `![](./images/x.webp)` has no meaningful src outside the repo. Absolute (http, //) and site-absolute
 * (/...) srcs pass through untouched. Pure; a null/absent path returns the markdown unchanged.
 */
export function resolveMarkdownAssets(markdown, itemPath, repo = CONTENT_REPO) {
  const md = String(markdown ?? '');
  const folder = String(itemPath || '').replace(/\/[^/]*$/, '').replace(/^\/+/, '');
  if (!folder) return md;
  return md.replace(/(!\[[^\]]*\]\()(\.\/)([^\s)]+\))/g,
    (_m, pre, _dot, rest) => `${pre}https://cdn.jsdelivr.net/gh/${repo}@main/${folder}/${rest}`);
}

export function resolveAsset(thumb, site = SITE) {
  if (!thumb || typeof thumb !== 'string') return null;
  if (/^https?:\/\//.test(thumb)) return thumb; // already absolute (a raw/jsDelivr/CDN URL)
  if (/^\/\//.test(thumb)) return `https:${thumb}`; // protocol-relative
  return `${site}${thumb.startsWith('/') ? '' : '/'}${thumb}`; // SITE-relative `/_astro/...`
}
