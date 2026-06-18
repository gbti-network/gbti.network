// Pure query/shaping helpers for the JSON API. No I/O — easy to unit-test.

import { CATEGORIES } from '../config/categories.mjs';
import { SOURCES } from '../config/sources.mjs';

/** Clamp a user-supplied limit to [1, max], defaulting when absent/invalid. */
export function clampLimit(raw, def = 50, max = 100) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, max);
}

/** Does an item match the given /feed filters? Pure; shared by the store's shard scan. */
export function matchesFilter(item, { category, source, since } = {}) {
  if (category && String(item.category || '').toLowerCase() !== String(category).toLowerCase()) return false;
  if (source && item.source !== source) return false;
  const sinceN = Number.parseInt(since, 10);
  if (Number.isFinite(sinceN) && (item.publishedAt ?? item.fetchedAt ?? 0) < sinceN) return false;
  return true;
}

/** Public item view (drop the internal `classified` flag). */
export function publicItem(i) {
  return {
    guid: i.guid,
    source: i.source,
    title: i.title,
    link: i.link,
    summary: i.summary,
    category: i.category,
    publishedAt: i.publishedAt,
    fetchedAt: i.fetchedAt,
  };
}

/** Categories (from config) joined with current counts (from the store index's counts.category map). */
export function categoriesWithCounts(countsByCategory = {}) {
  return CATEGORIES.map((c) => ({
    name: c.name,
    description: c.description,
    count: countsByCategory[c.name] || 0,
  }));
}

/** Sources (from config) joined with current counts (from the store index's counts.source map). */
export function sourcesWithCounts(countsBySource = {}) {
  return SOURCES.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    url: s.url,
    count: countsBySource[s.id] || 0,
  }));
}
