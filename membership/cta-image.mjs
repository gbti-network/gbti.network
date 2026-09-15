// sow-337: the ONE check every writer and reader of a call-to-action image shares. A card image is committed to
// house/images/ctas/<id>.webp and served as committed (src/pages/media/ctas/[file].ts), so whatever bytes land in
// the repo are what every visitor downloads. The admin re-encodes a chosen image in the browser (decode, draw,
// WebP), which carries no camera or location data; this module is the BACKSTOP that refuses a file that still
// does, whoever sent it (the Worker route, the extension and npm writers, the content check on a hand-made PR).
//
// Pure and Node-free: it reads a Uint8Array, never a Buffer, so the Worker, the client and the build run it alike.
//
// The WebP container (RIFF): "RIFF" <size> "WEBP", then chunks of <fourCC><size LE><payload, padded to even>.
// A still image is one VP8 (lossy) or VP8L (lossless) chunk, optionally behind a VP8X header. Metadata lives in
// its own chunks (EXIF, XMP, ICCP) and the VP8X flags announce them; animation is ANIM/ANMF.

export const CTA_IMAGE_DIR = 'house/images/ctas';
export const CTA_IMAGE_MAX_BYTES = 400_000;
export const CTA_IMAGE_FILE_RE = /^[a-z0-9][a-z0-9-]*\.webp$/;
const METADATA_CHUNKS = { EXIF: 'EXIF (camera) data', 'XMP ': 'XMP metadata', ICCP: 'an ICC colour profile' };

/** The file name a card's image is committed under. */
export const ctaImageFile = (id) => `${String(id || '').trim()}.webp`;

/** The repo path of a card image file name, or null when the name is not a plain card image name. */
export function ctaImagePath(file) {
  const f = String(file || '');
  return CTA_IMAGE_FILE_RE.test(f) ? `${CTA_IMAGE_DIR}/${f}` : null;
}

const fourcc = (b, at) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
const u32 = (b, at) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
const u24 = (b, at) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);

/**
 * Inspect WebP bytes. Returns { ok: true, width, height } for a still WebP with no metadata, or
 * { ok: false, problem } naming the first reason it is refused. Never throws.
 */
export function webpInfo(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : null;
  if (!b) return { ok: false, problem: 'the image is not binary data' };
  if (b.length > CTA_IMAGE_MAX_BYTES) return { ok: false, problem: `the image is ${Math.ceil(b.length / 1024)} KB; the limit is ${Math.floor(CTA_IMAGE_MAX_BYTES / 1000)} KB` };
  if (b.length < 20 || fourcc(b, 0) !== 'RIFF' || fourcc(b, 8) !== 'WEBP') return { ok: false, problem: 'the image is not a WebP file' };
  if (u32(b, 4) + 8 > b.length) return { ok: false, problem: 'the WebP file is truncated' };
  let at = 12, width = 0, height = 0, image = false;
  while (at + 8 <= b.length) {
    const id = fourcc(b, at);
    const size = u32(b, at + 4);
    const body = at + 8;
    if (body + size > b.length) return { ok: false, problem: `the WebP ${id.trim()} chunk is truncated` };
    if (METADATA_CHUNKS[id]) return { ok: false, problem: `the image still carries ${METADATA_CHUNKS[id]}; re-encode it so it is removed` };
    if (id === 'ANIM' || id === 'ANMF') return { ok: false, problem: 'animated images are not supported on a card' };
    if (id === 'VP8X') {
      if (size < 10) return { ok: false, problem: 'the WebP header is malformed' };
      const flags = b[body];
      if (flags & 0x02) return { ok: false, problem: 'animated images are not supported on a card' };
      if (flags & 0x2c) return { ok: false, problem: 'the image still announces metadata (EXIF, XMP or a colour profile); re-encode it so it is removed' };
      width = u24(b, body + 4) + 1;
      height = u24(b, body + 7) + 1;
    } else if (id === 'VP8 ') {
      if (size < 10 || b[body + 3] !== 0x9d || b[body + 4] !== 0x01 || b[body + 5] !== 0x2a) return { ok: false, problem: 'the WebP image data is malformed' };
      if (!width) { width = (b[body + 6] | (b[body + 7] << 8)) & 0x3fff; height = (b[body + 8] | (b[body + 9] << 8)) & 0x3fff; }
      image = true;
    } else if (id === 'VP8L') {
      if (size < 5 || b[body] !== 0x2f) return { ok: false, problem: 'the WebP image data is malformed' };
      if (!width) {
        const bits = u32(b, body + 1);
        width = (bits & 0x3fff) + 1;
        height = ((bits >>> 14) & 0x3fff) + 1;
      }
      image = true;
    }
    at = body + size + (size % 2);
  }
  if (!image) return { ok: false, problem: 'the WebP file has no image data' };
  if (!width || !height) return { ok: false, problem: 'the WebP file has no dimensions' };
  return { ok: true, width, height };
}

