// <gbti-saved> (SOW-037): the member's saved-items management surface (favorites + collections), shown in the
// workspace "Saved" tab. Reads the deletable edge store via client.getActivity() ({ favorites, collections }) and
// resolves each saved { type, slug } to a title via the per-type content index JSONs (the same indexes
// gbti-browse fetches). Manage actions write through the existing SOW-024 ops: toggleFavorite (remove),
// addToCollection (remove item), createCollection / renameCollection / deleteCollection. Host-agnostic + inert in
// public (no client -> a sign-in nudge). The GitHub token never reaches the page (the host holds it).
import { GbtiElement, define, esc } from '../base.mjs';
import { buildItemIndex, resolveItem, groupFavoritesByType, indexFileFor, typeLabel, SAVED_TYPES } from '../saved-core.mjs';

const SITE = 'https://gbti.network';

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .sec { margin:0 0 26px; }
  .sec h3 { font-size:15px; margin:0 0 12px; }
  .grp { margin:0 0 14px; }
  .grp h4 { font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin:0 0 6px; }
  ul.rows { list-style:none; margin:0; padding:0; }
  .row { display:flex; align-items:center; gap:10px; padding:9px 2px; border-top:1px solid var(--line); }
  .row:first-child { border-top:0; }
  .row .t { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--fg); text-decoration:none; font-weight:600; font-size:14px; }
  a.t:hover { color:var(--accent); }
  .badge { flex:none; font-size:11px; color:var(--muted); background:var(--hover); border-radius:999px; padding:2px 9px; }
  .lk { flex:none; background:none; border:0; font:inherit; font-size:13px; font-weight:600; color:var(--accent); cursor:pointer; padding:4px 6px; border-radius:6px; }
  .lk:hover { background:var(--hover); }
  .lk.danger { color:var(--danger); }
  .coll { border:1px solid var(--line); border-radius:12px; padding:12px 14px; margin:0 0 12px; }
  .coll-h { display:flex; align-items:center; gap:10px; margin:0 0 6px; }
  .coll-nm { font-size:14.5px; }
  .coll-ct { font-size:12px; color:var(--muted); }
  .coll-act { margin-left:auto; display:flex; gap:2px; }
  .empty { color:var(--muted); font-size:13px; padding:6px 2px; list-style:none; }
  .muted { color:var(--muted); font-size:14px; }
  .newc { display:flex; gap:8px; margin-top:10px; }
  .newc input { flex:1; min-width:0; font:inherit; font-size:13.5px; padding:8px 10px; border:1px solid var(--line); border-radius:8px; background:var(--panel); color:var(--fg); }
  .btn { flex:none; font:inherit; font-weight:600; font-size:13px; padding:8px 14px; border:0; border-radius:8px; background:var(--accent); color:#fff; cursor:pointer; }
  .busy { opacity:.6; pointer-events:none; }
`;

class GbtiSaved extends GbtiElement {
  connectedCallback() {
    this._activity = null; // { favorites, collections, error? }
    this._index = null; // Map "type:slug" -> item
    this._busy = false;
    super.connectedCallback?.();
    this._load();
  }

  async _load() {
    if (!this.client) { this.render(); return; }
    await this._reloadActivity(false);
    // Resolve titles from the per-type indexes (best-effort; a missing entry falls back to its slug).
    try {
      const perType = {};
      await Promise.all(SAVED_TYPES.map(async (t) => {
        const file = indexFileFor(t);
        if (!file) return;
        const res = await fetch(`${SITE}/${file}`, { cache: 'no-cache' });
        perType[t] = res.ok ? ((await res.json()).items || []) : [];
      }));
      this._index = buildItemIndex(perType);
    } catch { this._index = buildItemIndex({}); }
    this.render();
  }

  async _reloadActivity(rerender = true) {
    try {
      const a = await this.client.getActivity();
      this._activity = { favorites: a?.favorites || [], collections: a?.collections || [] };
    } catch (err) {
      this._activity = { favorites: [], collections: [], error: err?.code || 'error' };
    }
    if (rerender) this.render();
  }

  render() {
    if (!this.client) { this.set(this.css(CSS) + `<p class="muted">Sign in with the GBTI client to manage your saved items.</p>`); return; }
    if (!this._activity) { this.set(this.css(CSS) + `<p class="muted">Loading your saved items...</p>`); return; }
    if (this._activity.error === 'not-authenticated') { this.set(this.css(CSS) + `<p class="muted">Sign in to manage favorites and collections.</p>`); return; }
    const idx = this._index || buildItemIndex({});

    const favGroups = groupFavoritesByType(this._activity.favorites);
    const favHtml = favGroups.length
      ? favGroups.map((g) => `<div class="grp"><h4>${esc(typeLabel(g.type))}</h4><ul class="rows">${g.items.map((f) => this._itemRow(resolveItem(idx, f.type, f.slug), { fav: true })).join('')}</ul></div>`).join('')
      : `<p class="muted">No favorites yet. Tap the heart on any article, product, or prompt to save it here.</p>`;

    const colls = this._activity.collections;
    const collHtml = colls.length
      ? colls.map((c) => `<div class="coll">
          <div class="coll-h"><b class="coll-nm">${esc(c.name)}</b><span class="coll-ct">${(c.items || []).length} item${(c.items || []).length === 1 ? '' : 's'}</span>
            <span class="coll-act"><button class="lk" data-rename data-cid="${esc(c.id)}" type="button">Rename</button><button class="lk danger" data-del data-cid="${esc(c.id)}" type="button">Delete</button></span></div>
          <ul class="rows">${(c.items || []).length ? (c.items || []).map((it) => this._itemRow(resolveItem(idx, it.type, it.slug), { cid: c.id })).join('') : '<li class="empty">Empty collection.</li>'}</ul>
        </div>`).join('')
      : `<p class="muted">No collections yet. Use "Save to a collection" on any item to start one.</p>`;

    this.set(this.css(CSS) + `<div class="${this._busy ? 'busy' : ''}">
      <section class="sec"><h3>Favorites</h3>${favHtml}</section>
      <section class="sec"><h3>Collections</h3>${collHtml}
        <div class="newc"><input type="text" placeholder="New collection name" maxlength="80" data-newc /><button class="btn" data-newc-go type="button">Create</button></div>
      </section></div>`);
    this._wire();
  }

  _itemRow(item, { fav, cid } = {}) {
    const title = esc(item.title);
    const t = item.url ? `<a class="t" href="${SITE}${esc(item.url)}" target="_blank" rel="noopener">${title}</a>` : `<span class="t">${title}</span>`;
    const rm = fav
      ? `<button class="lk danger" data-unfav data-type="${esc(item.type)}" data-slug="${esc(item.slug)}" type="button">Remove</button>`
      : `<button class="lk danger" data-rmitem data-cid="${esc(cid)}" data-type="${esc(item.type)}" data-slug="${esc(item.slug)}" type="button">Remove</button>`;
    return `<li class="row"><span class="badge">${esc(typeLabel(item.type))}</span>${t}${rm}</li>`;
  }

  _wire() {
    this.$$('[data-unfav]').forEach((b) => b.addEventListener('click', () => this._run(() => this.client.toggleFavorite({ targetType: b.dataset.type, targetSlug: b.dataset.slug, on: false }))));
    this.$$('[data-rmitem]').forEach((b) => b.addEventListener('click', () => this._run(() => this.client.addToCollection({ id: b.dataset.cid, targetType: b.dataset.type, targetSlug: b.dataset.slug, on: false }))));
    this.$$('[data-rename]').forEach((b) => b.addEventListener('click', () => {
      const name = (typeof prompt === 'function' ? prompt('Rename collection') : '') || '';
      if (name.trim()) this._run(() => this.client.renameCollection({ id: b.dataset.cid, name: name.trim() }));
    }));
    this.$$('[data-del]').forEach((b) => b.addEventListener('click', () => {
      if (typeof confirm !== 'function' || confirm('Delete this collection? The saved items stay; only the list is removed.')) {
        this._run(() => this.client.deleteCollection({ id: b.dataset.cid }));
      }
    }));
    const input = this.$('[data-newc]');
    const create = () => { const n = (input?.value || '').trim(); if (n) this._run(() => this.client.createCollection({ name: n })); };
    this.on('[data-newc-go]', 'click', create);
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
  }

  // Run a mutation, then refetch the activity (the edge store is the source of truth). Fail-soft.
  async _run(fn) {
    this._busy = true; this.render();
    try { await fn(); } catch (err) { /* fail-soft; the refetch reflects the true state */ }
    this._busy = false;
    await this._reloadActivity();
  }
}

define('gbti-saved', GbtiSaved);
export { GbtiSaved };
