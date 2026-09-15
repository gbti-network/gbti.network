// sow-337: the call-to-action image, re-encoded in the browser before it leaves. Drawing the picture onto a canvas
// and encoding the canvas as WebP writes only pixels: camera make, GPS position and dates in the original file do not
// survive, because the canvas never had them. The browser adds one thing back, an sRGB colour profile (Chrome writes
// one into every canvas WebP), which stripWebpMetadata removes. The bytes are then checked with the same backstop the
// server runs (membership/cta-image.mjs), so a browser that quietly returns something else (Safari encodes a PNG when
// asked for WebP) is caught here with a clear message instead of a refused save.
//
// Pure apart from the default `encode`, which needs a DOM, and is injectable for tests.
import { webpInfo, stripWebpMetadata, CTA_IMAGE_MAX_BYTES } from '../../membership/cta-image.mjs';

export const CTA_IMAGE_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
/** Long edge in pixels, then WebP quality, tried in order until the file fits. A card shows at most 340px tall. */
export const CTA_IMAGE_LADDER = Object.freeze([[1200, 0.82], [1200, 0.72], [1000, 0.7], [800, 0.68], [640, 0.65]]);

/**
 * Re-encode a chosen image. Returns { ok: true, base64, dataUrl, width, height, bytes } or { ok: false, problem }.
 * Always re-encodes, even a WebP, because the point is to drop whatever the file carried.
 */
export async function encodeCtaImage(file, { encode = encodeWebp, ladder = CTA_IMAGE_LADDER } = {}) {
  const unreadable = { ok: false, problem: 'That image could not be read. Try another file.' };
  if (!file || !CTA_IMAGE_TYPES.includes(String(file.type || '').toLowerCase())) return { ok: false, problem: 'Choose a JPEG, PNG, WebP, GIF or AVIF image.' };
  let tooBig = false;
  for (const [edge, quality] of ladder) {
    let blob;
    try { blob = await encode(file, edge, quality); } catch { return unreadable; }
    if (!blob) return unreadable;
    if (String(blob.type || '') !== 'image/webp') return { ok: false, problem: 'This browser cannot save images as WebP. Use Chrome, Edge or Firefox to add an image.' };
    const bytes = stripWebpMetadata(new Uint8Array(await blob.arrayBuffer()));
    if (!bytes) return unreadable;
    if (bytes.length > CTA_IMAGE_MAX_BYTES) { tooBig = true; continue; }
    const info = webpInfo(bytes);
    if (!info.ok) return { ok: false, problem: `The re-encoded image was refused: ${info.problem}.` };
    const base64 = toBase64(bytes);
    return { ok: true, base64, dataUrl: `data:image/webp;base64,${base64}`, width: info.width, height: info.height, bytes: bytes.length };
  }
  return tooBig ? { ok: false, problem: `That image is over ${Math.floor(CTA_IMAGE_MAX_BYTES / 1000)} KB even after shrinking it. Try a smaller image.` } : unreadable;
}

/** Draw the image at most `edge` pixels on its long side and encode WebP. Browser-only. */
async function encodeWebp(file, edge, quality) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, edge / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  try { bmp.close?.(); } catch { /* not every host */ }
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/webp', quality));
}

/** Bytes as standard base64 (btoa, which browsers and Node share), in blocks so a large image does not overflow the stack. */
function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
