// sow-323 Phase 3: reading and writing the editorial review queue's KV records.
//
// SEPARATE FROM membership-editorial.mjs ON PURPOSE. Both publish routes write records, and one of them is
// github-app.mjs, which membership-editorial.mjs imports for its installation token. Putting the writes in the
// route module would make those two files import each other. The same reasoning put the audience rule in
// membership-audience.mjs rather than leaving it where it was first written.
//
// This module holds NO authorization and NO GitHub calls: the routes authorize, and the callers have already
// decided which items need review (queueableItems).
import {
  EDITORIAL_STATE, editorialKey, entryState, entryAfterEdit, newEntry, reviewableItem,
} from '../../membership/editorial-queue.mjs';

/** Read one record, or null. A value that will not parse reads as null so nothing acts on junk. */
export async function readEditorialEntry(kv, path) {
  try {
    const rec = await kv.get(editorialKey(path), 'json');
    return rec && typeof rec === 'object' ? rec : null;
  } catch { return null; }
}

/**
 * Write (or refresh) a queue record for every item of this publish that needs review.
 *
 * Returns `{ ok, entries, fresh }`. `fresh` is the records that are NEWLY waiting, which is the only thing the
 * owner is emailed about: an edit to something already pending does not mail them again, and neither does a
 * revision of something they dismissed (that returns to the queue quietly, per the owner's rule of 2026-09-15).
 * `ok:false` means a KV write failed and the caller must refuse the publish.
 */
export async function recordEditorialItems(kv, items, { githubId, now = new Date() } = {}) {
  const entries = [];
  const fresh = [];
  if (!kv || !Array.isArray(items) || !items.length) return { ok: true, entries, fresh };
  for (const item of items) {
    try {
      const existing = await readEditorialEntry(kv, item.path);
      const rec = (existing && entryAfterEdit(existing, { title: item.title, now }))
        || newEntry({ ...item, githubId, now });
      await kv.put(editorialKey(item.path), JSON.stringify(rec));
      entries.push(rec);
      if (!existing && entryState(rec) === EDITORIAL_STATE.pending) fresh.push(rec);
    } catch {
      return { ok: false, entries, fresh };
    }
  }
  return { ok: true, entries, fresh };
}

/**
 * Drop the records of items this publish DELETED (a removal, or the old half of a rename). Best effort: a
 * leftover record lists an item that is not there any more, which a superadmin can set aside, so a failed
 * cleanup must never refuse a publish that has already succeeded.
 */
export async function removeEditorialItems(kv, paths) {
  let removed = 0;
  if (!kv || !Array.isArray(paths)) return { removed };
  for (const p of paths) {
    const item = reviewableItem(p);
    if (!item) continue;
    try { await kv.delete(editorialKey(item.path)); removed += 1; } catch { /* best effort */ }
  }
  return { removed };
}
