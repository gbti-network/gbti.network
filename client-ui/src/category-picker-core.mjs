// sow-227: the pure logic behind <gbti-category-picker>, the one control for choosing exactly ONE category (owner,
// 2026-09-22: "make the category select not flat, hierarchical, and searchable", one control on both hosts). It
// serves two vocabularies that stay separate: the flat share topics (house/topics.yml, grouped under the Categories
// screen's headings) and the nested content category tree (house/taxonomy.yml). Node-free, no DOM, node-tested.
import { flattenTree } from './categories-core.mjs';
import { filterTopics, groupTopics } from './topic-picker-core.mjs';
import { esc } from './base.mjs';

/** The separator the picker draws between the levels of a category path. */
export const PATH_SEP = ' › ';

/**
 * The tree from /taxonomy.json as options in tree order: [{ key: 'ai/prompts', label, depth, crumbs: ['AI'] }]. The
 * key is the FULL path, because leaf keys repeat (`entertainment` is a top-level category and ai > prompts >
 * entertainment), and a path is what an item stores. Reuses flattenTree rather than walking the tree a fourth time.
 */
export function treeNodesFromJson(data) {
  const tree = data && data.tree && typeof data.tree === 'object' && !Array.isArray(data.tree) ? data.tree : null;
  if (!tree) return [];
  const flat = flattenTree(tree);
  const labelOf = new Map(flat.map((n) => [n.path.join('/'), n.label]));
  return flat.map((n) => ({
    key: n.path.join('/'),
    label: n.label,
    depth: n.level,
    crumbs: n.path.slice(0, -1).map((seg, i) => labelOf.get(n.path.slice(0, i + 1).join('/')) || seg),
  }));
}

/** Split a label around the first case-insensitive match of the query: { pre, mid, post }. No match, no mid. */
export function highlightParts(label, query) {
  const text = String(label ?? '');
  const q = String(query ?? '').trim().toLowerCase();
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  if (i < 0) return { pre: text, mid: '', post: '' };
  return { pre: text.slice(0, i), mid: text.slice(i, i + q.length), post: text.slice(i + q.length) };
}

/**
 * The rows a picker shows for a query, and the choosable options among them, in order.
 *   topics: a heading row per group (the Categories screen's order), then that group's matching topics.
 *   tree:   every node that matches (by label or its own key), plus its ancestors so a match is never shown out of
 *           context. An ancestor kept only for context is `muted`, and is still choosable (a path may stop anywhere).
 * vocab is { kind: 'topics', topics, groupOrder } or { kind: 'tree', nodes }. Returns { rows, options }.
 */
export function pickerRows(vocab, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (vocab && vocab.kind === 'tree') {
    const nodes = Array.isArray(vocab.nodes) ? vocab.nodes : [];
    const hit = (n) => !q || n.label.toLowerCase().includes(q) || n.key.split('/').pop().includes(q);
    const keep = new Set();
    for (const n of nodes) {
      if (!hit(n)) continue;
      const parts = n.key.split('/');
      for (let i = 1; i <= parts.length; i++) keep.add(parts.slice(0, i).join('/'));
    }
    const options = nodes.filter((n) => keep.has(n.key))
      .map((n) => ({ type: 'option', key: n.key, label: n.label, depth: n.depth, muted: Boolean(q) && !hit(n) }));
    return { rows: options, options };
  }
  const rows = [];
  const options = [];
  const topics = vocab && Array.isArray(vocab.topics) ? vocab.topics : [];
  for (const g of groupTopics(filterTopics(topics, q), vocab && vocab.groupOrder)) {
    if (!g.topics.length) continue;
    if (g.group) rows.push({ type: 'group', label: g.group });
    for (const t of g.topics) {
      const o = { type: 'option', key: t.key, label: t.label, depth: 0, muted: false };
      rows.push(o);
      options.push(o);
    }
  }
  return { rows, options };
}

/**
 * What the closed picker shows for its value: { state, crumbs, leaf }.
 *   empty    nothing chosen
 *   loading  a value, before the vocabulary arrives (shown as written, never as unknown)
 *   known    found: the tree shows its parents as crumbs
 *   unknown  a stored value the vocabulary does not have. It is SHOWN, never dropped, so an item saved before a
 *            category was renamed tells its author instead of silently losing its category.
 */
export function valueDisplay(vocab, value) {
  const v = String(value ?? '');
  const raw = v.split('/').filter(Boolean).join(PATH_SEP);
  if (!v) return { state: 'empty', crumbs: [], leaf: '' };
  if (!vocab) return { state: 'loading', crumbs: [], leaf: raw };
  if (vocab.kind === 'tree') {
    const n = (vocab.nodes || []).find((x) => x.key === v);
    return n ? { state: 'known', crumbs: n.crumbs, leaf: n.label } : { state: 'unknown', crumbs: [], leaf: raw };
  }
  const t = (vocab.topics || []).find((x) => x.key === v);
  return t ? { state: 'known', crumbs: [], leaf: t.label } : { state: 'unknown', crumbs: [], leaf: v };
}

/** Move the active option by `dir` (+1 / -1), clamped to the list (no wrap). -1 when there is nothing to move to. */
export function moveActive(index, dir, length) {
  if (!length) return -1;
  const from = Number.isInteger(index) ? index : -1;
  return Math.max(0, Math.min(length - 1, from + dir));
}

/**
 * The editor's Category field: the picker over the tree, plus the hidden input the editor already reads back, holding
 * the path the way every array field does (comma-joined). The stored shape is untouched: an ordered path of keys.
 */
export function categoryFieldHtml(path) {
  const segs = (Array.isArray(path) ? path : []).map((s) => String(s).trim()).filter(Boolean);
  return `<gbti-category-picker vocab="tree" data-cat-picker value="${esc(segs.join('/'))}"></gbti-category-picker>`
    + `<input data-key="categories" data-kind="array" type="hidden" value="${esc(segs.join(', '))}" />`;
}
