// <gbti-category-picker> (sow-227): choose exactly ONE category by search, from a grouped list or a tree. Built from
// the design the owner approved on 2026-09-23 (the "Category Picker" canvas), in the website's look, and used by
// both hosts: the share composer (vocab="topics", the share topics under the Categories screen's headings) and the
// editor's Category field (vocab="tree", the content category tree, chosen as a full path).
//
// sow-408 (owner-approved canvas "Share Category Tree", 2026-09-25): the topics read as a two-level tree. Each group
// is a parent row, pinned while its topics scroll, with its size ("24", or "2 of 9" while searching); the topics sit
// one level in on the tree's elbow connector; the closed picker names the group, "DevOps — Hosting". What a share
// stores is unchanged: still the topic key.
//
// It loads its own vocabulary from the public gbti.network JSON (/topics.json, /taxonomy.json), one fetch per page,
// and never touches the client, so a client broadcast never re-renders it mid-search. It opens IN the flow of the
// page rather than floating, so the share dialog and the extension panel cannot clip it.
//
// API: `vocab` and `value` attributes; `value` (a topic key, or a path 'ai/prompts/skill') and `path` properties;
// `has(key)`; `ready` (resolves true once the vocabulary loaded); `focus()`. Emits `change` (bubbling, composed)
// with { value, path, label } when the member picks something new. Setting `value` in code emits nothing, as a
// native select does not.
import { GbtiElement, define, esc } from '../base.mjs';
import { topicsFromJson, groupOrderFromJson } from '../topic-picker-core.mjs';
import { treeNodesFromJson, pickerRows, valueDisplay, highlightParts, moveActive, PATH_SEP } from '../category-picker-core.mjs';

const SITE = 'https://gbti.network';
const SOURCE = { topics: `${SITE}/topics.json`, tree: `${SITE}/taxonomy.json` };
const LOADS = new Map();

/** One fetch per vocabulary per page, shared by every picker on it. A failure is not kept, so a retry refetches. */
function loadVocab(kind) {
  if (!LOADS.has(kind)) {
    const p = fetch(SOURCE[kind], { cache: 'no-cache' })
      .then((r) => { if (!r.ok) throw new Error(`http-${r.status}`); return r.json(); })
      .then((data) => (kind === 'tree'
        ? { kind, nodes: treeNodesFromJson(data) }
        : { kind, topics: topicsFromJson(data), groupOrder: groupOrderFromJson(data) }))
      .then((v) => { if (!(v.nodes || v.topics).length) throw new Error('empty'); return v; })
      .catch(() => { LOADS.delete(kind); return null; });
    LOADS.set(kind, p);
  }
  return LOADS.get(kind);
}

const svg = (body, cls) => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const CARET = svg('<path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>', 'caret');
const CHECK = svg('<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>', 'ck');
const SEARCH = svg('<circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M16.5 16.5 21 21" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>', 'si');
const WARN = svg('<path d="M12 3 2 20h20L12 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v4M12 17v.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>', 'warn');

// The site's mono stack (src/styles/gbti-v3.css --f-mono), named literally: the shared tokens carry no mono font.
const MONO = `'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace`;

