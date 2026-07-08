// <gbti-tag-explorer> (SOW-100 follow-on): the Admin -> Tags "Tag manager", implemented from the owner's
// imported design (GBTI WorkBench Components / components/tags/current-state.html, "Tag manager (redesign)";
// distilled in .data/sow/1_progressing/extension/sow-100-category-assets/TAG-MANAGER-SOURCE.md). Real data
// from the public content indexes (one CDN fetch per type): an aligned sortable grid with a proportional
// usage bar, a type segmented control that BOTH filters rows and re-scopes usage, normalization-based
// duplicate detection with an amber review banner, and a right-hand detail panel listing the items carrying
// the selected tag. Rename/Merge/Retire render disabled pending the tag-curation follow-up.
import { GbtiElement, define, esc } from '../base.mjs';

const SITE = 'https://gbti.network';
const INDEXES = { post: 'blog-index.json', prompt: 'prompts-index.json', product: 'products-index.json' };
const SEG = [['all', 'All'], ['post', 'Articles'], ['prompt', 'Prompts'], ['product', 'Products']];

const SEARCH_ICO = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.2-3.2"></path></svg>';
const TAG_ICO = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-7.2-7.2a2 2 0 0 1-.6-1.4V4a1 1 0 0 1 1-1h7.9a2 2 0 0 1 1.4.6l7.5 7.5a2 2 0 0 1 0 2.8Z"></path><circle cx="7.5" cy="7.5" r="1.4" fill="currentColor" stroke="none"></circle></svg>';
const KEBAB = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>';
const ICONS = {
  pencil: '<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z"/>',
  merge: '<path d="M6 3v6a4 4 0 0 0 4 4h8"/><path d="m15 10 3 3-3 3"/><path d="M6 21v-4"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/>',
};
const icon = (n) => `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</svg>`;

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg);
    --panel2:color-mix(in srgb, var(--fg) 5%, var(--panel));
    --raise:color-mix(in srgb, var(--fg) 8%, var(--panel));
    --faint:color-mix(in srgb, var(--muted) 65%, transparent);
    --greenfg:var(--s-green-fg, #5fd49a); --green-dim:rgba(31,158,95,.16);
    --amber:#e0a94b; --amberfg:#f0c883; --amber-dim:rgba(224,169,75,.13); --r:7px; container-type:inline-size; }
  * { box-sizing:border-box; }
  .top { display:flex; align-items:baseline; gap:14px; flex-wrap:wrap; margin-bottom:12px; }
  .eyebrow { font-family:var(--font-mono, monospace); font-size:10.5px; text-transform:uppercase; letter-spacing:.14em; color:var(--muted); }
  .title { font-family:var(--font-display); font-weight:600; font-size:22px; letter-spacing:-.01em; }
  .count { margin-left:auto; font-family:var(--font-mono, monospace); font-size:12px; color:var(--muted); }
  .count b { color:var(--fg); font-weight:600; }

  .toolbar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:12px; }
  .search { position:relative; flex:1; min-width:220px; }
  .search svg { position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--faint); }
  .search input { width:100%; font:inherit; font-size:13.5px; color:var(--fg); padding:10px 12px 10px 36px; background:var(--panel); border:1.5px solid var(--line); border-radius:var(--r); outline:none; transition:border-color .15s, box-shadow .15s; }
  .search input::placeholder { color:var(--faint); }
  .search input:focus { border-color:var(--brand); box-shadow:0 0 0 3px var(--green-dim); }
  .seg { display:flex; background:var(--panel); border:1.5px solid var(--line); border-radius:var(--r); padding:2px; }
  .seg button { font:inherit; font-size:12.5px; color:var(--muted); background:none; border:none; padding:6px 12px; border-radius:5px; cursor:pointer; white-space:nowrap; transition:.12s; }
  .seg button:hover { color:var(--fg); }
  .seg button.on { background:var(--raise); color:var(--fg); box-shadow:0 1px 2px rgba(0,0,0,.25); }

  .dupe { display:flex; align-items:center; gap:12px; padding:11px 14px; background:var(--amber-dim); border:1.5px solid rgba(224,169,75,.34); border-radius:2px; margin-bottom:12px; }
  .dupe .dot { width:8px; height:8px; border-radius:50%; background:var(--amber); flex:none; }
  .dupe .txt { font-size:13px; color:var(--amberfg); }
  .dupe .txt code { font-family:var(--font-mono, monospace); font-size:12px; color:var(--fg); background:rgba(0,0,0,.24); padding:1px 6px; border-radius:4px; }
  .dupe .txt b { color:var(--fg); font-weight:600; }
  .dupe button { margin-left:auto; font:inherit; font-size:12.5px; font-weight:600; color:#1a1720; background:var(--amber); border:none; padding:7px 14px; border-radius:5px; cursor:pointer; white-space:nowrap; }
  .dupe .dismiss { background:none; color:var(--amberfg); font-weight:500; padding:7px 4px; margin-left:2px; }

  .split { display:flex; gap:14px; align-items:stretch; }
  .listwrap { flex:1; min-width:0; display:flex; flex-direction:column; background:var(--panel); border:1.5px solid var(--line); border-radius:var(--r); overflow:hidden; backdrop-filter:var(--glass-blur); }
  .grid-h, .row { display:grid; align-items:center; grid-template-columns:minmax(0,1fr) 132px 62px 62px 62px 30px; gap:14px; padding:0 16px; }
  @container (max-width: 920px) { .grid-h, .row { grid-template-columns:minmax(0,1fr) 108px 52px 52px 52px 26px; gap:10px; } }
  .grid-h { height:38px; border-bottom:1.5px solid var(--line); font-family:var(--font-mono, monospace); font-size:10px; text-transform:uppercase; letter-spacing:.09em; color:var(--muted); }
  .grid-h .col { display:flex; align-items:center; gap:5px; cursor:pointer; user-select:none; }
  .grid-h .col.num { justify-content:flex-end; }
  .grid-h .col:hover { color:var(--fg); }
  .grid-h .col .car { opacity:0; font-size:9px; transition:.12s; }
  .grid-h .col.sorted .car { opacity:1; color:var(--greenfg); }

  .rows { overflow-y:auto; max-height:60vh; }
  .rows::-webkit-scrollbar { width:10px; }
  .rows::-webkit-scrollbar-thumb { background:var(--line); border-radius:6px; border:3px solid var(--panel); }
  .row { height:52px; cursor:pointer; border-bottom:1px solid rgba(255,255,255,.045); position:relative; transition:background .12s; }
  .row:hover { background:var(--panel2); }
  .row.sel { background:var(--green-dim); }
  .row.sel::before { content:""; position:absolute; left:0; top:0; bottom:0; width:3px; background:var(--brand); }
  .tagcell { display:flex; align-items:center; gap:9px; min-width:0; }
  .tagname { font-family:var(--font-mono, monospace); font-size:13px; color:var(--fg); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .flag { font-family:var(--font-mono, monospace); font-size:9px; letter-spacing:.05em; text-transform:uppercase; color:var(--amberfg); border:1px solid rgba(224,169,75,.4); padding:1px 5px; border-radius:3px; flex:none; }
  .usage { display:flex; align-items:center; gap:9px; }
  .bar { flex:1; height:6px; background:rgba(255,255,255,.07); border-radius:99px; overflow:hidden; }
  .bar > i { display:block; height:100%; background:var(--brand); border-radius:99px; }
  .usage .tot { font-family:var(--font-mono, monospace); font-size:13px; font-weight:600; color:var(--fg); width:20px; text-align:right; }
  .num { font-family:var(--font-mono, monospace); font-size:13px; text-align:right; color:var(--muted); }
  .num.zero { color:var(--faint); }
  .rowact { display:flex; justify-content:center; color:var(--faint); opacity:0; transition:.12s; }
  .row:hover .rowact, .row.sel .rowact { opacity:1; }

  .detail { width:340px; flex:none; background:var(--panel); border:1.5px solid var(--line); border-radius:var(--r); display:flex; flex-direction:column; overflow:hidden; backdrop-filter:var(--glass-blur); }
  @container (max-width: 920px) { .detail { width:300px; } }
  @container (max-width: 640px) { .split { flex-direction:column; } .detail { width:auto; } }
  .detail.empty { align-items:center; justify-content:center; text-align:center; padding:30px; min-height:220px; }
  .detail.empty p { color:var(--faint); font-size:13px; max-width:190px; }
  .detail.empty .ico { color:var(--faint); margin-bottom:12px; }
  .dhead { padding:16px 18px 14px; border-bottom:1.5px solid var(--line); }
  .dhead .dtag { font-family:var(--font-mono, monospace); font-size:16px; color:var(--fg); font-weight:600; word-break:break-all; }
  .dhead .dmeta { color:var(--muted); font-size:12.5px; margin-top:3px; }
  .dhead .dmeta b { color:var(--greenfg); font-weight:600; }
  .dactions { display:flex; gap:8px; padding:12px 18px; border-bottom:1.5px solid var(--line); }
  .dactions button { flex:1; font:inherit; font-size:12.5px; font-weight:500; color:var(--muted); background:var(--raise); border:1.5px solid var(--line); border-radius:5px; padding:8px 4px; display:flex; align-items:center; justify-content:center; gap:5px; opacity:.55; cursor:default; }
  .ditems { overflow-y:auto; max-height:44vh; padding:6px 0; }
  .ditems::-webkit-scrollbar { width:10px; }
  .ditems::-webkit-scrollbar-thumb { background:var(--line); border-radius:6px; border:3px solid var(--panel); }
  .item { display:block; text-decoration:none; padding:11px 18px; border-bottom:1px solid rgba(255,255,255,.045); transition:background .12s; }
  .item:hover { background:var(--panel2); }
  .item .ititle { color:var(--fg); font-size:13px; line-height:1.35; }
  .item:hover .ititle { color:var(--greenfg); }
  .item .isub { display:flex; align-items:center; gap:8px; margin-top:5px; }
  .badge { font-family:var(--font-mono, monospace); font-size:9px; text-transform:uppercase; letter-spacing:.06em; padding:2px 6px; border-radius:3px; flex:none; }
  .badge.prompt { color:var(--greenfg); background:var(--green-dim); }
  .badge.post { color:#8fb8f0; background:rgba(120,150,220,.15); }
  .badge.product { color:var(--amberfg); background:var(--amber-dim); }
  .item .iauth { color:var(--muted); font-size:11.5px; }
  .muted { color:var(--muted); font-size:13.5px; }
`;

const norm = (t) => String(t).toLowerCase().replace(/[\s_-]+/g, '');

class GbtiTagExplorer extends GbtiElement {
  connectedCallback() {
    this._rows = null;
    this._q = '';
    this._type = 'all';
    this._sort = 'total';
    this._dir = -1;
    this._sel = null;
    this._dupeHidden = false;
    super.connectedCallback?.();
  }

  async load() {
    const byTag = new Map();
    await Promise.all(Object.entries(INDEXES).map(async ([type, file]) => {
      try {
        const res = await fetch(`${SITE}/${file}`, { cache: 'no-cache' });
        const data = await res.json();
        for (const it of (Array.isArray(data) ? data : data?.items || [])) {
          for (const raw of it.tags || []) {
            const tag = String(raw).trim().toLowerCase();
            if (!tag) continue;
            let row = byTag.get(tag);
            if (!row) { row = { tag, post: 0, prompt: 0, product: 0, total: 0, items: [] }; byTag.set(tag, row); }
            row[type] += 1; row.total += 1;
            row.items.push({ type, title: it.title || it.slug, url: it.url, author: it.author });
          }
        }
      } catch { /* a missing index leaves its type at zero */ }
    }));
    const rows = [...byTag.values()];
    // Duplicate detection: tags sharing a NORMALIZED form (spaces / hyphens / underscores collapsed).
    const byNorm = new Map();
    for (const r of rows) {
      const n = norm(r.tag);
      if (!byNorm.has(n)) byNorm.set(n, []);
      byNorm.get(n).push(r);
    }
    this._dupes = [...byNorm.values()].filter((g) => g.length > 1);
    for (const g of this._dupes) for (const r of g) r.dup = true;
    this._rows = rows;
    this._loading = false;
    this.render();
  }

  _activeTotal(d) { return this._type === 'all' ? d.total : d[this._type]; }

  _filtered() {
    let list = (this._rows || []).filter((d) => d.tag.includes(this._q.toLowerCase()));
    if (this._type !== 'all') list = list.filter((d) => d[this._type] > 0);
    const s = this._sort; const dir = this._dir;
    list.sort((a, b) => {
      if (s === 'tag') return a.tag < b.tag ? -dir : a.tag > b.tag ? dir : 0;
      const av = s === 'total' ? this._activeTotal(a) : a[s];
      const bv = s === 'total' ? this._activeTotal(b) : b[s];
      if (av === bv) return a.tag < b.tag ? -1 : 1;
      return (av - bv) * dir;
    });
    return list;
  }

  render() {
    if (!this._rows) {
      if (!this._loading) { this._loading = true; this.load(); }
      this.set(this.css(CSS) + `<p class="muted">Aggregating tags from the content indexes…</p>`);
      return;
    }
    const list = this._filtered();
    const maxNow = Math.max(1, ...list.map((d) => this._activeTotal(d)));
    const uses = list.reduce((n, d) => n + this._activeTotal(d), 0);
    const car = this._dir < 0 ? '▼' : '▲';
    const head = [['tag', 'Tag', ''], ['total', 'Usage', ' usehead'], ['post', 'Art', ' num'], ['prompt', 'Prm', ' num'], ['product', 'Prd', ' num']]
      .map(([k, l, cls]) => `<div class="col${cls}${this._sort === k ? ' sorted' : ''}" data-s="${k}"><span>${l}</span><span class="car">${car}</span></div>`).join('') + '<div></div>';
    const rowsHtml = list.map((d) => {
      const t = this._activeTotal(d);
      const pct = Math.max(4, Math.round((t / maxNow) * 100));
      const z = (n) => (n === 0 ? ' zero' : '');
      return `<div class="row${this._sel === d.tag ? ' sel' : ''}" data-tag="${esc(d.tag)}">
        <div class="tagcell"><span class="tagname">${esc(d.tag)}</span>${d.dup ? '<span class="flag">dup</span>' : ''}</div>
        <div class="usage"><div class="bar"><i style="width:${pct}%"></i></div><span class="tot">${t}</span></div>
        <div class="num${z(d.post)}">${d.post}</div>
        <div class="num${z(d.prompt)}">${d.prompt}</div>
        <div class="num${z(d.product)}">${d.product}</div>
        <div class="rowact" title="Tag curation is a follow-up">${KEBAB}</div>
      </div>`;
    }).join('');
    const firstDupe = this._dupes?.[0];
    const dupe = firstDupe && !this._dupeHidden ? `<div class="dupe">
        <span class="dot"></span>
        <span class="txt"><b>${this._dupes.length} likely duplicate${this._dupes.length === 1 ? '' : 's'}.</b> ${firstDupe.map((r) => `<code>${esc(r.tag)}</code>`).join(' and ')} read as the same label — consider merging.</span>
        <button id="reviewdupe" type="button">Review</button>
        <button class="dismiss" id="dismissdupe" type="button">Dismiss</button>
      </div>` : '';
    const sel = this._sel ? this._rows.find((r) => r.tag === this._sel) : null;
    const detail = sel ? `<div class="detail">
        <div class="dhead"><div class="dtag">${esc(sel.tag)}</div>
          <div class="dmeta"><b>${sel.total}</b> use${sel.total === 1 ? '' : 's'}${sel.prompt ? ` · ${sel.prompt} prompt${sel.prompt === 1 ? '' : 's'}` : ''}${sel.post ? ` · ${sel.post} article${sel.post === 1 ? '' : 's'}` : ''}${sel.product ? ` · ${sel.product} product${sel.product === 1 ? '' : 's'}` : ''}</div></div>
        <div class="dactions">
          <button type="button" disabled title="Tag curation is a follow-up">${icon('pencil')} Rename</button>
          <button type="button" disabled title="Tag curation is a follow-up">${icon('merge')} Merge</button>
          <button type="button" disabled title="Tag curation is a follow-up">${icon('archive')} Retire</button>
        </div>
        <div class="ditems">${sel.items.map((i) => `<a class="item" href="${SITE}${esc(i.url || '')}" target="_blank" rel="noopener">
          <div class="ititle">${esc(i.title)}</div>
          <div class="isub"><span class="badge ${esc(i.type)}">${esc(i.type)}</span><span class="iauth">@${esc(i.author || '')}</span></div>
        </a>`).join('')}</div>
      </div>` : `<div class="detail empty"><div><div class="ico">${TAG_ICO}</div><p>Select a tag to see the content carrying it.</p></div></div>`;

    this.set(this.css(CSS) + `
      <div class="top"><div><div class="eyebrow">Admin · Tags</div><div class="title">Tag manager</div></div>
        <div class="count"><b>${list.length}</b> of <b>${this._rows.length}</b> tags · <b>${uses}</b> uses</div></div>
      <div class="toolbar">
        <label class="search">${SEARCH_ICO}<input id="q" placeholder="Filter tags…" autocomplete="off" value="${esc(this._q)}" /></label>
        <div class="seg">${SEG.map(([k, l]) => `<button type="button" class="${this._type === k ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}</div>
      </div>
      ${dupe}
      <div class="split">
        <div class="listwrap"><div class="grid-h">${head}</div><div class="rows">${rowsHtml || `<p class="muted" style="padding:14px 16px">No tags match.</p>`}</div></div>
        ${detail}
      </div>`);

    this.$('#q')?.addEventListener('input', (e) => { this._q = e.target.value; this.render(); const el = this.$('#q'); el?.focus(); el?.setSelectionRange(el.value.length, el.value.length); });
    this.$$('.seg button').forEach((b) => b.addEventListener('click', () => { this._type = b.dataset.t; this.render(); }));
    this.$$('.grid-h .col').forEach((c) => c.addEventListener('click', () => {
      const k = c.dataset.s;
      if (this._sort === k) this._dir *= -1;
      else { this._sort = k; this._dir = k === 'tag' ? 1 : -1; }
      this.render();
    }));
    this.$$('.row[data-tag]').forEach((r) => r.addEventListener('click', () => { this._sel = this._sel === r.dataset.tag ? null : r.dataset.tag; this.render(); }));
    this.on('#reviewdupe', 'click', () => { this._q = this._dupes?.[0]?.[0]?.tag?.split(/[\s-]/)[0] || ''; this.render(); });
    this.on('#dismissdupe', 'click', () => { this._dupeHidden = true; this.render(); });
  }
}

define('gbti-tag-explorer', GbtiTagExplorer);
