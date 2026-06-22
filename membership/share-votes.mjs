// SOW-057: the PER-TARGET share-vote record. The favorites/activity store (membership/member-activity.mjs) is
// deliberately per-MEMBER and member-identity-free, so it cannot answer "how many DISTINCT members upvoted share
// X" at click time. That decision needs a per-TARGET structure, which is THIS module: a pure core over a single
// share's voter set, plus the Worker wrapper (workers/signup/share-votes.mjs) that does the KV read-modify-write
// around it under the key `upvotes:share:<author>/<id>`.
//
// The author's own upvote never counts toward the threshold (the author's github_id is cached on the record at
// first touch and excluded from the count). Idempotency is by the `enqueuedAt` WATERMARK, not the live count:
// once a share has been enqueued for syndication, it is never enqueued again even if votes churn around the
// threshold.
//
// Shape (KV value at upvotes:share:<author>/<id>):
//   { voters: ["<github_id>", ...], author: "<github_id>|null", enqueuedAt: <epoch ms>|null, updatedAt }
//
// GDPR note: this record holds raw github_ids OUTSIDE the per-member activity: key, so erasure must ALSO scrub
// these sets (scripts/lib/erase-member.mjs lists upvotes:share:* and removes the erased id). Documented in SOW-057.

export class ShareVoteError extends Error {}

const id = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

export function emptyShareVotes() {
  return { voters: [], author: null, enqueuedAt: null, updatedAt: null };
}

/** Defensive: coerce any stored value into the canonical shape (unique voter ids, numeric watermarks). */
export function normalizeShareVotes(raw) {
  const r = emptyShareVotes();
  if (!raw || typeof raw !== 'object') return r;
  if (Array.isArray(raw.voters)) {
    const seen = new Set();
    for (const v of raw.voters) {
      const s = id(v);
      if (!s || seen.has(s)) continue;
      seen.add(s);
      r.voters.push(s);
    }
  }
  r.author = id(raw.author) || null;
  r.enqueuedAt = Number.isFinite(Number(raw.enqueuedAt)) && raw.enqueuedAt != null ? Number(raw.enqueuedAt) : null;
  r.updatedAt = Number.isFinite(Number(raw.updatedAt)) && raw.updatedAt != null ? Number(raw.updatedAt) : null;
  return r;
}

/**
 * Add or remove a voter. PURE. `authorId` is the share author's github_id; once known it is cached on the record
 * (it never changes for a given share). Toggling is idempotent (adding an existing voter or removing an absent
 * one is a no-op beyond the updatedAt stamp).
 */
export function applyShareVote(record, { voterId, authorId, on }, { now = Date.now } = {}) {
  const voter = id(voterId);
  if (!voter) throw new ShareVoteError('voterId is required');
  const r = normalizeShareVotes(record);
  if (!r.author && id(authorId)) r.author = id(authorId);
  const has = r.voters.includes(voter);
  if (on && !has) r.voters.push(voter);
  else if (!on && has) r.voters = r.voters.filter((v) => v !== voter);
  r.updatedAt = Number(now());
  return r;
}

/** The number of DISTINCT voters excluding the share author. */
export function distinctNonAuthorCount(record) {
  const r = normalizeShareVotes(record);
  return r.voters.filter((v) => v !== r.author).length;
}

/**
 * Should this share be enqueued for syndication now? Only when the distinct non-author count has reached the
 * threshold AND the share has not already been enqueued (the watermark guard). Author exclusion is enforced at
 * vote time by the Worker (it knows the voter's github_login and the author username from the slug), and is
 * additionally defended here via the cached author github_id, so a share whose author never self-upvotes can
 * still be enqueued by two other members.
 */
export function shouldEnqueue(record, threshold) {
  const r = normalizeShareVotes(record);
  if (r.enqueuedAt != null) return false; // already enqueued: never again
  const t = Number.isFinite(Number(threshold)) ? Math.max(1, Math.floor(Number(threshold))) : 2;
  return distinctNonAuthorCount(r) >= t;
}

/** Stamp the enqueue watermark so the share is never enqueued again. PURE. */
export function markEnqueued(record, { now = Date.now } = {}) {
  const r = normalizeShareVotes(record);
  r.enqueuedAt = Number(now());
  r.updatedAt = Number(now());
  return r;
}

/** Remove a github_id from the voter set (GDPR erasure). Returns { record, changed }. */
export function scrubVoter(record, githubId, { now = Date.now } = {}) {
  const target = id(githubId);
  const r = normalizeShareVotes(record);
  const before = r.voters.length;
  r.voters = r.voters.filter((v) => v !== target);
  const authorWas = r.author;
  if (r.author === target) r.author = null; // also drop the cached author id if it is the erased member
  const changed = r.voters.length !== before || authorWas !== r.author;
  if (changed) r.updatedAt = Number(now());
  return { record: r, changed };
}
