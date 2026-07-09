// <gbti-browse> (SOW-031): the in-extension content browser. Four tabs — Blog / Products / Prompts (each fetched
// from the per-type build-time index JSON over the extension's gbti.network host permission) + Shares (the
// existing authenticated <gbti-shares-feed>). A row opens <gbti-reader> in a detail pane IN the extension,
// never navigating to gbti.network. Host-agnostic. Fail-soft: an unreachable index renders an empty state.
import { GbtiElement, define, esc } from '../base.mjs';
import { parseBrowseHash, stripDoParam } from '../browse-hash.mjs';
import { mergeAll, canSeeShares } from '../all-merge.mjs'; // SOW-042: the shared All directory merge + Shares policy
import './gbti-reader.mjs';
import './gbti-shares-feed.mjs';
import './gbti-news.mjs'; // SOW-043: the members-only news section (its own self-loading tab)
import './gbti-card-list.mjs'; // SOW-041: the shared content-item presentation
import { primaryChips, subChips, filterByCategoryPath } from '../browse-filter-core.mjs'; // SOW-054: the category drill-down

const SITE = 'https://gbti.network';
// SOW-042: "All" is the first tab — the UNCAPPED cross-type directory (the three per-type indexes + Shares).
const TABS = [
  { id: 'all', label: 'All' },
  { id: 'post', label: 'Articles', json: 'blog-index.json' },
  { id: 'product', label: 'Products', json: 'products-index.json' },
  { id: 'prompt', label: 'Prompts', json: 'prompts-index.json' },
  { id: 'share', label: 'Shares' },
  { id: 'news', label: 'News' }, // SOW-043: a self-loading members-only feed (not a per-type index)
];
const CONTENT_TYPES = ['post', 'product', 'prompt'];

