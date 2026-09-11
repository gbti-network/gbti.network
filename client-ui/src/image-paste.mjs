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
