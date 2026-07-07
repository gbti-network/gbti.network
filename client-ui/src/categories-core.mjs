// SOW-100: the pure logic behind the Admin -> Categories workspace (no DOM, no network, node-testable).
// Tree flattening + full-tree count rollup from the public index JSONs, channel status derivation,
// the pending-edit set (batched into ONE house PR; migrations are NOT pending-set members), and the
// content-browser pagination windowing. The element (gbti-categories-workspace) is a thin shell over this.
import { filterByCategoryPath } from './browse-filter-core.mjs';

export { filterByCategoryPath };

/** Flatten the taxonomy tree ({ key: { label, children? } }) into ordered nodes with path context. */
export function flattenTree(tree, parentPath = []) {
  const out = [];
  for (const [key, node] of Object.entries(tree || {})) {
    const path = [...parentPath, key];
    out.push({ key, label: node?.label || key, path, level: parentPath.length, hasChildren: Boolean(node?.children && Object.keys(node.children).length) });
    if (node?.children) out.push(...flattenTree(node.children, path));
  }
  return out;
}

/** Per-node content counts ROLLED UP (a node counts every item filed at or below it), from index-JSON items
 *  (each carries a full `categories` path). Keys are path joins ('devops/frameworks'). Zero-item nodes get 0. */
export function countRollup(tree, itemsByType = {}) {
  const nodes = flattenTree(tree);
  const counts = new Map(nodes.map((n) => [n.path.join('/'), { post: 0, prompt: 0, product: 0, total: 0 }]));
  for (const [type, items] of Object.entries(itemsByType)) {
    for (const it of items || []) {
      const cats = Array.isArray(it?.categories) ? it.categories : [];
      // credit every ancestor prefix of the item's path (rollup), once per item
      for (let d = 1; d <= cats.length; d++) {
        const k = cats.slice(0, d).join('/');
        const c = counts.get(k);
        if (!c) continue; // an orphaned path (not in the tree) counts nowhere
        if (c[type] != null) c[type] += 1;
        c.total += 1;
      }
    }
  }
  return counts;
}

/** Channel status for a node KEY (the channel map keys on flat category keys, top-level or sub):
 *  'review' when a pending (unbatched) channel op targets it, 'synced' when the git pool maps it, else 'none'. */
export function channelStatusFor(key, pool = [], pendingOps = []) {
  const k = String(key || '').toLowerCase();
  for (const op of pendingOps) {
    if ((op.kind === 'channel-set' || op.kind === 'channel-remove') && String(op.args?.category || '').toLowerCase() === k) return 'review';
  }
  return pool.some((r) => String(r?.category || '').toLowerCase() === k) ? 'synced' : 'none';
}

/** The channel currently mapped to a key in the git pool, or null. */
export function channelFor(key, pool = []) {
  const k = String(key || '').toLowerCase();
  const row = pool.find((r) => String(r?.category || '').toLowerCase() === k);
  return row ? String(row.channelId) : null;
}

// ---- The pending-edit set (batched -> ONE house PR). Ops are keyed so a re-edit REPLACES its predecessor.
// Kinds: 'label' {path[], label}, 'add' {parentPath[]|null, key, label}, 'channel-set' {category, channelId},
// 'channel-remove' {category}. Key renames / moves / removes are review-gated CI migrations and never enter
// this set.

/** The dedupe id for an op. */
export function opId(op) {
  switch (op.kind) {
    case 'label': return `label:${(op.args.path || []).join('/')}`;
    case 'add': return `add:${[...(op.args.parentPath || []), op.args.key].join('/')}`;
    case 'channel-set':
    case 'channel-remove': return `channel:${op.args.category}`;
    default: return `x:${JSON.stringify(op.args)}`;
  }
}

/** Upsert an op into the pending Map (id -> op); returns the same Map. A channel-set over a pending
 *  channel-remove (or vice versa) replaces it, matching the design's one-row-per-target tray. */
export function upsertOp(pending, op) {
  pending.set(opId(op), op);
  return pending;
}

/** A one-line human description for the tray + the PR body. */
export function describeOp(op) {
  const a = op.args || {};
  switch (op.kind) {
    case 'label': return `Rename label of ${(a.path || []).join(' / ')} to "${a.label}"`;
    case 'add': return a.parentPath && a.parentPath.length ? `Add subcategory ${a.key} under ${a.parentPath.join(' / ')}` : `Add top-level category ${a.key}`;
    case 'channel-set': return `Map ${a.category} to Discord channel #${a.channelId}`;
    case 'channel-remove': return `Unmap ${a.category} from its Discord channel`;
    default: return op.kind;
  }
}

/** Split the pending set into the two house-file op groups the batch apply consumes. */
export function batchPlan(pending) {
  const ops = [...pending.values()];
  return {
    taxonomy: ops.filter((o) => o.kind === 'label' || o.kind === 'add'),
    channels: ops.filter((o) => o.kind === 'channel-set' || o.kind === 'channel-remove'),
    descriptions: ops.map(describeOp),
    count: ops.length,
  };
}

// ---- Content-browser pagination (the design's windowed pager: 1, 2, ..., p-1, p, p+1, ..., n).

export function pageWindow(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const set = new Set([1, 2, page - 1, page, page + 1, pages - 1, pages].filter((n) => n >= 1 && n <= pages));
  const sorted = [...set].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i && sorted[i] - sorted[i - 1] > 1) out.push('…');
    out.push(sorted[i]);
  }
  return out;
}

export function paginate(items, page, per = 6) {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / per));
  const p = Math.min(Math.max(1, page), pages);
  const from = (p - 1) * per;
  return { page: p, pages, total, from: total ? from + 1 : 0, to: Math.min(from + per, total), items: items.slice(from, from + per) };
}

/** Relative age for browser rows (publishedAt ms -> "3d ago" style). */
export function relAge(ms, now) {
  if (!ms || !Number.isFinite(ms)) return '';
  const d = Math.max(0, Math.floor((now - ms) / 86400000));
  if (d === 0) return 'today';
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return mo < 12 ? `${mo}mo ago` : `${Math.floor(mo / 12)}y ago`;
}
