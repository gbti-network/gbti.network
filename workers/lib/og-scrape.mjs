// Shared OpenGraph scraper (SOW-050 news + SOW-057 share OG preview). Regex-only, NO DOM, so it is sub-millisecond
// CPU and fits the Worker Free budget. Pure: every function takes HTML + a base URL and never throws. The news
// worker (workers/news/src/og-image.mjs) re-exports scrapeOgImage from here; the signup Worker's OG-preview
// endpoint (workers/signup/membership-og.mjs) uses scrapeOgPreview.

const HEAD_SCAN = 200000; // these tags live in <head>; bound the scan for CPU

/** Read one attribute's value from a single tag string (quotes required). '' when absent. */
export function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return m ? m[1].trim() : '';
}

/** Resolve a candidate image URL to an absolute https URL against the page URL; '' when unusable (svg/data/relative
 *  with no base). */
export function absolutize(u, baseUrl) {
  let url = String(u || '').trim();
  if (!url) return '';
  if (/^\/\//.test(url)) url = `https:${url}`; // protocol-relative
  if (!/^https?:\/\//i.test(url)) {
    if (!baseUrl) return '';
    try { url = new URL(url, baseUrl).toString(); } catch { return ''; }
  }
  if (/^data:/i.test(url) || /\.svg(\?|#|$)/i.test(url)) return ''; // not a real raster lead image
  return url;
}

/** Decode the handful of HTML entities that commonly appear in og:title/description content. */
function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x27;/gi, "'")
    .trim();
}

/** Collect the og:/twitter: meta values (and the og:title / <title>, og:description / meta description) from HTML. */
function metaMap(html) {
  const head = String(html || '').slice(0, HEAD_SCAN);
  const keys = [
    'og:image', 'og:image:secure_url', 'twitter:image', 'twitter:image:src',
    'og:title', 'twitter:title', 'og:description', 'twitter:description', 'description',
    'keywords', 'news_keywords', // SOW-087: declared keyword hints feed the share category suggestion
  ];
  const out = {};
  for (const k of keys) out[k] = '';
  out._articleTags = []; // SOW-087: article:tag repeats once per tag; collect them all
  const META_RE = /<meta\b[^>]*>/gi;
  let m;
  while ((m = META_RE.exec(head))) {
    const tag = m[0];
    const key = (attr(tag, 'property') || attr(tag, 'name')).toLowerCase();
    if (key === 'article:tag') {
      const c = attr(tag, 'content');
      if (c) out._articleTags.push(c);
      continue;
    }
    if (key in out && !out[key]) {
      const c = attr(tag, 'content');
      if (c) out[key] = c;
    }
  }
  let linkImg = '';
  const lm = head.match(/<link\b[^>]*\srel\s*=\s*["']image_src["'][^>]*>/i);
  if (lm) linkImg = attr(lm[0], 'href');
  out._linkImg = linkImg;
  // <title> fallback for the title.
  const tm = head.match(/<title[^>]*>([^<]*)<\/title>/i);
  out._docTitle = tm ? tm[1].trim() : '';
  return out;
}

/** Pull the best lead-image URL from a page's HTML (og:image preferred). Returns '' when none. Pure. */
export function scrapeOgImage(html, baseUrl = '') {
  const m = metaMap(html);
  const raw = m['og:image'] || m['og:image:secure_url'] || m['twitter:image'] || m['twitter:image:src'] || m._linkImg;
  return absolutize(raw, baseUrl);
}

// SOW-087: bound the declared-tag hints (a page can claim anything; these only feed a SUGGESTION the member confirms).
const MAX_TAGS = 12;
const MAX_TAG_LEN = 48;

/** Collect the page's declared keyword/tag hints: every article:tag plus the comma-split keywords/news_keywords.
 *  Deduped case-insensitively, length- and count-capped. Pure. */
function collectTags(m) {
  const out = [];
  const seen = new Set();
  const push = (raw) => {
    const t = decodeEntities(raw).replace(/\s+/g, ' ').trim();
    if (!t || t.length > MAX_TAG_LEN || out.length >= MAX_TAGS) return;
    const k = t.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };
  for (const t of m._articleTags) push(t);
  for (const src of [m['keywords'], m['news_keywords']]) for (const part of String(src || '').split(',')) push(part);
  return out;
}

/**
 * Pull a full link preview from a page's HTML: { image, title, description, tags }. image is an absolute URL or ''.
 * title falls back og:title -> twitter:title -> <title>; description falls back og:description -> twitter:description
 * -> meta description; tags (SOW-087) are the page's declared article:tag/keywords hints. Pure; never throws.
 */
export function scrapeOgPreview(html, baseUrl = '') {
  const m = metaMap(html);
  const image = absolutize(m['og:image'] || m['og:image:secure_url'] || m['twitter:image'] || m['twitter:image:src'] || m._linkImg, baseUrl);
  const title = decodeEntities(m['og:title'] || m['twitter:title'] || m._docTitle);
  const description = decodeEntities(m['og:description'] || m['twitter:description'] || m['description']);
  return { image, title, description, tags: collectTags(m) };
}
