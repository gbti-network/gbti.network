// Known pixel dimensions for the OG images we emit, so a share page can advertise og:image:width and
// og:image:height. Strict scrapers (daily.dev among them) apply a minimum-width floor before they will use
// an image at all, and several will not fetch the image just to measure it: with no dimensions declared they
// fall back to their own thumbnail or to none. X is more forgiving and accepted our undeclared 480x360, which
// is why the same share previewed correctly there and blank on daily.dev.
//
// This is a LOOKUP, never a guess. A URL we do not recognize returns null and the page emits no width/height,
// which is exactly the behaviour we had before. Declaring a wrong size is worse than declaring none, because
// a scraper that trusts the tag will crop or reject against a number that does not match the bytes.

/** The branded default card shipped at /og-image.png. */
const DEFAULT_OG = { width: 1200, height: 630 };

/** YouTube serves every video's thumbnail at a fixed set of names, each a fixed size. `maxresdefault` only
 *  exists for videos uploaded at 720p or above, so its presence is confirmed by a fetch elsewhere, never
 *  assumed here; this map only says how big each one IS when it exists. */
const YT_THUMB_SIZES = {
  maxresdefault: { width: 1280, height: 720 },
  sddefault: { width: 640, height: 480 },
  hqdefault: { width: 480, height: 360 },
  mqdefault: { width: 320, height: 180 },
  default: { width: 120, height: 90 },
};

/** The pixel size of an OG image URL we recognize, or null when we do not know it.
 *  Accepts absolute URLs and the root-relative form the layout resolves against the site origin. */
export function knownImageSize(rawUrl) {
  const raw = String(rawUrl || '').trim();
  if (!raw) return null;

  let u;
  try { u = new URL(raw, 'https://gbti.network'); } catch { return null; }

  const host = u.hostname.toLowerCase().replace(/^www\./, '');

  if (host === 'gbti.network' && u.pathname === '/og-image.png') return { ...DEFAULT_OG };

  // i.ytimg.com/vi/<id>/<name>.jpg, and the WebP mirror at /vi_webp/<id>/<name>.webp.
  if (host === 'i.ytimg.com' || host === 'img.youtube.com' || host === 'i9.ytimg.com') {
    const m = /^\/vi(?:_webp)?\/[\w-]+\/([A-Za-z0-9_]+)\.(?:jpg|webp)$/.exec(u.pathname);
    const size = m && YT_THUMB_SIZES[m[1]];
    return size ? { ...size } : null;
  }

  return null;
}
