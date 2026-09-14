// SOW-166: the PURE projection behind /shares-index.json (src/pages/shares-index.json.ts). Extracted so the
// public-only leak guard is unit-tested with fixtures rather than only at build time, matching the
// buildActivityIndex pattern. Node-free: no astro imports, so a test drives it with plain { data } objects.
import { isPublicShare, feedTime, decodeEntities } from './home-feed.mjs';
import { isShareCoverUrl, shareCoverUrl, parseShareCoverUrl } from '../../membership/share-cover-url.mjs';

/**
 * Project a list of share collection entries (each `{ data }`) into the newest-first public-shares index.
 *
 * The guard is isPublicShare (status published AND visibility public, fail closed): a members-only share, a
 * Mode B stub, or a draft is EXCLUDED here. This is the first of two guards; the digest composition core drops
 * any item whose visibility is not 'public' as well, so a leak would have to defeat both.
 *
 * @param {Array<{ data: any }>} entries  the `share` collection entries
 * @returns {Array<{ type:'share', slug, title, author, description, url, publishedAt, visibility:'public', thumb? }>}
 */
/** Our hosted copy as an absolute URL, or null for anything else (an outside URL, nothing). */
function shareThumb(image) {
  if (!isShareCoverUrl(image)) return null;
  const p = parseShareCoverUrl(image);
  return shareCoverUrl(p.author, p.file);
}

export function buildSharesIndex(entries) {
  const list = Array.isArray(entries) ? entries : [];
  return list
    .filter((e) => isPublicShare(e?.data))
    .map((e) => {
      const d = e.data;
      const slug = `${d.author}/${d.id}`;
      return {
        type: 'share',
        slug,
        // The site-feed title resolution: the share's title, else its one-line description, else a neutral
        // default. decodeEntities unwinds OG-scraped entities (e.g. "A &#8211; B").
        title: decodeEntities(d.title ?? d.shortDescription ?? 'Shared a link'),
        author: d.author,
        // sow-166: the public one-line blurb the email digest shows under the title. Suppressed when the
        // share has NO title, because shortDescription is then already serving AS the title above and the
        // row would print the same sentence twice. Public frontmatter only, never a body.
        description: d.title ? (decodeEntities(d.shortDescription ?? '') || null) : null,
        url: `/shares/${slug}/`,
        publishedAt: feedTime(d) || null,
        visibility: 'public',
        // sow-272/sow-283: the digest's share rows get an image, but ONLY our hosted copy. An outside image URL
        // in an email makes the reader's mail client contact that host, so a share still pointing at one ships
        // no thumb at all (the row renders text-only, as every share row did before).
        ...(shareThumb(d.image) ? { thumb: shareThumb(d.image) } : {}),
      };
    })
    .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
}
