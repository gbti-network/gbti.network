// SOW-054: the admin-owned TOPIC MAP (house/topic-map.yml). A "followed topic" is a content-taxonomy PRIMARY
// category key (house/taxonomy.yml top-level: ai, devops, blockchain, ...). This map translates each topic to the
// NEWS categories (workers/news/config/categories.mjs) it should surface, so ONE "followed topics" selection drives
// BOTH the browse drill-down (content) and the news default (Phase 4). The stored member pref `prefs.categories`
// is then one clean vocabulary (topic keys); the Worker maps topics -> news categories server-side when
// personalizing the feed.
//
// Node-free + pure (no fs, no IO): the parser, the topic->news resolver, and the validator. The site build, the
// signup Worker, the client, and node tests all read house/topic-map.yml themselves and call these.

/**
 * Parse the raw parsed-YAML into a clean { topic: [newsCategory, ...] } map. Accepts either shape per topic:
 *   ai: ["AI/ML"]                         (a bare array), or
 *   ai: { newsCategories: ["AI/ML"] }     (the explicit form the SOW recommends).
 * Malformed entries are dropped; news categories are trimmed + de-duplicated. A missing/empty doc yields {}.
 */
export function topicMapFromParsed(parsed) {
  const out = {};
  const src = parsed && typeof parsed === 'object' ? (parsed.topics ?? parsed) : {};
  if (!src || typeof src !== 'object' || Array.isArray(src)) return out;
  for (const [topic, val] of Object.entries(src)) {
    if (typeof topic !== 'string' || !topic) continue;
    const list = Array.isArray(val) ? val : (val && Array.isArray(val.newsCategories) ? val.newsCategories : []);
    const seen = new Set();
    const cats = [];
    for (const c of list) {
      if (typeof c !== 'string') continue;
      const v = c.trim();
      if (!v || seen.has(v)) continue;
      seen.add(v);
      cats.push(v);
    }
    out[topic] = cats;
  }
  return out;
}

/**
 * Given a member's followed `topics` (topic keys) + the parsed/clean map, return the de-duplicated, order-stable
 * set of NEWS categories to surface. An unknown topic (no mapping) contributes nothing. Empty topics -> [].
 */
export function newsCategoriesForTopics(topics, map) {
  const m = topicMapFromParsed(map); // idempotent: accepts a raw parsed-YAML or an already-clean map
  const seen = new Set();
  const out = [];
  for (const t of Array.isArray(topics) ? topics : []) {
    for (const c of m[t] ?? []) {
      if (!seen.has(c)) { seen.add(c); out.push(c); }
    }
  }
  return out;
}

/**
 * SOW-054 Phase 4: reorder news items so those whose `category` is in `followedNewsCats` come FIRST (stable within
 * each group). NEVER hides: every item is kept (the SOW's "prioritize, never hide" decision). An empty
 * followedNewsCats (no followed topics) returns the original order. Operates on the RAW news items (which carry the
 * classifier `category`), so call it before projecting to card items.
 */
export function prioritizeNewsByTopics(items, followedNewsCats) {
  const set = new Set(Array.isArray(followedNewsCats) ? followedNewsCats : []);
  const list = Array.isArray(items) ? items : [];
  if (!set.size) return [...list];
  const followed = [];
  const rest = [];
  for (const it of list) (set.has(it && it.category) ? followed : rest).push(it);
  return [...followed, ...rest];
}

/**
 * Validate the parsed topic map against the live vocabularies. Returns an array of error strings (empty = valid):
 * every TOPIC key must be a real taxonomy PRIMARY, and every mapped news category must be a canonical news category.
 */
export function validateTopicMap(parsed, { taxonomyPrimaries = [], newsCategories = [] } = {}) {
  const errors = [];
  const map = topicMapFromParsed(parsed);
  const primaries = new Set(taxonomyPrimaries);
  const cats = new Set(newsCategories);
  for (const [topic, list] of Object.entries(map)) {
    if (!primaries.has(topic)) {
      errors.push(`house/topic-map.yml: "${topic}" is not a top-level category in house/taxonomy.yml`);
    }
    for (const c of list) {
      if (!cats.has(c)) {
        errors.push(`house/topic-map.yml: topic "${topic}" maps to "${c}", which is not a news category in workers/news/config/categories.mjs`);
      }
    }
  }
  return errors;
}
