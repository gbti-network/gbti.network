// 2026-10-23: the new tab's remembered Shares list, so the Shares tab paints at once from the last list this account
// saw while the fresh one loads (owner: "shares page still took 6 seconds to load"). The pure helpers are node-tested;
// the two chrome.storage wrappers at the bottom are the only side effects.
//
// One key PER ACCOUNT, `gbti:shares:<githubId>`, never a bare key: two accounts on one browser must not see each
// other's list (sow-345). There is no key without an identity, so a signed-out tab neither reads nor writes one, and
// sign-out removes every key with this prefix (background.mjs). The entries are share SUMMARIES only: a members-only
// share's note is a pointer here as it is on the wire. Showing a members-only row still waits for the membership
// check, because the feed's mergeAll hides those until it reads paid.

export const SHARES_CACHE_PREFIX = 'gbti:shares:';
export const SHARES_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // older than a day is not worth flashing
const MAX_ITEMS = 40;

/** The account's storage key, or null when there is no signed-in identity to scope it by. */
export function sharesCacheKey(identity) {
  const id = String(identity?.githubId ?? '').trim();
  return /^\d+$/.test(id) ? `${SHARES_CACHE_PREFIX}${id}` : null;
}

/** The items of a remembered entry worth showing now, or null (missing, malformed, or over a day old). */
export function usableSharesCache(entry, now = Date.now()) {
  if (!entry || !Array.isArray(entry.items) || !entry.items.length) return null;
  const at = Number(entry.at);
  if (!Number.isFinite(at) || now - at < 0 || now - at > SHARES_CACHE_MAX_AGE_MS) return null;
  return entry.items;
}

/** The entry to remember: the newest summaries and when they were fetched, nothing else. */
export function sharesCacheEntry(items, now = Date.now()) {
  return { at: now, items: (Array.isArray(items) ? items : []).slice(0, MAX_ITEMS) };
}

/** Read this account's remembered list. Null on any failure: the tab then waits for the fetch, as before. */
export async function readSharesCache(now = Date.now()) {
  try {
    const { gbti } = (await chrome.storage.local.get('gbti')) || {};
    const key = sharesCacheKey(gbti?.identity);
    if (!key) return null;
    const got = (await chrome.storage.local.get(key)) || {};
    return usableSharesCache(got[key], now);
  } catch { return null; }
}

/** Remember a freshly fetched list for this account. Best-effort: a blocked store only loses the instant paint. */
export async function writeSharesCache(items, now = Date.now()) {
  try {
    const { gbti } = (await chrome.storage.local.get('gbti')) || {};
    const key = sharesCacheKey(gbti?.identity);
    if (key) await chrome.storage.local.set({ [key]: sharesCacheEntry(items, now) });
  } catch { /* storage unavailable */ }
}
