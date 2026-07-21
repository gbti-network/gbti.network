// SOW-136: pure helpers behind the feed homepage (New & Popular ranking, the unified feed order,
// trending tags, relative time). Node-testable, no Astro imports; src/pages/index.astro maps the
// content collections to plain items and delegates the ordering decisions here.

/** The sort timestamp for a feed item: content uses publishedAt, shares use createdAt. 0 when undated. */
export function feedTime(data) {
  const d = data?.publishedAt ?? data?.createdAt ?? data?.updatedAt;
  return d ? new Date(d).valueOf() : 0;
}

/** Newest first; undated items sink. Stable for equal timestamps. Returns a new array. */
export function sortByNewest(items) {
  return [...items].sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
}

/**
 * SOW-018 scoped reversal (elected by sow-131, first applied here): ONLY a published, visibility:public
 * share may reach a public artifact. Fail closed: any missing/other value excludes the share. Members-only
 * shares (including Mode B stub metadata) stay extension-only.
 */
export function isPublicShare(data) {
  return data?.status === 'published' && data?.visibility === 'public';
}

/**
 * New & Popular: favorites weigh 3, comments 2, newest breaks ties. Pre-launch (all counts zero) this
 * degrades to pure recency. Items carry {favorites, comments, date, kind}. To keep the grid from
 * collapsing into one content type (six prompts in a row), each kind is capped at `maxPerKind`; when
 * the cap leaves slots unfilled (too few kinds), the remainder backfills by plain score order.
 */
export function rankNewAndPopular(items, n = 6, maxPerKind = 2) {
  const score = (it) => (it.favorites ?? 0) * 3 + (it.comments ?? 0) * 2;
  const ranked = [...items].sort((a, b) => score(b) - score(a) || (b.date ?? 0) - (a.date ?? 0));
  const picked = [];
  const perKind = new Map();
  for (const it of ranked) {
    if (picked.length >= n) break;
    const k = it.kind ?? '';
    if ((perKind.get(k) ?? 0) >= maxPerKind) continue;
    perKind.set(k, (perKind.get(k) ?? 0) + 1);
    picked.push(it);
  }
  for (const it of ranked) {
    if (picked.length >= n) break;
    if (!picked.includes(it)) picked.push(it);
  }
  return picked;
}

/**
 * Decode the HTML entities that ride in on scraped share metadata (OG titles like "A &#8211; B" or
 * "Q&amp;A"). Numeric forms first, then the common named set; ampersand last so "&amp;" itself does
 * not spawn new matches for the earlier rules.
 */
export function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Trending tags: free-form `tags` counted across the listed items, top N by count (ties alphabetical).
 * Tags are lowercased for counting so "AI" and "ai" merge.
 */
export function aggregateTags(items, n = 9) {
  const counts = new Map();
  for (const it of items) {
    for (const raw of it.tags ?? []) {
      const tag = String(raw).trim().toLowerCase();
      if (!tag) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, n);
}

/** Estimated reading time in whole minutes (220 wpm), minimum 1. 0 for an empty/absent body. */
export function readMinutes(text) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean).length;
  return words === 0 ? 0 : Math.max(1, Math.round(words / 220));
}

/** Short relative time for feed metadata: "just now", "5m ago", "3h ago", "2d ago", "4mo ago", "1y ago". */
export function relativeTime(date, now = Date.now()) {
  const t = date ? new Date(date).valueOf() : NaN;
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  if (d < 365) return `${Math.max(1, Math.round(d / 30))}mo ago`;
  return `${Math.max(1, Math.round(d / 365))}y ago`;
}
