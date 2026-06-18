// SOW-043 groundwork (deploy-independent): pure helpers for the members-only news module. The news worker
// (gbti-news-api, to be embedded as workers/news/ + proxied by the signup Worker's /membership/news) serves items
// shaped { guid, source, title, link, summary, category, publishedAt, fetchedAt } (per its INTEGRATION.md). These
// helpers project a news item onto the shared <gbti-card-list> item shape, build the UTM-tagged outbound link, and
// blend news into a content+shares feed as SUPPLEMENTARY (secondary to member content + Shares, which stay
// primary). No DOM, no client, no deploy dependency -> node-testable. The element/proxy/Discord/onboarding phases
// remain owner/deploy-gated; this is the reusable, decision-free core P4/P5 will consume.
import { toMs } from './all-merge.mjs';

// SOW-043 P5: every outbound news link carries these so referred traffic is attributable to the extension.
export const UTM = Object.freeze({ utm_source: 'gbti-network', utm_medium: 'extension', utm_campaign: 'news' });

// The news worker serves publishedAt/fetchedAt as EPOCH SECONDS (per gbti-news-api INTEGRATION.md), so convert to
// ms for the card-list's time helpers (which treat a bare number as ms). A missing/zero value -> null.
const secToMs = (s) => (typeof s === 'number' && s > 0 ? s * 1000 : null);

/** Append the GBTI UTM params to an outbound news link (preserving any existing query). A non-URL falls through. */
export function utmLink(link, params = UTM) {
  if (typeof link !== 'string' || !link) return '';
  try {
    const u = new URL(link);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  } catch { return link; }
}

/** Project a news item onto the shared card-list item shape. News is always members + flagged `supplementary`
 *  (and type/kind 'news') so the blended feed renders it as a lighter, secondary card. openHref is the UTM-tagged
 *  source link (a news item has no in-network page; the readability preview is a separate, lib-gated phase). */
export function newsToItem(n = {}) {
  return {
    type: 'news',
    kind: 'news',
    supplementary: true,
    guid: n.guid ?? null,
    title: n.title || n.source || 'News',
    author: n.source || 'News',
    source: n.source || null,
    visibility: 'members',
    thumb: null,
    category: n.category ?? null,
    excerpt: n.summary || '',
    createdAt: secToMs(n.publishedAt) ?? secToMs(n.fetchedAt), // epoch seconds -> ms (the feed serves seconds)
    openHref: n.link ? utmLink(n.link) : null,
    link: n.link ?? null,
  };
}

/** Blend news into a primary content+shares list, newest-first. Member content + Shares stay PRIMARY (the caller
 *  styles them as highlighted); news items are projected, optionally filtered to a category set, capped, flagged
 *  supplementary, and interleaved by time. Pure; does not mutate the inputs. */
export function blendNews(primary = [], news = [], { cap = 20, categories = null } = {}) {
  let supp = (Array.isArray(news) ? news : []).map(newsToItem);
  if (categories && categories.size) supp = supp.filter((it) => it.category && categories.has(String(it.category).toLowerCase()));
  supp = supp.slice(0, Math.max(0, cap));
  const all = [...(Array.isArray(primary) ? primary : []), ...supp];
  return all.sort((a, b) => toMs(b.createdAt ?? b.publishedAt) - toMs(a.createdAt ?? a.publishedAt));
}
