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
