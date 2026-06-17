// <gbti-browse> (SOW-031): the in-extension content browser. Four tabs — Blog / Products / Prompts (each fetched
// from the per-type build-time index JSON over the extension's gbti.network host permission) + Shares (the
// existing authenticated <gbti-shares-feed>). A row opens <gbti-reader> in a detail pane IN the extension,
// never navigating to gbti.network. Host-agnostic. Fail-soft: an unreachable index renders an empty state.
import { GbtiElement, define, esc } from '../base.mjs';
import { parseBrowseHash } from '../browse-hash.mjs';
import { resolveAsset } from '../assets.mjs';
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
  .row .thumb { flex:none; width:46px; height:46px; object-fit:cover; border-radius:8px; background:var(--hover); border:1px solid var(--line); }
  .row .t { min-width:0; flex:1; }
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
    // Initialize state BEFORE super.connectedCallback(), which synchronously calls render() (base.mjs) -> _body()
    // dereferences this._cache/_tab, so they must exist first; otherwise a TypeError aborts the whole mount
    // (including _init below) and the page renders nothing.
    // SOW-031: the hash carries tab + an optional read=<repo path> deep-link (set by the new-tab feed rows), so a
    // click on a Latest/Following row lands here and auto-opens that item in the reader instead of gbti.network.
    const { tab, read } = parseBrowseHash(typeof location !== 'undefined' ? location.hash : '');
    this._tab = tab && TABS.some((t) => t.id === tab) ? tab : 'post';
    this._openPath = this._tab !== 'share' ? read : null; // shares have no path-addressed reader item
    this._cache = {};
    this._reading = null;
    super.connectedCallback?.(); // base now renders the initial list with fields in place
    // Hide a thumbnail that fails to load (a stale /_astro hash after a site redeploy, or a missing asset) so the
    // row shows no image instead of a broken-image icon. CSP forbids inline onerror, and img error events do not
    // bubble, so a single capture-phase listener on the shadow root covers every (re-)rendered list.
    this.root?.addEventListener('error', (e) => {
      const t = e.target;
      if (t && t.tagName === 'IMG' && t.classList?.contains('thumb')) t.style.display = 'none';
    }, true);
    this._init();
  }

  // Load the active tab's index, then (if deep-linked via read=<path>) open that item in the reader.
  async _init() {
    await this._ensure(this._tab);
    if (this._openPath) {
      const found = (this._cache[this._tab] || []).find((x) => x.path === this._openPath);
      // Found -> open the rich index item; not found (race / pruned) -> a minimal item the reader fetches by path.
      this._reading = found || { type: this._tab, path: this._openPath };
      this._openPath = null;
      this.render();
    }
  }

  async _ensure(id) {
    const tab = TABS.find((t) => t.id === id);
    if (!tab?.json || this._cache[id]) return;
    try {
      const res = await fetch(`${SITE}/${tab.json}`, { cache: 'no-cache' });
      this._cache[id] = res.ok ? ((await res.json()).items || []) : [];
    } catch { this._cache[id] = []; }
    // Do not flash the list when a deep-link open is pending (_init will render the reader next).
    if (this._tab === id && !this._reading && !this._openPath) this.render();
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
    const items = this._cache?.[this._tab]; // optional chain: never throw if render runs before init
    if (!items) return `<p class="empty">Loading...</p>`;
    if (!items.length) return `<p class="empty">Nothing here yet.</p>`;
    return `<ul class="rows">${items.map((it, i) => {
      const thumb = resolveAsset(it.thumb);
      const img = thumb ? `<img class="thumb" src="${esc(thumb)}" alt="" loading="lazy">` : '';
      return `<li class="row" data-open="${i}">${img}
      <span class="t"><b>${esc(it.title)}</b>${it.excerpt ? `<span class="ex">${esc(it.excerpt)}</span>` : ''}<span class="meta">${esc(authorName(it.author))}${it.visibility === 'members' ? ' · members' : ''}</span></span>
      <span class="go">Read &rarr;</span></li>`;
    }).join('')}</ul>`;
  }
}

define('gbti-browse', GbtiBrowse);
export { GbtiBrowse };
