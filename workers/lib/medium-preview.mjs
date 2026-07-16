// SOW-102 follow-on: a Medium fallback for the share link preview. Medium fronts every page fetch (any
// user agent, any IP class) with a Cloudflare bot challenge and discontinued its oEmbed endpoint, so both
// the generic OG scrape and the provider-oEmbed path come back empty for medium.com links. The one surface
// Medium still serves to a plain server fetch is the RSS feed (author or publication), which carries each
// recent item's title + body HTML (the lead image included). This module is pure + node-free (URL mapping
// and regex extraction only; the caller fetches), mirroring oembed-providers.mjs.
//
// HONEST LIMIT: a Medium feed carries only the author's most recent posts (about ten), so an older article
// still gets no preview. Best-effort by design.
//
// SSRF posture: the returned feed URL is always host medium.com (or the article's own *.medium.com
// subdomain), derived from an already safeFetchTarget-validated URL; no new fetch surface.

/** The RSS feed URL for a Medium article link, or null when the URL is not a Medium article.
 *  medium.com/@user/<slug>  -> medium.com/feed/@user
 *  medium.com/<pub>/<slug>  -> medium.com/feed/<pub>       (publications)
 *  <sub>.medium.com/<slug>  -> <sub>.medium.com/feed       (custom author subdomains) */
export function mediumFeedUrlFor(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl || '')); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  const segs = u.pathname.split('/').filter(Boolean);
  if (host === 'medium.com' || host === 'www.medium.com') {
    if (segs.length < 2) return null; // an article link is /<owner>/<slug>
    const owner = segs[0];
    if (owner === 'feed' || owner === 'm' || owner === 'p') return null; // not an owner segment we can feed
    return `https://medium.com/feed/${owner}`;
  }
  if (host.endsWith('.medium.com') && host !== 'help.medium.com' && segs.length >= 1) {
    return `https://${host}/feed`;
  }
  return null;
}

/** The trailing hex id Medium appends to every article slug (the stable per-post key). '' when absent. */
export function mediumArticleId(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl || '')); } catch { return ''; }
  const m = /-([0-9a-f]{8,16})$/.exec(u.pathname.split('/').filter(Boolean).pop() || '');
  return m ? m[1] : '';
}

const unescapeXml = (s) => String(s ?? '')
  .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"')
  .replaceAll('&#39;', "'").replaceAll('&amp;', '&');

const stripCdata = (s) => {
  const m = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(String(s ?? ''));
  return m ? m[1] : String(s ?? '').trim();
};

/**
 * Extract the article's preview from a Medium RSS feed. Matches the item whose <link>/<guid> carries the
 * article's trailing id, then pulls the title, the first <img src> of the body HTML, and a plain-text
 * first paragraph as the description. Returns { title, image, description, tags } or null (no match /
 * unusable item). Regex-based like og-scrape.mjs; a malformed feed just returns null.
 */
export function previewFromMediumFeed(xml, articleUrl) {
  const id = mediumArticleId(articleUrl);
  if (!id || !xml) return null;
  const items = String(xml).split(/<item[\s>]/).slice(1);
  const itemXml = items.find((it) => it.includes(id));
  if (!itemXml) return null;

  const pick = (tag) => {
    const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(itemXml);
    return m ? stripCdata(m[1]).trim() : '';
  };
  const title = pick('title');
  const body = unescapeXml(stripCdata(pick('content:encoded') || pick('description')));
  const img = /<img[^>]+src=["']([^"']+)["']/i.exec(body);
  const para = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(body);
  const text = para ? para[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
  const tags = [...itemXml.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/gi)]
    .map((m) => stripCdata(m[1]).trim().toLowerCase()).filter(Boolean).slice(0, 8);

  if (!title && !img) return null;
  return {
    title: title || null,
    image: img ? img[1] : null,
    description: text ? text.slice(0, 300) : null,
    tags,
  };
}
