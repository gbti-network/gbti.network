// SOW-050 Tier 1: scrape a source article's lead image from its HTML <head> (og:image, then twitter:image, then
// <link rel="image_src">). Regex-only — NO DOM — so it is sub-millisecond CPU and fits the 10 ms Free cron budget
// (a linkedom parse would not). Used to BACKFILL already-stored items that carry no feed image (the article body is
// not persisted, so the only way to get an image for the backlog is to fetch the page). Pure scrape + a thin fetch
// wrapper; both never throw.

/** Read one attribute's value from a single tag string (quotes required). '' when absent. */
function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return m ? m[1].trim() : '';
}

/** Resolve a candidate image URL to an absolute https URL against the page URL; '' when unusable (svg/data/relative
 *  with no base). */
function absolutize(u, baseUrl) {
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

/** Pull the best lead-image URL from a page's HTML. Scans <meta> tags for og:image (preferred) / twitter:image and
 *  the <link rel="image_src"> fallback, resolving relative URLs against `baseUrl`. Returns '' when none. Pure. */
export function scrapeOgImage(html, baseUrl = '') {
  const head = String(html || '').slice(0, 200000); // these tags live in <head>; bound the scan for CPU
  const cands = { 'og:image': '', 'og:image:secure_url': '', 'twitter:image': '', 'twitter:image:src': '' };
  const META_RE = /<meta\b[^>]*>/gi;
  let m;
  while ((m = META_RE.exec(head))) {
    const tag = m[0];
    const key = (attr(tag, 'property') || attr(tag, 'name')).toLowerCase();
    if (key in cands && !cands[key]) {
      const c = attr(tag, 'content');
      if (c) cands[key] = c;
    }
  }
  let linkImg = '';
  const lm = head.match(/<link\b[^>]*\srel\s*=\s*["']image_src["'][^>]*>/i);
  if (lm) linkImg = attr(lm[0], 'href');
  const raw = cands['og:image'] || cands['og:image:secure_url'] || cands['twitter:image'] || cands['twitter:image:src'] || linkImg;
  return absolutize(raw, baseUrl);
}

/** Fetch an article page (bounded, timed out) and scrape its og:image. Returns the URL or null. Never throws.
 *  `fetchImpl` is injectable for tests. `maxBytes` caps the body we scan (og tags are near the top). */
export async function fetchOgImage(link, { fetchImpl = fetch, timeoutMs = 8000, maxBytes = 60000 } = {}) {
  const url = String(link || '');
  if (!/^https?:\/\//i.test(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'gbti-news-bot/0.1 (+https://gbti.network)', Accept: 'text/html,application/xhtml+xml' },
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
    if (!res || !res.ok) return null;
    const ct = res.headers?.get?.('content-type') || '';
    if (ct && !/html|xml/i.test(ct)) return null; // not an HTML page (e.g. a PDF/feed) -> nothing to scrape
    let html = await res.text();
    if (typeof html === 'string' && html.length > maxBytes) html = html.slice(0, maxBytes);
    return scrapeOgImage(html, url) || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
