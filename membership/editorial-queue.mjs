// sow-323 Phase 3: the EDITORIAL REVIEW QUEUE core. Node-free (no fs, no yaml, no crypto), so the Worker, the
// admin surface and the tests share one implementation, exactly as the creator-application core does.
//
// WHAT IS IN THE QUEUE. A member's article, project or prompt enters when they publish it: every such item starts
// members-only (the owner's rule of 2026-09-12) and a superadmin decides what becomes public. SHARES ARE NOT
// REVIEWED: the owner ruled on 2026-09-15 that only a superadmin can make a share public at all, so a member's
// share never waits for anything. A trusted author (the silently granted creator tier) and staff publish public
// directly, so nothing of theirs enters either.
//
// WHY KV AND NOT house/. The record is per-person, mutable state about work in progress, which CLAUDE.md's storage
// boundary keeps out of the public repository; what is PUBLIC is the content itself, and that is in git. The
// `editorial:` prefix must also be in BACKED_UP_PREFIXES (scripts/lib/kv-backup.mjs), which is an explicit list.
//
// ONE RECORD PER ITEM, keyed by its repository path, because that is what a superadmin approves and what the
// author edits.

/** The reviewable content directories and the type each carries. `products` is the retired name of `projects`. */
export const REVIEWED_DIRS = Object.freeze({ posts: 'post', projects: 'project', products: 'project', prompts: 'prompt' });

export const EDITORIAL_STATE = Object.freeze({
  pending: 'pending',
  approved: 'approved',
  dismissed: 'dismissed', // the superadmin looked and left it members-only. SILENT: the author is not told.
  unknown: 'unknown', // a malformed record: never actionable
});

/** The KV key prefix the superadmin lane lists over, and which kv-backup.mjs must carry. */
export const EDITORIAL_KEY_PREFIX = 'editorial:';

/** The KV key for one item. ONE builder, so every reader and writer agrees on the shape. */
export function editorialKey(path) {
  return `${EDITORIAL_KEY_PREFIX}${String(path ?? '').trim()}`;
}

/** A title is free text a member wrote, so bound it and strip control characters before storing it. */
const text = (v, max = 200) => String(v ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, max);

/**
 * The item at a repository path as `{ path, type, slug, login }`, or null when the path is not a reviewable member
 * content item. Read from the PATH only, so nothing a caller says about an item can retarget its record.
 */
export function reviewableItem(filePath) {
  const m = /^members\/([a-z0-9][a-z0-9-]*)\/(posts|projects|products|prompts)\/([a-z0-9][a-z0-9-]*)\/index\.md$/.exec(String(filePath || ''));
  if (!m) return null;
  return { path: m[0], type: REVIEWED_DIRS[m[2]], slug: m[3], login: m[1] };
}

/** The public URL an item has once it is public. The queue links to it and the owner email carries it. */
export function itemUrl(type, slug, origin = 'https://gbti.network') {
  const base = { post: '/articles', project: '/projects', prompt: '/prompts' }[type];
  return base && slug ? `${String(origin).replace(/\/$/, '')}${base}/${slug}/` : null;
}

/** The `title:` a content file's frontmatter states, bounded. The caller falls back to the slug. */
export function titleOf(content) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(content || ''));
  const m = fm && /^title:\s*["']?(.+?)["']?\s*$/m.exec(fm[1]);
  return m ? text(m[1]) : '';
}

/**
 * The items of a publish that ENTER the queue: reviewable content the caller is publishing members-only, when the
 * caller is neither a trusted author nor a superadmin. A file the request does not carry as a string (a delete, an
 * image) publishes no words. `statedVisibility` is injected so this core stays node-free and shares the Worker's
 * one frontmatter reader (membership/hosted-author.mjs).
 */
export function queueableItems(files, { folder, trusted = false, isSuperadmin = false, statedVisibility } = {}) {
  if (trusted || isSuperadmin || !Array.isArray(files) || typeof folder !== 'string' || !folder) return [];
  const out = [];
  for (const f of files) {
    const path = typeof f === 'string' ? f : f?.path;
    const content = typeof f === 'string' ? null : f?.content;
    const item = reviewableItem(path);
    if (!item || item.login !== folder) continue;
    if (typeof content !== 'string') continue;
    if (typeof statedVisibility === 'function' && statedVisibility(content) !== 'members') continue;
    out.push({ ...item, title: titleOf(content) });
  }
  return out;
}

