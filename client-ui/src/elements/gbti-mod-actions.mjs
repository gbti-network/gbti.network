// <gbti-mod-actions> (SOW-071): the shared per-item moderation control, on every content type (post/product/prompt
// in the reader, share in the shares feed). Keyed on data-gbti-type/-author/-slug/-id; it builds the canonical
// members/<author>/... path itself (mod-actions-core modPathFor) and calls client.admin(action, {path}). The client
// gate is UX-only: the host re-derives the actor role from house/roles.yml + re-validates the path (admin-ops
// requireRole + requireMemberContentPath), and CODEOWNERS + the SOW-005 gate enforce the merge.
//
// sow-409 (owner, 2026-09-25): "these admin tools needs to be moved into a superadmin only elipsis dropdown." It used
// to be a row of up to seven buttons beside heart and Save, shown in tiers from moderator up. It is now ONE "..."
// button that opens a menu, for a superadmin only, listing only the actions that apply (menuActions): Hide, the half
// of each sow-189 mark pair that applies (read from the public /content-flags.json), and Remove last. The menu takes
// the avatar menu's look (extension/shell.css .me-menu / .mi), so no new design was invented.
//
// Owner, 2026-10-08: the menu also carries Edit, first, for the item's OWNER as well as a superadmin. It opens the item
// in the WorkBench editor (a new tab from the extension, which has no WorkBench of its own). So an owner who is not a
// superadmin now sees the "..." button too, holding Edit alone, and the button is named "More actions" for everyone.
import { GbtiElement, define, esc } from '../base.mjs';
import { modPathFor, menuActions, flagKeyFor, canEditItem, editHrefFor, workbenchTarget } from '../mod-actions-core.mjs';
import { isLockedMembership } from '../../../client/src/membership.mjs';

const SITE = 'https://gbti.network';
const ACTION_LABEL = { hide: 'Hide', unhide: 'Unhide', remove: 'Remove', stale: 'Mark stale', unstale: 'Unmark stale', unindex: 'Unindex', reindex: 'Reindex' };
const ACTION_API = { hide: 'deplatform', unhide: 'republish', remove: 'remove', stale: 'stale', unstale: 'unstale', unindex: 'unindex', reindex: 'reindex' };
const ACTION_DONE = { hide: 'Hidden', unhide: 'Republished', remove: 'Removed', stale: 'Marked stale', unstale: 'Stale cleared', unindex: 'Unindexed', reindex: 'Reindexed' };
const CONFIRM = {
  hide: 'Hide this item? It is set to draft and removed from public view (reversible).',
  unhide: 'Republish this item? It returns to public view.',
  remove: 'Remove this item? This deletes the file (recoverable only from git history).',
  stale: 'Mark this item stale? It leaves the directory, the feeds, the homepage and related posts; its page, its link and the members feed stay (reversible).',
  unstale: 'Clear the stale mark? The item returns to public discovery.',
  unindex: 'Unindex this item? Its page asks search engines not to index it and it leaves the sitemap; the site still points at it (reversible).',
  reindex: 'Reindex this item? Search engines are allowed to index it again.',
};
// What a finished action does to the item's marks, so the next open offers the other half of the pair before the
// published /content-flags.json catches up (a rebuild, about 2 to 3 minutes).
const FLAG_AFTER = { stale: ['stale', true], unstale: ['stale', false], unindex: ['unindexed', true], reindex: ['unindexed', false] };

