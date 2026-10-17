// sow-462: IndexNow, the pure part. IndexNow lets a site tell Bing, and the other engines that share the protocol
// (Yandex, Seznam, Naver), which addresses changed instead of waiting for them to crawl. A production deploy saves the
// LIVE sitemap before it replaces it, then sends the addresses that are new, re-dated or gone in the new build. The
// dates are the sitemap's <lastmod> (membership/content-lastmod.mjs), so an edit to an article announces that article
// and nothing else.
//
// The key is public by design. An engine checks ownership by fetching https://gbti.network/<key>.txt, so the key is
// committed in public/ and repeated here. It authorises nothing beyond these notices.

export const INDEXNOW_KEY = '6c83868318a21665ff084e1d6352fce0';
export const INDEXNOW_HOST = 'gbti.network';
export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
/** The protocol's ceiling for one request. */
export const INDEXNOW_MAX_URLS = 10000;

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** A sitemap's entries as a Map of address to <lastmod> ('' when the entry has none). */
export function parseSitemapUrls(xml) {
  const out = new Map();
  for (const m of String(xml ?? '').matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = /<loc>([\s\S]*?)<\/loc>/.exec(m[1]);
    if (!loc) continue;
    const lastmod = /<lastmod>([\s\S]*?)<\/lastmod>/.exec(m[1]);
    out.set(decode(loc[1].trim()), lastmod ? lastmod[1].trim() : '');
  }
  return out;
}

/** The shard addresses a sitemap index lists. */
export function parseSitemapIndex(xml) {
  return [...String(xml ?? '').matchAll(/<sitemap>[\s\S]*?<loc>([\s\S]*?)<\/loc>[\s\S]*?<\/sitemap>/g)].map((m) => decode(m[1].trim()));
}

/**
 * What to announce: addresses new in the build, addresses whose date moved, and addresses the build dropped (an engine
 * learns about a removal by fetching it and meeting the 404). Only this site's own addresses: the protocol refuses a
 * request that names another host.
 */
export function changedUrls(before, after, host = INDEXNOW_HOST) {
  const own = (u) => { try { return new URL(u).host === host; } catch { return false; } };
  const out = [];
  for (const [u, lastmod] of after) if (own(u) && (!before.has(u) || before.get(u) !== lastmod)) out.push(u);
  for (const u of before.keys()) if (own(u) && !after.has(u)) out.push(u);
  return out;
}

/** The request body IndexNow takes, capped at one request's worth of addresses. */
export function indexNowPayload(urls) {
  return {
    host: INDEXNOW_HOST,
    key: INDEXNOW_KEY,
    keyLocation: `https://${INDEXNOW_HOST}/${INDEXNOW_KEY}.txt`,
    urlList: urls.slice(0, INDEXNOW_MAX_URLS),
  };
}
