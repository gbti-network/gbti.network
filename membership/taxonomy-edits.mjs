// SOW-055: the PURE category-manager edit core. Given the PARSED house/taxonomy.yml ({ tree: { key: { label,
// children? } } }) plus an action, each function returns { next, changed, audit } — `next` is the new parsed
// taxonomy (the caller serializes + commits it via the SOW-005 PR flow), `changed` is false when the action is
// already satisfied (idempotent), and `audit` is an identity-minimal log entry folded into the PR body. Node-free
// (no fs / no yaml) so it runs in the client, the Worker, and node tests.
//
// v1 ships only the SAFE operations: ADD a category/subcategory and RENAME a node's LABEL. Both leave every
// content `categories` PATH unchanged, so no content is orphaned and no migration is needed. The path-changing
// operations (rename a KEY, MOVE/reparent, REMOVE) require the content migration and are SOW-055 Phase 2.
//
// SECURITY: this only COMPUTES the file edit. Authorization is enforced by CODEOWNERS (house/** is admin-owned) +
// the no-bypass branch protection + the metadata-only gate, exactly like the other governance edits. A non-admin
// PR touching house/taxonomy.yml is auto-rejected regardless of what this computes.

export class TaxonomyEditError extends Error {}

const KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/; // kebab-case, matching validate-content's category-key rule
const MAX_LABEL = 60;

function isoOf(now) {
  const d = now instanceof Date ? now : new Date(now ?? Date.now());
  if (Number.isNaN(d.getTime())) throw new TaxonomyEditError('invalid timestamp');
  return d.toISOString();
}
/** Identity-minimal audit entry (the SOW-024 / SOW-038 shape), keyed by the category PATH rather than a github_id. */
function auditEntry(ctx, action, path, detail) {
  const a = ctx?.actor || null;
  return {
    at: isoOf(ctx?.now),
    actor: a ? { github_id: a.githubId != null ? String(a.githubId) : (a.github_id != null ? String(a.github_id) : null), login: a.login ?? null } : null,
    action,
    target: { path: [...path] },
    detail: detail ?? null,
  };
}

/** Resolve the NODE at an array path into the tree (or null). A [] path is the root (no node; use the tree map). */
export function nodeAt(taxonomy, path) {
  if (!Array.isArray(path) || path.length === 0) return null;
  let map = taxonomy?.tree;
  let node = null;
  for (const key of path) {
    if (!map || typeof map !== 'object') return null;
    node = map[key];
    if (!node || typeof node !== 'object') return null;
    map = node.children;
  }
  return node;
}

function cleanLabel(label) {
  const lab = typeof label === 'string' ? label.trim() : '';
  if (!lab) throw new TaxonomyEditError('a category label is required');
  return lab.slice(0, MAX_LABEL);
}
function cleanTaxonomy(taxonomy) {
  const tx = structuredClone(taxonomy && typeof taxonomy === 'object' ? taxonomy : {});
  if (!tx.tree || typeof tx.tree !== 'object' || Array.isArray(tx.tree)) tx.tree = {};
  return tx;
}

/**
 * ADD a category (or subcategory). `parentPath` ([] = top level) names the parent node; `key` is the new
 * kebab-case slug and `label` its display name. Idempotent: re-adding the identical node is a no-op; a key clash
 * with a DIFFERENT label is an error (use renameLabel). Safe: adds a new leaf, never touches an existing path.
 */
export function addCategory(taxonomy, { parentPath = [], key, label } = {}, ctx = {}) {
  const tx = cleanTaxonomy(taxonomy);
  const k = typeof key === 'string' ? key.trim() : '';
  if (!KEY_RE.test(k)) throw new TaxonomyEditError('a category key must be kebab-case (lowercase letters, digits, single hyphens)');
  const lab = cleanLabel(label);

  let childrenMap;
  if (Array.isArray(parentPath) && parentPath.length) {
    const parent = nodeAt(tx, parentPath);
    if (!parent) throw new TaxonomyEditError(`parent category not found: ${parentPath.join(' > ')}`);
    if (!parent.children || typeof parent.children !== 'object' || Array.isArray(parent.children)) parent.children = {};
    childrenMap = parent.children;
  } else {
    childrenMap = tx.tree;
  }

  const fullPath = [...(Array.isArray(parentPath) ? parentPath : []), k];
  const existing = childrenMap[k];
  if (existing) {
    if ((existing.label ?? '') === lab) return { next: tx, changed: false, audit: auditEntry(ctx, 'taxonomy.add', fullPath, { label: lab, noop: true }) };
    throw new TaxonomyEditError(`a category "${k}" already exists here; use rename to change its label`);
  }
  childrenMap[k] = { label: lab };
  return { next: tx, changed: true, audit: auditEntry(ctx, 'taxonomy.add', fullPath, { label: lab }) };
}

