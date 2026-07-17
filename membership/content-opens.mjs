// SOW-126: the PER-ITEM member-content detail-open record. Answers "how many DISTINCT members opened this
// content item's expanded reader view" so the reconcile popularity engine can promote it to auto-share on its
// `popular` channels once the threshold is met. Clones the SOW-111 news-opens pattern: a pure core over a
// single item's opener set, with the Worker doing the KV read-modify-write around it under the key
// `content-opens:<type>:<slug>` (type in post|product|prompt|share; slug is the bare slug for content, the
// composite <author>/<id> for a share).
//
// Unlike news-opens, this record carries NO postedAt watermark: promotion is RECONCILE-periodic and its
// idempotency lives in house/popular-promoted.yml, so this store is purely the distinct-opener tally.
//
// GDPR note: this holds raw github_ids OUTSIDE the per-member activity key, so erasure must ALSO scrub these
// sets (scripts/lib/erase-member.mjs lists content-opens:* and removes the erased id via scrubOpener).

export class ContentOpenError extends Error {}

const id = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

export const CONTENT_OPEN_TYPES = Object.freeze(['post', 'product', 'prompt', 'share']);

export function emptyContentOpens() {
  return { openers: [], updatedAt: null };
}

/** Defensive: coerce any stored value into the canonical shape (unique opener ids). */
export function normalizeContentOpens(raw) {
  const r = emptyContentOpens();
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
  r.updatedAt = Number.isFinite(Number(raw.updatedAt)) && raw.updatedAt != null ? Number(raw.updatedAt) : null;
  return r;
}

/** Record one member's open. PURE. Re-opening is a no-op beyond the updatedAt stamp (the set dedupes). The
 *  author of the item is excluded by the caller (their own open must not count toward their item's popularity). */
export function applyOpen(record, { openerId }, { now = Date.now } = {}) {
  const opener = id(openerId);
  if (!opener) throw new ContentOpenError('openerId is required');
  const r = normalizeContentOpens(record);
  if (!r.openers.includes(opener)) r.openers.push(opener);
  r.updatedAt = Number(now());
  return r;
}

/** The number of DISTINCT members who opened the item. */
export function distinctOpenerCount(record) {
  return normalizeContentOpens(record).openers.length;
}

/** Remove a github_id from the opener set (GDPR erasure). Returns { record, changed }. */
export function scrubOpener(record, githubId, { now = Date.now } = {}) {
  const target = id(githubId);
  const r = normalizeContentOpens(record);
  const before = r.openers.length;
  r.openers = r.openers.filter((v) => v !== target);
  const changed = r.openers.length !== before;
  if (changed) r.updatedAt = Number(now());
  return { record: r, changed };
}

/** The canonical KV key for a content item's opener set. */
export function contentOpensKey(type, slug) {
  return `content-opens:${String(type)}:${String(slug)}`;
}