// One fetch of the published marks per page, shared by every menu on it, and only ever started for a superadmin. A
// failure is not kept, so the next menu retries; until then the menu offers both halves of each pair.
let FLAGS = null;
function loadFlags() {
  if (!FLAGS) {
    FLAGS = fetch(`${SITE}/content-flags.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`http-${r.status}`))))
      .then((d) => (d && typeof d.flags === 'object' && d.flags ? d.flags : {}))
      .catch(() => { FLAGS = null; return null; });
  }
  return FLAGS;
}

const DOTS = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg>';

// The panel and rows copy the avatar menu (extension/shell.css .me-menu / .mi); the shell's tokens reach this shadow
// root through inheritance, with the client-ui tokens as the fallback where a page does not define them.
const CSS = `
  :host { display:inline-flex; position:relative; }
  [hidden] { display:none !important; }
  .dots { display:inline-flex; align-items:center; justify-content:center; width:36px; height:36px; padding:0; border-radius:999px;
    border:1px solid var(--line-2, var(--line)); background:transparent; color:var(--muted); cursor:pointer; }
  .dots:hover, .dots[aria-expanded="true"] { color:var(--fg); border-color:var(--accent); background:transparent; }
  .dots:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
  .dots svg { width:18px; height:18px; fill:currentColor; }
  .menu { position:absolute; top:calc(100% + 8px); right:0; min-width:200px; z-index:80; padding:6px; display:flex; flex-direction:column;
    background:var(--paper, var(--panel)); border:1.5px solid var(--line-2, var(--line)); border-radius:var(--r-lg, 16px);
    box-shadow:var(--sh-md, 0 10px 28px -10px rgba(0,0,0,.22));
    /* The Glass layout makes --paper translucent and frosts the avatar menu with --glass-blur (extension/shell.css);
       that page rule cannot reach this shadow root, so the menu names it itself. Flat defines no --glass-blur: none. */
    -webkit-backdrop-filter:var(--glass-blur, none); backdrop-filter:var(--glass-blur, none); }
  .mi { display:block; width:100%; text-align:left; padding:8px 12px; border:0; border-radius:var(--r, 10px); background:transparent;
    color:var(--fg); font:inherit; font-size:14px; font-weight:500; cursor:pointer; white-space:nowrap; }
  .mi:hover, .mi:focus-visible { background:var(--green-tint); color:var(--green-700, var(--accent)); outline:none; }
  a.mi { box-sizing:border-box; text-decoration:none; }
  .mi-remove, .mi-remove:hover, .mi-remove:focus-visible { color:var(--danger, #c0392b); }
  .mi-remove:hover, .mi-remove:focus-visible { background:color-mix(in srgb, var(--danger, #c0392b) 10%, transparent); }
  .sep { height:1px; background:var(--line); margin:5px 4px; }
  .said { margin-left:8px; font-size:12px; font-weight:700; color:var(--muted); white-space:nowrap; align-self:center; }
`;

class GbtiModActions extends GbtiElement {
  connectedCallback() {
    this._role = 'member';
    this._viewer = ''; // the signed-in member's GBTI folder, to recognise the item's owner
    this._locked = true; // until status() says otherwise: a lapsed or unknown account gets no owner Edit
    this._flags = undefined; // undefined = not asked yet; null = could not read; { stale, unindexed } = known
    this._open = false;
    this._said = '';
    this._onDocClick = (e) => { if (this._open && !(e.composedPath?.() || []).includes(this)) this._setOpen(false); };
    this._onKey = (e) => this._key(e);
    super.connectedCallback?.();
    this._load();
  }

  disconnectedCallback() {
    this._unlisten();
    super.disconnectedCallback?.();
  }

  async _load() {
    // The host re-checks the role server-side; this read is only to decide what to SHOW. Fail closed to 'member' and
    // to no viewer (identity.username is the folder on both hosts, sow-428).
    try {
      const s = await this.client?.status?.();
      this._role = s?.role || 'member';
      this._viewer = String(s?.identity?.username || s?.username || '');
      this._locked = isLockedMembership(s?.membership);
    } catch { this._role = 'member'; this._viewer = ''; this._locked = true; }
    if (this._role === 'superadmin' && flagKeyFor(this.dataset.gbtiType, this.dataset.gbtiSlug)) {
      const all = await loadFlags();
      const key = flagKeyFor(this.dataset.gbtiType, this.dataset.gbtiSlug);
      this._flags = all ? { stale: all[key]?.stale === true, unindexed: all[key]?.unindexed === true } : null;
    }
    this.render();
  }

  _path() {
    return modPathFor({ type: this.dataset.gbtiType, author: this.dataset.gbtiAuthor, slug: this.dataset.gbtiSlug, id: this.dataset.gbtiId });
  }

  _actions() {
    return this._path() ? menuActions({ role: this._role, type: this.dataset.gbtiType, flags: this._flags ?? null }) : [];
  }

  // The Edit row's link, or null. The website opens its own WorkBench; anywhere else opens the website's in a new tab.
  _editLink() {
    const d = this.dataset;
    if (!canEditItem({ role: this._role, viewer: this._viewer, author: d.gbtiAuthor, locked: this._locked })) return null;
    const { base, newTab } = workbenchTarget(typeof location !== 'undefined' ? location : null);
    const href = editHrefFor({ type: d.gbtiType, author: d.gbtiAuthor, slug: d.gbtiSlug, id: d.gbtiId }, base);
    return href ? { href, newTab } : null;
  }

  render() {
    const actions = this._actions();
    const edit = this._editLink();
    if (!actions.length && !edit) { this._unlisten(); this.set(''); return; } // neither owner nor superadmin, or no path
    const editRow = edit
      ? `<a class="mi mi-edit" role="menuitem" data-edit href="${esc(edit.href)}"${edit.newTab ? ' target="_blank" rel="noopener"' : ''}>Edit</a>`
        + (actions.length ? '<div class="sep" role="separator"></div>' : '')
      : '';
    const rows = editRow + actions.map((a) => `${a === 'remove' && actions.length > 1 ? '<div class="sep" role="separator"></div>' : ''}`
      + `<button class="mi mi-${a}" type="button" role="menuitem" data-act="${a}">${ACTION_LABEL[a]}</button>`).join('');
    this.set(this.css(CSS)
      + `<button class="dots" type="button" data-dots aria-label="More actions" title="More actions" aria-haspopup="menu" aria-expanded="${this._open}">${DOTS}</button>`
      + `<div class="menu" role="menu" aria-label="More actions"${this._open ? '' : ' hidden'}>${rows}</div>`
      + (this._said ? `<span class="said" role="status">${this._said}</span>` : ''));
    this.$('[data-dots]')?.addEventListener('click', (e) => { e.stopPropagation(); this._setOpen(!this._open); });
    // The link itself navigates. A new tab leaves this page behind, so focus goes back to the button, as Escape does.
    this.$('[data-edit]')?.addEventListener('click', (e) => {
      const newTab = e.currentTarget?.target === '_blank';
      this._setOpen(false);
      if (newTab) this.$('[data-dots]')?.focus?.();
    });
    this.$$('[data-act]').forEach((b) => b.addEventListener('click', () => this._do(b.dataset.act)));
  }

  _setOpen(open) {
    this._open = open;
    const menu = this.$('.menu');
    const btn = this.$('[data-dots]');
    if (menu) menu.hidden = !open;
    if (btn) btn.setAttribute('aria-expanded', String(open));
    if (open) {
      document.addEventListener('click', this._onDocClick, true);
      document.addEventListener('keydown', this._onKey, true);
      this.$('.mi')?.focus?.();
    } else {
      this._unlisten();
    }
  }

  _unlisten() {
    if (typeof document === 'undefined') return;
    document.removeEventListener('click', this._onDocClick, true);
    document.removeEventListener('keydown', this._onKey, true);
  }

  // Esc closes and returns focus to the button; the arrow keys move between rows (Enter and Space press a row, as
  // any button does). The Edit row is a link, and Space on a link scrolls the page, so Space presses it here.
  _key(e) {
    if (!this._open) return;
    if (e.key === 'Escape') { e.preventDefault(); this._setOpen(false); this.$('[data-dots]')?.focus?.(); return; }
    if (e.key === ' ' && this.root?.activeElement?.matches?.('a.mi')) { e.preventDefault(); this.root.activeElement.click(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = this.$$('.mi');
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(this.root?.activeElement ?? null);
    const next = e.key === 'ArrowDown' ? (at + 1) % items.length : (at <= 0 ? items.length - 1 : at - 1);
    items[next]?.focus?.();
  }

  // Trigger the wired admin op; on success emit 'mod-action' (the host feed/reader can reload to drop a hidden item).
  // Fail-soft: a forbidden/error shows beside the button; nothing changes locally.
  async _do(act) {
    const path = this._path();
    if (!path) return;
    this._setOpen(false);
    if (typeof confirm === 'function' && !confirm(CONFIRM[act])) return;
    this._said = '...';
    this.render();
    try {
      await this.client.admin(ACTION_API[act], { path });
    } catch (err) {
      this._said = (err?.code === 'forbidden') ? 'Not permitted' : `${ACTION_LABEL[act]} failed`;
      this.render();
      return;
    }
    this._said = ACTION_DONE[act];
    const flip = FLAG_AFTER[act];
    if (flip && this._flags) this._flags = { ...this._flags, [flip[0]]: flip[1] }; // unknown marks stay unknown
    this.render();
    // Sent after the outcome is shown, outside the try: a host listener that throws must not turn a finished action
    // into "failed".
    this.dispatchEvent(new CustomEvent('mod-action', { detail: { action: act, path }, bubbles: true, composed: true }));
  }
}

define('gbti-mod-actions', GbtiModActions);
export { GbtiModActions };