/**
 * RENAME a node's LABEL (display name) only. The key/slug and thus every content `categories` path is unchanged,
 * so this is always safe (no orphaning, no migration). Idempotent when the label already matches.
 */
export function renameLabel(taxonomy, { path, label } = {}, ctx = {}) {
  const tx = cleanTaxonomy(taxonomy);
  if (!Array.isArray(path) || path.length === 0) throw new TaxonomyEditError('a category path is required');
  const lab = cleanLabel(label);
  const node = nodeAt(tx, path);
  if (!node) throw new TaxonomyEditError(`category not found: ${path.join(' > ')}`);
  if ((node.label ?? '') === lab) return { next: tx, changed: false, audit: auditEntry(ctx, 'taxonomy.rename', path, { label: lab, noop: true }) };
  node.label = lab;
  return { next: tx, changed: true, audit: auditEntry(ctx, 'taxonomy.rename', path, { label: lab }) };
}

// ---- SOW-055 Phase 2: the PATH-CHANGING ops (rename-key / move / remove) + the content-categories migration ----
// These change a category's PATH, so every content item whose `categories` starts with the old path must be
// rewritten (or, for a remove with no reassignment, would be orphaned). The pure functions below compute the tree
// edit + a `pathChange` descriptor; the caller (scripts/migrate-category.mjs) scans ALL content and applies
// rewriteCategories() to each affected item, committing the taxonomy edit + the rewrites in ONE PR.

const samePath = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((s, i) => s === b[i]);
/** Does a content path START WITH a category path (so it is affected by a change to that category)? */
export const pathStartsWith = (cats, prefix) => Array.isArray(cats) && Array.isArray(prefix) && cats.length >= prefix.length && prefix.every((s, i) => cats[i] === s);

/** Resolve { childrenMap, key, parentPath } for a path, or null if the node is missing. childrenMap[key] is the node. */
function locate(tx, path) {
  const key = path[path.length - 1];
  const parentPath = path.slice(0, -1);
  const childrenMap = parentPath.length === 0 ? tx.tree : nodeAt(tx, parentPath)?.children;
  if (!childrenMap || typeof childrenMap !== 'object' || !childrenMap[key]) return null;
  return { childrenMap, key, parentPath };
}

/** RENAME a node's KEY/slug. The PATH changes (the last segment), so content under it must be migrated. */
export function renameKey(taxonomy, { path, newKey } = {}, ctx = {}) {
  const tx = cleanTaxonomy(taxonomy);
  if (!Array.isArray(path) || path.length === 0) throw new TaxonomyEditError('a category path is required');
  const nk = typeof newKey === 'string' ? newKey.trim() : '';
  if (!KEY_RE.test(nk)) throw new TaxonomyEditError('the new key must be kebab-case (lowercase letters, digits, single hyphens)');
  const loc = locate(tx, path);
  if (!loc) throw new TaxonomyEditError(`category not found: ${path.join(' > ')}`);
  if (nk === loc.key) return { next: tx, changed: false, audit: auditEntry(ctx, 'taxonomy.rename-key', path, { newKey: nk, noop: true }), pathChange: null };
  if (loc.childrenMap[nk]) throw new TaxonomyEditError(`a sibling category "${nk}" already exists here`);
  // Rebuild the children map preserving INSERTION ORDER, swapping the one key (delete+add would move it to the end).
  const rebuilt = {};
  for (const [k, v] of Object.entries(loc.childrenMap)) rebuilt[k === loc.key ? nk : k] = v;
  if (loc.parentPath.length === 0) tx.tree = rebuilt; else nodeAt(tx, loc.parentPath).children = rebuilt;
  const to = [...path.slice(0, -1), nk];
  return { next: tx, changed: true, audit: auditEntry(ctx, 'taxonomy.rename-key', path, { to }), pathChange: { kind: 'rename', from: path, to } };
}

