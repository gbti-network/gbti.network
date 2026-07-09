// SOW-092: pure helpers behind the share-submit redirect. On success the composer emits a READER-READY
// optimistic item (the SOW-076 instant-feel model: the member sees their share NOW; the canonical version
// replaces it on the next feed load after the ~3 minute deploy). Node-free, no DOM, unit-tested.

/** The owning username from a publish result path (members/<user>/shares/<id>.md). Null when unparseable. */
export function authorFromPath(path) {
  const m = /^members\/([a-z0-9][a-z0-9-]*)\//i.exec(String(path || ''));
  return m ? m[1] : null;
}

/**
 * Build the optimistic share item the reader renders immediately after a successful post.
 * `res` is the publishShare result ({ id, path, visibility, ... }), `input`/`body` are what the member
 * just submitted. The item carries the LOCAL plaintext body and NO encryptedBody, so the author's own
 * just-written share renders with zero decrypt round-trip even at members visibility (gbti-reader._body
 * renders whatever body it is handed). Returns null without the id or author (no redirect target).
 */
export function optimisticShareItem({ res, input = {}, body = '', now = null } = {}) {
  const id = res?.id ?? null;
  const author = authorFromPath(res?.path);
  if (!id || !author) return null;
  const createdAt = now ?? new Date().toISOString();
  return {
    type: 'share',
    author,
    id,
    title: input.title || '',
    shortDescription: input.shortDescription || '',
    url: input.url || '',
    image: input.image || null,
    thumb: input.image || null,
    visibility: res?.visibility ?? input.visibility ?? 'members',
    body: String(body || ''),
    createdAt,
    publishedAt: createdAt,
  };
}
