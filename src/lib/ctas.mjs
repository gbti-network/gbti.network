// sow-281: the PURE read side of the CTA registry (house/ctas.yml). The build asks "which enabled CTA does this
// item carry?" (ctaFor) and the artifact asks "does each assignment point at a real item?" (resolveAssignments).
// Node-free, so the tests run it on literal registries and the Astro pages run it on the parsed file. The three
// truthful states the SOW demands are distinct here: no CTA (ctaFor null, nothing assigned), a CTA that exists but
// is disabled (ctaFor null, the registry still lists the assignment), and an assignment that names no item
// (resolved: false, never dropped, so the manager can show it in red instead of the site quietly forgetting it).
import { ctasOf, validRef } from '../../membership/cta-edits.mjs';

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** The stable key of an item reference. */
export const itemKey = (type, ref) => `${type}:${str(ref)}`;

/** The public URL of an item reference, or null when the reference is malformed. Shares are author/id. */
export function itemUrl(type, ref) {
  const r = str(ref);
  if (!validRef(type, r)) return null;
  switch (type) {
    case 'post': return `/articles/${r}/`;
    case 'project': return `/projects/${r}/`;
    case 'prompt': return `/prompts/${r}/`;
    case 'share': return `/shares/${r}/`;
    default: return null;
  }
}

/** Every assignment in the registry, flattened: [{ ctaId, type, ref, enabled }]. */
export function assignmentsOf(registry) {
  const out = [];
  for (const c of ctasOf(registry)) {
    if (!c || typeof c !== 'object') continue;
    for (const it of Array.isArray(c.items) ? c.items : []) {
      if (it && typeof it === 'object') out.push({ ctaId: str(c.id), type: it.type, ref: str(it.ref), enabled: c.enabled === true });
    }
  }
  return out;
}

/**
 * The ENABLED CTA assigned to one item, or null. The first enabled match in registry order wins when an item is
 * (transiently) on two CTAs, so the answer is deterministic. A disabled CTA never renders, however it is assigned.
 */
export function ctaFor(registry, type, ref) {
  const key = itemKey(type, ref);
  for (const c of ctasOf(registry)) {
    if (!c || typeof c !== 'object' || c.enabled !== true) continue;
    const items = Array.isArray(c.items) ? c.items : [];
    if (items.some((it) => it && itemKey(it.type, it.ref) === key)) return c;
  }
  return null;
}

/**
 * The registry with every assignment resolved against the real item list. `items` is [{ type, ref, title, live }]
 * from the content collections (live = the item has a public page). An assignment that matches nothing is kept and
 * marked resolved: false; one that matches a draft or a members-only item is resolved but not live (no url).
 */
export function resolveAssignments(registry, items) {
  const index = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    if (it && it.type && it.ref) index.set(itemKey(it.type, it.ref), it);
  }
  return ctasOf(registry).filter((c) => c && typeof c === 'object').map((c) => ({
    id: str(c.id),
    label: str(c.label),
    line: str(c.line),
    button: str(c.button),
    destination: str(c.destination),
    partner: str(c.partner),
    enabled: c.enabled === true,
    note: typeof c.note === 'string' ? c.note : '',
    items: (Array.isArray(c.items) ? c.items : []).filter((it) => it && typeof it === 'object').map((it) => {
      const found = index.get(itemKey(it.type, it.ref)) || null;
      const live = !!found?.live;
      return { type: it.type, ref: str(it.ref), resolved: !!found, live, title: found?.title ?? null, url: live ? itemUrl(it.type, it.ref) : null };
    }),
  }));
}
