// sow-427 B2: KV access for PREPARED PROJECT LISTINGS, shared by the superadmin routes, the signed-out read and the
// claim. The pure half (key shapes, validation, the record) is membership/prepared-listings.mjs; this module only
// reads and writes.
//
//   invite-listing:<ID>              one listing record
//   invite-listing-img:<ID>:<name>   one image, { dataBase64, contentType, bytes, at }, put with metadata { bytes }
//
// The image value mirrors the member draft store (`draftimg:`, membership-draft-images.mjs) on purpose: the same
// base64-in-JSON wire shape, so the website reads a listing image with the loader it already uses for staged ones,
// and the size rides in key metadata so a listing's images can be counted from a list() without fetching them.
//
// READS FAIL SOFT TO NULL, exactly like invites-store.mjs: an unreadable record behaves like an absent one, and
// every caller's next step on null is the fail-closed one (inactive, not found, refuse). A LIST that fails returns
// null rather than a short list, because a manager that silently shows fewer listings than exist is the
// silent-truncation failure this system tries not to have.
//
// COPYING A SUPERADMIN'S STAGED IMAGES IS THREE STEPS, NOT ONE (amendment 5). The route collects the bytes first
// (collectListingImages, which writes nothing), validates everything, and only then writes the images
// (writeCollectedImages), the invite and the listing, deleting the staged copies LAST (deleteStagedCopies). A
// refusal anywhere before the writes leaves the superadmin's staged images exactly where they were, so a retry
// after fixing the permalink still finds them.
//
// No logging: every value here is about a person who has not agreed to anything yet.

import {
  LISTING_KEY_PREFIX, isListingId, isListingImageName, listingKey, listingImageKey, listingImagePrefix,
} from '../../membership/prepared-listings.mjs';
import {
  draftImageKey, legacyDraftImageKey, itemTokenOf, contentTypeFor, DRAFT_IMAGE_MAX_BYTES,
} from '../../membership/draft-images.mjs';
import { base64Bytes } from '../../src/lib/workbench-client-core.mjs';

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// ---- listing records ------------------------------------------------------------------------------------------

/** The listing record stored under `id`, or null (absent, unreadable, not an object, or a malformed id). */
export async function readListing(kv, id) {
  if (!kv || !isListingId(id)) return null;
  try {
    const rec = await kv.get(listingKey(id), 'json');
    return isPlainObject(rec) ? rec : null;
  } catch {
    return null;
  }
}

/** Write a listing record under its own id. True on success, false on any failure (never throws). */
export async function writeListing(kv, rec) {
  if (!kv || !isPlainObject(rec) || !isListingId(rec.id)) return false;
  try {
    await kv.put(listingKey(rec.id), JSON.stringify(rec));
    return true;
  } catch {
    return false;
  }
}

/** Delete one listing record. True on success (an absent key counts), false on a failed delete. */
export async function deleteListing(kv, id) {
  if (!kv || !isListingId(id)) return false;
  try {
    await kv.delete(listingKey(id));
    return true;
  } catch {
    return false;
  }
}

/** Every listing id in the store, paged over the prefix, or null when the list could not be completed. */
export async function listListingIds(kv) {
  if (!kv) return null;
  const ids = [];
  let cursor;
  for (;;) {
    let page;
    try { page = await kv.list({ prefix: LISTING_KEY_PREFIX, cursor }); } catch { return null; }
    for (const k of page?.keys ?? []) {
      const id = String(k?.name ?? '').slice(LISTING_KEY_PREFIX.length);
      if (id) ids.push(id);
    }
    if (page?.list_complete || !page?.cursor) break;
    cursor = page.cursor;
  }
  return ids;
}

/**
 * Every listing, as `[{ id, rec }]` where `id` is the KEY's id and `rec` the stored record (null when it would not
 * parse). A record whose own id disagrees with its key is returned as it is, for the caller to flag, rather than
 * dropped: dropping it would hide a corrupt row from the only surface that could notice it. Null when the list
 * itself failed.
 */
