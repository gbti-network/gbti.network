// sow-283: the address of a share cover image we host ourselves. A share's `image` used to be whatever URL the
// link preview found, so every reader (the homepage, the digest, the extension) made each visitor's browser
// contact that third party. The share-covers workflow (scripts/share-covers.mjs) copies a public share's cover
// into members/<author>/shares/images/<id>-<hash>.webp and, once that copy is deployed, points `image` here.
//
// The hash is the first 8 hex characters of the WebP's sha256, so every copy has an immutable URL: a re-copied
// cover gets a new name instead of overwriting one that browsers, CDNs and sent emails may already hold.
//
// Dependency-free on purpose: the site build, the signup Worker (member digest) and the extension all import it.

export const SHARE_COVER_ORIGIN = 'https://gbti.network';
export const SHARE_COVER_PREFIX = '/media/shares/';

const AUTHOR_RE = /^[a-z0-9][a-z0-9-]*$/;
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const HASH_RE = /^[0-9a-f]{8}$/;
// <author>/<id>-<hash>.webp. The id may itself contain hyphens, so the hash is taken from the END.
const FILE_RE = /^([a-z0-9][a-z0-9-]*)-([0-9a-f]{8})\.webp$/;

/** The committed file name for a copy: `<id>-<hash8>.webp`. Throws on an id or hash the reader would refuse. */
export function shareCoverFileName(id, hash) {
  const h = String(hash || '').slice(0, 8).toLowerCase();
  if (!ID_RE.test(String(id || '')) || !HASH_RE.test(h)) throw new Error(`shareCoverFileName: bad id or hash (${id}, ${hash})`);
  return `${id}-${h}.webp`;
}

/** The root-relative path the site serves a copy at. */
export function shareCoverPath(author, fileName) {
  if (!AUTHOR_RE.test(String(author || '')) || !FILE_RE.test(String(fileName || ''))) {
    throw new Error(`shareCoverPath: bad author or file (${author}, ${fileName})`);
  }
  return `${SHARE_COVER_PREFIX}${author}/${fileName}`;
}

/** The absolute URL a share's `image` frontmatter carries once it points at our copy. */
export function shareCoverUrl(author, fileName) {
  return `${SHARE_COVER_ORIGIN}${shareCoverPath(author, fileName)}`;
}

/**
 * Parse an image value into { author, id, hash, file, path } when it is one of our copies, else null. Accepts the
 * absolute URL or the root-relative path, and nothing else: no query string, no fragment, no other host, so a
 * look-alike (`https://gbti.network.evil.test/media/shares/...`) is never mistaken for ours.
 */
export function parseShareCoverUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  let path = value;
  if (value.startsWith(SHARE_COVER_ORIGIN + '/')) path = value.slice(SHARE_COVER_ORIGIN.length);
  else if (!value.startsWith(SHARE_COVER_PREFIX)) return null;
  if (!path.startsWith(SHARE_COVER_PREFIX)) return null;
  const rest = path.slice(SHARE_COVER_PREFIX.length).split('/');
  if (rest.length !== 2 || !AUTHOR_RE.test(rest[0])) return null;
  const m = FILE_RE.exec(rest[1]);
  if (!m) return null;
  return { author: rest[0], id: m[1], hash: m[2], file: rest[1], path };
}

/** True when an image value is one of our hosted copies. */
export function isShareCoverUrl(value) {
  return parseShareCoverUrl(value) !== null;
}

/** For rendering on gbti.network itself: our copy as a root-relative path (works in any local preview), any other
 *  value unchanged. */
export function shareImageForSite(value) {
  const p = parseShareCoverUrl(value);
  return p ? p.path : value;
}
