// SOW-024: the member ACTIVITY model (favorites + collections), the behavioral/relational data that must
// be ERASABLE. Per SOW-024 this lives in the deletable edge store (Cloudflare KV), NOT the public git repo,
// so a member's right to erasure is a hard delete and the data is never published as immutable history.
//
// This module is the PURE, node-free core: each function takes a plain activity object and a command and
// returns a NEW activity object. No IO, no Date.now()/randomUUID() inside (callers inject `now`/`genId`), so
// it is fully unit-tested with fakes. The Worker handler (workers/signup/membership-activity.mjs) does the
// KV read-modify-write around these transforms.
//
// Shape (one KV value per member, key `activity:<github_id>`):
//   { favorites: [{ type, slug, addedAt }],
//     upvotes: [{ type, slug, addedAt }],            // SOW-057: a member's per-target upvotes (deletable here)
//     collections: [{ id, name, createdAt, items: [{ type, slug, addedAt }] }],
//     updatedAt }

// SOW-050 P3: a Share is a first-class basket type alongside post/product/prompt. Its slug is the composite
// "<author>/<id>" (the same targetSlug the comment system uses), so it legitimately carries one slash; every
// other type stays a single segment.
export const CONTENT_TYPES = new Set(['post', 'product', 'prompt', 'share']);
export const MAX_FAVORITES = 2000;
export const MAX_UPVOTES = 2000;
export const MAX_COLLECTIONS = 100;
export const MAX_ITEMS_PER_COLLECTION = 1000;
export const MAX_NAME_LEN = 80;
const SLUG_RE = /^[a-z0-9-]+$/;
const SHARE_SLUG_RE = /^[a-z0-9-]+\/[a-z0-9-]+$/;
const slugOk = (type, slug) => (type === 'share' ? SHARE_SLUG_RE : SLUG_RE).test(slug);

/** Thrown for caller-input problems; the handler maps it to a 400 (never a 500). */
export class ActivityError extends Error {}

export function emptyActivity() {
  return { favorites: [], upvotes: [], collections: [], updatedAt: null };
}

/** Coerce a stored favorites/upvotes-shaped array into deduped, valid { type, slug, addedAt } entries. */
function normalizeTargetList(raw) {
  const out = [];
  if (!Array.isArray(raw)) return out;
  const seen = new Set();
  for (const f of raw) {
    if (!f || !isTarget(f.type, f.slug)) continue;
    const k = targetKey(f);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ type: f.type, slug: f.slug, addedAt: Number(f.addedAt) || 0 });
  }
  return out;
}

const isTarget = (type, slug) => CONTENT_TYPES.has(type) && typeof slug === 'string' && slugOk(type, slug);
const targetKey = (t) => `${t.type}:${t.slug}`;

/** Defensive: coerce any stored/incoming value into the canonical shape, dropping malformed entries, so a
 *  hand-edited or partially-written KV value can never crash a read or a transform. */
export function normalizeActivity(raw) {
  const a = emptyActivity();
  if (!raw || typeof raw !== 'object') return a;
  a.favorites = normalizeTargetList(raw.favorites);
  a.upvotes = normalizeTargetList(raw.upvotes);
  if (Array.isArray(raw.collections)) {
    const seenIds = new Set();
    for (const c of raw.collections) {
      if (!c || typeof c.id !== 'string' || typeof c.name !== 'string') continue;
      if (seenIds.has(c.id)) continue;
      seenIds.add(c.id);
      const items = [];
      const seenItems = new Set();
      if (Array.isArray(c.items)) {
        for (const it of c.items) {
          if (!it || !isTarget(it.type, it.slug)) continue;
          const k = targetKey(it);
          if (seenItems.has(k)) continue;
          seenItems.add(k);
          items.push({ type: it.type, slug: it.slug, addedAt: Number(it.addedAt) || 0 });
        }
      }
      a.collections.push({ id: c.id, name: c.name.slice(0, MAX_NAME_LEN), createdAt: Number(c.createdAt) || 0, items });
    }
  }
  a.updatedAt = Number(raw.updatedAt) || null;
  return a;
}

function cleanName(name) {
  const nm = typeof name === 'string' ? name.trim() : '';
  if (!nm) throw new ActivityError('a collection name is required');
  return nm.slice(0, MAX_NAME_LEN);
}