/** MOVE (reparent) a node. Its key is unchanged but its PATH changes, so content under it must be migrated. */
export function moveCategory(taxonomy, { fromPath, toParentPath = [] } = {}, ctx = {}) {
  const tx = cleanTaxonomy(taxonomy);
  if (!Array.isArray(fromPath) || fromPath.length === 0) throw new TaxonomyEditError('a source category path is required');
  if (!Array.isArray(toParentPath)) throw new TaxonomyEditError('a valid destination parent path is required');
  const loc = locate(tx, fromPath);
  if (!loc) throw new TaxonomyEditError(`category not found: ${fromPath.join(' > ')}`);
  const key = loc.key;
  const to = [...toParentPath, key];
  if (samePath(fromPath.slice(0, -1), toParentPath)) return { next: tx, changed: false, audit: auditEntry(ctx, 'taxonomy.move', fromPath, { to, noop: true }), pathChange: null };
  // Cannot move a node under itself or one of its own descendants (would detach the subtree from the tree).
  if (pathStartsWith(toParentPath, fromPath)) throw new TaxonomyEditError('cannot move a category under itself or its descendant');
  let destMap;
  if (toParentPath.length === 0) destMap = tx.tree;
  else {
    const destParent = nodeAt(tx, toParentPath);
    if (!destParent) throw new TaxonomyEditError(`destination parent not found: ${toParentPath.join(' > ')}`);
    if (!destParent.children || typeof destParent.children !== 'object') destParent.children = {};
    destMap = destParent.children;
  }
  if (destMap[key]) throw new TaxonomyEditError(`a category "${key}" already exists at the destination`);
  const node = loc.childrenMap[key];
  delete loc.childrenMap[key];
  destMap[key] = node;
  return { next: tx, changed: true, audit: auditEntry(ctx, 'taxonomy.move', fromPath, { to }), pathChange: { kind: 'move', from: fromPath, to } };
}

/** MERGE a node INTO another: the source's subcategories move under the destination (a same-key child at the
 *  destination REFUSES — resolve it first), the source is removed, and filed content re-prefixes from the
 *  source path to the destination path (deeper segments preserved). SOW-100 merge. */
export function mergeCategory(taxonomy, { fromPath, intoPath } = {}, ctx = {}) {
  const tx = cleanTaxonomy(taxonomy);
  if (!Array.isArray(fromPath) || fromPath.length === 0) throw new TaxonomyEditError('a source category path is required');
  if (!Array.isArray(intoPath) || intoPath.length === 0) throw new TaxonomyEditError('a destination category path is required');
  if (samePath(fromPath, intoPath)) throw new TaxonomyEditError('cannot merge a category into itself');
  if (pathStartsWith(intoPath, fromPath)) throw new TaxonomyEditError('cannot merge a category into its own descendant');
  const src = locate(tx, fromPath);
  if (!src) throw new TaxonomyEditError(`category not found: ${fromPath.join(' > ')}`);
  const dest = nodeAt(tx, intoPath);
  if (!dest) throw new TaxonomyEditError(`destination category not found: ${intoPath.join(' > ')}`);
  const srcNode = src.childrenMap[src.key];
  const kids = srcNode?.children && typeof srcNode.children === 'object' ? srcNode.children : {};
  if (Object.keys(kids).length) {
    if (!dest.children || typeof dest.children !== 'object') dest.children = {};
    for (const k of Object.keys(kids)) {
      if (dest.children[k]) throw new TaxonomyEditError(`the destination already has a subcategory "${k}" — merge or rename it first`);
    }
    for (const [k, v] of Object.entries(kids)) dest.children[k] = v;
  }
  delete src.childrenMap[src.key];
  return { next: tx, changed: true, audit: auditEntry(ctx, 'taxonomy.merge', fromPath, { into: intoPath }), pathChange: { kind: 'merge', from: fromPath, to: intoPath } };
}

/** REMOVE a node (and its subtree). With reassignToParent, affected content reattaches to the parent; otherwise
 *  affected content would be ORPHANED, so the caller must refuse unless there are no references. */
export function removeCategory(taxonomy, { path, reassignToParent = false } = {}, ctx = {}) {
  const tx = cleanTaxonomy(taxonomy);
  if (!Array.isArray(path) || path.length === 0) throw new TaxonomyEditError('a category path is required');
  const loc = locate(tx, path);
  if (!loc) throw new TaxonomyEditError(`category not found: ${path.join(' > ')}`);
  delete loc.childrenMap[loc.key];
  const to = reassignToParent ? path.slice(0, -1) : null;
  return { next: tx, changed: true, audit: auditEntry(ctx, 'taxonomy.remove', path, { reassignToParent }), pathChange: { kind: 'remove', from: path, to } };
}

/**
 * Rewrite ONE content item's `categories` for a pathChange. Returns:
 *   - undefined : the item is NOT under the changed path (leave it alone).
 *   - an array  : the new `categories` (move/rename relocate the prefix preserving deeper segments; a remove with
 *                 reassignToParent reattaches the whole affected subtree to the parent).
 *   - null      : the item is ORPHANED (a remove with no reassignment) — the caller must refuse the migration.
 */
export function rewriteCategories(categories, pathChange) {
  if (!pathChange || !pathStartsWith(categories, pathChange.from)) return undefined;
  const { kind, from, to } = pathChange;
  if (kind === 'remove') return to === null ? null : [...to];
  return [...to, ...categories.slice(from.length)]; // move | rename
}
