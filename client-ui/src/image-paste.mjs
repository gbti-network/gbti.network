// A pasted image in the WorkBench Preview (2026-09-11). Left to the browser, an image on the clipboard lands in
// the paragraph as <img src="data:..."> and vanishes on "Done editing", because the commit's read-back has no
// storable ref for it and nothing had staged the bytes. The Preview intercepts the paste and stages the file the
// way the editor's image card does; this module decides WHAT was pasted and what to call it, without a DOM, so
// those decisions are tested rather than trusted.
import { uniqueImageName } from './gallery.mjs';

/**
 * What an image paste should do, from the clipboard's contents.
 *   { kind: 'file', file }        an image FILE is on the clipboard (a screenshot, a copied bitmap, a copied web
 *                                 image: browsers put the bitmap beside the HTML, and the staged copy is the one
 *                                 that survives the source going away), so it is staged beside the draft.
 *   { kind: 'remote', url, alt }  no file, only HTML that is a single <img> with an http(s) address (a copied web
 *                                 image whose bitmap the browser withheld): inserted as a block pointing there.
 *   null                          not an image paste; the browser's default paste proceeds.
 * The remote form is refused when the HTML carries text beside the image, because that is a paste of prose that
 * happens to hold a picture, and the paragraph is what the author expects to arrive.
 */
export function imagePastePlan(data) {
  const files = Array.from(data?.files || []).filter((f) => /^image\//i.test(String(f?.type || '')));
  if (files.length) return { kind: 'file', file: files[0] };
  let html = '';
  try { html = String(data?.getData?.('text/html') || ''); } catch { html = ''; }
  if (!html) return null;
  const at = (name) => {
    const m = new RegExp(`<img\\b[^>]*\\s${name}=(?:"([^"]*)"|'([^']*)')`, 'i').exec(html);
    return m ? (m[1] ?? m[2] ?? '') : '';
  };
  const src = at('src');
  if (!/^https?:\/\//i.test(src)) return null;
  const text = html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
  if (text) return null;
  return { kind: 'remote', url: src, alt: at('alt').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/[\[\]\n]/g, '').trim() };
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * The file name a pasted image is staged under. A clipboard image arrives as a generic "image.png" (Chrome) or
 * with no name at all, and two pastes must not fight over one file, so a generic name becomes
 * `pasted-YYYYMMDD-HHMMSS.<ext>`; a real name is kept. Either way the name is made unique against the images the
 * draft already references (the editor's own rule, uniqueImageName). The extension follows the name, else the
 * MIME type, else png; jpeg is written jpg to match the staged-name rules.
 */
export function pastedImageName(file, taken, now = new Date()) {
  const name = String(file?.name || '').trim();
  const fromName = /\.([a-z0-9]+)$/i.exec(name)?.[1];
  const fromType = String(file?.type || '').split('/')[1];
  const ext = String(fromName || fromType || 'png').toLowerCase().replace(/^jpeg$/, 'jpg');
  const generic = !name || /^(image|img|pasted|screenshot|clipboard|unnamed|untitled)(\.[a-z0-9]+)?$/i.test(name);
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return uniqueImageName(generic ? `pasted-${stamp}.${ext}` : name, taken);
}

/** The file's bytes as a data: URL (what stageImage and the Preview's staged-image cache both want). Browser-only. */
export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('The image could not be read.'));
    r.readAsDataURL(file);
  });
}

/** The Worker's cap for one image (workbench-client.ts MAX_IMAGE_BYTES, check-media). */
export const IMAGE_MAX_BYTES = 1_048_576;

/**
 * The sizes and qualities tried, in order, when an image is over the cap: the long edge in CSS pixels and the
 * WEBP quality. A screenshot re-encodes under the cap at the first step nearly always; a photo walks down.
 */
export const FIT_LADDER = Object.freeze([[1600, 0.9], [1600, 0.8], [1600, 0.7], [1200, 0.75], [1000, 0.7], [800, 0.65]]);

/**
 * An image that fits the cap, or the reason it cannot. Owner report, 2026-09-11: a 174 KB webp copied out of a
 * Chrome tab pasted as "over 1 MB", because a browser puts a copied image on the clipboard as a decoded PNG
 * bitmap, many times the size of the file it came from. So an image over the cap is re-encoded here as WEBP,
 * walking FIT_LADDER until it fits; an image already under the cap is passed through untouched (a dropped
 * webp keeps its bytes, its name and its format). Browser-only past the first line (canvas); `encode` is
 * injectable for tests. Returns { blob, name, reencoded } or throws the cap error when nothing on the ladder fits.
 */
export async function fitImageFile(file, { maxBytes = IMAGE_MAX_BYTES, ladder = FIT_LADDER, encode = null } = {}) {
  const name = String(file?.name || 'image.png');
  if (!(Number(file?.size) > maxBytes)) return { blob: file, name, reencoded: false };
  const base = name.replace(/\.[a-z0-9]+$/i, '') || 'image';
  const enc = encode || encodeWebp;
  for (const [edge, quality] of ladder) {
    const blob = await enc(file, edge, quality);
    if (blob && blob.size <= maxBytes) return { blob, name: `${base}.webp`, reencoded: true };
  }
  throw new Error('That image is over 1 MB even after shrinking it. Please optimize it (or pick a smaller one) first.');
}

/** Draw the image at most `edge` pixels on its long side and encode WEBP at `quality`. Browser-only. */
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
