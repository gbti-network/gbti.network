// SOW-017 / SOW-023: the public activity index. A flat, newest-first list of published works (posts,
// products, prompts) emitted at build time as /activity-index.json, which the extension new-tab page reads to
// render the "Latest Activity" feed. Published-works metadata only (no behavioral data). Plain .mjs so node
// --test can import the pure builder directly (the Astro endpoint maps the collections into it).

/**
 * @typedef {{ type: 'post'|'product'|'prompt', slug: string, title: string, author: string, url: string, publishedAt: number|null, visibility: 'public'|'members' }} ActivityEntry
 */

/**
 * Sort newest-first (undated entries sink to the bottom) and cap at `limit`. Does not mutate the input.
 * @param {ActivityEntry[]} entries
 * @param {number} [limit]
 * @returns {ActivityEntry[]}
 */
export function buildActivityIndex(entries, limit = 40) {
  return [...entries]
    .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
    .slice(0, Math.max(0, limit));
}