/** A fresh pending record for an item. */
export function newEntry({ path, type, slug, login, githubId, title, now = new Date() }) {
  const at = (now instanceof Date ? now : new Date(now)).toISOString();
  return {
    path: String(path),
    type: String(type),
    slug: String(slug),
    login: String(login),
    githubId: githubId == null ? null : String(githubId),
    title: text(title) || String(slug),
    requestedAt: at,
    updatedAt: at,
    state: EDITORIAL_STATE.pending,
    decidedAt: null,
    decidedBy: null,
    decidedByLogin: null,
    editedSinceDecision: false,
  };
}

/** The state of a stored record. A missing, malformed or unrecognised record is `unknown`, never `pending`. */
export function entryState(rec) {
  if (!rec || typeof rec !== 'object' || typeof rec.path !== 'string' || !rec.path) return EDITORIAL_STATE.unknown;
  const s = rec.state;
  return s === EDITORIAL_STATE.pending || s === EDITORIAL_STATE.approved || s === EDITORIAL_STATE.dismissed ? s : EDITORIAL_STATE.unknown;
}

/**
 * The record after the author publishes this item again. An APPROVED item stays approved (the owner's rule: an
 * approved item stays public through its author's later edits). A DISMISSED item returns to the queue, marked as
 * edited since, and without a second owner email: the owner is told when an item first arrives, and a revision of
 * something they already set aside should not mail them again.
 */
export function entryAfterEdit(rec, { title, now = new Date() } = {}) {
  const at = (now instanceof Date ? now : new Date(now)).toISOString();
  if (entryState(rec) === EDITORIAL_STATE.unknown) return null;
  const next = { ...rec, updatedAt: at };
  if (title) next.title = text(title);
  if (entryState(rec) === EDITORIAL_STATE.dismissed) {
    next.state = EDITORIAL_STATE.pending;
    next.editedSinceDecision = true;
  }
  return next;
}

/** May a decision be recorded? Approving an approved item is a no-op; dismissing needs something waiting. */
export function canDecide(rec, decision) {
  const state = entryState(rec);
  if (state === EDITORIAL_STATE.unknown) return false;
  if (decision === 'approve') return state !== EDITORIAL_STATE.approved;
  if (decision === 'dismiss') return state === EDITORIAL_STATE.pending;
  return false;
}

/** The record after a superadmin decides. Pure: the caller stores it. */
export function decideEntry(rec, { decision, githubId, login, now = new Date() } = {}) {
  if (!canDecide(rec, decision)) throw new Error(`cannot ${decision} an item in state ${entryState(rec)}`);
  const at = (now instanceof Date ? now : new Date(now)).toISOString();
  return {
    ...rec,
    state: decision === 'approve' ? EDITORIAL_STATE.approved : EDITORIAL_STATE.dismissed,
    updatedAt: at,
    decidedAt: at,
    decidedBy: githubId == null ? null : String(githubId),
    decidedByLogin: login ? String(login) : null,
    editedSinceDecision: false,
  };
}

/** The queue as a superadmin reads it: waiting first, then the most recently touched. A malformed row is kept. */
export function sortEntries(list) {
  const rank = { [EDITORIAL_STATE.pending]: 0, [EDITORIAL_STATE.dismissed]: 1, [EDITORIAL_STATE.approved]: 2, [EDITORIAL_STATE.unknown]: 3 };
  return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
    const ra = rank[entryState(a)] ?? 3;
    const rb = rank[entryState(b)] ?? 3;
    if (ra !== rb) return ra - rb;
    return String(b?.updatedAt ?? '').localeCompare(String(a?.updatedAt ?? ''));
  });
}

/** How many items are waiting, which is what the admin tab and the owner email count. */
export const pendingCount = (list) => (Array.isArray(list) ? list : []).filter((r) => entryState(r) === EDITORIAL_STATE.pending).length;
