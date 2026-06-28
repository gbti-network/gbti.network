// SOW-071: pure helpers for <gbti-mod-actions>, the shared per-item moderation control. The path builder CONFINES a
// control to a member content file (it can only ever emit a members/<author>/... path, never a house/ path); the
// role->actions map is the UX gate. NEITHER is the security boundary: the Worker/host re-derives the actor role from
// house/roles.yml and re-validates the path (admin-ops requireRole + requireMemberContentPath), and CODEOWNERS + the
// SOW-005 gate enforce the merge. Node-free + pure so node --test covers them.

export const RANK = { member: 0, moderator: 1, admin: 2, superadmin: 3 };
const TYPE_DIR = { post: 'posts', product: 'products', prompt: 'prompts' };
const SAFE = /^[A-Za-z0-9_-]+$/; // a username / slug / share-id segment; rejects '/', '..', etc.

/**
 * The canonical member-content path for a moderation target, or null when it cannot be confined to a member file:
 *   share              -> members/<author>/shares/<id>.md         (needs a safe id)
 *   post|product|prompt -> members/<author>/<dir>/<slug>/index.md  (needs a safe slug)
 * Any non-safe author/slug/id (a slash, '..', empty) returns null, so the control is simply not offered.
 */
export function modPathFor({ type, author, slug, id } = {}) {
  if (!SAFE.test(String(author || ''))) return null;
  if (type === 'share') return SAFE.test(String(id || '')) ? `members/${author}/shares/${id}.md` : null;
  const dir = TYPE_DIR[type];
  if (!dir || !SAFE.test(String(slug || ''))) return null;
  return `members/${author}/${dir}/${slug}/index.md`;
}

/** The moderation actions a role may SEE: none below moderator; Hide/Unhide at moderator+; +Remove at admin+. */
export function visibleActions(role) {
  const r = RANK[role] ?? 0;
  if (r < RANK.moderator) return [];
  return r >= RANK.admin ? ['hide', 'unhide', 'remove'] : ['hide', 'unhide'];
}
