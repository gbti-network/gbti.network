// SOW-037: pure helpers for the member "Saved" view (favorites + collections). A favorite / collection item is a
// bare { type, slug } in the deletable edge store (SOW-024); to show titles we resolve each against the per-type
// content index JSONs (the same indexes gbti-browse fetches). Node-free so it unit-tests without a DOM/network.

// A favorite's type is the content type ('post' for an article). Map it to its build-time index file + label.
const TYPE_INDEX = { post: 'blog-index.json', product: 'products-index.json', prompt: 'prompts-index.json' };
const TYPE_LABEL = { post: 'Articles', product: 'Products', prompt: 'Prompts' };
const ORDER = ['post', 'product', 'prompt'];

export function indexFileFor(type) { return TYPE_INDEX[type] || null; }
export function typeLabel(type) { return TYPE_LABEL[type] || String(type || ''); }
export const SAVED_TYPES = ORDER.slice();

/**
 * Build a lookup Map keyed "type:slug" -> { type, slug, title, url, path, thumb } from a { [type]: items[] }
 * object (items as shipped by the per-type index JSONs). Malformed entries are skipped.
 */
export function buildItemIndex(perType = {}) {
  const map = new Map();
  for (const [type, items] of Object.entries(perType || {})) {
    for (const it of items || []) {
      if (!it || !it.slug) continue;
      map.set(`${type}:${it.slug}`, { type, slug: it.slug, title: it.title || it.slug, url: it.url || null, path: it.path || null, thumb: it.thumb || null });
    }
  }
  return map;
}

/** Resolve a saved { type, slug } to a display item, falling back to the slug when the index has no entry
 *  (e.g. a removed item, or a members-only Mode A item that is absent from the public index). */
export function resolveItem(index, type, slug) {
  return (index && index.get(`${type}:${slug}`)) || { type, slug, title: slug, url: null, path: null, thumb: null };
}

/** Group favorites ([{type, slug}]) by type in a stable order, dropping malformed entries. Returns
 *  [{ type, items: [{type, slug}] }]. Unknown types sort after the known ones. */
export function groupFavoritesByType(favorites = []) {
  const groups = new Map();
  for (const f of favorites || []) {
    if (!f || !f.type || !f.slug) continue;
    if (!groups.has(f.type)) groups.set(f.type, []);
    groups.get(f.type).push({ type: f.type, slug: f.slug });
  }
  const known = ORDER.filter((t) => groups.has(t));
  const extra = [...groups.keys()].filter((t) => !ORDER.includes(t));
  return [...known, ...extra].map((t) => ({ type: t, items: groups.get(t) }));
}

/** Total saved count across favorites + every collection's items (for an at-a-glance header). */
export function savedCount(activity = {}) {
  const favs = Array.isArray(activity.favorites) ? activity.favorites.length : 0;
  const coll = Array.isArray(activity.collections)
    ? activity.collections.reduce((n, c) => n + (Array.isArray(c?.items) ? c.items.length : 0), 0)
    : 0;
  return { favorites: favs, inCollections: coll };
}
