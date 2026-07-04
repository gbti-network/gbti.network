// SOW-111: the PER-ITEM news detail-open record. Answers "how many DISTINCT members opened this news item's
// detailed view" so the Worker can auto-share it to its category Discord channel at the configured threshold.
// Clones the SOW-057 share-votes pattern: a pure core over a single item's opener set, with the Worker doing
// the KV read-modify-write around it under the key `news-opens:<guid>`.
//
// Idempotency is by the `postedAt` WATERMARK, not the live count: once this record has triggered an auto-post
// attempt, it never triggers again (the news-posted:<guid> record is the cross-signal dedupe; this watermark
// stops the opens path from re-resolving on every later open).
//
// Shape (KV value at news-opens:<guid>):
//   { openers: ["<github_id>", ...], postedAt: <epoch ms>|null, updatedAt }
//
// GDPR note: this record holds raw github_ids OUTSIDE the per-member activity key, so erasure must ALSO scrub
// these sets (scripts/lib/erase-member.mjs lists news-opens:* and removes the erased id via scrubOpener).

export class NewsOpenError extends Error {}

const id = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

export function emptyNewsOpens() {
  return { openers: [], postedAt: null, updatedAt: null };
}

/** Defensive: coerce any stored value into the canonical shape (unique opener ids, numeric watermarks). */
export function normalizeNewsOpens(raw) {
  const r = emptyNewsOpens();
  if (!raw || typeof raw !== 'object') return r;
  if (Array.isArray(raw.openers)) {
    const seen = new Set();
    for (const v of raw.openers) {
      const s = id(v);
      if (!s || seen.has(s)) continue;
      seen.add(s);
      r.openers.push(s);
    }
  }
  r.postedAt = Number.isFinite(Number(raw.postedAt)) && raw.postedAt != null ? Number(raw.postedAt) : null;
  r.updatedAt = Number.isFinite(Number(raw.updatedAt)) && raw.updatedAt != null ? Number(raw.updatedAt) : null;
  return r;
}

/** Record one member's open. PURE. Re-opening is a no-op beyond the updatedAt stamp (the set dedupes). */
export function applyOpen(record, { openerId }, { now = Date.now } = {}) {
  const opener = id(openerId);
  if (!opener) throw new NewsOpenError('openerId is required');
  const r = normalizeNewsOpens(record);
  if (!r.openers.includes(opener)) r.openers.push(opener);
  r.updatedAt = Number(now());
  return r;
}

/** The number of DISTINCT members who opened the item. */
export function distinctOpenerCount(record) {
  return normalizeNewsOpens(record).openers.length;
}

/** Should this item auto-post now? Only at the threshold AND never after the watermark. */
export function shouldPost(record, threshold) {
  const r = normalizeNewsOpens(record);
  if (r.postedAt != null) return false; // already triggered: never again
  const t = Number.isFinite(Number(threshold)) ? Math.max(1, Math.floor(Number(threshold))) : 2;
  return distinctOpenerCount(r) >= t;
}

/** Stamp the post watermark so this record never triggers again. PURE. */
export function markPosted(record, { now = Date.now } = {}) {
  const r = normalizeNewsOpens(record);
  r.postedAt = Number(now());
  r.updatedAt = Number(now());
  return r;
}

/** Remove a github_id from the opener set (GDPR erasure). Returns { record, changed }. */
export function scrubOpener(record, githubId, { now = Date.now } = {}) {
  const target = id(githubId);
  const r = normalizeNewsOpens(record);
  const before = r.openers.length;
  r.openers = r.openers.filter((v) => v !== target);
  const changed = r.openers.length !== before;
  if (changed) r.updatedAt = Number(now());
  return { record: r, changed };
}
