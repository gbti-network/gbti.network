// SOW-050 Tier 1: scrape a source article's lead image from its HTML <head> (og:image, then twitter:image, then
// <link rel="image_src">). The regex-only scraper now lives in the SHARED module workers/lib/og-scrape.mjs (also
// used by the SOW-057 share OG-preview endpoint); this file re-exports it and keeps the news-bot fetch wrapper.

export { scrapeOgImage } from '../../../lib/og-scrape.mjs';
import { scrapeOgImage } from '../../../lib/og-scrape.mjs';

/** Read a response body only as far as the end of its <head> (where every tag the scraper wants lives), and never
 *  past `maxBytes`. The scan used to stop at a flat 60 KB, and a page whose head runs longer lost its og:image:
 *  JetBrains' blog carries it about 66 KB in (owner report, 2026-09-30). Stopping at </head> keeps the work to the
 *  head itself, so a longer cap costs nothing on a page with a short one. Pure over the response. */
export async function readHead(res, maxBytes = 250000) {
  const reader = res?.body?.getReader?.();
  if (!reader) {
    const html = await res.text();
    const end = html.search(/<\/head\s*>/i);
    return (end >= 0 ? html.slice(0, end) : html).slice(0, maxBytes);
  }
  const decoder = new TextDecoder();
  let html = '';
  try {
    while (html.length < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      const end = html.search(/<\/head\s*>/i);
      if (end >= 0) { html = html.slice(0, end); break; }
    }
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
  }
  return html.slice(0, maxBytes);
}

/** Fetch an article page (bounded, timed out) and scrape its og:image. Returns the URL or null. Never throws.
 *  `fetchImpl` is injectable for tests. `maxBytes` caps how much of the page is read (see readHead). */
export async function fetchOgImage(link, { fetchImpl = fetch, timeoutMs = 8000, maxBytes = 250000 } = {}) {
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
    const html = await readHead(res, maxBytes);
    return scrapeOgImage(html, url) || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
