// sow-289: the PURE core for the outbound partner link store (house/outbound-links.yml). Node-free, no IO: the
// redirect generator, the build artifact, the board and the tests all validate the store through this one place, so
// a malformed edit fails the build instead of shipping a broken redirect.
//
// One entry per path: { path, destination, partner, status, note }.
//   path         the site path that redirects (ten today, five of them legacy WordPress paths outside /outbound/)
//   destination  the partner URL, ABSOLUTE, with an explicit path before any query (see the rule below)
//   partner      a short label for the board (codeable, bugherd, cloudways, tailscale)
//   status       live | placeholder | retired. A placeholder carries no referral parameter and credits nobody; a
//                retired link is STILL EMITTED as a redirect (an old post may link it), retired is a board label.
//   note         provenance prose shown on the board: where the destination came from and what went wrong before
//
// THE EXPLICIT SLASH RULE IS ENFORCED HERE BECAUSE IT WAS FOUND LIVE. A destination with no path before its query
// (`https://cloudways.com?id=1`) is served by Cloudflare Pages with a trailing slash appended, and with no path to
// land on it lands at the END of the query, turning `chan=gbti` into `chan=gbti/`. `new URL()` normalises that shape
// to a `/` pathname, so the check reads the raw string: the host must be followed by a slash.

export const LINK_STATUSES = Object.freeze(['live', 'placeholder', 'retired']);

const PATH_RE = /^\/[^\s?#]*$/;
const DESTINATION_RE = /^https?:\/\/[^/?#\s]+\/[^\s]*$/i;
const PARTNER_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Coerce a parsed store to its list of entries, or an empty list. Never throws. */
export function linksOf(parsed) {
  return Array.isArray(parsed?.links) ? parsed.links : [];
}

/**
 * Every problem with a parsed store, as strings; an empty list means valid. Checks the whole file rather than
 * stopping at the first fault so an edit can be fixed in one pass.
 */
export function validateOutboundLinks(parsed) {
  const problems = [];
  if (!parsed || typeof parsed !== 'object') return ['outbound-links: the file did not parse to an object'];
  if (!Array.isArray(parsed.links)) return ['outbound-links: `links` must be a list'];
  const seen = new Set();
  parsed.links.forEach((e, i) => {
    const at = `outbound-links: entry ${i + 1}`;
    if (!e || typeof e !== 'object') { problems.push(`${at} is not an object`); return; }
    const p = typeof e.path === 'string' ? e.path : '';
    if (!PATH_RE.test(p)) problems.push(`${at} has an invalid path "${p}" (must start with / and carry no whitespace, query or fragment)`);
    else if (seen.has(p)) problems.push(`${at} repeats the path "${p}"`);
    else seen.add(p);
    const d = typeof e.destination === 'string' ? e.destination : '';
    if (!DESTINATION_RE.test(d)) problems.push(`${at} (${p}) has an invalid destination "${d}" (must be an absolute http(s) URL with an explicit path before any query, for example https://example.com/?ref=x)`);
    if (!PARTNER_RE.test(String(e.partner ?? ''))) problems.push(`${at} (${p}) has an invalid partner "${e.partner}" (a short lowercase label)`);
    if (!LINK_STATUSES.includes(e.status)) problems.push(`${at} (${p}) has an invalid status "${e.status}" (one of ${LINK_STATUSES.join(', ')})`);
    if (e.note != null && typeof e.note !== 'string') problems.push(`${at} (${p}) has a note that is not text`);
  });
  return problems;
}

/** The redirect rows the generator emits for a valid store, in file order: [path, destination] pairs. */
export function redirectRowsOf(parsed) {
  return linksOf(parsed).map((e) => [String(e.path), String(e.destination)]);
}

/** The board's view of one entry: the fields, with the note defaulting to an empty string. */
export function linkSummary(e) {
  return {
    path: String(e?.path ?? ''),
    destination: String(e?.destination ?? ''),
    partner: String(e?.partner ?? ''),
    status: LINK_STATUSES.includes(e?.status) ? e.status : 'live',
    note: typeof e?.note === 'string' ? e.note.trim() : '',
  };
}
