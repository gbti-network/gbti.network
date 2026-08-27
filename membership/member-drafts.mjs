// SOW-157: hosted draft staging. A hosted member has NO fork, so their drafts cannot stage on fork
// branches; they live in the deletable edge store (KV `drafts:<github_id>`) instead — private to the
// member, erasable (SOW-024), device-independent, and NEVER in git history (which also serves the SOW-011
// invariant: nothing trial-authored reaches the canonical repo; trial members may stage here too).
// Node-free pure transforms; the Worker handler does auth + the KV read-modify-write.

export const DRAFTS_MAX_ITEMS = 50;
export const DRAFT_MAX_BYTES = 150_000;
export const DRAFTS_MAX_TOTAL_BYTES = 1_000_000;

const TYPE_RE = /^(post|product|prompt|profile)$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
// A github login, matched exactly as the folder segment it becomes. Deliberately the same shape the Author
// picker's `member:<login>` value carries, so a value that round-trips through the store is one the picker
// can render back without re-parsing it differently than it was written.
const LOGIN_RE = /^[a-z0-9][a-z0-9-]{0,38}$/;

/**
 * Normalize a pending author reassignment, or null.
 *
 * WHAT THIS IS FOR. The superadmin Author picker is a PENDING choice: it takes effect at publish, not at
 * save. Before this field existed the choice lived only in the DOM, so saving a draft and reloading silently
 * discarded it, and publishing that draft from the Drafts list reassigned nothing while reporting success.
 *
 * THIS VALUE CONFERS NO AUTHORITY AND MUST NEVER BE READ AS THOUGH IT DID. The draft route is signed-in and
 * non-banned only (workers/signup/membership-drafts.mjs), so any member can store any target here, including
 * one naming somebody else's folder. That is deliberately harmless: the folder decision is re-resolved at
 * publish from the caller's own identity (workers/signup/membership-author.mjs re-runs authorizeSuperadmin
 * "rather than trusted from the request body"), and a non-superadmin who stored a foreign target gets a 400
 * there. The invariant a future change must not break: nothing downstream may let this stored value
 * influence whether a caller is allowed to write outside their own folder.
 *
 * So the validation below is a SHAPE check, keeping the store free of junk that the picker would then have
 * to defend against. It is not a permission check and must not be mistaken for one.
 */
function normalizeAuthorTarget(v) {
  if (v == null) return null;
  if (typeof v !== 'object') throw new DraftError('the author target must be an object');
  const scope = String(v.scope ?? '');
  if (scope === 'house') return { scope: 'house' };
  if (scope !== 'member') throw new DraftError('the author target scope must be house or member');
  const username = String(v.username ?? '').trim().toLowerCase();
  if (!LOGIN_RE.test(username)) throw new DraftError('the author target username is invalid');
  return { scope: 'member', username };
}

export class DraftError extends Error {}

export const draftKeyOf = (type, slug) => `${type}:${slug}`;

/** Normalize a stored KV blob to { items: { "<type>:<slug>": record } }. Unknown shapes reset empty. */
export function normalizeDrafts(stored) {
  const items = stored && typeof stored === 'object' && stored.items && typeof stored.items === 'object' ? stored.items : {};
  return { items: { ...items } };
}

function utf8Bytes(s) {
  return new TextEncoder().encode(typeof s === 'string' ? s : JSON.stringify(s ?? '')).length;
}

/**
 * Upsert one draft record. The record is the editor's restore state: { type, slug, pendingSlug?, path,
 * frontmatter, body, authorTarget?, updatedAt }. Caps: per-draft bytes, item count, total bytes. Throws
 * DraftError on any violation (the handler maps it to a 400).
 */
export function applyDraftPut(state, draft, { now = () => new Date().toISOString() } = {}) {
  const d = draft ?? {};
  const type = String(d.type ?? '');
  const slug = String(d.slug ?? '');
  if (!TYPE_RE.test(type)) throw new DraftError('a valid draft type is required');
  if (!SLUG_RE.test(slug)) throw new DraftError('a valid draft slug is required');
  const pendingSlug = d.pendingSlug != null ? String(d.pendingSlug) : null;
  if (pendingSlug != null && !SLUG_RE.test(pendingSlug)) throw new DraftError('the pending slug is invalid');
  const next = normalizeDrafts(state);
  const key = draftKeyOf(type, slug);
  const prev = next.items[key];
  // SOW-014: the from-the-author note travels WITH the draft. It used to exist only as a publish-time
  // argument, so a note typed in the editor was lost the moment the draft was saved, and publishing from a
  // draft wrote no note at all (which then fails content validation for a product or prompt).
  //
  // An ABSENT authorNote preserves whatever is stored rather than clearing it, so a caller that does not know
  // about the field cannot destroy a note. Clearing is explicit: send an empty string.
  const authorNote = typeof d.authorNote === 'string'
    ? d.authorNote
    : (typeof prev?.authorNote === 'string' ? prev.authorNote : null);
  // The pending author reassignment travels with the draft, on exactly the authorNote terms above and for
  // exactly the same reason: an ABSENT value PRESERVES what is stored rather than clearing it, because
  // src/pages/workbench/preview.astro is a second saveDraft caller that knows nothing about this field and
  // must not be able to destroy a superadmin's pending reassignment simply by saving. Clearing is explicit:
  // send null, which is what the editor does once a publish has consumed the move.
  const authorTarget = d.authorTarget !== undefined
    ? normalizeAuthorTarget(d.authorTarget)
    : (prev?.authorTarget ?? null);
  const record = {
    type, slug, pendingSlug,
    path: typeof d.path === 'string' ? d.path : null,
    frontmatter: d.frontmatter && typeof d.frontmatter === 'object' ? d.frontmatter : {},
    body: typeof d.body === 'string' ? d.body : '',
    ...(authorNote != null ? { authorNote } : {}),
    ...(authorTarget != null ? { authorTarget } : {}),
    updatedAt: now(),
  };
  if (utf8Bytes(JSON.stringify(record)) > DRAFT_MAX_BYTES) throw new DraftError(`a draft may not exceed ${DRAFT_MAX_BYTES} bytes`);
  const isNew = !(key in next.items);
  if (isNew && Object.keys(next.items).length >= DRAFTS_MAX_ITEMS) throw new DraftError(`draft limit reached (${DRAFTS_MAX_ITEMS}); discard one first`);
  next.items[key] = record;
  if (utf8Bytes(JSON.stringify(next)) > DRAFTS_MAX_TOTAL_BYTES) throw new DraftError('the draft store is full; discard some drafts first');
  return next;
}

/** Delete one draft by type + slug. Deleting a missing draft is a clean no-op (idempotent discard). */
export function applyDraftDelete(state, { type, slug } = {}) {
  const next = normalizeDrafts(state);
  delete next.items[draftKeyOf(String(type ?? ''), String(slug ?? ''))];
  return next;
}

/** The list view, newest first. */
export function listDraftRecords(state) {
  return Object.values(normalizeDrafts(state).items).sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
}