// SOW-114: one-shot semantics for a do= force-action — replace the hash WITHOUT it so a refresh or the
// hashchange listener never re-runs the action. replaceState adds no history entry and fires no hashchange.
function consumeDo() {
  if (typeof location === 'undefined' || typeof history === 'undefined') return;
  const rest = stripDoParam(location.hash);
  try { history.replaceState(null, '', location.pathname + location.search + (rest ? '#' + rest : '')); } catch { /* fail-soft */ }
}
const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .tabs { display:flex; gap:4px; background:var(--panel); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); border:1px solid var(--line); border-radius:999px; padding:4px; margin:0 0 16px; flex-wrap:wrap; }
  .tab { border:0; background:transparent; color:var(--muted); font:inherit; font-weight:700; font-size:13px; padding:7px 15px; border-radius:999px; cursor:pointer; }
  .tab.on { background:var(--hover); color:var(--accent); }
  ul.rows { list-style:none; margin:0; padding:0; }
  .row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:13px 2px; border-top:1px solid var(--line); cursor:pointer; }
  .row:first-child { border-top:0; }
  .row:hover { background:var(--hover); }
  .row .thumb { flex:none; width:46px; height:46px; object-fit:cover; border-radius:8px; background:var(--hover); border:1px solid var(--line); }
  /* Category-glyph fallback (no image): a rounded square with the category accent gradient + a white glyph,
     matching the main app's PromptCard .kglyph. --ka is set inline per row from cat-glyph.mjs. */
  .row .thumb.glyph { display:flex; align-items:center; justify-content:center; border:0; color:#fff;
    background:linear-gradient(145deg, color-mix(in srgb, var(--ka) 66%, white), var(--ka)); }
  .row .thumb.glyph svg { width:24px; height:24px; }
  .row .t { min-width:0; flex:1; }
  .row .t b { display:block; font-size:15px; }
  .row .t .ex { display:block; color:var(--muted); font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .row .t .meta { color:var(--muted); font-size:12px; margin-top:2px; }
  .row .go { flex:none; color:var(--accent); font-size:13px; font-weight:700; }
  .empty { color:var(--muted); padding:18px 2px; }
  .btn { border:1px solid var(--line); background:var(--panel); color:var(--fg); border-radius:8px; font:inherit; font-weight:600; font-size:13px; padding:6px 13px; cursor:pointer; margin:0 0 14px; }
  .btn:hover { border-color:var(--accent); color:var(--accent); }
  /* SOW-054: the category drill-down chip rows (primary, then subcategory when a primary is selected). */
  .cchips { display:flex; flex-wrap:wrap; gap:6px; margin:0 0 12px; }
  .cchips.sub { margin-top:-4px; }
  .cchip { font:inherit; font-size:12.5px; font-weight:600; color:var(--muted); background:var(--panel); border:1px solid var(--line); border-radius:999px; padding:5px 12px; cursor:pointer; }
  .cchip:hover { color:var(--fg); border-color:var(--accent); }
  .cchip.on { color:#fff; background:var(--accent); border-color:var(--accent); }
  .cchip .n { opacity:.7; font-variant-numeric:tabular-nums; margin-left:4px; }
`;

class GbtiBrowse extends GbtiElement {
  connectedCallback() {
    // Initialize state BEFORE super.connectedCallback(), which synchronously calls render() (base.mjs) -> _body()
    // dereferences this._cache/_tab, so they must exist first; otherwise a TypeError aborts the whole mount
    // (including _init below) and the page renders nothing.
    // SOW-031: the hash carries tab + an optional read=<repo path> deep-link (set by the new-tab feed rows), so a
    // click on a Latest/Following row lands here and auto-opens that item in the reader instead of gbti.network.
    const { tab, read, action } = parseBrowseHash(typeof location !== 'undefined' ? location.hash : '');
    // SOW-042: a bare browse.html (e.g. the site header's "Browse the co-op") lands on the All directory.
    this._tab = tab && TABS.some((t) => t.id === tab) ? tab : 'all';
    this._openPath = (this._tab !== 'share' && this._tab !== 'all' && this._tab !== 'news') ? read : null; // shares/all/news have no path-addressed reader item
    this._openDo = this._openPath ? action : null; // SOW-114: the deep-link force-action (do=favorite|collect)
    if (this._openDo) consumeDo(); // one-shot: strip do= from the hash so refresh/hashchange never re-runs it
    this._cache = {};
    this._cat = []; // SOW-054: the selected category drill-down path ([] = All; [primary]; [primary, sub])
    this._shares = null; // SOW-042: raw Shares for the All tab, fetched once (member-gated)
    this._membership = null; // SOW-042: effective status for the Shares-omission policy
    this._reading = null;
    super.connectedCallback?.(); // base now renders the initial list with fields in place
    // Hide a thumbnail that fails to load (a stale /_astro hash after a site redeploy, or a missing asset) so the
    // row shows no image instead of a broken-image icon. CSP forbids inline onerror, and img error events do not
    // bubble, so a single capture-phase listener on the shadow root covers every (re-)rendered list.
    this.root?.addEventListener('error', (e) => {
      const t = e.target;
      if (t && t.tagName === 'IMG' && t.classList?.contains('thumb')) t.style.display = 'none';
    }, true);
    // SOW-036: react to hashchange so the shared left rail's Articles/Products/Prompts/Shares links switch the
    // active tab (and open a read=<path> deep-link) while already on the Browse page, not just on first load.
    this._onHash = () => {
      const { tab, read, action } = parseBrowseHash(typeof location !== 'undefined' ? location.hash : '');
      const t = tab && TABS.some((x) => x.id === tab) ? tab : this._tab;
      if (read && t !== 'share' && t !== 'all' && t !== 'news') {
        this._tab = t;
        const found = (this._cache[t] || []).find((x) => x.path === read);
        // SOW-114: spread so a do= force-action never mutates the shared cache row; strip it once consumed.
        this._reading = { ...(found || { type: t, path: read }), doAction: action || null };
        if (action) consumeDo();
        this.render(); this._ensure(t); return;
      }
      if (t !== this._tab || this._reading) { this._tab = t; this._cat = []; this._reading = null; this.render(); this._ensureTab(t); }
    };
    if (typeof window !== 'undefined') window.addEventListener('hashchange', this._onHash);
    this._init();
  }

  disconnectedCallback() {
    if (this._onHash && typeof window !== 'undefined') window.removeEventListener('hashchange', this._onHash);
    super.disconnectedCallback?.();
  }

  // Load the active tab's index, then (if deep-linked via read=<path>) open that item in the reader.
  async _init() {
    await this._ensureTab(this._tab);
    if (this._openPath) {
      const found = (this._cache[this._tab] || []).find((x) => x.path === this._openPath);
      // Found -> open the rich index item; not found (race / pruned) -> a minimal item the reader fetches by path.
      // SOW-114: spread so a do= force-action rides the reading copy, never the shared cache row.
      this._reading = { ...(found || { type: this._tab, path: this._openPath }), doAction: this._openDo };
      this._openPath = null;
      this._openDo = null;
      this.render();
    }
  }

  // Route a tab to its loader: 'all' fans out across the per-type indexes + Shares, every other tab loads its index.
  _ensureTab(id) { return id === 'all' ? this._ensureAll() : this._ensure(id); }

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

  // SOW-042: the All directory. Load the three per-type indexes IN PARALLEL, then (once) the member's Shares —
  // gated by effective status so a Locked/unknown account never sees Shares. Each source fails soft to [].
  async _ensureAll() {
    await Promise.all(CONTENT_TYPES.map((t) => this._ensure(t)));
    if (this._shares === null) {
      try { const st = await this.client?.status?.(); this._membership = st?.membership ?? 'unknown'; }
      catch { this._membership = 'unknown'; }
      if (canSeeShares(this._membership)) {
        try { this._shares = (await this.client.listShares())?.items ?? []; } catch { this._shares = []; }
      } else { this._shares = []; }
    }
    if (this._tab === 'all' && !this._reading && !this._openPath) this.render();
  }

  // The merged, newest-first directory items, or null while any per-type index / the Shares read is still pending.
  _allItems() {
    const ready = CONTENT_TYPES.every((t) => this._cache[t]);
    if (!ready || this._shares === null) return null;
    const items = CONTENT_TYPES.flatMap((t) => this._cache[t] || []);
    return mergeAll({ items, shares: this._shares, membership: this._membership });
  }

  render() {
    if (this._reading) {
      const label = TABS.find((t) => t.id === this._reading.type)?.label || 'list';
      this.set(this.css(CSS) + `<button class="btn" data-back type="button">&larr; Back to ${esc(label)}</button><div data-reader></div>`);
      this.on('[data-back]', 'click', () => { this._reading = null; this.render(); this._ensureTab(this._tab); });
      const host = this.$('[data-reader]');
      const r = document.createElement('gbti-reader');
      host.replaceChildren(r);
      r.open(this._reading);
      return;
    }
    const tabs = TABS.map((t) => `<button class="tab ${t.id === this._tab ? 'on' : ''}" data-tab="${t.id}" type="button">${esc(t.label)}</button>`).join('');
    this.set(this.css(CSS) + `<div class="tabs" role="tablist">${tabs}</div><div data-body></div>`);
    this.$$('[data-tab]').forEach((b) => b.addEventListener('click', () => { this._tab = b.dataset.tab; this._cat = []; this.render(); this._ensureTab(this._tab); }));
    this._renderBody();
  }

  // SOW-041/042: the content tabs (incl. the All directory) render through the shared <gbti-card-list>; clicking a
  // card opens it IN PLACE in the reader (the card has no openHref, so it emits card-open). The Shares tab keeps its
  // existing authenticated feed. All == the per-type indexes + Shares merged newest-first (SOW-042).
  _renderBody() {
    const host = this.$('[data-body]');
    if (!host) return;
    if (this._tab === 'share') { host.replaceChildren(document.createElement('gbti-shares-feed')); return; }
    if (this._tab === 'news') { host.replaceChildren(document.createElement('gbti-news')); return; } // SOW-043: self-loading members-only feed
    const items = this._tab === 'all' ? this._allItems() : this._cache?.[this._tab];
    if (!items) { host.innerHTML = `<p class="empty">Loading...</p>`; return; }
    // SOW-054: the category drill-down. A primary chip row (and, once a primary is selected, its subcategory row)
    // sits above the list; the list shows only items whose categories path matches the selection. The labels ride
    // on the index items (categoryLabels), so no taxonomy lookup is needed in the bundle.
    const cat = this._cat || [];
    const primaries = primaryChips(items);
    const primaryLabel = (primaries.find((p) => p.key === cat[0]) || {}).label || cat[0] || '';
    const chipRow = (chips, depth, allLabel) =>
      `<div class="cchips${depth ? ' sub' : ''}">`
      + `<button class="cchip ${cat.length === depth ? 'on' : ''}" data-cat="${depth}" type="button">${esc(allLabel)}</button>`
      + chips.map((c) => `<button class="cchip ${cat[depth] === c.key ? 'on' : ''}" data-cat="${depth}" data-key="${esc(c.key)}" type="button">${esc(c.label)}<span class="n">${c.count}</span></button>`).join('')
      + `</div>`;
    let chrome = '';
    if (primaries.length) {
      chrome += chipRow(primaries, 0, 'All');
      const subs = cat.length ? subChips(items, cat[0]) : [];
      if (subs.length) chrome += chipRow(subs, 1, `All ${primaryLabel}`);
    }
    host.innerHTML = chrome + `<div data-list></div>`;
    host.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => {
      const depth = Number(b.dataset.cat);
      this._cat = 'key' in b.dataset ? cat.slice(0, depth).concat(b.dataset.key) : cat.slice(0, depth);
      this._renderBody();
    }));
    const list = document.createElement('gbti-card-list');
    list.mode = 'detailed';
    list.items = filterByCategoryPath(items, cat);
    list.addEventListener('card-open', (e) => { const it = e.detail?.item; if (it) { this._reading = it; this.render(); } });
    (host.querySelector('[data-list]') || host).replaceChildren(list);
  }
}

define('gbti-browse', GbtiBrowse);
export { GbtiBrowse };