// BASE_CSS styles every bare button green with a green hover, so the trigger names its own background for both.
const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  [hidden] { display:none !important; }
  .trig { width:100%; min-height:44px; display:flex; align-items:center; gap:10px; padding:10px 12px; font:inherit; font-size:14px; font-weight:400;
    text-align:left; cursor:pointer; background:var(--panel); color:var(--fg); border:1.5px solid var(--line-2); border-radius:8px; }
  .trig:hover { background:var(--panel); border-color:var(--brand); }
  .trig:focus-visible, .trig[aria-expanded="true"] { outline:none; border-color:var(--brand); box-shadow:0 0 0 3px var(--green-tint); }
  .trig.bad, .trig.bad:hover { border-color:var(--danger); color:var(--danger); box-shadow:none; }
  .tv { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .tv.ph, .crumb { color:var(--fg-mute); }
  .leaf { font-weight:600; }
  .tv.mono { font-family:${MONO}; font-size:12.5px; }
  svg { flex:none; width:16px; height:16px; }
  .caret { color:var(--fg-mute); transition:transform .15s ease; }
  .trig[aria-expanded="true"] .caret { transform:rotate(180deg); }
  .note { margin:7px 2px 0; font-size:12.5px; line-height:1.45; color:var(--danger); }
  .pop { margin-top:6px; background:var(--panel); border:1px solid var(--line-2); border-radius:12px; padding:6px;
    box-shadow:0 12px 30px -12px rgba(0,0,0,.32); }
  :host-context([data-theme="dark"]) .pop { box-shadow:0 14px 34px -12px rgba(0,0,0,.7); }
  .sw { position:relative; }
  .si { position:absolute; left:13px; top:50%; transform:translateY(-50%); width:15px; height:15px; color:var(--fg-mute); pointer-events:none; }
  .srch { width:100%; font-family:${MONO}; font-size:13px; padding:9px 14px 9px 36px; border:1.5px solid var(--brand); border-radius:999px;
    box-shadow:0 0 0 3px var(--green-tint); background:var(--panel); color:var(--fg); outline:none; }
  .srch::placeholder { color:var(--fg-mute); }
  .list { max-height:288px; overflow-y:auto; margin-top:6px; display:flex; flex-direction:column; gap:1px; }
  /* sow-408: a topic group is a parent row that stays pinned while its own topics scroll under it (the owner's
     screenshot, scrolled mid-group, had no heading in view). Glass makes --panel translucent, so the pinned row frosts
     what passes beneath it; flat defines no --glass-blur and it is a no-op. */
  .sec { display:flex; flex-direction:column; gap:1px; padding-bottom:6px; }
  .grp { position:sticky; top:0; z-index:1; display:flex; align-items:center; gap:8px; margin-bottom:2px; padding:9px 12px 7px;
    font-size:14px; font-weight:700; color:var(--fg); background:var(--panel); border-bottom:1px solid var(--line); cursor:default;
    -webkit-backdrop-filter:var(--glass-blur, none); backdrop-filter:var(--glass-blur, none); }
  .gl { flex:1; min-width:0; }
  .gc { font-family:${MONO}; font-size:11px; font-weight:500; color:var(--fg-mute); }
  .sec .opt { scroll-margin-top:40px; }
  .opt { display:flex; align-items:center; gap:8px; padding:7px 12px; border-radius:8px; font-size:14px; line-height:1.35; font-weight:500; color:var(--fg); cursor:pointer; }
  .opt.top { font-weight:650; }
  .opt.muted { color:var(--fg-mute); }
  .opt.act { background:var(--green-tint); color:var(--accent); }
  .opt.sel { color:var(--accent); font-weight:700; }
  .br { flex:none; width:9px; height:9px; margin-top:-6px; border-left:1.5px solid var(--line-2); border-bottom:1.5px solid var(--line-2); border-bottom-left-radius:3px; }
  .lb { flex:1; min-width:0; }
  mark { background:none; color:inherit; font-weight:800; text-decoration:underline; text-underline-offset:3px; }
  .ck { width:15px; height:15px; }
  .empty { padding:14px 12px; font-size:13.5px; color:var(--fg-mute); }
  .keys { display:flex; gap:16px; padding:8px 10px 3px; margin-top:6px; border-top:1px solid var(--line); font-family:${MONO}; font-size:11px; color:var(--fg-mute); }
  @media (hover: none) { .keys { display:none; } }
`;

class GbtiCategoryPicker extends GbtiElement {
  constructor() {
    super();
    this._value = '';
    this._open = false;
    this._query = '';
    this._active = -1;
    this._vocab = null;
    this._failed = false;
    this._options = [];
    this._onDocDown = (e) => { if (!e.composedPath().includes(this)) this._close(false); };
  }

  connectedCallback() {
    if (!this._valueSet && this.hasAttribute('value')) this._value = this.getAttribute('value') || '';
    super.connectedCallback?.();
    this._load();
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();
    document.removeEventListener('pointerdown', this._onDocDown, true);
  }

  // It never reads the client, so a client broadcast has nothing to refresh and would only reset an open search.
  skipClientRender() { return true; }

  get kind() { return this.getAttribute('vocab') === 'tree' ? 'tree' : 'topics'; }
  get value() { return this._value; }
  set value(v) {
    this._value = v == null ? '' : String(v);
    this._valueSet = true;
    if (this.isConnected) this.render();
  }
  get path() { return this._value ? (this.kind === 'tree' ? this._value.split('/').filter(Boolean) : [this._value]) : []; }
  get ready() { return this._load(); }

  /** Whether `key` is in the loaded vocabulary (false while it loads). */
  has(key) {
    const v = this._vocab;
    if (!v || !key) return false;
    return v.kind === 'tree' ? v.nodes.some((n) => n.key === key) : v.topics.some((t) => t.key === key);
  }

  focus() { this.$('.trig')?.focus(); }

  _load() {
    if (!this._loading) {
      this._loading = loadVocab(this.kind).then((v) => {
        this._vocab = v;
        this._failed = !v;
        if (!v) this._loading = null; // let the next attempt refetch
        if (this.isConnected) this.render();
        return Boolean(v);
      });
    }
    return this._loading;
  }

  render() {
    const d = valueDisplay(this._vocab, this._value);
    const bad = this._failed || d.state === 'unknown';
    let face;
    if (this._failed) face = `<span class="tv">Categories did not load. Click to try again.</span>`;
    else if (d.state === 'empty') face = `<span class="tv ph">${esc(this.getAttribute('placeholder') || 'Choose a category')}</span>`;
    else if (d.state === 'loading') face = `<span class="tv ph">${esc(d.leaf)}</span>`;
    else if (d.state === 'unknown') face = `${WARN}<span class="tv mono">${esc(d.leaf)}</span>`;
    else face = `<span class="tv">${d.crumbs.length ? `<span class="crumb">${esc(d.crumbs.join(PATH_SEP) + PATH_SEP)}</span>` : ''}<span class="leaf">${esc(d.leaf)}</span></span>`;
    const said = d.state === 'known' ? `: ${[...d.crumbs, d.leaf].join(', ')}` : '';
    const count = this._vocab?.topics?.length;
    this.set(this.css(CSS) + `
      <button class="trig${bad ? ' bad' : ''}" type="button" aria-haspopup="listbox" aria-expanded="${this._open}"
        aria-label="${esc((this.getAttribute('aria-label') || 'Category') + said)}"${this.hasAttribute('required') ? ' aria-required="true"' : ''}>${face}${CARET}</button>
      ${d.state === 'unknown' && !this._open ? '<p class="note">Not in the category list, so publishing would stop here. Choose a category to replace it.</p>' : ''}
      ${this._open ? `<div class="pop">
        <div class="sw">${SEARCH}<input class="srch" type="search" role="combobox" aria-expanded="true" aria-controls="cp-list" aria-autocomplete="list"
          aria-label="Search categories" placeholder="${this.kind === 'tree' ? 'Search categories' : `Search ${count ? `${count} ` : ''}topics`}" autocomplete="off" spellcheck="false"></div>
        <div class="list" id="cp-list" role="listbox" aria-label="Categories"></div>
        <div class="keys" aria-hidden="true"><span>↑ ↓ move</span><span>Enter choose</span><span>Esc close</span></div>
      </div>` : ''}`);
    this.on('.trig', 'click', () => this._toggle());
    if (!this._open) return;
    const s = this.$('.srch');
    s.value = this._query;
    s.addEventListener('input', () => { this._query = s.value; this._active = 0; this._renderList(); });
    s.addEventListener('keydown', (e) => this._onKey(e));
    const list = this.$('.list');
    list.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the search box
    list.addEventListener('click', (e) => { const o = e.target.closest('[data-i]'); if (o) this._pick(Number(o.dataset.i)); });
    list.addEventListener('mousemove', (e) => {
      const o = e.target.closest('[data-i]');
      if (o && Number(o.dataset.i) !== this._active) { this._active = Number(o.dataset.i); this._paintActive(false); }
    });
    this._renderList();
  }

  _renderList() {
    const list = this.$('.list');
    if (!list) return;
    if (!this._vocab) { list.innerHTML = `<div class="empty">${this._failed ? 'Categories did not load.' : 'Loading…'}</div>`; return; }
    const { rows, options } = pickerRows(this._vocab, this._query);
    this._options = options;
    if (this._active >= options.length) this._active = options.length - 1;
    const tree = this._vocab.kind === 'tree';
    const q = this._query;
    const searching = Boolean(String(q ?? '').trim());
    let i = -1;
    let inSec = false;
    // sow-408: a topic group opens a section (role="group", named by its label) whose header is pinned; the header is
    // hidden from assistive tech because the group's own name already says it. Topics sit one level in, on the same
    // elbow connector as the tree, and a tree keeps its 20px per level.
    const html = rows.map((r) => {
      if (r.type === 'group') {
        const open = `${inSec ? '</div>' : ''}<div class="sec" role="group" aria-label="${esc(r.label)}">`;
        inSec = true;
        return `${open}<div class="grp" aria-hidden="true"><span class="gl">${esc(r.label)}</span>`
          + `<span class="gc">${searching ? `${r.count} of ${r.total}` : r.total}</span></div>`;
      }
      i += 1;
      const sel = r.key === this._value;
      const p = highlightParts(r.label, r.muted ? '' : q);
      const cls = `opt${sel ? ' sel' : ''}${r.muted ? ' muted' : ''}${tree && r.depth === 0 ? ' top' : ''}`;
      const pad = tree ? 12 + r.depth * 20 : (r.depth ? 20 : 12);
      return `<div class="${cls}" role="option" id="cp-o${i}" data-i="${i}" aria-selected="${sel}" style="padding-left:${pad}px">`
        + `${r.depth > 0 ? '<span class="br" aria-hidden="true"></span>' : ''}`
        + `<span class="lb">${esc(p.pre)}${p.mid ? `<mark>${esc(p.mid)}</mark>` : ''}${esc(p.post)}</span>${sel ? CHECK : ''}</div>`;
    }).join('') + (inSec ? '</div>' : '');
    list.innerHTML = options.length ? html : '<div class="empty">Nothing matches that search.</div>';
    this._paintActive(true);
  }

  _paintActive(scroll) {
    this.$$('.opt').forEach((o) => o.classList.toggle('act', Number(o.dataset.i) === this._active));
    const act = this.$(`#cp-o${this._active}`);
    const s = this.$('.srch');
    if (s) { if (act) s.setAttribute('aria-activedescendant', act.id); else s.removeAttribute('aria-activedescendant'); }
    if (scroll) act?.scrollIntoView?.({ block: 'nearest' });
  }

  _toggle() {
    if (this._failed) { this._failed = false; this.render(); this._load(); return; }
    if (this._open) { this._close(true); return; }
    this._open = true;
    this._query = '';
    const start = this._vocab ? pickerRows(this._vocab, '').options.findIndex((o) => o.key === this._value) : -1;
    this._active = Math.max(0, start);
    this.render();
    this.$('.srch')?.focus();
    document.addEventListener('pointerdown', this._onDocDown, true);
  }

  _close(refocus) {
    if (!this._open) return;
    this._open = false;
    this._query = '';
    document.removeEventListener('pointerdown', this._onDocDown, true);
    this.render();
    if (refocus) this.$('.trig')?.focus();
  }

  _pick(i) {
    const o = this._options[i];
    if (!o) return;
    const changed = o.key !== this._value;
    this._value = o.key;
    this._valueSet = true;
    this._close(true);
    if (changed) this.emit('change', { value: this._value, path: this.path, label: o.label });
  }

  _onKey(e) {
    const n = this._options.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this._active = moveActive(this._active, e.key === 'ArrowDown' ? 1 : -1, n);
      this._paintActive(true);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (this._active >= 0) this._pick(this._active);
    } else if (e.key === 'Escape') {
      // Stopped here so a picker inside the share dialog closes itself, not the dialog and the draft with it.
      e.preventDefault();
      e.stopPropagation();
      this._close(true);
    } else if (e.key === 'Tab') {
      this._close(false);
    }
  }
}

define('gbti-category-picker', GbtiCategoryPicker);
export { GbtiCategoryPicker };
