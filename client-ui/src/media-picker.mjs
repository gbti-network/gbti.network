// sow-165 (Q36): the pure half of the editor's image reuse picker.
//
// The picker offers every image the signed-in member's own published items already reference, read from the
// build-time /media-index.json. Selecting one has to COPY the file into the item being edited, because a body
// image reference is `./images/<name>` resolved against the item's own folder: a reference to a file sitting
// in a different item's folder would render in the editor (which resolves over jsDelivr) and 404 on the built
// site. That copy is not a new code path. It stages the bytes through the SAME client.stageImage the upload
// flow uses, so co-location, naming and the publish flush stay in one place.
//
// Everything here is pure so it is reachable from node --test. The fetching and the DOM live in the element.

import { resolveContentAsset } from './assets.mjs';

/** Where the index lives. Absolute so the extension can fetch it cross-origin (the endpoint sends CORS `*`). */
export const MEDIA_INDEX_URL = 'https://gbti.network/media-index.json';

/**
 * The rows for one author, newest item first (the endpoint emits them in that order already).
 * Fail-soft to [] for a missing index, a missing author, or a shape that is not what we expect: an empty
 * picker is a correct empty state, and throwing here would take the whole editor down with it.
 */
export function mediaFor(index, author) {
  const rows = index?.byAuthor?.[author];
  return Array.isArray(rows) ? rows.filter((r) => r && typeof r.name === 'string' && typeof r.itemPath === 'string') : [];
}

/**
 * Filter rows by a free-text query over the file name AND the item title, case-insensitively.
 * Searching the title as well as the name is the point: a member remembers "the Upwork post", not
 * "claude-connector-directory-upwork.webp".
 */
export function filterMedia(rows, query) {
  const q = String(query ?? '').trim().toLowerCase();
  const list = Array.isArray(rows) ? rows : [];
  if (!q) return list.slice();
  return list.filter((r) => `${r?.name ?? ''} ${r?.itemTitle ?? ''}`.toLowerCase().includes(q));
}

/**
 * What selecting a row means for the item currently being edited.
 *
 * The `alreadyHere` case is the one worth having a name for: an image that lives in THIS item's folder needs
 * no copy at all, only the reference. Re-staging it would upload a byte-identical file over itself, and on a
 * host that de-duplicates by name it would look like it worked while doing nothing.
 *
 * @param {{name: string, itemPath: string}} record a row from the index
 * @param {string} currentItemPath the item being edited (may be absent for a brand-new, unsaved item)
 * @returns {{name: string, ref: string, alreadyHere: boolean, sourceUrl: string}|null}
 */
export function reusePlan(record, currentItemPath) {
  const name = record?.name;
  const from = record?.itemPath;
  if (!name || !from) return null;
  const alreadyHere = !!currentItemPath && from === currentItemPath;
  return {
    name,
    ref: `./images/${name}`,          // what the block stores, identical to what an upload produces
    alreadyHere,
    // Resolved against the SOURCE item, which is the whole point: the bytes live in the other item's folder.
    sourceUrl: resolveContentAsset(`./images/${name}`, from),
  };
}

/**
 * The member whose library to offer, derived from the item being edited.
 *
 * `members/<user>/posts/<slug>/index.md` -> `<user>`. That is the right answer without any new plumbing: the
 * folder an item lives in IS its owner, and it is the same key the index groups by.
 *
 * A `house/` item returns null rather than guessing. House content carries whatever `author` its frontmatter
 * names, so the folder does not identify a member, and offering the wrong person's library is worse than
 * offering none. An element that knows the signed-in login can pass it explicitly and override this.
 */
export function authorFromItemPath(itemPath) {
  const m = /^members\/([a-z0-9][a-z0-9-]*)\//i.exec(String(itemPath ?? ''));
  return m ? m[1] : null;
}
