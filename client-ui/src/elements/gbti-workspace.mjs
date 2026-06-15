// <gbti-workspace> (SOW-033): the member's management surface inside the extension. A tabbed view of everything
// they own (Articles / Prompts / Products) plus their pull requests with live gate status, and a pinned profile
// row. Each content row opens the item IN PLACE in an embedded <gbti-content-editor> (open-inside-the-extension,
// the SOW-031 tie), reusing the exact gbti-content-list -> editor.load flow. PR rows classify into Proposed /
// Needs changes / Accepted / Declined via the pure classifyPull helper. Host-agnostic (consumes only the
// injected client) so it runs in the extension now and the npm CMS later. Fail-soft: every read falls back to an
// empty state, never throws.
import { GbtiElement, define, esc } from '../base.mjs';
import { classifyPull } from '../workspace-core.mjs';
import './gbti-content-editor.mjs';

const TABS = [
  { id: 'post', label: 'Articles', type: 'post' },
  { id: 'prompt', label: 'Prompts', type: 'prompt' },
  { id: 'product', label: 'Products', type: 'product' },
  { id: 'prs', label: 'Pull requests' },
];

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .tabs { display:flex; gap:4px; background:var(--panel); border:1px solid var(--line); border-radius:999px; padding:4px; margin:0 0 16px; flex-wrap:wrap; }
  .tab { border:0; background:transparent; color:var(--muted); font:inherit; font-weight:700; font-size:13px; padding:7px 15px; border-radius:999px; cursor:pointer; }
  .tab.on { background:var(--hover); color:var(--accent); }
  .profile { display:flex; align-items:center; gap:10px; border:1px solid var(--line); border-radius:12px; padding:11px 14px; margin:0 0 14px; background:var(--panel); font-size:14px; }
  .profile .lbl { color:var(--muted); font-size:12px; }
  .profile button { margin-left:auto; }
  ul.rows { list-style:none; margin:0; padding:0; }
  .row { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:11px 2px; border-top:1px solid var(--line); }
  .row:first-child { border-top:0; }
  .row .t { min-width:0; overflow:hidden; }
  .row .t b { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .row .t .meta { color:var(--muted); font-size:12.5px; }
  .tag { display:inline-block; padding:2px 8px; border-radius:999px; background:var(--hover); font-size:11.5px; color:var(--muted); white-space:nowrap; }
  .tag.ok { background:rgba(31,158,95,.14); color:var(--accent); }
  .tag.bad { background:rgba(224,108,108,.16); color:var(--danger); }
  .btn { flex:none; border:1px solid var(--line); background:var(--panel); color:var(--fg); border-radius:8px; font:inherit; font-weight:600; font-size:13px; padding:6px 13px; cursor:pointer; }
  .btn:hover { border-color:var(--accent); color:var(--accent); }
  .right { display:flex; align-items:center; gap:8px; flex:none; }
  .muted { color:var(--muted); }
  .empty { color:var(--muted); padding:18px 2px; }
  .back { margin:0 0 14px; }
  a { color:var(--accent); }
`;

class GbtiWorkspace extends GbtiElement {
  connectedCallback() {
    super.connectedCallback?.();
    this._tab = 'post';
    this._cache = {};   // type -> items[]
    this._prs = null;   // { prs }
    this._editing = null;
    this.render();
    this._loadProfile();
    this._ensureTab('post');
  }

  // ----- data loaders (each fail-soft to an empty state, like gbti-content-list/gbti-pr-list) -----
  async _loadProfile() {
    try {
      const items = (await this.client?.listContent?.({ type: 'profile' }))?.items ?? [];
      this._profile = items[0] || null;
    } catch { this._profile = null; }
    if (!this._editing) this.render();
  }

  async _ensureTab(id) {
    const tab = TABS.find((t) => t.id === id);
    if (!tab) return;
    if (tab.type && !this._cache[tab.type]) {
      try { this._cache[tab.type] = (await this.client?.listContent?.({ type: tab.type }))?.items ?? []; }
      catch { this._cache[tab.type] = []; }
    } else if (id === 'prs' && !this._prs) {
      try { this._prs = (await this.client?.listPRs?.())?.prs ?? []; }
      catch { this._prs = []; }
    }
    if (this._tab === id && !this._editing) this.render();
    if (id === 'prs') this._loadPrStatuses();
  }

  _loadPrStatuses() {
    for (const pr of this._prs || []) this._loadPrStatus(pr.number);
  }
  async _loadPrStatus(number) {
    let status = null;
    try { status = await this.client?.prStatus?.({ number }); } catch { /* leave null */ }
    const pr = (this._prs || []).find((p) => p.number === number);
    const tag = this.$(`.gate[data-n="${number}"]`);
    if (!pr || !tag) return;
    const { label, tone } = classifyPull(pr, status);
    tag.className = `gate tag ${tone}`;
    tag.textContent = label;
    if (status?.description) tag.title = status.description;
  }

  // ----- rendering -----
  render() {
    if (this._editing) {
      this.set(this.css(CSS) + `<button class="btn back" data-back type="button">&larr; Back to my work</button><gbti-content-editor></gbti-content-editor>`);
      this.on('[data-back]', 'click', () => { this._editing = null; this.render(); });
      const ed = this.$('gbti-content-editor');
      const e = this._editing;
      if (ed?.load) ed.load(e.type, e.frontmatter, e.body);
      return;
    }
    const tabs = TABS.map((t) => `<button class="tab ${t.id === this._tab ? 'on' : ''}" data-tab="${t.id}" type="button" role="tab" aria-selected="${t.id === this._tab}">${esc(t.label)}</button>`).join('');
    this.set(this.css(CSS) + `${this._profileHtml()}<div class="tabs" role="tablist">${tabs}</div><div data-body>${this._body()}</div>`);
    this.$$('[data-tab]').forEach((b) => b.addEventListener('click', () => { this._tab = b.dataset.tab; this.render(); this._ensureTab(this._tab); }));
    this._wireBody();
  }

  _profileHtml() {
    if (!this._profile) return '';
    const f = this._profile.frontmatter || {};
    const name = f.displayName || f.title || this._profile.title || 'Your profile';
    return `<div class="profile"><span class="lbl">Profile</span> <b>${esc(name)}</b><button class="btn" data-profile type="button">Edit profile</button></div>`;
  }

  _body() {
    const tab = TABS.find((t) => t.id === this._tab);
    if (this._tab === 'prs') {
      const prs = this._prs;
      if (prs === null) return `<p class="empty">Loading your pull requests...</p>`;
      if (prs.length === 0) return `<p class="empty">No pull requests yet. Publish from the site or the CMS and they show here.</p>`;
      return `<ul class="rows">${prs.map((pr) => `<li class="row">
        <span class="t"><b>${esc(pr.title || ('PR #' + pr.number))}</b><span class="meta"><a href="${esc(pr.html_url || '#')}" target="_blank" rel="noopener">#${esc(pr.number)}</a> on GitHub</span></span>
        <span class="right"><span class="gate tag" data-n="${esc(pr.number)}">checking...</span></span></li>`).join('')}</ul>`;
    }
    const items = this._cache[tab.type];
    if (!items) return `<p class="empty">Loading...</p>`;
    if (items.length === 0) return `<p class="empty">No ${esc(tab.label.toLowerCase())} yet.</p>`;
    return `<ul class="rows">${items.map((it, i) => {
      const status = it.status ? `<span class="tag ${it.status === 'published' ? 'ok' : ''}">${esc(it.status)}</span>` : '';
      const vis = it.visibility === 'members' ? `<span class="tag">members</span>` : '';
      return `<li class="row"><span class="t"><b>${esc(it.title)}</b><span class="meta">${esc(it.type || '')}</span></span>
        <span class="right">${status} ${vis}<button class="btn" data-edit="${i}" type="button">Open</button></span></li>`;
    }).join('')}</ul>`;
  }

  _wireBody() {
    this.on('[data-profile]', 'click', () => this._openItem(this._profile?.path, 'profile'));
    const tab = TABS.find((t) => t.id === this._tab);
    if (tab?.type) {
      this.$$('[data-edit]').forEach((b) => b.addEventListener('click', () => {
        const it = (this._cache[tab.type] || [])[Number(b.dataset.edit)];
        if (it) this._openItem(it.path, it.type);
      }));
    }
  }

  async _openItem(path, type) {
    if (!path) return;
    try {
      const full = await this.client.getContentItem({ path });
      this._editing = { type, frontmatter: full.frontmatter, body: full.body };
      this.render();
    } catch { /* could not load: stay on the list */ }
  }
}

define('gbti-workspace', GbtiWorkspace);
export { GbtiWorkspace };
