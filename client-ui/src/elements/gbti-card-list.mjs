// <gbti-card-list> (SOW-041): the ONE canonical content-item presentation for the extension — the Browse `.row` +
// cat-glyph vocabulary, in three density modes (compact / detailed / card) lifted from the new-tab feed and
// restyled onto the client-ui shadow tokens. Both gbti-browse (SOW-031) and the new-tab Activity feed (SOW-042)
// consume it, so there is one source of truth for the card/row look (the owner's "two stylings" complaint).
//
// Consumed imperatively: set `el.items` (a uniform projection {type,title,author,visibility,thumb,excerpt,
// category,createdAt,openHref?}) and `el.mode`. An item WITH `openHref` renders as an <a> (navigation, e.g. the
// activity feed deep-linking into the reader); an item WITHOUT it renders as a button that emits `card-open`
// (detail:{item}) so the host opens it in place (e.g. gbti-browse's detail pane). Inert in public (no markup
// until a host sets items). The body/discussion engine stays in gbti-reader; this is presentation only.
import { GbtiElement, define, esc } from '../base.mjs';
import { glyphFor } from '../cat-glyph.mjs';
import { resolveAsset } from '../assets.mjs';

const MODES = new Set(['compact', 'detailed', 'card']);
const TYPE_LABEL = { post: 'Article', product: 'Product', prompt: 'Prompt', share: 'Share' };
const lc = (s) => String(s || '').toLowerCase();
const authorName = (a) => (lc(a) === 'gbti' || lc(a) === 'house' ? 'GBTI Network' : a);

