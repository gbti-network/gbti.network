// SOW-073: a small stale-while-revalidate cache for the member workbench (<gbti-workspace>). It renders the
// last-known owned content INSTANTLY (killing the cold-open "Loading / you have none" flash) then revalidates in the
// background. Per-member, per-type, persisted in chrome.storage.local when available (the extension pages) and an
// in-memory Map otherwise (the npm CMS host, tests). Pure + node-free + host-portable: no chrome.* reference is
// required for it to work, it just uses chrome.storage when present. Fail-safe: any storage error falls through to
// a live fetch, never throws, never blanks the view.

export const WB_CACHE_PREFIX = 'gbti:wb';
export const WB_DEFAULT_TTL_MS = 10 * 60 * 1000; // SWR staleness bound: how long a copy may be SHOWN while revalidating

const mem = new Map(); // npm-host / test fallback (no chrome.storage)

/** The chrome.storage.local store if this host exposes it, else null (-> in-memory fallback). */
function store() {
  try {
    const s = globalThis.chrome?.storage?.local;
    return s && typeof s.get === 'function' && typeof s.set === 'function' ? s : null;
  } catch { return null; }
}

export function wbKey(memberKey, type) { return `${WB_CACHE_PREFIX}:${memberKey}:${type}`; }

async function rawGet(key) {
  const s = store();
  if (s) { try { const r = await s.get(key); return r?.[key] ?? null; } catch { return null; } }
  return mem.has(key) ? mem.get(key) : null;
}
async function rawSet(key, value) {
  const s = store();
  if (s) { try { await s.set({ [key]: value }); } catch { /* storage unavailable */ } return; }
  mem.set(key, value);
}
async function rawDel(keys) {
  const list = Array.isArray(keys) ? keys : [keys];
  const s = store();
  if (s) { try { await s.remove(list); } catch { /* ignore */ } return; }
  for (const k of list) mem.delete(k);
}

/**
 * Read the cached items for a member+type. Returns { items, at, fresh } or null when absent/unusable. `fresh` is
 * whether the entry is within the TTL (a fresh entry can skip the revalidate; a stale one is still shown while a
 * background revalidate runs).
 */
export async function wbCacheGet(memberKey, type, { ttl = WB_DEFAULT_TTL_MS, now = Date.now } = {}) {
  if (!memberKey || !type) return null;
  const v = await rawGet(wbKey(memberKey, type));
  if (!v || !Array.isArray(v.items)) return null;
  const at = Number(v.at) || 0;
  return { items: v.items, at, fresh: (now() - at) < ttl };
}

/**
 * Persist items for a member+type. Write-on-success: by default an empty array is NOT persisted (so a transient
 * auth failure that yields [] cannot poison the cache). The workbench passes allowEmpty:true on the SUCCESS path,
 * where [] genuinely means "this member owns none", so an empty list caches instead of re-fetching forever.
 */
export async function wbCacheSet(memberKey, type, items, { now = Date.now, allowEmpty = false } = {}) {
  if (!memberKey || !type || !Array.isArray(items)) return;
  if (!items.length && !allowEmpty) return;
  await rawSet(wbKey(memberKey, type), { at: now(), items });
}

/** Invalidate one type (delete the entry so the next read misses + refetches). Used by activity invalidation (P2). */
export async function wbCacheInvalidate(memberKey, type) {
  if (!memberKey || !type) return;
  await rawDel(wbKey(memberKey, type));
}

/** Invalidate several types at once (e.g. a publish touches the type + overview + prs). */
export async function wbCacheInvalidateMany(memberKey, types = []) {
  if (!memberKey || !Array.isArray(types) || !types.length) return;
  await rawDel(types.map((t) => wbKey(memberKey, t)));
}

/**
 * Clear ALL workbench cache (a given member, or every member when memberKey is falsy). Called on sign-out / account
 * switch so one member's owned-content metadata never survives into another session (SOW-073 GDPR guard).
 */
export async function wbCacheClear(memberKey) {
  const prefix = memberKey ? `${WB_CACHE_PREFIX}:${memberKey}:` : `${WB_CACHE_PREFIX}:`;
  const s = store();
  if (s) {
    try {
      const all = await s.get(null);
      const keys = Object.keys(all || {}).filter((k) => k.startsWith(prefix));
      if (keys.length) await s.remove(keys);
    } catch { /* ignore */ }
    return;
  }
  for (const k of [...mem.keys()]) if (k.startsWith(prefix)) mem.delete(k);
}

/** Test-only: reset the in-memory fallback store. */
export function _resetWbMemoryStore() { mem.clear(); }
