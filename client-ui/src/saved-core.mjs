// SOW-037: pure helpers for the member "Saved" view (favorites + collections). A favorite / collection item is a
// bare { type, slug } in the deletable edge store (SOW-024); to show titles we resolve each against the per-type
// content index JSONs (the same indexes gbti-browse fetches). Node-free so it unit-tests without a DOM/network.

// A favorite's type is the content type ('post' for an article). Map it to its build-time index file + label.
// SOW-050 P3: 'share' is a first-class saved type. Shares have no public page/index, so there is no index file
// (indexFileFor('share') -> null and resolveItem falls back to the slug); they still get a label + sort slot.
const TYPE_INDEX = { post: 'blog-index.json', product: 'products-index.json', prompt: 'prompts-index.json' };
const TYPE_LABEL = { post: 'Articles', product: 'Products', prompt: 'Prompts', share: 'Shares' };
const ORDER = ['post', 'product', 'prompt', 'share'];

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
      const row = { type, slug: it.slug, title: it.title || it.slug, url: it.url || null, path: it.path || null, thumb: it.thumb || null };
      map.set(`${type}:${it.slug}`, row);
      // SOW-112: a saved row created before a rename still carries the OLD slug; the index item ships the old
      // slugs as aliases, so the row resolves to the renamed item (never overwriting a real current-slug entry).
      for (const a of Array.isArray(it.aliases) ? it.aliases : []) {
        const k = `${type}:${a}`;
        if (!map.has(k)) map.set(k, row);
      }
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

/** SOW-050 P2: per-type saved counts ({ post: n, share: n, ... }) across favorites + every collection's items.
 *  Drives the Saved view's type-filter chip row (a type chip shows only when its count is > 0). */
export function savedTypeCounts(activity = {}) {
  const counts = {};
  const bump = (t) => { if (t) counts[t] = (counts[t] || 0) + 1; };
  for (const f of activity.favorites || []) bump(f?.type);
  for (const c of activity.collections || []) for (const it of c?.items || []) bump(it?.type);
  return counts;
}

/** SOW-050 P2: the ordered type-filter chips for the Saved view. Always an 'all' chip first, then one chip per
 *  known content type that actually has saved items, in the canonical ORDER. [{ type, label, count }]. */
export function savedTypeChips(activity = {}) {
  const counts = savedTypeCounts(activity);
  const total = Object.values(counts).reduce((n, v) => n + v, 0);
  const chips = [{ type: 'all', label: 'All', count: total }];
  for (const t of ORDER) if (counts[t]) chips.push({ type: t, label: typeLabel(t), count: counts[t] });
  return chips;
}

/** SOW-050 P2: narrow a display activity ({favorites, collections}) to a single content type for the chip row.
 *  `type` null/'all' returns the activity unchanged. Collections are kept; only their items are narrowed. */
export function filterSavedByType(activity = {}, type) {
  if (!type || type === 'all') return activity;
  return {
    favorites: (activity.favorites || []).filter((f) => f?.type === type),
    collections: (activity.collections || []).map((c) => ({ ...c, items: (c?.items || []).filter((it) => it?.type === type) })),
  };
}

/** Total saved count across favorites + every collection's items (for an at-a-glance header). */
export function savedCount(activity = {}) {
  const favs = Array.isArray(activity.favorites) ? activity.favorites.length : 0;
  const coll = Array.isArray(activity.collections)
    ? activity.collections.reduce((n, c) => n + (Array.isArray(c?.items) ? c.items.length : 0), 0)
    : 0;
  return { favorites: favs, inCollections: coll };
}
