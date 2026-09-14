// sow-277: the ONE decoder for HTML entities in scraped link metadata. A page's og:title often carries a numeric
// entity where the publisher wrote an en dash or an apostrophe (`&#8211;`, `&#8217;`). The link-preview scraper
// used to decode only a few named entities, so those reached the share composer raw, were stored raw, and showed
// as literal codes wherever a reader escapes without decoding (the extension reader's heading). The public site
// hid it by decoding at render with its own copy of this function.
//
// Used at INTAKE by the scraper (workers/lib/og-scrape.mjs), so what gets stored is clean text, and re-exported by
// src/lib/home-feed.mjs for the site's render-time decode of older stored values. Decode ONCE: a second pass would
// turn a title that literally reads "&lt;" into "<". Escaping at render is untouched and still happens exactly once.
//
// Dependency-free: the signup Worker, the site build and the extension bundle all import it.

const NAMED = {
  quot: '"', apos: "'", nbsp: ' ', lt: '<', gt: '>',
  ndash: '\u2013', mdash: '\u2014', hellip: '\u2026',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
};

/** A code point that decodes to a real character; anything else is left exactly as written. */
function fromCode(n, raw) {
  if (!Number.isInteger(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return raw;
  return String.fromCodePoint(n);
}

/**
 * Decode numeric (decimal and hex) entities and the common named set. `&amp;` is decoded LAST and in the same
 * single pass as everything else, so `&amp;#8211;` becomes the text `&#8211;` rather than a dash: the source said
 * "ampersand, then #8211;", and only one level of encoding is removed. Never throws.
 */
export function decodeHtmlEntities(value) {
  return String(value ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (raw, body) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      return fromCode(parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10), raw);
    }
    const key = body.toLowerCase();
    if (key === 'amp') return '&';
    return Object.prototype.hasOwnProperty.call(NAMED, key) ? NAMED[key] : raw;
  });
}
