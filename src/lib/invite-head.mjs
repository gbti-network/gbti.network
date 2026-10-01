// sow-437: put a live invitation's personal title into the claim page head, for the browser tab and link previews.
// Pure (string in, string out) so node --test exercises it; functions/claim/index.js is the thin edge caller.
//
// Only the two tags a tab and an unfurl read are touched: <title> and og:title (twitter cards fall back to
// og:title, and the page carries no twitter:title). The description and the image stay generic. The title is
// person-entered text, so it is escaped for both an element body and a double-quoted attribute.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);

const TITLE_RE = /<title>[^<]*<\/title>/;
const OG_TITLE_RE = /(<meta property="og:title" content=")[^"]*(")/;

/**
 * Returns { html, changed }. `changed` is true only when BOTH tags were found and replaced, and on anything else
 * the original html comes back untouched, so a layout change can never produce a page that is half personalized.
 */
export function personalizeHead(html, title) {
  if (typeof html !== 'string' || typeof title !== 'string' || !title.trim()) return { html, changed: false };
  if (!TITLE_RE.test(html) || !OG_TITLE_RE.test(html)) return { html, changed: false };
  const t = escapeHtml(title.trim());
  const out = html.replace(TITLE_RE, `<title>${t}</title>`).replace(OG_TITLE_RE, `$1${t}$2`);
  return { html: out, changed: true };
}

/** The invitation code from a claim page URL, upper-cased, or '' when it is not code-shaped (3 to 32 of A-Z 0-9). */
export function claimCodeFrom(url) {
  let code = '';
  try { code = String(new URL(url).searchParams.get('code') ?? '').trim().toUpperCase(); } catch { return ''; }
  return /^[A-Z0-9]{3,32}$/.test(code) ? code : '';
}
