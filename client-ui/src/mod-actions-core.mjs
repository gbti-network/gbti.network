// SOW-071: pure helpers for <gbti-mod-actions>, the shared per-item moderation control. The path builder CONFINES a
// control to a member content file (it can only ever emit a members/<author>/... path, never a house/ path); the
// role->actions map is the UX gate. NEITHER is the security boundary: the Worker/host re-derives the actor role from
// house/roles.yml and re-validates the path (admin-ops requireRole + requireMemberContentPath), and CODEOWNERS + the
// SOW-005 gate enforce the merge. Node-free + pure so node --test covers them.

export const RANK = { member: 0, moderator: 1, admin: 2, superadmin: 3 };
const TYPE_DIR = { post: 'posts', project: 'projects', product: 'projects', prompt: 'prompts' };
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

// The content types the sow-189 marks apply to (membership/content-flags.mjs KEY_RE). A share cannot be marked: the
// Worker derives the key from the path and refuses anything else, so the menu never offers it.
const FLAGGABLE = { post: 'post', product: 'project', project: 'project', prompt: 'prompt' };

/** The key an item's marks are published under in /content-flags.json (`post:<slug>`), or null for a share. */
export function flagKeyFor(type, slug) {
  const t = FLAGGABLE[type];
  return t && SAFE.test(String(slug || '')) ? `${t}:${slug}` : null;
}

/**
 * sow-409 (owner, 2026-09-25): the actions in the superadmin "..." menu, in order. Replaces the SOW-071 tiers, where
 * a moderator saw Hide and Unhide and an admin added Remove: the owner made the menu superadmin-only.
 *   - not superadmin: [] (the item's owner still gets the menu, holding Edit alone: canEditItem below);
 *   - Hide, never Unhide: the reader and the Shares feed only ever show live items;
 *   - an article, project or prompt: the half of each mark pair that applies, from `flags` ({ stale, unindexed });
 *     both halves when `flags` is null, because the marks could not be read;
 *   - a share: no marks (they do not apply to shares);
 *   - Remove last.
 */
export function menuActions({ role, type, flags = null } = {}) {
  if (role !== 'superadmin') return [];
  const out = ['hide'];
  if (FLAGGABLE[type]) {
    if (flags) {
      out.push(flags.stale ? 'unstale' : 'stale', flags.unindexed ? 'reindex' : 'unindex');
    } else {
      out.push('stale', 'unstale', 'unindex', 'reindex');
    }
  }
  out.push('remove');
  return out;
}

// Owner, 2026-10-08: "content owners and superadmins should be able to edit from this dropdown by opening up the
// content inside the workbench." The menu's Edit row opens the item itself in the WorkBench editor, through the
// WorkBench's own deep links: `#edit=<path>` for an article, project or prompt (parseWorkspaceEdit) and
// `#edit-share=<id>` for a share (parseWorkspaceEditShare; a superadmin's link to another member's share moves the
// WorkBench to Network shares to find it). The WorkBench accepts lowercase member paths only, so anything else gets no
// row rather than a link that opens nothing. House items (the GBTI Network author) live outside members/ and are not
// editable there. As with the rest of the menu this is the UX gate; the Worker decides who may publish what.
const EDIT_TAB = { post: 'post', project: 'project', product: 'project', prompt: 'prompt', share: 'share' };
const LOWER = /^[a-z0-9][a-z0-9-]*$/;
const HOUSE = new Set(['gbti', 'house']);
const lc = (v) => String(v ?? '').trim().toLowerCase();

/**
 * Whether the viewer may open this item in the editor: a superadmin, or its owner (their GBTI folder is the author)
 * while their membership is not locked. A lapsed owner's work stays live, but the WorkBench shows them its locked
 * screen instead of the editor, so the row would lead nowhere. `locked` is isLockedMembership(status.membership).
 */
export function canEditItem({ role, viewer, author, locked = false } = {}) {
  if (role === 'superadmin') return true;
  const me = lc(viewer);
  return !locked && Boolean(me) && me === lc(author);
}

/**
 * Where the WorkBench is from the page the menu sits on. On gbti.network (or a subdomain such as the preview) it is
 * the site's own /workbench/, in the same tab. Anywhere else (the extension, which has none since sow-406, or the agent
 * server's local page, which serves no /workbench/) it is the website's, in a new tab.
 */
export function workbenchTarget(loc) {
  const host = String(loc?.hostname || '');
  const onSite = /^https?:$/.test(String(loc?.protocol || '')) && (host === 'gbti.network' || host.endsWith('.gbti.network'));
  return onSite ? { base: '/workbench/', newTab: false } : { base: 'https://gbti.network/workbench/', newTab: true };
}

/**
 * The WorkBench link that opens this item in its editor, or null when it cannot be opened there. `base` is the
 * WorkBench page: '/workbench/' on the website, 'https://gbti.network/workbench/' from the extension.
 */
export function editHrefFor({ type, author, slug, id } = {}, base = '/workbench/') {
  const tab = EDIT_TAB[type];
  if (!tab || HOUSE.has(lc(author)) || !LOWER.test(String(author || ''))) return null;
  if (type === 'share') return LOWER.test(String(id || '')) ? `${base}#tab=share&edit-share=${id}` : null;
  if (!LOWER.test(String(slug || ''))) return null;
  const path = modPathFor({ type, author, slug });
  return path ? `${base}#tab=${tab}&edit=${encodeURIComponent(path)}` : null;
}
