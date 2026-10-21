// Which URL a page declares as the original.
//
// A member cross-posting an article they first published elsewhere sets `canonicalUrl` in the editor, and
// rel=canonical then points at their copy so ours does not compete with it in search. The field existed in
// both content schemas and in the editor form for months while NOTHING read it: a member could fill it in,
// see it accepted and see it in their publish diff, and the published page still declared itself the
// original. This module is the consumer that was missing, so the rule lives in one testable place rather
// than inline in a layout where the next person cannot see it.
//
// og:url is NOT this value. A share, a comment and the referral attribution all have to land on the GBTI
// page, so BaseLayout keeps og:url on our own URL and moves rel=canonical alone.

/**
 * @param {object} args
 * @param {unknown} args.override  the member-supplied `canonicalUrl`, which is whatever was in the frontmatter
 * @param {string|URL} args.pageUrl  this page's own absolute URL
 * @returns {string} the absolute URL for rel=canonical
 */
export function resolveCanonical({ override, pageUrl }) {
  const own = String(pageUrl ?? '');
  if (typeof override !== 'string') return own;
  const trimmed = override.trim();
  if (!trimmed) return own;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return own; // a relative path, or not a URL at all
  }
  // The value reaches the head as an href, and it is member-supplied. Only the two web schemes qualify:
  // javascript:, data: and mailto: are all valid URLs as far as the parser is concerned.
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return own;
  return parsed.href;
}
