// SOW-031: pure helpers for the in-extension Browse deep-link hash (browse.html#tab=<type>&read=<encoded path>).
// The new-tab Latest/Following feed rows BUILD the hash (so a click opens the in-extension reader instead of
// navigating out to gbti.network); <gbti-browse> PARSES it on load to auto-open that item. No DOM, unit-tested so
// the build/parse round-trip stays in lockstep across the two call sites (newtab.mjs + gbti-browse.mjs).

// SOW-042: 'all' is the cross-type directory tab (browse.html#tab=all). buildReadHash is never called with 'all'
// (feed rows always deep-link a concrete type), so its 'post' fallback is unaffected; parseBrowseHash recognizing
// 'all' lets the rail's "All" link + the gbti-browse All tab round-trip.
const TAB_IDS = new Set(['all', 'post', 'product', 'prompt', 'share', 'news']);

/** Build the location.hash fragment (WITHOUT the leading '#') for opening `path` of `type` in the reader.
 *  Falls back to a tab-only hash when there is no path (so the row still lands on the right Browse tab). */
export function buildReadHash(type, path) {
  const t = TAB_IDS.has(type) ? type : 'post';
  return path ? `tab=${t}&read=${encodeURIComponent(path)}` : `tab=${t}`;
}

/** Parse a location.hash (with or without the leading '#') into { tab, read }. tab is null when absent/unknown
 *  (the caller defaults to 'post'); read is the decoded repo path or null. Malformed encoding falls back to the
 *  raw token rather than throwing. */
export function parseBrowseHash(hash) {
  const s = String(hash || '').replace(/^#/, '');
  const tabM = s.match(/(?:^|&)tab=([a-z]+)(?:&|$)/);
  const readM = s.match(/(?:^|&)read=([^&]+)/);
  const tab = tabM && TAB_IDS.has(tabM[1]) ? tabM[1] : null;
  let read = null;
  if (readM) {
    try { read = decodeURIComponent(readM[1]); } catch { read = readM[1]; }
  }
  return { tab, read };
}
