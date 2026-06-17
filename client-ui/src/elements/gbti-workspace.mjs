// <gbti-workspace> (SOW-033): the member's management surface inside the extension. A tabbed view of everything
// they own (Articles / Prompts / Products) plus their pull requests with live gate status, and a pinned profile
// row. Each content row opens the item IN PLACE in an embedded <gbti-content-editor> (open-inside-the-extension,
// the SOW-031 tie), reusing the exact gbti-content-list -> editor.load flow. PR rows classify into Proposed /
// Needs changes / Accepted / Declined via the pure classifyPull helper. Host-agnostic (consumes only the
// injected client) so it runs in the extension now and the npm CMS later. Fail-soft: every read falls back to an
// empty state, never throws.
import { GbtiElement, define, esc } from '../base.mjs';
import { classifyPull, parseWorkspaceTab } from '../workspace-core.mjs';
import './gbti-content-editor.mjs';
import './gbti-contrib-inbox.mjs';
import './gbti-contrib-review.mjs';
import './gbti-saved.mjs';
import './gbti-subscriptions.mjs';

const TABS = [
  { id: 'post', label: 'Articles', type: 'post' },
  { id: 'prompt', label: 'Prompts', type: 'prompt' },
  { id: 'product', label: 'Products', type: 'product' },
  { id: 'prs', label: 'Pull requests' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'saved', label: 'Saved' }, // SOW-037: favorites + collections
  { id: 'subs', label: 'Subscriptions' }, // SOW-037: follows + membership
];

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .tabs { display:flex; gap:4px; background:var(--panel); border:1px solid var(--line); border-radius:999px; padding:4px; margin:0 0 16px; flex-wrap:wrap; }
  .tab { border:0; background:transparent; color:var(--muted); font:inherit; font-weight:700; font-size:13px; padding:7px 15px; border-radius:999px; cursor:pointer; }
  .tab.on { background:var(--hover); color:var(--accent); }
  .tbadge { display:inline-block; min-width:16px; margin-left:6px; padding:0 5px; border-radius:999px; background:var(--accent); color:#fff; font-size:11px; font-weight:800; line-height:16px; text-align:center; vertical-align:text-top; }
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
    // Initialize state BEFORE super.connectedCallback(), which synchronously calls render() (base.mjs) -> _body()
    // dereferences this._cache/_tab, so they must exist first; otherwise a TypeError aborts the whole mount and
    // the workspace renders nothing. (Same fix as gbti-browse.)
    // SOW-036 P4: open on the tab named by the deep-link hash (workspace.html#tab=prompt), falling back to 'post'.
    // Lets the avatar menu route the member straight to "My prompts" / "My products" / "My pull requests".
    this._tab = (typeof location !== 'undefined' && parseWorkspaceTab(location.hash)) || 'post';
    this._cache = {};   // type -> items[]
    this._prs = null;   // { prs }
    this._editing = null;
    this._reviewing = null; // SOW-028: the PR number being reviewed in the drill-in, or null
    this._inboxCount = null; // SOW-028 P5: count of contributions awaiting review, for the Inbox tab badge
    super.connectedCallback?.(); // base now renders the initial view with fields in place
    this._loadProfile();
    this._ensureTab(this._tab);
    this._loadInboxCount();
  }

  // SOW-028 P5: poll the incoming-contribution count on open (batch-first, like the rest of the client) so the
  // Inbox tab carries a "N to review" badge without the member having to open it. Fail-soft to no badge.
  async _loadInboxCount() {
    try { this._inboxCount = (await this.client?.listContributions?.())?.contributions?.length ?? 0; }
    catch { this._inboxCount = 0; }
    if (!this._editing && this._reviewing == null) this.render();
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
    // The Inbox / Saved / Subscriptions tabs are self-loading elements (they fetch their own data on connect),
    // so there is nothing to preload here; render() already mounted them. Returning avoids a redundant render.
    if (id === 'inbox' || id === 'saved' || id === 'subs') return;
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
    for (const pr of this._prs || []) {
      // SOW-033 P4: a merged/closed PR is already terminal (classifyPull decides Accepted/Declined from
      // pr.state/merged, ignoring the gate), so label it immediately and skip the per-PR gate fetch — one fewer
      // API call per terminal PR, and the label shows instantly instead of waiting on the network.
      if (pr.merged === true || pr.state === 'closed' || pr.state === 'merged') this._renderPrLabel(pr, null);
      else this._loadPrStatus(pr.number);
    }
  }
  async _loadPrStatus(number) {
    let status = null;
    try { status = await this.client?.prStatus?.({ number }); } catch { /* leave null */ }
    const pr = (this._prs || []).find((p) => p.number === number);
    if (pr) this._renderPrLabel(pr, status);
  }
  _renderPrLabel(pr, status) {
    const tag = this.$(`.gate[data-n="${pr.number}"]`);
    if (!tag) return;
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
    if (this._reviewing != null) {
      // SOW-028 drill-in: review one incoming contribution. On a decision the review element emits
      // `contrib-decided`; we return to the Inbox, which remounts <gbti-contrib-inbox> and refetches, so the
      // decided PR drops off the list.
      this.set(this.css(CSS) + `<button class="btn back" data-back type="button">&larr; Back to inbox</button><gbti-contrib-review number="${esc(this._reviewing)}"></gbti-contrib-review>`);
      this.on('[data-back]', 'click', () => { this._reviewing = null; this.render(); });
      this.$('gbti-contrib-review')?.addEventListener('contrib-decided', () => { this._reviewing = null; this.render(); this._loadInboxCount(); });
      return;
    }
    const tabs = TABS.map((t) => {
      const badge = t.id === 'inbox' && this._inboxCount ? `<span class="tbadge">${esc(this._inboxCount)}</span>` : '';
      return `<button class="tab ${t.id === this._tab ? 'on' : ''}" data-tab="${t.id}" type="button" role="tab" aria-selected="${t.id === this._tab}">${esc(t.label)}${badge}</button>`;
    }).join('');
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
    // SOW-028: the incoming-contribution review inbox is its own self-loading element. It fetches + renders
    // independently (and is inert with no client), so the workspace just mounts the tag.
    if (this._tab === 'inbox') return `<gbti-contrib-inbox></gbti-contrib-inbox>`;
    if (this._tab === 'saved') return `<gbti-saved></gbti-saved>`; // SOW-037
    if (this._tab === 'subs') return `<gbti-subscriptions></gbti-subscriptions>`; // SOW-037
    if (this._tab === 'prs') {
      const prs = this._prs;
      if (prs === null) return `<p class="empty">Loading your pull requests...</p>`;
      if (prs.length === 0) return `<p class="empty">No pull requests yet. Publish from the site or the CMS and they show here.</p>`;
      return `<ul class="rows">${prs.map((pr) => `<li class="row">
        <span class="t"><b>${esc(pr.title || ('PR #' + pr.number))}</b><span class="meta"><a href="${esc(pr.html_url || '#')}" target="_blank" rel="noopener">#${esc(pr.number)}</a> on GitHub</span></span>
        <span class="right"><span class="gate tag" data-n="${esc(pr.number)}">checking...</span></span></li>`).join('')}</ul>`;
    }
    const items = this._cache?.[tab?.type]; // optional chain: never throw if render runs before init
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
    // SOW-028: the Inbox tab's <gbti-contrib-inbox> emits `contrib-open` (composed) when a Review button is
    // clicked; open the review drill-in. The listener sits on the element node the bubbling event passes through.
    if (this._tab === 'inbox') {
      this.$('gbti-contrib-inbox')?.addEventListener('contrib-open', (e) => { this._reviewing = e.detail?.number ?? null; this.render(); });
    }
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
