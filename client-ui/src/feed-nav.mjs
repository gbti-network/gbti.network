// sow-296: THE feed navigation, shared by the website and the extension.
//
// The website already had one source for its seven feed entries (src/lib/site-nav.ts, sow-187) and the extension
// carried the same seven destinations in its own left rail (sow-204). They agreed by hand, which is the shape that
// drifts: a label change on one host silently left the other behind. The new tab renders a ROW OF TABS in place of
// that rail (owner, 2026-09-22), so the two hosts now render the same list from this file and only the hrefs differ:
// the site links to /feeds/<narrow>/, the extension to newtab.html#type=<its own type key>.
//
// Node-free and data-only, so both hosts and node --test can read it.

/** The seven feed narrows in nav order. `key` is the WEBSITE narrow key, which is also the tab key. */
export const FEED_TABS = Object.freeze([
  Object.freeze({ key: 'all', label: 'All' }),
  Object.freeze({ key: 'news', label: 'News' }),
  Object.freeze({ key: 'network', label: 'Network' }),
  Object.freeze({ key: 'articles', label: 'Articles' }),
  Object.freeze({ key: 'projects', label: 'Projects' }),
  Object.freeze({ key: 'prompts', label: 'Prompts & Skills' }),
  Object.freeze({ key: 'shares', label: 'Shares' }),
]);

export const FEED_TAB_KEYS = Object.freeze(FEED_TABS.map((t) => t.key));

/** The label for a tab key, or '' when the key is not one of ours. */
export function feedTabLabel(key) {
  return FEED_TABS.find((t) => t.key === String(key || ''))?.label || '';
}