/** Toggle a favorite on/off. */
export function applyFavorite(activity, { type, slug, on }, { now = Date.now } = {}) {
  if (!isTarget(type, slug)) throw new ActivityError('invalid favorite target');
  const a = normalizeActivity(activity);
  const k = targetKey({ type, slug });
  const exists = a.favorites.some((f) => targetKey(f) === k);
  if (on && !exists) {
    if (a.favorites.length >= MAX_FAVORITES) throw new ActivityError('favorite limit reached');
    a.favorites.push({ type, slug, addedAt: now() });
  } else if (!on && exists) {
    a.favorites = a.favorites.filter((f) => targetKey(f) !== k);
  }
  a.updatedAt = now();
  return a;
}

/** SOW-057: toggle a member's per-target upvote on/off (the per-member record; the per-target voter set + the
 *  syndication threshold live in membership/share-votes.mjs). Mirrors applyFavorite. */
export function applyUpvote(activity, { type, slug, on }, { now = Date.now } = {}) {
  if (!isTarget(type, slug)) throw new ActivityError('invalid upvote target');
  const a = normalizeActivity(activity);
  const k = targetKey({ type, slug });
  const exists = a.upvotes.some((u) => targetKey(u) === k);
  if (on && !exists) {
    if (a.upvotes.length >= MAX_UPVOTES) throw new ActivityError('upvote limit reached');
    a.upvotes.push({ type, slug, addedAt: now() });
  } else if (!on && exists) {
    a.upvotes = a.upvotes.filter((u) => targetKey(u) !== k);
  }
  a.updatedAt = now();
  return a;
}

/** Create a named collection; returns { activity, id }. */
export function createCollection(activity, { name }, { now = Date.now, genId } = {}) {
  if (typeof genId !== 'function') throw new ActivityError('genId is required');
  const nm = cleanName(name);
  const a = normalizeActivity(activity);
  if (a.collections.length >= MAX_COLLECTIONS) throw new ActivityError('collection limit reached');
  const id = String(genId());
  a.collections.push({ id, name: nm, createdAt: now(), items: [] });
  a.updatedAt = now();
  return { activity: a, id };
}

export function renameCollection(activity, { id, name }, { now = Date.now } = {}) {
  const nm = cleanName(name);
  const a = normalizeActivity(activity);
  const c = a.collections.find((x) => x.id === id);
  if (!c) throw new ActivityError('collection not found');
  c.name = nm;
  a.updatedAt = now();
  return a;
}

export function deleteCollection(activity, { id }, { now = Date.now } = {}) {
  const a = normalizeActivity(activity);
  const before = a.collections.length;
  a.collections = a.collections.filter((c) => c.id !== id);
  if (a.collections.length === before) throw new ActivityError('collection not found');
  a.updatedAt = now();
  return a;
}

/** SOW-050 P2: a pure, optional content-type filter over an activity object. `types` is a list of allowed
 *  content types; an empty/missing list returns the (normalized) activity unchanged. Favorites are filtered
 *  directly; every collection is KEPT (so the named lists never disappear from the view) with its items narrowed
 *  to the allowed types. Used server-side by getMemberActivity and mirrored by the Saved view's chip row. */
export function filterActivity(activity, types) {
  const a = normalizeActivity(activity);
  if (!Array.isArray(types) || types.length === 0) return a;
  const allow = new Set(types);
  a.favorites = a.favorites.filter((f) => allow.has(f.type));
  a.upvotes = a.upvotes.filter((u) => allow.has(u.type));
  a.collections = a.collections.map((c) => ({ ...c, items: c.items.filter((it) => allow.has(it.type)) }));
  return a;
}

/** Add/remove a content item to/from a collection. */
export function setCollectionItem(activity, { id, type, slug, on }, { now = Date.now } = {}) {
  if (!isTarget(type, slug)) throw new ActivityError('invalid collection item target');
  const a = normalizeActivity(activity);
  const c = a.collections.find((x) => x.id === id);
  if (!c) throw new ActivityError('collection not found');
  const k = targetKey({ type, slug });
  const exists = c.items.some((it) => targetKey(it) === k);
  if (on && !exists) {
    if (c.items.length >= MAX_ITEMS_PER_COLLECTION) throw new ActivityError('collection item limit reached');
    c.items.push({ type, slug, addedAt: now() });
  } else if (!on && exists) {
    c.items = c.items.filter((it) => targetKey(it) !== k);
  }
  a.updatedAt = now();
  return a;
}
