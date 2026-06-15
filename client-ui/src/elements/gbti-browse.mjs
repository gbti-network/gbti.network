// <gbti-browse> (SOW-031): the in-extension content browser. Four tabs — Blog / Products / Prompts (each fetched
// from the per-type build-time index JSON over the extension's gbti.network host permission) + Shares (the
// existing authenticated <gbti-shares-feed>). A row opens <gbti-reader> in a detail pane IN the extension,
// never navigating to gbti.network. Host-agnostic. Fail-soft: an unreachable index renders an empty state.
import { GbtiElement, define, esc } from '../base.mjs';
import './gbti-reader.mjs';
import './gbti-shares-feed.mjs';

const SITE = 'https://gbti.network';
const TABS = [
  { id: 'post', label: 'Blog', json: 'blog-index.json' },
  { id: 'product', label: 'Products', json: 'products-index.json' },
  { id: 'prompt', label: 'Prompts', json: 'prompts-index.json' },
  { id: 'share', label: 'Shares' },
];
const authorName = (a) => (a === 'gbti' ? 'GBTI Network' : a);

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .tabs { display:flex; gap:4px; background:var(--panel); border:1px solid var(--line); border-radius:999px; padding:4px; margin:0 0 16px; flex-wrap:wrap; }
  .tab { border:0; background:transparent; color:var(--muted); font:inherit; font-weight:700; font-size:13px; padding:7px 15px; border-radius:999px; cursor:pointer; }
  .tab.on { background:var(--hover); color:var(--accent); }
  ul.rows { list-style:none; margin:0; padding:0; }
  .row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:13px 2px; border-top:1px solid var(--line); cursor:pointer; }
  .row:first-child { border-top:0; }
  .row:hover { background:var(--hover); }
  .row .t { min-width:0; }
  .row .t b { display:block; font-size:15px; }
  .row .t .ex { display:block; color:var(--muted); font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .row .t .meta { color:var(--muted); font-size:12px; margin-top:2px; }
  .row .go { flex:none; color:var(--accent); font-size:13px; font-weight:700; }
  .empty { color:var(--muted); padding:18px 2px; }
  .btn { border:1px solid var(--line); background:var(--panel); color:var(--fg); border-radius:8px; font:inherit; font-weight:600; font-size:13px; padding:6px 13px; cursor:pointer; margin:0 0 14px; }
  .btn:hover { border-color:var(--accent); color:var(--accent); }
`;

class GbtiBrowse extends GbtiElement {
  connectedCallback() {
    super.connectedCallback?.();
    const m = (typeof location !== 'undefined' ? location.hash : '').match(/tab=([a-z]+)/);
    this._tab = m && TABS.some((t) => t.id === m[1]) ? m[1] : 'post';
    this._cache = {};
    this._reading = null;
    this.render();
    this._ensure(this._tab);
  }

  async _ensure(id) {
    const tab = TABS.find((t) => t.id === id);
    if (!tab?.json || this._cache[id]) return;
    try {
      const res = await fetch(`${SITE}/${tab.json}`, { cache: 'no-cache' });
      this._cache[id] = res.ok ? ((await res.json()).items || []) : [];
    } catch { this._cache[id] = []; }
    if (this._tab === id && !this._reading) this.render();
  }

  render() {
    if (this._reading) {
      const label = TABS.find((t) => t.id === this._reading.type)?.label || 'list';
      this.set(this.css(CSS) + `<button class="btn" data-back type="button">&larr; Back to ${esc(label)}</button><div data-reader></div>`);
      this.on('[data-back]', 'click', () => { this._reading = null; this.render(); this._ensure(this._tab); });
      const host = this.$('[data-reader]');
      const r = document.createElement('gbti-reader');
      host.replaceChildren(r);
      r.open(this._reading);
      return;
    }
    const tabs = TABS.map((t) => `<button class="tab ${t.id === this._tab ? 'on' : ''}" data-tab="${t.id}" type="button">${esc(t.label)}</button>`).join('');
    this.set(this.css(CSS) + `<div class="tabs" role="tablist">${tabs}</div><div data-body>${this._body()}</div>`);
    this.$$('[data-tab]').forEach((b) => b.addEventListener('click', () => { this._tab = b.dataset.tab; this.render(); this._ensure(this._tab); }));
    if (this._tab !== 'share') {
      this.$$('[data-open]').forEach((el) => el.addEventListener('click', () => {
        const it = (this._cache[this._tab] || [])[Number(el.dataset.open)];
        if (it) { this._reading = it; this.render(); }
      }));
    }
  }

  _body() {
    if (this._tab === 'share') return `<gbti-shares-feed></gbti-shares-feed>`;
    const items = this._cache[this._tab];
    if (!items) return `<p class="empty">Loading...</p>`;
    if (!items.length) return `<p class="empty">Nothing here yet.</p>`;
    return `<ul class="rows">${items.map((it, i) => `<li class="row" data-open="${i}">
      <span class="t"><b>${esc(it.title)}</b>${it.excerpt ? `<span class="ex">${esc(it.excerpt)}</span>` : ''}<span class="meta">${esc(authorName(it.author))}${it.visibility === 'members' ? ' · members' : ''}</span></span>
      <span class="go">Read &rarr;</span></li>`).join('')}</ul>`;
  }
}

define('gbti-browse', GbtiBrowse);
export { GbtiBrowse };
