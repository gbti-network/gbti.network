// SOW-031: resolve a content thumbnail/cover URL emitted by the per-type index JSON (toIndexItem.thumb) into a
// fully-qualified URL the in-extension UI can put in an <img src>. The index emits a SITE-relative
// `/_astro/...` build-optimized path (or, defensively, an already-absolute URL); the UI prefixes the gbti.network
// origin for the relative case. Pure + node-testable. Returns null for an empty/invalid value (the caller then
// renders no image, never a broken one).

const SITE = 'https://gbti.network';

export function resolveAsset(thumb, site = SITE) {
  if (!thumb || typeof thumb !== 'string') return null;
  if (/^https?:\/\//.test(thumb)) return thumb; // already absolute (a raw/jsDelivr/CDN URL)
  if (/^\/\//.test(thumb)) return `https:${thumb}`; // protocol-relative
  return `${site}${thumb.startsWith('/') ? '' : '/'}${thumb}`; // SITE-relative `/_astro/...`
}