function relTime(v) {
  if (!v) return '';
  const ms = typeof v === 'number' ? v : Date.parse(v);
  if (!ms) return '';
  const d = Math.floor((Date.now() - ms) / 86400000);
  if (d < 1) return 'today';
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`;
  return `${Math.floor(d / 365)} year${Math.floor(d / 365) === 1 ? '' : 's'} ago`;
}

const lockIco = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .media { position:relative; flex:none; display:flex; align-items:center; justify-content:center; overflow:hidden; color:#fff;
    background:linear-gradient(145deg, color-mix(in srgb, var(--ka, #5b6472) 60%, white), var(--ka, #5b6472)); }
  .media .gl svg { width:48%; height:48%; }
  .media .cimg { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  .chip { display:inline-flex; align-items:center; font-family:var(--font-mono, monospace); font-size:10.5px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--muted); background:var(--hover); border-radius:6px; padding:3px 8px; white-space:nowrap; flex:none; }
  .lock { display:inline-flex; align-items:center; gap:4px; font-family:var(--font-mono, monospace); font-size:10px; font-weight:600; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:2px 8px 2px 6px; white-space:nowrap; }
  .lock svg { width:11px; height:11px; }
  .meta { font-family:var(--font-mono, monospace); font-size:12px; color:var(--muted); white-space:nowrap; }
  .meta b { color:var(--fg); font-weight:500; }
  .title { font-weight:600; color:var(--fg); }
  .empty { color:var(--muted); padding:18px 2px; }
  a, .open { color:inherit; text-decoration:none; }

  /* MODE compact */
  .compact { display:flex; flex-direction:column; gap:8px; }
  .row-c { display:flex; align-items:center; gap:12px; background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:11px 14px; cursor:pointer; transition:border-color .14s, box-shadow .14s, transform .14s; }
  .row-c:hover { border-color:var(--accent); transform:translateY(-1px); }
  .row-c .media { width:38px; height:38px; border-radius:9px; }
  .row-c .title { flex:1; min-width:0; font-size:14.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .row-c:hover .title { color:var(--accent); }
  .row-c .right { display:flex; align-items:center; gap:10px; flex:none; }

  /* MODE detailed (the canonical Browse-style list) */
  .detailed { display:flex; flex-direction:column; gap:11px; }
  .row-d { display:grid; grid-template-columns:62px 1fr; gap:15px; align-items:center; background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:13px 16px; cursor:pointer; transition:border-color .14s, box-shadow .14s, transform .14s; }
  .row-d:hover { border-color:var(--accent); transform:translateY(-1px); }
  .row-d .media { width:62px; height:62px; border-radius:10px; }
  .row-d .body { min-width:0; }
  .row-d .top { display:flex; align-items:center; gap:9px; margin:0 0 4px; }
  .row-d .title { font-size:15.5px; }
  .row-d:hover .title { color:var(--accent); }
  .row-d .ex { display:block; color:var(--muted); font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin:2px 0 4px; }

  /* MODE card */
  .card { display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:13px; }
  .card-i { display:flex; flex-direction:column; background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:14px 14px 0; cursor:pointer; overflow:hidden; transition:border-color .14s, box-shadow .14s, transform .14s; }
  .card-i:hover { border-color:var(--accent); transform:translateY(-2px); }
  .card-i .top { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .card-i .title { font-size:15px; line-height:1.3; margin:10px 0 6px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  .card-i:hover .title { color:var(--accent); }
  .card-i .meta { margin:0 0 12px; white-space:normal; }
  .card-i .media { margin:0 -14px; width:calc(100% + 28px); height:118px; border-radius:0; }
`;

class GbtiCardList extends GbtiElement {
  set items(v) { this._items = Array.isArray(v) ? v : []; this.render(); }
  get items() { return this._items || []; }
  set mode(v) { this._mode = MODES.has(v) ? v : 'detailed'; this.render(); }
  get mode() { return this._mode || 'detailed'; }

  _media(item) {
    const g = glyphFor(item.category, item.type);
    const thumb = item.thumb ? resolveAsset(item.thumb) : null;
    const img = thumb ? `<img class="cimg" src="${esc(thumb)}" alt="" loading="lazy">` : '';
    return `<span class="media" style="--ka:${esc(g.accent)}"><span class="gl"><svg viewBox="0 0 24 24" aria-hidden="true">${g.svg}</svg></span>${img}</span>`;
  }
  _chip(item) { return `<span class="chip">${esc(TYPE_LABEL[item.type] || item.type)}</span>`; }
  _lock(item) { return item.visibility === 'members' ? `<span class="lock">${lockIco}Members</span>` : ''; }
  _meta(item) { const ago = relTime(item.createdAt ?? item.publishedAt); return `<span class="meta"><b>${esc(authorName(item.author))}</b>${ago ? ` · ${esc(ago)}` : ''}</span>`; }
  _open(item, i, cls) { return item.openHref ? `<a class="${cls}" data-card="${i}" href="${esc(item.openHref)}">` : `<div class="${cls}" data-card="${i}" role="button" tabindex="0">`; }
  _close(item) { return item.openHref ? '</a>' : '</div>'; }

  _compact(items) {
    return `<div class="compact">` + items.map((it, i) => `${this._open(it, i, 'row-c')}${this._media(it)}${this._chip(it)}<span class="title">${esc(it.title)}</span><span class="right">${this._lock(it)}${this._meta(it)}</span>${this._close(it)}`).join('') + `</div>`;
  }
  _detailed(items) {
    return `<div class="detailed">` + items.map((it, i) => `${this._open(it, i, 'row-d')}${this._media(it)}<div class="body"><div class="top">${this._chip(it)}${this._lock(it)}</div><div class="title">${esc(it.title)}</div>${it.excerpt ? `<span class="ex">${esc(it.excerpt)}</span>` : ''}${this._meta(it)}</div>${this._close(it)}`).join('') + `</div>`;
  }
  _card(items) {
    return `<div class="card">` + items.map((it, i) => `${this._open(it, i, 'card-i')}<div class="top">${this._chip(it)}${this._lock(it)}</div><div class="title">${esc(it.title)}</div>${this._meta(it)}${this._media(it)}${this._close(it)}`).join('') + `</div>`;
  }

  render() {
    if (!this._items) return;
    if (!this._items.length) { this.set(this.css(CSS) + `<p class="empty">Nothing here yet.</p>`); return; }
    const body = this.mode === 'compact' ? this._compact(this._items) : this.mode === 'card' ? this._card(this._items) : this._detailed(this._items);
    this.set(this.css(CSS) + body);
    // A content image that 404s drops to its category glyph (CSP-safe capture-phase; img error does not bubble).
    if (!this._wiredErr) {
      this.root?.addEventListener('error', (e) => { const t = e.target; if (t?.tagName === 'IMG' && t.classList?.contains('cimg')) t.remove(); }, true);
      this._wiredErr = true;
    }
    // A card without an openHref opens IN PLACE: emit card-open for the host to handle.
    this.$$('[data-card]').forEach((el) => {
      if (el.tagName === 'A') return; // a real link navigates natively
      const open = () => this.emit('card-open', { item: this._items[Number(el.dataset.card)] });
      el.addEventListener('click', open);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
  }
}

define('gbti-card-list', GbtiCardList);
export { GbtiCardList };
