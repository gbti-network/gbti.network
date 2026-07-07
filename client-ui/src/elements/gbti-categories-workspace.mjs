// <gbti-categories-workspace> (SOW-100): the Admin -> Categories two-pane workspace from the imported
// "Category Management B" design. Left: a searchable, collapsible taxonomy tree with per-node rolled-up
// content counts and a channel status dot. Right: the detail editor (label, key, Discord channel card,
// subcategories, danger zone) plus a dashboard column (stat cards + a paginated per-category content
// browser) — THREE panes at wide widths via a container query, stacked below. Edits accumulate in a pending
// set (amber pill) and ship as ONE house PR from "Review N changes" (client.admin('category-batch'));
// key renames / moves / removes stay immediate review-gated CI migrations (client.adminOp). Routing is
// fixed dual-post (SOW-087); the design's per-category routing toggles are descoped v1. Superadmin/admin
// gated server-side; inert without a client (SOW-070 lazy load from render).
import { GbtiElement, define, esc } from '../base.mjs';
import { submitAck } from '../workspace-core.mjs';
import {
  flattenTree, countRollup, channelStatusFor, channelFor,
  upsertOp, describeOp, batchPlan, pageWindow, paginate, relAge, filterByCategoryPath,
} from '../categories-core.mjs';

const SITE = 'https://gbti.network';
const INDEXES = { post: 'blog-index.json', prompt: 'prompts-index.json', product: 'products-index.json' };
const TYPE_LABEL = { post: 'Articles', prompt: 'Prompts', product: 'Products' };
const CB_PER = 6;

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); container-type:inline-size; --r7:7px; } /* default border radius is 7px (owner) */
  .muted { color:var(--muted); font-size:13.5px; }
  button { font:inherit; cursor:pointer; }
  /* local accents (design): amber = pending, blurple = Discord; dark variants via host-context */
  :host { --amber:#c6892b; --amber-tint:#fbf3e3; --amber-line:#ecd9ad; --blur:#5865f2; --blur-fg:#3b45c9; --blur-tint:#eef0fe; --blur-line:#d3d8fb; }
  :host-context([data-theme="dark"]) { --amber:#e0a94b; --amber-tint:rgba(224,169,75,.12); --amber-line:rgba(224,169,75,.35); --blur:#7d87ff; --blur-fg:#aab2ff; --blur-tint:rgba(125,135,242,.12); --blur-line:rgba(125,135,242,.35); }

  .chead { display:flex; align-items:flex-start; gap:clamp(8px, 1cqw, 12px); flex-wrap:wrap; margin-bottom:clamp(10px, 1.4cqw, 16px); }
  .chead h2 { font-family:var(--font-display); font-size:clamp(16px, 1.4cqw + 10px, 19px); margin:0 0 2px; }
  @container (max-width: 480px) { .chead .grow > .muted { display:none; } } /* redundant with the intro copy at phone widths */
  .chead .grow { flex:1; min-width:220px; }
  .pending { display:inline-flex; align-items:center; gap:7px; font-size:12.5px; font-weight:700; color:var(--amber); background:var(--amber-tint); border:1.5px solid var(--amber-line); border-radius:999px; padding:5px 12px 5px 6px; transition:opacity .15s ease; }
  .pending .cnt { display:inline-flex; align-items:center; justify-content:center; min-width:20px; height:20px; border-radius:50%; background:var(--amber); color:#fff; font-family:var(--font-mono, monospace); font-size:11.5px; }
  .pending[hidden] { display:none; }
  .btn { font-weight:700; font-size:13px; padding:9px 14px; border:0; border-radius:var(--r7); background:var(--brand); color:#fff; white-space:nowrap; }
  .btn.pr { box-shadow:0 6px 16px rgba(31,158,95,.28); }
  .btn[disabled] { opacity:.5; cursor:default; box-shadow:none; }
  .btn.soft { background:var(--panel); color:var(--fg); border:1.5px solid var(--line); }

  .cpane { display:grid; grid-template-columns:minmax(0,1fr); gap:clamp(8px, 1.2cqw, 14px); }
  /* Desktop-preserve (owner rule): keep the tree BESIDE the detail down to ~600px page widths; the column
     itself compresses fluidly instead of the layout stacking. Stacking is the MOBILE treatment only. */
  @container (min-width: 500px) { .cpane { grid-template-columns:clamp(185px, 26cqw, 280px) minmax(0,1fr); } }
  .tree-col { border:1.5px solid var(--line); border-radius:var(--r7); background:var(--panel); backdrop-filter:var(--glass-blur); display:flex; flex-direction:column; max-height:70vh; min-width:0; }
  /* Stacked (mobile) treatment: the tree becomes a capped top strip above the detail. */
  @container (max-width: 499px) { .tree-col { max-height:300px; } }
  .csearch { margin:10px; }
  .csearch input { width:100%; box-sizing:border-box; font:inherit; font-size:13px; padding:9px 11px; border:1.5px solid var(--line); border-radius:var(--r7); background:var(--bg, transparent); color:var(--fg); }
  .csearch input:focus-visible { outline:2px solid var(--brand); outline-offset:1px; }
  .tscroll { overflow-y:auto; overflow-x:hidden; scrollbar-gutter:stable; flex:1; padding:0 6px 8px 8px; }
  .tscroll::-webkit-scrollbar { width:8px; }
  .tscroll::-webkit-scrollbar-thumb { background:var(--line); border-radius:999px; }
  .tscroll::-webkit-scrollbar-track { background:transparent; }
  .titem { display:flex; align-items:center; gap:6px; width:100%; box-sizing:border-box; text-align:left; background:none; border:0; border-radius:var(--r7); padding:7px 8px; color:var(--fg); }
  .titem:hover { background:var(--hover); }
  .titem.on { background:var(--hover); color:var(--brand); font-weight:700; }
  .titem .car { flex:none; width:14px; color:var(--muted); font-size:10px; transition:transform .12s ease; }
  .titem.closed .car { transform:rotate(-90deg); }
  .titem .car.leaf { visibility:hidden; }
  .titem .lab { flex:1; min-width:0; font-size:clamp(12.5px, 1.1cqw + 9px, 13.5px); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .titem.lvl0 .lab { font-family:var(--font-display); font-weight:700; }
  .titem .cnt { flex:none; font-family:var(--font-mono, monospace); font-size:11px; color:var(--muted); }
  .titem .dot { flex:none; width:8px; height:8px; border-radius:50%; background:var(--line); }
  .titem .dot.synced { background:var(--brand); }
  .titem .dot.review { background:var(--amber); }
  .ind1 { margin-left:12px; } .ind2 { margin-left:24px; } .ind3 { margin-left:36px; }
  .legend { display:flex; gap:14px; padding:9px 14px; border-top:1.5px solid var(--line); font-size:11px; color:var(--muted); }
  .legend i { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:5px; }
  .tnew { color:var(--muted); font-size:13px; }

  .detail { min-width:0; }
  .dgrid { display:grid; grid-template-columns:minmax(0,1fr); gap:14px; align-items:start; }
  @container (min-width: 1100px) { .dgrid { grid-template-columns:minmax(0,3fr) minmax(0,2fr); } }
  .card { border:1.5px solid var(--line); border-radius:var(--r7); background:var(--panel); backdrop-filter:var(--glass-blur); padding:clamp(11px, 1.4cqw, 16px) clamp(12px, 1.6cqw, 18px); }
  .crumb { font-size:12px; color:var(--muted); margin-bottom:6px; }
  .crumb b { color:var(--fg); cursor:pointer; } .crumb b:hover { color:var(--brand); }
  .dtitle { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:12px; }
  .dtitle h3 { font-family:var(--font-display); font-size:clamp(19px, 2cqw + 12px, 24px); margin:0; }
  .lvltag { font-family:var(--font-mono, monospace); font-size:10px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); background:var(--hover); border-radius:999px; padding:3px 9px; }
  .dclose { margin-left:auto; font:inherit; font-size:12px; font-weight:600; color:var(--muted); background:none; border:1.5px solid var(--line); border-radius:var(--r7); padding:4px 10px; }
  .dclose:hover { color:var(--fg); background:var(--hover); }
  .fields { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  @container (max-width: 620px) { .fields { grid-template-columns:1fr; } }
  .fld label { display:block; font-family:var(--font-mono, monospace); font-size:10.5px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin-bottom:5px; }
  .fld input { width:100%; box-sizing:border-box; font:inherit; font-size:14px; padding:10px 12px; border:1.5px solid var(--line); border-radius:var(--r7); background:var(--bg, transparent); color:var(--fg); }
  .fld input:focus-visible { outline:2px solid var(--brand); outline-offset:1px; }
  .fld input.mono { font-family:var(--font-mono, monospace); background:var(--hover); }
  .hint { font-size:11.5px; color:var(--muted); margin-top:5px; }
  .sech { display:flex; align-items:center; gap:7px; font-family:var(--font-mono, monospace); font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:16px 0 9px; }

  .dcard { border:1.5px solid var(--blur-line); border-radius:0; background:var(--blur-tint); padding:14px 16px; } /* colored borders are square (owner) */
  .dcard .row1 { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
  .dcard .sav { width:38px; height:38px; border-radius:var(--r7); background:var(--blur); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:800; }
  .dcard .st { font-size:12px; color:var(--muted); }
  .dcard .st b { color:var(--blur-fg); }
  .pickrow { display:flex; gap:8px; flex-wrap:wrap; }
  .pick { position:relative; flex:1; min-width:200px; }
  .pickbtn { width:100%; display:flex; align-items:center; gap:8px; font-family:var(--font-mono, monospace); font-size:13px; padding:11px 12px; border:1.5px solid var(--blur-line); border-radius:var(--r7); background:var(--panel); color:var(--fg); text-align:left; }
  .pickbtn .hash { color:var(--blur-fg); font-weight:800; }
  .dmenu { position:absolute; left:0; right:0; top:calc(100% + 5px); z-index:8; background:var(--panel); border:1.5px solid var(--line); border-radius:var(--r7); box-shadow:0 12px 30px rgba(0,0,0,.25); padding:5px; max-height:260px; overflow:auto; }
  .dopt { display:flex; align-items:center; gap:8px; width:100%; text-align:left; font-family:var(--font-mono, monospace); font-size:12.5px; background:none; border:0; border-radius:var(--r7); padding:8px 9px; color:var(--fg); }
  .dopt:hover { background:var(--hover); }
  .dopt .used { font-family:var(--font-body); font-style:italic; font-size:11px; color:var(--muted); margin-left:auto; }
  .dopt.unlink { color:var(--danger); }
  .dopt .hash { color:var(--blur-fg); }
  .manrow { display:flex; gap:8px; margin-top:8px; }
  .manrow input { flex:1; font-family:var(--font-mono, monospace); font-size:12.5px; padding:9px 11px; border:1.5px solid var(--blur-line); border-radius:var(--r7); background:var(--panel); color:var(--fg); }
  .dnote { font-size:12px; color:var(--muted); margin-top:10px; line-height:1.5; }

  .sublist { display:flex; flex-direction:column; }
  .subrow { display:flex; align-items:center; gap:9px; width:100%; text-align:left; background:none; border:0; border-top:1px solid var(--line); padding:9px 4px; color:var(--fg); }
  .subrow:first-child { border-top:0; }
  .subrow:hover { background:var(--hover); border-radius:var(--r7); }
  .subrow .k { font-family:var(--font-mono, monospace); font-size:11.5px; color:var(--muted); }
  .subrow .n { margin-left:auto; font-family:var(--font-mono, monospace); font-size:11.5px; color:var(--muted); }
  .addsub { display:flex; gap:8px; margin-top:10px; flex-wrap:wrap; }
  .addsub input { flex:1; min-width:120px; font:inherit; font-size:13px; padding:8px 10px; border:1.5px solid var(--line); border-radius:var(--r7); background:var(--bg, transparent); color:var(--fg); }

  .danger { border-color:color-mix(in srgb, var(--danger) 45%, transparent); border-radius:0; } /* colored borders are square (owner) */
  .danger .sech { color:var(--danger); }
  .drow { display:flex; gap:8px; flex-wrap:wrap; }
  .btn.warn { background:var(--panel); color:var(--danger); border:1.5px solid color-mix(in srgb, var(--danger) 55%, transparent); }
  .moverow { display:flex; gap:8px; align-items:center; margin-top:10px; flex-wrap:wrap; }
  .moverow select { font:inherit; font-size:13px; padding:9px 11px; border:1.5px solid var(--line); border-radius:var(--r7); background:var(--panel); color:var(--fg); min-width:200px; }

  .stats { display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:10px; margin-bottom:14px; }
  .stat { border:1.5px solid var(--line); border-radius:var(--r7); padding:12px 14px; background:var(--panel); }
  .stat .n { font-family:var(--font-display); font-size:clamp(20px, 1.8cqw + 12px, 26px); font-weight:800; }
  .stat .l { font-family:var(--font-mono, monospace); font-size:10.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
  .stat.accent { background:var(--hover); } .stat.accent .n { color:var(--brand); }
  .stat.warn .n { color:var(--amber); }

  .cbtabs { display:flex; gap:4px; border-bottom:1.5px solid var(--line); margin-bottom:8px; }
  .cbtab { font-size:12.5px; font-weight:700; color:var(--muted); background:none; border:0; border-bottom:2px solid transparent; padding:8px 10px; }
  .cbtab.on { color:var(--brand); border-bottom-color:var(--brand); }
  .cbtab .n { font-family:var(--font-mono, monospace); font-size:10.5px; margin-left:4px; color:var(--muted); }
  .cbrow { display:flex; align-items:center; gap:10px; padding:8px 2px; border-top:1px solid var(--line); }
  .cbrow:first-of-type { border-top:0; }
  .cbrow a { color:var(--fg); text-decoration:none; font-size:13.5px; font-weight:600; }
  .cbrow a:hover { color:var(--brand); }
  .cbrow .sub { font-family:var(--font-mono, monospace); font-size:11px; color:var(--muted); }
  .cbempty { text-align:center; color:var(--muted); font-size:13px; padding:18px 0; }
  .cbfoot { display:flex; align-items:center; gap:6px; margin-top:10px; }
  .cbfoot .rng { font-family:var(--font-mono, monospace); font-size:11px; color:var(--muted); margin-right:auto; }
  .pgb { min-width:30px; height:28px; font-size:12px; border:1.5px solid var(--line); border-radius:var(--r7); background:var(--panel); color:var(--fg); }
  .pgb.on { background:var(--brand); border-color:var(--brand); color:#fff; }
  .pgb[disabled] { opacity:.4; cursor:default; }
  .dots { color:var(--muted); font-size:12px; padding:0 2px; }
  @media (pointer: coarse) {
    .titem { padding:10px 8px; }
    .pgb { min-width:36px; height:34px; }
    .cbtab { padding:10px 12px; }
  }

  .empty-hero { text-align:center; padding:26px 0 8px; }
  .empty-hero h3 { font-family:var(--font-display); margin:0 0 4px; }
  .needs { margin-top:14px; }
  .needs .subrow .dot { width:8px; height:8px; border-radius:50%; background:var(--line); }
  .msg { font-size:13px; color:var(--accent); margin:10px 0 0; line-height:1.5; }
`;

class GbtiCategoriesWorkspace extends GbtiElement {
  connectedCallback() {
    this._tree = null;       // taxonomy tree ({key:{label,children}})
    this._pool = null;       // [{category, channelId}]
    this._items = null;      // {post:[], prompt:[], product:[]} from the index JSONs
    this._counts = null;     // Map pathKey -> counts
    this._sel = null;        // selected path array or null (empty state)
    this._collapsed = new Set();
    this._pending = new Map();
    this._q = '';
    this._cbType = 'post';
    this._cbPage = 1;
    this._pickerOpen = false;
    this._msg = null;
    super.connectedCallback?.();
    this._onDoc = (e) => { if (this._pickerOpen && !e.composedPath().includes(this)) { this._pickerOpen = false; this.render(); } };
    if (typeof document !== 'undefined') document.addEventListener('mousedown', this._onDoc);
  }

  disconnectedCallback() { if (typeof document !== 'undefined') document.removeEventListener('mousedown', this._onDoc); super.disconnectedCallback?.(); }

  async load() {
    if (!this.client) { this.render(); return; }
    try {
      const [tax, pool] = await Promise.all([this.client.taxonomy?.(), this.client.contentChannelPool?.()]);
      this._tree = tax?.tree || {};
      this._pool = pool?.channels || [];
    } catch { this._tree = {}; this._pool = []; }
    // The public index JSONs carry every item's full categories path (build-time; no auth needed).
    const items = {};
    await Promise.all(Object.entries(INDEXES).map(async ([type, file]) => {
      try {
        const res = await fetch(`${SITE}/${file}`, { cache: 'no-cache' });
        const data = await res.json();
        items[type] = Array.isArray(data) ? data : data?.items || [];
      } catch { items[type] = []; }
    }));
    this._items = items;
    this._counts = countRollup(this._tree, items);
    this._loading = false;
    this.render();
  }

  // ---- helpers over state
  nodeAt(path) {
    let cur = { children: this._tree };
    for (const k of path || []) { cur = cur?.children?.[k]; if (!cur) return null; }
    return cur;
  }
  labelOf(path) {
    // a pending label op wins so the UI reflects the unmerged edit
    const p = this._pending.get(`label:${path.join('/')}`);
    return p ? p.args.label : (this.nodeAt(path)?.label || path[path.length - 1]);
  }
  countOf(path) { return this._counts?.get(path.join('/'))?.total ?? 0; }
  statusOf(path) { return channelStatusFor(path[path.length - 1], this._pool || [], [...this._pending.values()]); }

  render() {
    if (!this.client) { this.set(this.css(CSS) + `<p class="muted">Sign in with the GBTI client to manage categories.</p>`); return; }
    if (!this._tree) {
      if (!this._loading) { this._loading = true; this.load(); }
      this.set(this.css(CSS) + `<p class="muted">Loading the taxonomy…</p>`);
      return;
    }
    const plan = batchPlan(this._pending);
    const header = `
      <div class="chead">
        <div class="grow"><h2>Categories</h2><span class="muted">The canonical taxonomy, its Discord channels, and the content filed under each. Edits publish together as one house PR.</span></div>
        <span class="pending" ${plan.count ? '' : 'hidden'}><span class="cnt">${plan.count}</span> unpublished edit${plan.count === 1 ? '' : 's'}</span>
        <button class="btn soft" id="newtop" type="button">New category</button>
        <button class="btn pr" id="review" type="button" ${plan.count ? '' : 'disabled'}>${plan.count ? `Publish ${plan.count} change${plan.count === 1 ? '' : 's'}` : 'Nothing to publish'}</button>
      </div>`;
    const body = `<div class="cpane">${this._treeHtml()}<div class="detail">${this._sel ? this._detailHtml() : this._emptyHtml()}</div></div>
      ${this._msg ? `<p class="msg">${this._msg}</p>` : ''}`;
    this.set(this.css(CSS) + header + body);
    this._wire();
  }

  _treeHtml() {
    const q = this._q.trim().toLowerCase();
    const flat = flattenTree(this._tree);
    const matches = (n) => !q || n.label.toLowerCase().includes(q) || n.key.toLowerCase().includes(q);
    const deepMatch = new Set();
    if (q) {
      for (const n of flat) {
        if (matches(n)) for (let d = 1; d <= n.path.length; d++) deepMatch.add(n.path.slice(0, d).join('/'));
      }
    }
    const rows = [];
    const walk = (tree, parentPath) => {
      for (const [key, node] of Object.entries(tree || {})) {
        const path = [...parentPath, key];
        const pk = path.join('/');
        if (q && !deepMatch.has(pk)) continue;
        const level = parentPath.length;
        const kids = node?.children && Object.keys(node.children).length;
        const closed = !q && this._collapsed.has(pk);
        const on = this._sel && this._sel.join('/') === pk;
        rows.push(`<button class="titem lvl${level} ind${Math.min(level, 3)}${closed ? ' closed' : ''}${on ? ' on' : ''}" type="button" data-sel="${esc(pk)}" data-kids="${kids ? 1 : 0}">
          <span class="car${kids ? '' : ' leaf'}" data-car="${esc(pk)}">▾</span>
          <span class="lab">${esc(this.labelOf(path))}</span>
          <span class="cnt">${this.countOf(path)}</span>
          <span class="dot ${esc(this.statusOf(path))}"></span>
        </button>`);
        if (kids && !closed) walk(node.children, path);
      }
    };
    walk(this._tree, []);
    return `<aside class="tree-col">
      <div class="csearch"><input id="tsearch" type="search" placeholder="Filter categories…" value="${esc(this._q)}" /></div>
      <div class="tscroll" role="tree">${rows.join('') || `<p class="muted" style="padding:10px">No categories match.</p>`}
        <button class="titem tnew" type="button" id="newtop2">+ New top-level category</button>
      </div>
      <div class="legend"><span><i style="background:var(--brand)"></i>Synced</span><span><i style="background:var(--amber)"></i>Pending PR</span><span><i style="background:var(--line)"></i>No channel</span></div>
    </aside>`;
  }

  _detailHtml() {
    const path = this._sel;
    const node = this.nodeAt(path);
    if (!node) { this._sel = null; return this._emptyHtml(); }
    const key = path[path.length - 1];
    const label = this.labelOf(path);
    const lvl = path.length === 1 ? 'Top level' : node.children && Object.keys(node.children).length ? 'Subcategory' : 'Leaf';
    const crumb = [`<b data-desel>Taxonomy</b>`, ...path.slice(0, -1).map((k, i) => `<b data-crumb="${esc(path.slice(0, i + 1).join('/'))}">${esc(this.labelOf(path.slice(0, i + 1)))}</b>`)].join(' / ');
    const c = this._counts?.get(path.join('/')) || { post: 0, prompt: 0, product: 0, total: 0 };
    const kids = Object.entries(node.children || {});
    const editor = `
      <div class="card">
        <div class="crumb">${crumb}</div>
        <div class="dtitle"><h3>${esc(label)}</h3><span class="lvltag">${lvl}</span><button class="dclose" type="button" data-desel title="Back to the category dashboard">✕ Close</button></div>
        <div class="fields">
          <div class="fld"><label>Display label</label><input id="labelin" value="${esc(label)}" /></div>
          <div class="fld"><label>Key</label><input class="mono" value="${esc(key)}" readonly /><div class="hint">Renaming a key opens a review-gated migration that rewrites every filed item.</div></div>
        </div>
        ${this._discordHtml(key)}
        <div class="sech">Subcategories</div>
        <div class="sublist">${kids.map(([k2]) => {
          const p2 = [...path, k2];
          return `<button class="subrow" type="button" data-sel="${esc(p2.join('/'))}"><span>${esc(this.labelOf(p2))}</span><span class="k">${esc(k2)}</span><span class="n">${this.countOf(p2)}</span></button>`;
        }).join('') || `<p class="muted">No subcategories.</p>`}</div>
        <div class="addsub"><input id="subkey" placeholder="new-key" /><input id="sublabel" placeholder="Display label" /><button class="btn soft" id="addsub" type="button">Add subcategory</button></div>
        <div class="sech" style="margin-top:20px">Danger zone</div>
        <div class="card danger" style="padding:12px 14px">
          <div class="drow">
            <button class="btn warn" id="renamekey" type="button">Rename key…</button>
            <button class="btn warn" id="movecat" type="button">Move…</button>
            <button class="btn warn" id="removecat" type="button">Remove…</button>
          </div>
          <div id="dangerui"></div>
          <div class="hint">Each opens a review-gated migration PR that rewrites the filed content (never batched).</div>
        </div>
      </div>`;
    const dash = `
      <div>
        <div class="stats">
          <div class="stat accent"><div class="n">${kids.length}</div><div class="l">Subcategories</div></div>
          <div class="stat"><div class="n">${c.post}</div><div class="l">Articles</div></div>
          <div class="stat"><div class="n">${c.prompt}</div><div class="l">Prompts</div></div>
          <div class="stat"><div class="n">${c.product}</div><div class="l">Products</div></div>
        </div>
        <div class="card">${this._browserHtml(path)}</div>
      </div>`;
    return `<div class="dgrid">${editor}${dash}</div>`;
  }

  _discordHtml(key) {
    const mapped = channelFor(key, this._pool || []);
    const pendingOp = this._pending.get(`channel:${key}`);
    const effective = pendingOp ? (pendingOp.kind === 'channel-set' ? pendingOp.args.channelId : null) : mapped;
    const status = pendingOp ? 'Pending house PR' : mapped ? 'Synced (in the git map)' : 'No channel linked';
    const pool = this._pool || [];
    const options = [...new Map(pool.map((r) => [String(r.channelId), r])).values()];
    const menu = this._pickerOpen ? `<div class="dmenu">
        ${options.map((r) => `<button class="dopt" type="button" data-pickch="${esc(String(r.channelId))}"><span class="hash">#</span>${esc(String(r.channelId))}<span class="used">${esc(r.category)}${String(r.channelId) === String(effective ?? '') ? ' · current' : ''}</span></button>`).join('')}
        ${effective ? `<button class="dopt unlink" type="button" data-unlink="1">Unlink channel</button>` : ''}
      </div>` : '';
    return `
      <div class="sech" style="margin-top:18px">Discord channel</div>
      <div class="dcard">
        <div class="row1"><span class="sav">G</span><div><b>GBTI Network</b><div class="st">${esc(status)}</div></div></div>
        <div class="pickrow">
          <div class="pick"><button class="pickbtn" id="pickbtn" type="button" aria-expanded="${this._pickerOpen}"><span class="hash">#</span>${effective ? esc(String(effective)) : '<span class="muted">choose a channel…</span>'}</button>${menu}</div>
        </div>
        <div class="manrow"><input id="manch" placeholder="or paste a channel id (numbers only)" inputmode="numeric" /><button class="btn soft" id="manset" type="button">Set</button></div>
        <div class="dnote">Routing is fixed dual-post: a published item announces in its type's featured channel AND this mapped category channel (SOW-087). Per-category routing toggles are a follow-up.</div>
      </div>`;
  }

  _browserHtml(path) {
    const items = (this._items?.[this._cbType] || []);
    const filed = items.filter((it) => Array.isArray(it.categories) && path.every((k, i) => it.categories[i] === k));
    const pg = paginate(filed, this._cbPage, CB_PER);
    const now = Date.now();
    const tabs = Object.keys(INDEXES).map((t) => {
      const n = (this._items?.[t] || []).filter((it) => Array.isArray(it.categories) && path.every((k, i) => it.categories[i] === k)).length;
      return `<button class="cbtab${t === this._cbType ? ' on' : ''}" type="button" data-cbtab="${t}">${TYPE_LABEL[t]}<span class="n">${n}</span></button>`;
    }).join('');
    const rows = pg.items.map((it) => `<div class="cbrow">
        <div style="min-width:0"><a href="${SITE}${esc(it.url || '')}" target="_blank" rel="noopener">${esc(it.title || it.slug || '')}</a>
        <div class="sub">@${esc(it.author || '')}${it.publishedAt ? ` · ${esc(relAge(Number(it.publishedAt), now))}` : ''}</div></div>
      </div>`).join('');
    const pager = pg.pages > 1 ? `<div class="cbfoot"><span class="rng">${pg.from}–${pg.to} of ${pg.total}</span>
        <button class="pgb" type="button" data-cbpage="${pg.page - 1}" ${pg.page === 1 ? 'disabled' : ''}>‹</button>
        ${pageWindow(pg.page, pg.pages).map((n) => (n === '…' ? `<span class="dots">…</span>` : `<button class="pgb${n === pg.page ? ' on' : ''}" type="button" data-cbpage="${n}">${n}</button>`)).join('')}
        <button class="pgb" type="button" data-cbpage="${pg.page + 1}" ${pg.page === pg.pages ? 'disabled' : ''}>›</button>
      </div>` : '';
    return `<div class="cbtabs">${tabs}</div>${rows || `<div class="cbempty">Nothing filed here yet.</div>`}${pager}`;
  }

  _emptyHtml() {
    const flat = flattenTree(this._tree);
    const mapped = flat.filter((n) => channelStatusFor(n.key, this._pool || [], []) === 'synced').length;
    const needs = flat.filter((n) => n.path.length === 1 && channelStatusFor(n.key, this._pool || [], []) === 'none');
    return `<div class="card">
      <div class="empty-hero"><h3>No category selected</h3><p class="muted">Pick a category from the tree to edit it, map its Discord channel, and browse its content.</p></div>
      <div class="stats" style="margin-top:14px">
        <div class="stat accent"><div class="n">${flat.length}</div><div class="l">Categories</div></div>
        <div class="stat"><div class="n">${mapped}</div><div class="l">Mapped to Discord</div></div>
        <div class="stat warn"><div class="n">${needs.length}</div><div class="l">Need a channel</div></div>
        <div class="stat"><div class="n">${this._pending.size}</div><div class="l">Unmerged edits</div></div>
      </div>
      ${needs.length ? `<div class="needs"><div class="sech">Needs a Discord channel</div>${needs.map((n) => `<button class="subrow" type="button" data-sel="${esc(n.path.join('/'))}"><span class="dot"></span><span>${esc(n.label)}</span><span class="k">${esc(n.key)}</span></button>`).join('')}</div>` : ''}
    </div>`;
  }

  _wire() {
    this.$('#tsearch')?.addEventListener('input', (e) => { this._q = e.target.value; this.render(); this.$('#tsearch')?.focus(); const el = this.$('#tsearch'); if (el) el.setSelectionRange(el.value.length, el.value.length); });
    this.$$('[data-sel]').forEach((b) => b.addEventListener('click', (e) => {
      if (e.target.closest('[data-car]') && b.dataset.kids === '1') return; // caret handles collapse
      const pk = b.dataset.sel;
      this._sel = this._sel && this._sel.join('/') === pk ? null : pk.split('/');
      this._cbPage = 1; this._pickerOpen = false; this.render();
    }));
    this.$$('[data-car]').forEach((c) => c.addEventListener('click', (e) => {
      const pk = c.dataset.car;
      const btn = c.closest('[data-sel]');
      if (btn?.dataset.kids !== '1') return;
      e.stopPropagation();
      this._collapsed.has(pk) ? this._collapsed.delete(pk) : this._collapsed.add(pk);
      this.render();
    }));
    this.$$('[data-crumb]').forEach((b) => b.addEventListener('click', () => { this._sel = b.dataset.crumb.split('/'); this._cbPage = 1; this.render(); }));
    this.$$('[data-desel]').forEach((b) => b.addEventListener('click', () => { this._sel = null; this._pickerOpen = false; this.render(); }));
    // keyboard: arrows move the tree selection, Enter selects, Esc closes the picker
    this.$('.tscroll')?.addEventListener('keydown', (e) => {
      const items = this.$$('.titem[data-sel]');
      const idx = items.findIndex((b) => b === this.root.activeElement);
      if (e.key === 'ArrowDown' && idx < items.length - 1) { items[idx + 1].focus(); e.preventDefault(); }
      if (e.key === 'ArrowUp' && idx > 0) { items[idx - 1].focus(); e.preventDefault(); }
    });
    this.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this._pickerOpen) { this._pickerOpen = false; this.render(); }
      else if (this._sel) { this._sel = null; this.render(); } // Esc steps back to the dashboard
    });

    const newTop = () => {
      const key = (typeof prompt === 'function' && prompt('New top-level category key (kebab-case):')) || '';
      if (!key.trim()) return;
      const label = (typeof prompt === 'function' && prompt('Display label:', key)) || key;
      upsertOp(this._pending, { kind: 'add', args: { parentPath: [], key: key.trim().toLowerCase(), label: label.trim() } });
      this.render();
    };
    this.on('#newtop', 'click', newTop);
    this.on('#newtop2', 'click', newTop);
    this.on('#addsub', 'click', () => {
      const key = this.$('#subkey')?.value?.trim().toLowerCase();
      const label = this.$('#sublabel')?.value?.trim();
      if (!key || !this._sel) return;
      upsertOp(this._pending, { kind: 'add', args: { parentPath: [...this._sel], key, label: label || key } });
      this.render();
    });
    this.$('#labelin')?.addEventListener('change', (e) => {
      const label = e.target.value.trim();
      if (!label || !this._sel) return;
      if (label === (this.nodeAt(this._sel)?.label || '')) { this._pending.delete(`label:${this._sel.join('/')}`); }
      else upsertOp(this._pending, { kind: 'label', args: { path: [...this._sel], label } });
      this.render();
    });
    this.on('#pickbtn', 'click', () => { this._pickerOpen = !this._pickerOpen; this.render(); });
    this.$$('[data-pickch]').forEach((b) => b.addEventListener('click', () => this._setChannel(b.dataset.pickch)));
    this.$$('[data-unlink]').forEach((b) => b.addEventListener('click', () => {
      const key = this._sel[this._sel.length - 1];
      upsertOp(this._pending, { kind: 'channel-remove', args: { category: key } });
      this._pickerOpen = false; this.render();
    }));
    this.on('#manset', 'click', () => {
      const v = this.$('#manch')?.value?.trim();
      if (v && /^[0-9]{5,25}$/.test(v)) this._setChannel(v);
      else this._msg = 'A Discord channel id is 5 to 25 digits.'; this.render();
    });
    this.$$('[data-cbtab]').forEach((b) => b.addEventListener('click', () => { this._cbType = b.dataset.cbtab; this._cbPage = 1; this.render(); }));
    this.$$('[data-cbpage]').forEach((b) => b.addEventListener('click', () => { this._cbPage = Number(b.dataset.cbpage) || 1; this.render(); }));
    this.on('#review', 'click', () => this._review());
    this.on('#renamekey', 'click', () => this._dangerKey());
    this.on('#movecat', 'click', () => this._dangerMove());
    this.on('#removecat', 'click', () => this._dangerRemove());
  }

  _setChannel(channelId) {
    const key = this._sel[this._sel.length - 1];
    upsertOp(this._pending, { kind: 'channel-set', args: { category: key, channelId: String(channelId) } });
    this._pickerOpen = false;
    this._msg = null;
    this.render();
  }

  async _review() {
    const plan = batchPlan(this._pending);
    if (!plan.count) return;
    this._msg = 'Publishing the changes…'; this.render();
    try {
      const res = await this.client.admin('category-batch', { ops: [...this._pending.values()], descriptions: plan.descriptions });
      this._pending.clear();
      this._msg = res?.noop ? 'Everything in the batch was already applied.' : `Published as PR #${res?.prNumber ?? '?'} — the changes reach the site about 2 to 3 minutes after it merges.`;
      await this.load();
    } catch (err) { this._msg = esc(err?.message || 'The batch could not be opened.'); this.render(); }
  }

  // ---- the review-gated migrations (immediate, confirm-gated, never batched)
  async _migrate(action, extra, confirmText) {
    if (typeof confirm === 'function' && !confirm(confirmText)) return;
    this._msg = 'Dispatching the review-gated migration…'; this.render();
    try {
      await this.client.adminOp('category-migrate', { action, from: [...this._sel], ...extra, apply: true });
      this._msg = 'Migration dispatched. It opens a review-gated PR that rewrites the filed content; watch the repository pull requests.';
    } catch (err) { this._msg = esc(err?.message || 'The migration could not be dispatched.'); }
    this.render();
  }
  _dangerKey() {
    const nk = (typeof prompt === 'function' && prompt('New key (kebab-case). This rewrites every filed item via a review-gated PR:', this._sel[this._sel.length - 1])) || '';
    if (!nk.trim()) return;
    this._migrate('rename', { newKey: nk.trim().toLowerCase() }, `Rename the key to "${nk.trim().toLowerCase()}"? A review-gated migration PR rewrites all filed content.`);
  }
  _dangerMove() {
    const ui = this.$('#dangerui');
    if (!ui) return;
    const flat = flattenTree(this._tree).filter((n) => {
      const pk = n.path.join('/');
      const selPk = this._sel.join('/');
      return pk !== selPk && !pk.startsWith(`${selPk}/`) && pk !== this._sel.slice(0, -1).join('/');
    });
    ui.innerHTML = `<div class="moverow"><span class="hint">Move under:</span><select id="movesel"><option value="">Top level</option>${flat.map((n) => `<option value="${esc(n.path.join('/'))}">${esc(n.path.map((k, i) => this.labelOf(n.path.slice(0, i + 1))).join(' / '))}</option>`).join('')}</select><button class="btn warn" id="movego" type="button">Move</button></div>`;
    ui.querySelector('#movego')?.addEventListener('click', () => {
      const to = ui.querySelector('#movesel')?.value || '';
      this._migrate('move', { toParent: to ? to.split('/') : [] }, `Move "${this.labelOf(this._sel)}"${to ? ` under ${to}` : ' to the top level'}? A review-gated migration PR rewrites all filed content.`);
    });
  }
  _dangerRemove() {
    const hasItems = this.countOf(this._sel) > 0;
    this._migrate('remove', { reassign: hasItems }, hasItems
      ? `Remove "${this.labelOf(this._sel)}"? Its ${this.countOf(this._sel)} filed item(s) are reassigned to the parent by the review-gated migration.`
      : `Remove the empty category "${this.labelOf(this._sel)}"? A review-gated migration PR applies it.`);
  }
}

define('gbti-categories-workspace', GbtiCategoriesWorkspace);
