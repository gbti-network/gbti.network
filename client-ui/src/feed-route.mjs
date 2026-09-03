// Pure routing helpers for the new-tab feed + the left rail (SOW-039/042 follow-up). Extracted so the
// hash -> type -> rail-key derivation is node-testable without a DOM. The Activity feed IS the unified content
// browser: a bare `newtab.html` is the All river (TYPE 'all', rail key 'activity'); a `#type=<X>` (or the bell's
// legacy `#tab=<X>`) narrows to one type and lights the matching Browse rail item.

// sow-204 item 4a: 'network' joins the set so the extension rail carries the SAME feed vocabulary as the
// website (All, News, Network, Articles, Projects, Prompts, Shares). Network is the member-PUBLICATIONS
// aggregate: posts, projects and prompts, with no shares and no news, matching matchesNarrow('network') in
// src/lib/home-feed.mjs. It is the one entry the extension was missing.
import { canonicalType } from './content-types.mjs';

export const TYPE_FILTERS = new Set(['all', 'post', 'project', 'prompt', 'share', 'news', 'network']);

// sow-204: the item types a NETWORK view admits. Named once here because the website's matchesNarrow and this
// set must agree; if they drift, the same rail item shows different things on the two hosts, which is the exact
// outcome adopting the website's set was meant to prevent.
export const NETWORK_KINDS = Object.freeze(['post', 'project', 'prompt']);

// TYPE -> the rail key to highlight. 'all' maps to 'activity' (Activity IS the All river; there is no separate
// Browse "All" item). Anything unknown falls back to 'activity' so the rail never ends up with nothing lit.
const RAIL_KEY = { all: 'activity', post: 'articles', project: 'projects', product: 'projects', prompt: 'prompts', share: 'shares', news: 'news', network: 'network' };

/** Parse a location.hash (with or without the leading '#') into a known TYPE filter, or null when none.
 *  Accepts both the rail's `type=<X>` shortcut and the activity bell's legacy `tab=<X>` deep-link shape. */
export function parseTypeFromHash(hash) {
  const m = /(?:^|[#&])(?:type|tab)=([a-z]+)/.exec(String(hash || ''));
  // sow-196: a #type=product / tab=product deep link, emitted for months and now bookmarked and
  // syndicated, must still resolve. Unresolved it falls through to a default view with no explanation.
  const ty = m ? canonicalType(m[1]) : null;
  return ty && TYPE_FILTERS.has(ty) ? ty : null;
}

/** The active TYPE for a given hash: the parsed type, or 'all' (the river) when the hash carries none. */
export function typeForHash(hash) {
  return parseTypeFromHash(hash) || 'all';
}

/** The rail key to highlight for a TYPE (so the left rail always agrees with the chips + feed). */
export function railKeyForType(type) {
  return RAIL_KEY[type] || 'activity';
}

/**
 * Which sources a given TYPE view composes, and whether it narrows to a single type. Pure + node-testable; the
 * new-tab feed (renderFeed + the lazy-load gates) is driven entirely by this so the two stay in lockstep.
 *   - `all`  (Activity): member content + Shares, NO news. The quick river (capped).
 *   - `news` (News): news BLENDED with member content + Shares, newest-first (member activity is injected).
 *   - `share`: Shares only (loads Shares, then narrows).
 *   - `post|project|prompt`: that one content type only (no Shares, no news).
 * `narrow` is false for the two BLENDED views (`all`, `news`) and true for the single-type directories.
 * @returns {{ wantNews: boolean, wantShares: boolean, narrow: boolean }}
 */
export function feedSources(type) {
  // sow-204: `narrow` means "render from the single per-type DIRECTORY index" (SOW-031). NETWORK spans three
  // types, so it has no single directory and must render from the merged river like `all` does, then filter.
  // That is why network is narrow:false but still filtered: the two flags answer different questions, and
  // conflating them would make the view either load the wrong index or show everything.
  const isNetwork = type === 'network';
  return {
    wantNews: type === 'news',
    wantShares: type === 'all' || type === 'news' || type === 'share',
    narrow: !(type === 'all' || type === 'news' || isNetwork),
    // The item types to keep, or null for "keep everything". A single-type view reports its own type so a
    // consumer can filter uniformly instead of special-casing network.
    kinds: isNetwork ? NETWORK_KINDS : (type === 'all' || type === 'news' ? null : [type]),
  };
}
