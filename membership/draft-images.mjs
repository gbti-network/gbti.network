// The staged-image store's pure half: keys, validation and quota. No KV, no network, no secrets, so the
// rules are unit-testable on their own (workers/signup/membership-draft-images.mjs does the IO).
//
// WHY THIS EXISTS. src/lib/workbench-client.ts staged an uploaded image into a plain in-memory Map and only
// publish() ever read it. Saving a draft therefore wrote the image PATH into KV and the image BYTES nowhere,
// so a reload left the editor and the preview pointing at a jsDelivr URL for a file that was never
// committed: a broken thumbnail that no amount of re-saving could fix.
//
// The bytes cannot ride along inside the draft record. membership/member-drafts.mjs caps a single draft at
// 150,000 bytes and the whole per-member store at 1,000,000, while one image alone may be a megabyte. So a
// staged image gets its own key, and its own caps, next to the drafts rather than inside them.
//
// The key is built from the AUTHENTICATED github_id, the item the image belongs to, and a sanitized file name.
// A caller never supplies a path, so there is no cross-member path to police: one member simply cannot address
// another member's key.

import { sanitizeImageName, base64Bytes } from '../src/lib/workbench-client-core.mjs';

/** One image per key. 1 MB decoded, matching MAX_IMAGE_BYTES in workbench-client.ts and the check-media gate. */
export const DRAFT_IMAGE_MAX_BYTES = 1_048_576;
/** Per-member ceilings, so the staging area cannot be used as free image hosting. */
export const DRAFT_IMAGES_MAX_COUNT = 40;
export const DRAFT_IMAGES_MAX_TOTAL_BYTES = 20 * 1_048_576;

export class DraftImageError extends Error {}

/** The KV key prefix for one member's staged images (also the list() prefix for quota and erasure). */
export const draftImagePrefix = (githubId) => `draftimg:${String(githubId)}:`;

// The item a staged image belongs to, in the SAME `<type>:<slug>` form the draft store keys its records by
// (membership/member-drafts.mjs draftKeyOf). Reusing that identity is deliberate: an image belongs to a draft,
// applyDraftPut already refuses a draft with no valid slug, and a PENDING rename does not move the draft's key
// (pendingSlug is a separate field), so images live and die with the draft they were staged for.
const ITEM_TOKEN_RE = /^(post|product|prompt|profile):[a-z0-9][a-z0-9-]{0,79}$/;

/** The validated item token, or null. Every caller treats null as a refusal rather than a default. */
export function itemTokenOf(item) {
  const t = String(item ?? '').trim().toLowerCase();
  return ITEM_TOKEN_RE.test(t) ? t : null;
}

/**
 * The KV key for one staged image: `draftimg:<github_id>:<type>:<slug>:<name>`.
 *
 * `item` and `name` MUST already be validated (itemTokenOf / imageNameOf). The key is built entirely from the
 * AUTHENTICATED github_id plus validated input, so one member still cannot express another member's key.
 *
 * The item segment exists because the key used to be `draftimg:<id>:<name>`, with no item in it at all: two
 * unpublished drafts that both staged a `cover.png` collided silently, the second overwriting the first, and
 * the first item then previewed the wrong picture and published the wrong bytes into its own folder.
 */
export const draftImageKey = (githubId, item, name) => `${draftImagePrefix(githubId)}${item}:${name}`;

/**
 * The pre-item key shape, read-only. Kept so an image staged before the per-item key shipped is still found
 * for the draft it belongs to, rather than silently going missing mid-edit. Nothing writes this shape any
 * more, so these keys drain as their drafts are published or erased; remove this once they are gone.
 */
export const legacyDraftImageKey = (githubId, name) => `${draftImagePrefix(githubId)}${name}`;

/**
 * The sanitized file name for a staged image, from either a bare name or a full repo path.
 *
 * sanitizeImageName already reduces `a/b/../evil.png` to `evil.png` (it splits on both separators and keeps
 * the last segment) and rejects any extension that is not png/jpg/jpeg/webp/gif, so a traversal attempt
 * cannot escape the member's own prefix and an svg cannot be smuggled in. Returns null when there is no
 * usable name, which every caller treats as a refusal rather than a default.
 */
export function imageNameOf(pathOrName) {
  return sanitizeImageName(pathOrName);
}

/** The content type to hand back with the bytes, derived from the (already validated) extension. */
export function contentTypeFor(name) {
  const ext = String(name || '').toLowerCase().split('.').pop();
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'application/octet-stream';
}

/**
 * Validate one incoming staged image. Throws DraftImageError with copy an author can act on.
 * @returns {{ name: string, bytes: number }} the sanitized name and decoded size.
 */
export function validateDraftImage({ name, dataBase64 } = {}) {
  const clean = imageNameOf(name);
  if (!clean) throw new DraftImageError('Use a PNG, JPG, WEBP, or GIF image (SVG is not supported on the web).');
  const b64 = String(dataBase64 ?? '');
  if (!b64) throw new DraftImageError('That image had no data. Try choosing it again.');
  const bytes = base64Bytes(b64);
  if (bytes > DRAFT_IMAGE_MAX_BYTES) throw new DraftImageError('That image is over 1 MB. Please optimize it (or pick a smaller one) first.');
  return { name: clean, bytes };
}

/**
 * Enforce the per-member ceilings before a put. `existing` is the member's current staged images as
 * `[{ id, bytes }]`, which the handler reads from a KV prefix list rather than by fetching every value. The
 * `id` is the whole key tail (`<type>:<slug>:<name>`), so the same file name under two different drafts counts
 * as the two separate images it is.
 *
 * Re-staging the SAME id is a replacement, so its old size comes out of the total before the new one goes in.
 * Without that, replacing one image ten times would count as ten images and the author would be told the store
 * is full while holding a single picture.
 */
export function checkDraftImageQuota(existing, { id, bytes } = {}) {
  const others = (existing || []).filter((e) => e && e.id !== id);
  if (others.length + 1 > DRAFT_IMAGES_MAX_COUNT) {
    throw new DraftImageError(`staged image limit reached (${DRAFT_IMAGES_MAX_COUNT}); publish or discard a draft first`);
  }
  const total = others.reduce((n, e) => n + (Number(e.bytes) || 0), 0) + (Number(bytes) || 0);
  if (total > DRAFT_IMAGES_MAX_TOTAL_BYTES) {
    throw new DraftImageError('the staged image store is full; publish or discard a draft first');
  }
  return { count: others.length + 1, totalBytes: total };
}
