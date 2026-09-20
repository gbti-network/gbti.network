// <gbti-share-list> (sow-304): the member's OWN shares in the WorkBench, modelled on <gbti-content-list>. Each
// row carries the date, the audience, the title (or the note's first line), the state (Published or Removed),
// a View button for a published public share, and Edit, which emits `gbti-edit-share` with the summary so the
// page can open the share composer in edit mode (the composer is the editor; see share-post-core.mjs). A
// deep link `#tab=share&edit-share=<id>` sets the `edit-id` attribute; once the list has loaded it emits the
// edit for that row ONCE and drops the attribute. Self-loading and inert without a client, like the inbox.
//
// sow-377: paged at 15 a row, the same size and pager shape the content tabs use, sharing one page-window
// helper with them. In Network scope (`scope="network"`, superadmin) this list is every share on the
// network, and it used to render all of them in one scroll.

import { GbtiElement, define, esc } from '../base.mjs';
import { shareRowState, sharePublicUrl } from '../share-post-core.mjs';
import { relTime, absTime } from '../time-core.mjs';
import { pageWindow, WORKSPACE_PAGE_SIZE } from '../workspace-core.mjs';

class GbtiShareList extends GbtiElement {
  static get observedAttributes() { return ['edit-id', 'scope']; }

  /** sow-317: `scope="network"` lists EVERY member's shares (superadmin, through client.networkShares). */
  _network() { return this.getAttribute('scope') === 'network' && typeof this.client?.networkShares === 'function'; }

  connectedCallback() {
    this._items = null;
    this._error = '';
    this._page = 0; // sow-377: client-side paging, like the content tabs
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
    // sow-377: page the list. In Network scope this is every share on the network, which ran to hundreds of
    // rows in one scroll. `data-i` stays the index into the FULL list, so a row action on page two still
    // reaches its own item.
    const w = pageWindow(items?.length || 0, this._page, WORKSPACE_PAGE_SIZE);
    const body = items === null
      ? `<p class="muted">Loading your shares...</p>`
      : items.length === 0
        ? `<p class="muted">${this._error ? esc(this._error) : 'No shares yet. Use the share bar above to post your first one.'}</p>`
        : `<ul class="list">${items.slice(w.start, w.end).map((it, j) => this.rowHtml(it, w.start + j)).join('')}</ul>`
          + this.pagerHtml(w);
    this.set(this.css(`
      .row { align-items: flex-start; gap: 10px; }
      .sh-main { min-width: 0; flex: 1 1 auto; }
      .sh-t { display: block; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .sh-m { display: block; font-size: 12px; color: var(--fg-mute, #888); margin-top: 2px; }
      .rowacts { display: inline-flex; gap: 6px; flex: none; }
      .tag.muted { opacity: .7; }
      .pager { display: flex; align-items: center; justify-content: center; gap: 14px; margin: 16px 0 2px; }
      .pager-n { font-size: 12.5px; color: var(--muted); font-family: var(--font-mono, monospace); }
      /* This element has its own shadow root, so the workspace's .btn rules do not reach it. BASE_CSS gives a
         bare button a brand fill and its own :hover, and button.ghost lands AFTER that hover rule at equal
         specificity, which leaves a ghost button with no hover feedback at all. Hence an explicit one here. */
      .pgb { flex: none; border: 1px solid var(--line); background: var(--panel); color: var(--fg);
        border-radius: 8px; font: inherit; font-weight: 600; font-size: 13px; padding: 6px 13px; cursor: pointer; }
      .pgb:hover { background: var(--panel); border-color: var(--accent); color: var(--accent); }
      .pgb[disabled] { opacity: .42; cursor: default; }
      .pgb[disabled]:hover { background: var(--panel); border-color: var(--line); color: var(--fg); }
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
    this.$$('button[data-page]').forEach((b) => b.addEventListener('click', () => {
      if (b.hasAttribute('disabled')) return;
      this._page = Number(b.dataset.page) || 0;
      this.render();
      // The list can be taller than the viewport, so paging from the foot would otherwise leave the reader
      // looking at the pager of a list whose new first row is off the top of the screen.
      this.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }));
  }

  /** sow-377: Prev / Page N of M / Next, in the same shape the content tabs use. Nothing when there is one page. */
  pagerHtml({ page, pages }) {
    if (pages <= 1) return '';
    return `<div class="pager">`
      + `<button class="pgb" data-page="${page - 1}" type="button"${page === 0 ? ' disabled' : ''}>&larr; Prev</button>`
      + `<span class="pager-n">Page ${page + 1} of ${pages}</span>`
      + `<button class="pgb" data-page="${page + 1}" type="button"${page >= pages - 1 ? ' disabled' : ''}>Next &rarr;</button>`
      + `</div>`;
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