export async function listListings(kv) {
  const ids = await listListingIds(kv);
  if (!ids) return null;
  const out = [];
  for (const id of ids) {
    let rec = null;
    try { rec = await kv.get(`${LISTING_KEY_PREFIX}${id}`, 'json'); } catch { rec = null; }
    out.push({ id, rec: isPlainObject(rec) ? rec : null });
  }
  return out;
}

// ---- listing images -------------------------------------------------------------------------------------------

/** One stored listing image, `{ dataBase64, contentType, bytes }`, or null. */
export async function readListingImage(kv, id, name) {
  if (!kv || !isListingId(id) || !isListingImageName(name)) return null;
  try {
    const v = await kv.get(listingImageKey(id, name), 'json');
    if (!isPlainObject(v) || typeof v.dataBase64 !== 'string' || !v.dataBase64) return null;
    return { dataBase64: v.dataBase64, contentType: v.contentType || contentTypeFor(name), bytes: Number(v.bytes) || base64Bytes(v.dataBase64) };
  } catch {
    return null;
  }
}

/** Store one listing image. True on success, false on a refused name, empty bytes or a failed write. */
export async function putListingImage(kv, id, name, dataBase64, { now = Date.now() } = {}) {
  if (!kv || !isListingId(id) || !isListingImageName(name)) return false;
  const b64 = typeof dataBase64 === 'string' ? dataBase64 : '';
  if (!b64) return false;
  const bytes = base64Bytes(b64);
  const at = now instanceof Date ? now.getTime() : Number(now);
  try {
    await kv.put(listingImageKey(id, name), JSON.stringify({ dataBase64: b64, contentType: contentTypeFor(name), bytes, at }), { metadata: { bytes } });
    return true;
  } catch {
    return false;
  }
}

/** A listing's stored images as `[{ name, key, bytes }]`, read from key metadata, or null when the list failed. */
export async function listListingImages(kv, id) {
  if (!kv || !isListingId(id)) return null;
  const prefix = listingImagePrefix(id);
  const out = [];
  let cursor;
  for (;;) {
    let page;
    try { page = await kv.list({ prefix, cursor }); } catch { return null; }
    for (const k of page?.keys ?? []) {
      const key = String(k?.name ?? '');
      out.push({ name: key.slice(prefix.length), key, bytes: Number(k?.metadata?.bytes) || 0 });
    }
    if (page?.list_complete || !page?.cursor) break;
    cursor = page.cursor;
  }
  return out;
}

/**
 * Delete a listing's images, all of them or all but `keep`. Deletes the keys the list returned rather than rebuilt
 * ones, so a key stored under a name the current rules would refuse is removed too. `{ ok, deleted }`; ok is false
 * when the list or any delete failed, so a caller can refuse to delete the record and leave the retry possible.
 */
export async function deleteListingImages(kv, id, { keep = [] } = {}) {
  const stored = await listListingImages(kv, id);
  if (!stored) return { ok: false, deleted: 0 };
  const hold = new Set(keep);
  let deleted = 0;
  let ok = true;
  for (const s of stored) {
    if (hold.has(s.name)) continue;
    try { await kv.delete(s.key); deleted += 1; } catch { ok = false; }
  }
  return { ok, deleted };
}

/** Delete the named images of one listing (the names an edit stopped using). `{ ok, deleted }`. */
export async function deleteListingImageNames(kv, id, names) {
  if (!kv || !isListingId(id)) return { ok: false, deleted: 0 };
  let deleted = 0;
  let ok = true;
  for (const name of Array.isArray(names) ? names : []) {
    if (!isListingImageName(name)) continue;
    try { await kv.delete(listingImageKey(id, name)); deleted += 1; } catch { ok = false; }
  }
  return { ok, deleted };
}

/**
 * The bytes for every name, as `{ ok: true, images: Map(name, base64) }`, or `{ ok: false, missing: [names] }`.
 * For the claim, which commits exactly the images the stored record names and must refuse when one is gone.
 */
export async function readListingImageMap(kv, id, names) {
  const images = new Map();
  const missing = [];
  for (const name of Array.isArray(names) ? names : []) {
    const img = await readListingImage(kv, id, name);
    if (img) images.set(name, img.dataBase64);
    else missing.push(name);
  }
  return missing.length ? { ok: false, missing } : { ok: true, images };
}

