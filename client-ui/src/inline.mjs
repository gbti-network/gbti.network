// Pure inline-editing helpers (SOW-006 v2). The in-place editor reads a content page's INERT hooks
// (data-gbti-* baked into the public Astro build), loads the current item via the client, lets the member
// edit regions in place, then merges the edits back into the FULL frontmatter so an inline edit never drops
// other metadata. No DOM here: the component passes a dataset-like object + the edited regions; these stay
// pure so they are unit-tested in node.

const TYPE_RE = /^(post|product|prompt|profile)$/;

/**
 * Read the editing hooks from a page region's dataset (element.dataset or a plain object).
 * Returns null when the hooks are absent/invalid (a non-editable page), so the overlay simply does nothing.
 * @param {{gbtiPath?:string, gbtiType?:string, gbtiSlug?:string, gbtiOwner?:string}} dataset
 */
export function readHooks(dataset = {}) {
  const path = dataset.gbtiPath || null;
  const type = TYPE_RE.test(dataset.gbtiType || '') ? dataset.gbtiType : null;
  if (!path || !type) return null;
  return { path, type, slug: dataset.gbtiSlug || null, owner: dataset.gbtiOwner || null };
}

/**
 * Whether the signed-in member may edit this hooked content IN PLACE (owns the folder). UX gate only; the
 * SOW-005 gate is authoritative on merge. owner is the content's owner username (from the hook).
 */
export function canEditInPlace(hooks, identity) {
  if (!hooks || !identity?.username) return false;
  // own-folder: the content path must be under members/<my-username>/ (matches content-ops' write scope).
  return hooks.path.startsWith(`members/${String(identity.username).toLowerCase()}/`);
}

/**
 * Merge inline edits into a loaded item, producing the publish payload. The full current frontmatter is
 * carried through (only the edited fields change), so other metadata + system-managed fields are preserved
 * (the core's content-ops re-forces the gated fields server-side). edits = { title?, body?, fields? }.
 */
export function toPublishPayload(item, edits = {}) {
  if (!item || !item.frontmatter) throw new Error('no item to edit');
  const input = { ...item.frontmatter, ...(edits.fields || {}) };
  if (edits.title != null) input.title = edits.title;
  const type = input.type || item.type || edits.type;
  const body = edits.body != null ? edits.body : item.body;
  return { type, input, body };
}
