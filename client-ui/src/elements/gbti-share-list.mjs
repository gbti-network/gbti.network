// <gbti-share-list> (sow-304): the member's OWN shares in the WorkBench, modelled on <gbti-content-list>. Each
// row carries the date, the audience, the title (or the note's first line), the state (Published or Removed),
// a View button for a published public share, and Edit, which emits `gbti-edit-share` with the summary so the
// page can open the share composer in edit mode (the composer is the editor; see share-post-core.mjs). A
// deep link `#tab=share&edit-share=<id>` sets the `edit-id` attribute; once the list has loaded it emits the
// edit for that row ONCE and drops the attribute. Self-loading and inert without a client, like the inbox.

import { GbtiElement, define, esc } from '../base.mjs';
import { shareRowState, sharePublicUrl } from '../share-post-core.mjs';
import { relTime, absTime } from '../time-core.mjs';

class GbtiShareList extends GbtiElement {
  static get observedAttributes() { return ['edit-id', 'scope']; }

  /** sow-317: `scope="network"` lists EVERY member's shares (superadmin, through client.networkShares). */
  _network() { return this.getAttribute('scope') === 'network' && typeof this.client?.networkShares === 'function'; }

  connectedCallback() {
    this._items = null;
    this._error = '';
    super.connectedCallback?.();
    this.reload();
  }

  /** Re-read the list (the page calls this after an edit lands). */
  async reload() {
    if (!this.client || typeof this.client.myShares !== 'function') { this._items = null; this.render(); return; }
    try {
      const r = this._network() ? await this.client.networkShares() : await this.client.myShares();
      this._items = Array.isArray(r?.items) ? r.items : [];
      this._error = '';
    } catch (err) {
      this._items = [];
      this._error = err?.message ? String(err.message) : 'could not load your shares';
    }
    this.render();
    if (!this.isConnected) return; // a superseded instance (the workspace re-rendered): its events would reach nobody
    const consumed = this._consumePendingEdit();
    // The workspace keeps the deep-link id until a LIVE list has looked for it (it re-mounts this element on
    // every render, and an early instance can be replaced before its load returns), then drops it on this.
    this.emit('gbti-share-list-loaded', { count: Array.isArray(this._items) ? this._items.length : 0, consumed });
  }

  /** Emit the pending deep-link edit once. Returns the id it emitted, or null. */
  _consumePendingEdit() {
    const want = this.getAttribute('edit-id');
    if (!want || !Array.isArray(this._items)) return null;
    const it = this._items.find((s) => String(s.id) === want);
    this.removeAttribute('edit-id');
    if (!it) return null;
    this.emit('gbti-edit-share', { ...it });
    return want;
  }

  render() {
    const items = this._items;
    const body = items === null
      ? `<p class="muted">Loading your shares...</p>`
      : items.length === 0
        ? `<p class="muted">${this._error ? esc(this._error) : 'No shares yet. Use the share bar above to post your first one.'}</p>`
        : `<ul class="list">${items.map((it, i) => this.rowHtml(it, i)).join('')}</ul>`;
    this.set(this.css(`
      .row { align-items: flex-start; gap: 10px; }
      .sh-main { min-width: 0; flex: 1 1 auto; }
      .sh-t { display: block; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .sh-m { display: block; font-size: 12px; color: var(--fg-mute, #888); margin-top: 2px; }
      .rowacts { display: inline-flex; gap: 6px; flex: none; }
      .tag.muted { opacity: .7; }
    `) + `<div class="panel">
           <h2>${this._network() ? 'Network shares' : 'My shares'}</h2>
           ${body}
         </div>`);
    this.$$('button[data-i]').forEach((b) => b.addEventListener('click', () => {
      const it = items?.[Number(b.dataset.i)];
      if (it) this.emit('gbti-edit-share', { ...it });
    }));
    this.$$('button[data-view]').forEach((b) => b.addEventListener('click', () => {
      const url = b.dataset.view;
      if (url) window.open(url, '_blank', 'noopener');
    }));
  }

  rowHtml(it, i) {
    const state = shareRowState(it);
    const vis = String(it.visibility ?? 'members') === 'public' ? 'public' : 'members';
    const url = sharePublicUrl(it);
    const title = it.title || (it.shortDescription ? String(it.shortDescription) : '') || (it.body ? String(it.body).split('\n')[0] : '') || (it.url ? String(it.url) : '') || it.id;
    const when = it.createdAt ? `<time datetime="${esc(it.createdAt)}" title="${esc(absTime(it.createdAt))}">${esc(relTime(it.createdAt))}</time>` : '';
    const edited = it.updatedAt ? ` <span class="muted">(edited ${esc(relTime(it.updatedAt))})</span>` : '';
    const view = url ? `<button class="ghost" data-view="${esc(url)}" title="Open the live public page in a new tab">View</button>` : '';
    const who = this._network() && it.author ? `<span class="tag who">@${esc(String(it.author))}</span> ` : ''; // sow-317
    return `<li class="row">
      <span class="sh-main"><span class="sh-t">${esc(title)}</span><span class="sh-m">${who}${when}${edited} <span class="tag ${state.tone}">${esc(state.label)}</span> <span class="tag">${vis}</span></span></span>
      <span class="rowacts">${view}<button class="ghost" data-i="${i}">Edit</button></span>
    </li>`;
  }
}

define('gbti-share-list', GbtiShareList);
export { GbtiShareList };
