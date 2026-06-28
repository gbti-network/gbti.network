// <gbti-mod-actions> (SOW-071): the shared per-item moderation control, on every content type (post/product/prompt
// in the reader, share in the shares feed). Role-gated UX: renders NOTHING below moderator, Hide/Unhide at moderator+,
// +Remove at admin+. Keyed on data-gbti-type/-author/-slug/-id; it builds the canonical members/<author>/... path
// itself (mod-actions-core modPathFor) and calls client.admin(action, {path}). The client gate is UX-only: the host
// re-derives the actor role from house/roles.yml + re-validates the path (admin-ops requireRole +
// requireMemberContentPath), and CODEOWNERS + the SOW-005 gate enforce the merge. Factored from gbti-shares-feed._hide.
import { GbtiElement, define } from '../base.mjs';
import { modPathFor, visibleActions } from '../mod-actions-core.mjs';

const ACTION_LABEL = { hide: 'Hide', unhide: 'Unhide', remove: 'Remove' };
const ACTION_API = { hide: 'deplatform', unhide: 'republish', remove: 'remove' };
const ACTION_DONE = { hide: 'Hidden', unhide: 'Republished', remove: 'Removed' };
const CONFIRM = {
  hide: 'Hide this item? It is set to draft and removed from public view (reversible).',
  unhide: 'Republish this item? It returns to public view.',
  remove: 'Remove this item? This deletes the file (recoverable only from git history).',
};

const CSS = `
  :host { display:inline-flex; }
  .mod { display:inline-flex; gap:6px; align-items:center; }
  .ma { font:inherit; font-size:12px; font-weight:700; color:var(--muted); background:transparent; border:1px solid var(--line); border-radius:6px; padding:4px 9px; cursor:pointer; }
  .ma:hover { color:var(--fg); border-color:var(--accent); }
  .ma-remove { color:#c0392b; }
  .ma-remove:hover { border-color:#c0392b; }
  .ma[disabled] { opacity:.6; cursor:default; }
`;

class GbtiModActions extends GbtiElement {
  connectedCallback() {
    this._role = 'member';
    super.connectedCallback?.();
    this._load();
  }

  async _load() {
    // The host re-checks the role server-side; this read is only to decide what to SHOW. Fail closed to 'member'.
    try { this._role = (await this.client?.status?.())?.role || 'member'; } catch { this._role = 'member'; }
    this.render();
  }

  _path() {
    return modPathFor({ type: this.dataset.gbtiType, author: this.dataset.gbtiAuthor, slug: this.dataset.gbtiSlug, id: this.dataset.gbtiId });
  }

  render() {
    const path = this._path();
    const actions = path ? visibleActions(this._role) : [];
    if (!actions.length) { this.set(''); return; } // below moderator, or an unresolvable / non-member path
    const btns = actions.map((a) => `<button class="ma ma-${a}" type="button" data-act="${a}">${ACTION_LABEL[a]}</button>`).join('');
    this.set(this.css(CSS) + `<span class="mod">${btns}</span>`);
    this.$$('[data-act]').forEach((b) => b.addEventListener('click', () => this._do(b.dataset.act)));
  }

  // Trigger the wired admin op; on success emit 'mod-action' (the host feed/reader can reload to drop a hidden item).
  // Fail-soft: a forbidden/error shows inline; nothing changes locally.
  async _do(act) {
    const path = this._path();
    if (!path) return;
    if (typeof confirm === 'function' && !confirm(CONFIRM[act])) return;
    const btn = this.$(`[data-act="${act}"]`);
    if (btn) { btn.disabled = true; btn.textContent = '...'; }
    try {
      await this.client.admin(ACTION_API[act], { path });
      if (btn) btn.textContent = ACTION_DONE[act];
      this.dispatchEvent(new CustomEvent('mod-action', { detail: { action: act, path }, bubbles: true, composed: true }));
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = (err?.code === 'forbidden') ? 'Not permitted' : `${ACTION_LABEL[act]} failed`; }
    }
  }
}

define('gbti-mod-actions', GbtiModActions);
export { GbtiModActions };
