// sow-347: browser storage that never throws. When a browser refuses a page its storage (the member blocked site
// data, some private modes), merely READING the `localStorage` property throws a SecurityError, and a
// `typeof localStorage` check does not help, because evaluating the name is what throws. The WorkBench read two
// saved settings that way and rendered nothing at all for those members. Every read goes through here instead.

/** The page's localStorage, or null when there is none or the browser refuses it. Never throws. */
export function browserStorage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

/** One stored value, or null when it is absent or storage is unavailable. Never throws. */
export function readStored(key) {
  try { return browserStorage()?.getItem(key) ?? null; } catch { return null; }
}
