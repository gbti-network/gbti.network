// SOW-017 / SOW-023: the public activity index. A flat, newest-first list of published works (posts,
// products, prompts) emitted at build time as /activity-index.json, which the extension new-tab page reads to
// render the "Latest Activity" feed. Published-works metadata only (no behavioral data). Plain .mjs so node
// --test can import the pure builder directly (the Astro endpoint maps the collections into it).
//
// SOW-111 QA follow-up (owner-decided): the cap is PER TYPE, not global. A flat 40-total cap let the most
// prolific type crowd the others out of the river (24 prompts left room for only 8 posts + 8 products); now
// each type contributes its newest `limit` and the merged river stays newest-first. The feed paginates
// client-side, so the bigger index never renders all at once.

/**
 * @typedef {{ type: 'post'|'product'|'prompt', slug: string, title: string, author: string, url: string, publishedAt: number|null, visibility: 'public'|'members' }} ActivityEntry
 */

/**
 * Newest-first with undated entries sinking, capped at `limit` PER TYPE. Does not mutate the input.
 * @param {ActivityEntry[]} entries
 * @param {number} [limit]  the per-type cap
 * @returns {ActivityEntry[]}
 */
export function buildActivityIndex(entries, limit = 40) {
  const cap = Math.max(0, limit);
  const byType = new Map();
  const sorted = [...entries].sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
  const out = [];
  for (const e of sorted) {
    const n = byType.get(e.type) ?? 0;
    if (n >= cap) continue;
    byType.set(e.type, n + 1);
    out.push(e);
  }
  return out;
}
