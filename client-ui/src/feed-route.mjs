// Pure routing helpers for the new-tab feed + the left rail (SOW-039/042 follow-up). Extracted so the
// hash -> type -> rail-key derivation is node-testable without a DOM. The Activity feed IS the unified content
// browser: a bare `newtab.html` is the All river (TYPE 'all', rail key 'activity'); a `#type=<X>` (or the bell's
// legacy `#tab=<X>`) narrows to one type and lights the matching Browse rail item.

export const TYPE_FILTERS = new Set(['all', 'post', 'product', 'prompt', 'share', 'news']);

// TYPE -> the rail key to highlight. 'all' maps to 'activity' (Activity IS the All river; there is no separate
// Browse "All" item). Anything unknown falls back to 'activity' so the rail never ends up with nothing lit.
const RAIL_KEY = { all: 'activity', post: 'articles', product: 'products', prompt: 'prompts', share: 'shares', news: 'news' };

/** Parse a location.hash (with or without the leading '#') into a known TYPE filter, or null when none.
 *  Accepts both the rail's `type=<X>` shortcut and the activity bell's legacy `tab=<X>` deep-link shape. */
export function parseTypeFromHash(hash) {
  const m = /(?:^|[#&])(?:type|tab)=([a-z]+)/.exec(String(hash || ''));
  return m && TYPE_FILTERS.has(m[1]) ? m[1] : null;
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
 *   - `post|product|prompt`: that one content type only (no Shares, no news).
 * `narrow` is false for the two BLENDED views (`all`, `news`) and true for the single-type directories.
 * @returns {{ wantNews: boolean, wantShares: boolean, narrow: boolean }}
 */
export function feedSources(type) {
  return {
    wantNews: type === 'news',
    wantShares: type === 'all' || type === 'news' || type === 'share',
    narrow: !(type === 'all' || type === 'news'),
  };
}