/** Decode standard base64 to bytes, or null when it is not base64. Uses atob, which Node, browsers and Workers share. */
export function bytesFromBase64(b64) {
  const s = String(b64 || '').replace(/\s+/g, '');
  if (!s || s.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
  let bin;
  try { bin = atob(s); } catch { return null; }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Base64 is 4 characters per 3 bytes, so anything longer than this cannot decode to an image under the cap; refuse
// it before decoding rather than spend the work on a request that will be refused anyway.
const MAX_BASE64 = Math.ceil(CTA_IMAGE_MAX_BYTES / 3) * 4 + 4;

/**
 * The image half of a card add or update, shared by the Worker route and the extension and npm writer so both
 * refuse the same uploads. `imageBase64` is the re-encoded WebP the admin sends; `removeImage: true` clears it.
 * Returns { ok: false, problem } or { ok: true, fields, upload }: `fields` merges into the edit core's fields
 * ({ image: '<id>.webp' } for an upload, { image: null } for a removal, {} for neither) and `upload` is the
 * { path, contentBase64 } to commit beside the registry, or null. The file is always named after the card, so a
 * replacement overwrites the old image in place.
 */
export function ctaImageUpload({ id, imageBase64, removeImage } = {}) {
  const hasUpload = imageBase64 !== undefined && imageBase64 !== null;
  if (hasUpload && removeImage === true) return { ok: false, problem: 'send a new image or remove the image, not both' };
  if (removeImage !== undefined && typeof removeImage !== 'boolean') return { ok: false, problem: 'removeImage must be true or false' };
  if (removeImage === true) return { ok: true, fields: { image: null }, upload: null };
  if (!hasUpload) return { ok: true, fields: {}, upload: null };
  if (typeof imageBase64 !== 'string') return { ok: false, problem: 'the image must be sent as base64 text' };
  const b64 = imageBase64.replace(/\s+/g, '');
  if (b64.length > MAX_BASE64) return { ok: false, problem: `the image is over the ${Math.floor(CTA_IMAGE_MAX_BYTES / 1000)} KB limit` };
  const bytes = bytesFromBase64(b64);
  if (!bytes) return { ok: false, problem: 'the image is not valid base64' };
  const info = webpInfo(bytes);
  if (!info.ok) return { ok: false, problem: info.problem };
  const path = ctaImagePath(ctaImageFile(id));
  if (!path) return { ok: false, problem: 'the card needs a kebab-case id before it can have an image' };
  return { ok: true, fields: { image: ctaImageFile(id) }, upload: { path, contentBase64: b64 } };
}

/**
 * Every file a card edit commits besides the registry itself: the uploaded image, plus a DELETE for any image the
 * registry named before the edit and no card names after it (a removed image does not linger in the repository,
 * where the site would stop serving it but anyone could still fetch it). `before` and `after` are parsed registries.
 */
export function ctaImageFileChanges(before, after, upload = null) {
  const names = (doc) => new Set((Array.isArray(doc?.ctas) ? doc.ctas : []).map((c) => c?.image).filter((f) => typeof f === 'string'));
  const kept = names(after);
  const files = upload ? [{ path: upload.path, contentBase64: upload.contentBase64 }] : [];
  for (const f of names(before)) {
    const path = ctaImagePath(f);
    if (path && !kept.has(f) && path !== upload?.path) files.push({ path, content: null });
  }
  return files;
}
