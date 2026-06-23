// SOW-054 Phase 2: pure helpers for the browse category drill-down. The per-type index items carry `categories`
// (the key path, e.g. ["devops","frameworks"]) and `categoryLabels` (the matching label breadcrumb the index
// endpoints emit). These derive the PRIMARY and SUBCATEGORY chip rows from a set of items and filter the list by a
// selected category path prefix. Node-free + pure, so node --test covers them.

/** Distinct {key,label,count} for a path SEGMENT across items, keeping only items that HAVE that depth. `depth`
 *  0 = primary, 1 = first subcategory. When depth=1, restricts to items whose primary key === `underPrimary`. */
function segChips(items, depth, underPrimary) {
  const map = new Map(); // key -> { key, label, count }
  for (const it of Array.isArray(items) ? items : []) {
    const cats = Array.isArray(it && it.categories) ? it.categories : [];
    if (depth === 1 && cats[0] !== underPrimary) continue;
    const key = cats[depth];
    if (typeof key !== 'string' || !key) continue;
    const labels = Array.isArray(it && it.categoryLabels) ? it.categoryLabels : [];
    const label = (typeof labels[depth] === 'string' && labels[depth]) || key;
    const cur = map.get(key) || { key, label, count: 0 };
    cur.count += 1;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** The PRIMARY category chips present across items (with counts), sorted by label. */
export function primaryChips(items) {
  return segChips(items, 0);
}

/** The SUBCATEGORY chips under a selected primary key (with counts), sorted by label. [] when no primary or none. */
export function subChips(items, primaryKey) {
  return primaryKey ? segChips(items, 1, primaryKey) : [];
}

/** Filter items to those whose `categories` path STARTS WITH `path` (a prefix match). path=[] -> all items
 *  (an item with no categories is kept only when path is empty). */
export function filterByCategoryPath(items, path) {
  const p = (Array.isArray(path) ? path : []).filter((s) => typeof s === 'string' && s);
  const list = Array.isArray(items) ? items : [];
  if (!p.length) return list;
  return list.filter((it) => {
    const cats = Array.isArray(it && it.categories) ? it.categories : [];
    return p.every((seg, i) => cats[i] === seg);
  });
}
