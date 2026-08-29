// sow-165 (owner answer to Q36, 2026-08-29): the editor's reuse picker sources from the member's OWN
// published items, NOT from `members/<user>/images/`.
//
// Why that folder is not the source. Q34 settled that an uploaded body image co-locates into the item's own
// folder, and the side effect nobody could see at the time is that the per-user folder stopped accumulating.
// Measured at origin/main before the owner chose: `members/*/images/` holds ONE file, against 385 co-located
// image files across three members. A picker reading the per-user folder would have shown one image to one
// member and nothing at all to anybody else, so it would have looked built and been useless.
//
// The owner accepted the stated cost of this source: the picker is a HISTORY rather than a curated set, so
// one item's screenshots sit alongside another's.
//
// WHY THIS SCANS THE RAW FILE INSTEAD OF CALLING referencedImages(entry.data).
//
// That was the first implementation and it silently found HALF the corpus: 195 images where the real answer
// is 377. The field list was not the problem. `IMAGE_FIELD_KEYS` already names coverImage, image, banner,
// featuredImage, icon, iconLarge and the gallery list. The problem is that an Astro content collection
// resolves an `image()`-typed field into an ImageMetadata OBJECT before anything downstream sees it, so
// `String(value)` is "[object Object]" and the canonical `./images/<name>` regex cannot match. The extractor
// was correct and was being handed the wrong shape.
//
// The failure is worth naming because of how it presented: an index that built, validated, shipped a
// plausible 195, and was wrong by half in the SAFE-LOOKING direction. It was caught only by counting the
// files on disk and refusing to accept a gap I could not explain, and then by checking whether each
// "unreferenced" filename appeared in its own item's text at all. 182 of 190 did.
//
// Scanning the raw file text cannot drift from a field list, because it has none. It sees every frontmatter
// form (scalar, quoted, and a `- "./images/x"` gallery row) and both markdown body forms, and a new image
// field added to the schema tomorrow is covered without an edit here.
//
// This module is node-free and carries no URL convention of its own. It emits `{ name, itemPath }` and the UI
// resolves that pair through the EXISTING `resolveContentAsset` in client-ui/src/assets.mjs, which already
// knows how to turn a content-relative image into a jsDelivr URL.

import { contentItemPath } from './content-index.mjs';

// The canonical co-located shape, matched anywhere in the file. Deliberately NOT anchored and deliberately not
// requiring a markdown wrapper: the same literal appears as a bare frontmatter scalar (`image: ./images/x`),
// a quoted one, a gallery row, an `![alt](./images/x)` image and a `[text](./images/x)` LINK. All five are a
// reference for this purpose, because the question is "does the item use this file", not "does Astro emit it".
const ANY_IMAGE_REF_RE = /\.\/images\/([a-z0-9][a-z0-9._-]*)/gi;

/**
 * Every image an item's SOURCE references, in first-seen order (so the frontmatter cover leads, because
 * frontmatter is at the top of the file), deduped by name.
 *
 * @param {string} source the raw index.md text, frontmatter and body together
 * @param {{type: string, author?: string, slug: string, title?: string}} item
 * @returns {Array<{name: string, itemPath: string, itemTitle: string, type: string, slug: string, author: string}>}
 */
export function mediaRecordsFromSource(source, item) {
  const type = item?.type;
  const slug = item?.slug;
  const author = item?.author || 'gbti';
  const itemPath = contentItemPath(type, author, slug);
  // No resolvable path means no way to address the image, so emitting the record would produce a broken
  // thumbnail rather than a missing one. Drop it.
  if (!itemPath) return [];

  const seen = new Set();
  const out = [];
  for (const m of String(source ?? '').matchAll(ANY_IMAGE_REF_RE)) {
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, itemPath, itemTitle: item?.title || slug || '', type, slug, author });
  }
  return out;
}

/**
 * Group flat records by author, preserving arrival order (the caller sorts newest-first before calling, so
 * each author's list stays newest-first without this needing to know about dates).
 * @param {Array<{author: string}>} records
 * @returns {Record<string, Array<object>>}
 */
export function groupMediaByAuthor(records) {
  const out = {};
  for (const r of Array.isArray(records) ? records : []) {
    const a = r?.author;
    if (!a) continue;
    (out[a] ||= []).push(r);
  }
  return out;
}
