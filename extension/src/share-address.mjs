// A share opened in the extension gets a REAL address (owner, 2026-10-17: "can we make sure extension shares have deep
// urls?", choosing "move to the extension's own page"). Chrome hides the address of an overridden new tab, and only a
// document LOAD at the extension's own address makes it show: rewriting the part after # (writeReadHash) never leaves
// the hidden new tab. So opening a share from the feed loads newtab.html?view=share#tab=share&read=<author>/<id>, and
// the share being opened is handed to that page through this tab's sessionStorage so it shows at once, before the
// feed finishes loading. Pure helpers; newtab.mjs does the navigation. No chrome.* APIs, no permissions.

export const SHARE_VIEW = 'share';
export const SHARE_HANDOFF_KEY = 'gbti-nt-open-share';

/** "<author>/<id>" for a share item, or null for anything else. */
export function shareSlugOf(item) {
  if (!item || item.type !== 'share') return null;
  const author = String(item.author || '').trim();
  const id = String(item.id || '').trim();
  return author && id ? `${author}/${id}` : null;
}

/** The share's own page, relative to the extension root (newtab.html sits there, so a relative assign resolves). */
export function shareAddress(slug) {
  return `newtab.html?view=${SHARE_VIEW}#tab=share&read=${encodeURIComponent(String(slug))}`;
}

/** Is this document the share page (loaded at its own address), rather than the new tab? */
export function isSharePage(search) {
  try { return new URLSearchParams(String(search || '')).get('view') === SHARE_VIEW; } catch { return false; }
}

/**
 * How to open an item: 'load' = go to the share's own address (a share opened from the new tab or any page that is not
 * already the share page), 'inplace' = show it here (every other type, and a share while already on the share page,
 * where the address bar is visible and writeReadHash keeps it current).
 */
export function openMode(item, search) {
  return shareSlugOf(item) && !isSharePage(search) ? 'load' : 'inplace';
}

/**
 * Hand the share to the page about to load. `fromFeed` says a person clicked it in a feed, so the share page's "Back to
 * the feed" may step back in history; a deep link that redirected here must not, or Back would land on the link that
 * redirects here again. Fail-soft: a blocked store only costs the instant open.
 */
export function writeHandoff(storage, item, { fromFeed = false } = {}) {
  const slug = shareSlugOf(item);
  if (!slug || !storage) return false;
  try { storage.setItem(SHARE_HANDOFF_KEY, JSON.stringify({ slug, item, fromFeed: fromFeed === true })); return true; } catch { return false; }
}

/**
 * Take the handed-over share if it is the one this address names, and clear the hand-over either way so a later
 * reload of a bookmarked address never reuses a stale item. Returns { item, fromFeed }, or null.
 */
export function takeHandoff(storage, slug) {
  if (!storage) return null;
  let raw = null;
  try { raw = storage.getItem(SHARE_HANDOFF_KEY); storage.removeItem(SHARE_HANDOFF_KEY); } catch { return null; }
  try {
    const v = JSON.parse(raw || 'null');
    return v && v.slug === slug && shareSlugOf(v.item) === slug ? { item: v.item, fromFeed: v.fromFeed === true } : null;
  } catch { return null; }
}

/** The tab title for an open share; the bookmark takes this name. */
export function shareTitle(item) {
  const t = String(item?.title || '').trim();
  return t ? `${t} · GBTI Network` : 'Share · GBTI Network';
}