// ---- the superadmin's staged images ---------------------------------------------------------------------------

/**
 * One image the CALLER staged in the member draft store for `item`, `{ dataBase64, contentType, key }` or null.
 * The key is built from the caller's own account number, so a superadmin reads only their own staged images. The
 * item-scoped key first, then the pre-item key, exactly as the draft image route reads.
 */
export async function readStagedImage(kv, callerId, item, name) {
  if (!kv || !callerId || !isListingImageName(name)) return null;
  const token = itemTokenOf(item);
  const keys = token ? [draftImageKey(callerId, token, name), legacyDraftImageKey(callerId, name)] : [legacyDraftImageKey(callerId, name)];
  for (const key of keys) {
    let v = null;
    try { v = await kv.get(key, 'json'); } catch { v = null; }
    if (isPlainObject(v) && typeof v.dataBase64 === 'string' && v.dataBase64) {
      return { dataBase64: v.dataBase64, contentType: v.contentType || contentTypeFor(name), key };
    }
  }
  return null;
}

/**
 * Gather the bytes for every image a prepared project references, WRITING NOTHING. A freshly staged upload (the
 * caller's own draft image store, under `stagedItem`) wins over the listing's stored copy, because the superadmin
 * just replaced it; otherwise the listing's stored copy is kept (an edit that did not touch that image).
 *
 * @returns `{ ok: true, images: Map(name, { dataBase64, source: 'staged' | 'listing', key }) }`, or
 *          `{ ok: false, error: 'image_missing', missing: [names] }`, or
 *          `{ ok: false, error: 'image_too_large', names: [names] }` for an image over the 1 MiB per-image cap.
 */
export async function collectListingImages(kv, { callerId = null, stagedItem = null, id = null, names = [] } = {}) {
  const images = new Map();
  const missing = [];
  const tooLarge = [];
  for (const name of Array.isArray(names) ? names : []) {
    let got = null;
    const staged = callerId ? await readStagedImage(kv, callerId, stagedItem, name) : null;
    if (staged) got = { dataBase64: staged.dataBase64, source: 'staged', key: staged.key };
    else if (isListingId(id)) {
      const stored = await readListingImage(kv, id, name);
      if (stored) got = { dataBase64: stored.dataBase64, source: 'listing', key: listingImageKey(id, name) };
    }
    if (!got) { missing.push(name); continue; }
    if (base64Bytes(got.dataBase64) > DRAFT_IMAGE_MAX_BYTES) { tooLarge.push(name); continue; }
    images.set(name, got);
  }
  if (missing.length) return { ok: false, error: 'image_missing', missing };
  if (tooLarge.length) return { ok: false, error: 'image_too_large', names: tooLarge };
  return { ok: true, images };
}

/** The collected images as `Map(name, base64)`, the shape buildClaimFiles and preparedSizeProblem take. */
export function imageBytesOf(images) {
  const m = new Map();
  for (const [name, v] of images instanceof Map ? images : new Map()) m.set(name, v.dataBase64);
  return m;
}

/**
 * Write the collected images that came from the staged store under the listing `id` (the ones already stored for
 * it are left alone). `{ ok, written: [names] }`; on a failed write `ok` is false and `written` names what did land,
 * for the caller to remove.
 */
export async function writeCollectedImages(kv, id, images, { now = Date.now() } = {}) {
  const written = [];
  for (const [name, v] of images instanceof Map ? images : new Map()) {
    if (v.source !== 'staged') continue;
    if (!(await putListingImage(kv, id, name, v.dataBase64, { now }))) return { ok: false, written };
    written.push(name);
  }
  return { ok: true, written };
}

/** Delete the staged copies the collected images were read from. The LAST step of a save. Returns the count. */
export async function deleteStagedCopies(kv, images) {
  let n = 0;
  for (const v of (images instanceof Map ? images : new Map()).values()) {
    if (v.source !== 'staged' || !v.key || !String(v.key).startsWith('draftimg:')) continue;
    try { await kv.delete(v.key); n += 1; } catch { /* a leftover staged copy is the member store's own cleanup */ }
  }
  return n;
}
