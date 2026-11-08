// sow-494: <gbti-community-manager>, the Community tab on /admin (superadmin). Every entry, drafts and private ones
// included, with its state, who can see it, its counts and the next thing to do with it: open a draft, close a live
// entry, publish closed poll results. New entry, Edit and Manage access open the same dialog the Community pages use.
// The Worker re-checks the superadmin role on every call; the tab and this module are only loaded for a superadmin.
import { GbtiElement, define, esc } from '../base.mjs';
import { relTime } from '../time-core.mjs';
import { COMMUNITY_CSS, KIND_ICON } from './community-css.mjs';
import { KIND_LABEL, isPollKind, meetingText, statusPill, entryHref, plural } from '../community-core.mjs';

const CSS = `
  .bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }
  .bar p { margin: 0; color: var(--fg-soft); font-size: 14px; flex: 1; min-width: 220px; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px; }
  .chip { min-height: 34px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--line-2); background: var(--paper); font-weight: 600; font-size: 13px; }
  .chip:hover { background: var(--tint); }
  .chip[aria-pressed="true"] { background: var(--fg); color: var(--paper); border-color: var(--fg); }
  .chip[aria-pressed="true"]:hover { background: var(--fg); }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; font-family: var(--f-mono); font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--fg-mute); font-weight: 500; padding: 8px 10px; border-bottom: 1px solid var(--line); }
  td { padding: 12px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  tr:last-child td { border-bottom: 0; }
  td.t a { font-weight: 700; color: var(--fg); text-decoration: none; overflow-wrap: anywhere; }
  td.t a:hover { color: var(--green-700); text-decoration: underline; }
  td.t small { display: block; color: var(--fg-mute); margin-top: 4px; }
  td.n { white-space: nowrap; color: var(--fg-soft); }
  .acts { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
  .msg { min-height: 20px; margin-top: 10px; font-size: 14px; }
  .bad { color: var(--err); font-weight: 600; }
  .empty { padding: 28px 10px; text-align: center; color: var(--fg-soft); }
  @media (max-width: 760px) {
    thead { display: none; }
    tr { display: grid; grid-template-columns: 1fr; gap: 6px; padding: 12px 0; border-bottom: 1px solid var(--line); }
    td { border: 0; padding: 2px 0; }
    .acts { justify-content: flex-start; }
  }
`;

const FILTERS = [['', 'All'], ['live', 'Live'], ['draft', 'Drafts'], ['closed', 'Closed'], ['published', 'Results']];

class GbtiCommunityManager extends GbtiElement {
  constructor() {
    super();
    this._state = 'idle';
    this._entries = [];
    this._filter = '';
  }

  render() {
    if (!this.client) return;
    if (typeof this.client.communityAdmin !== 'function') { this.set(this.css(COMMUNITY_CSS + CSS) + '<p class="cm-mute">Community is managed by superadmins.</p>'); return; }
    if (this._state === 'idle') { this.load(); return; }
    this.draw();
  }

  async load() {
    this._state = 'loading';
    this.draw();
    try {
      const r = await this.client.communityList({});
      this._entries = r.entries || [];
      this._state = 'ok';
    } catch (e) {
      this._error = e;
      this._state = 'error';
    }
    this.draw();
  }

  actions(e) {
    const b = (op, label, cls = 'cm-btn2 sm') => `<button type="button" class="${cls}" data-op="${op}" data-id="${esc(e.id)}">${esc(label)}</button>`;
    const out = [];
    const poll = isPollKind(e.kind);
    if (e.status === 'draft') out.push(b('open', 'Open now'));
    if (e.status === 'live') out.push(b('close', poll ? 'Close voting' : 'Close topic'));
    if (poll && e.status === 'closed') out.push(b('publish', 'Publish results'));
    if (poll && e.status === 'published') out.push(b('unpublish', 'Unpublish'));
    if (!poll && e.status === 'closed') out.push(b('open', 'Reopen'));
    out.push(`<button type="button" class="cm-btn2 sm" data-edit="${esc(e.id)}">Edit</button>`, `<button type="button" class="cm-btn2 sm" data-access="${esc(e.id)}">Access</button>`);
    return out.join('');
  }

  rowHtml(e) {
    const pill = statusPill(e);
    const counts = isPollKind(e.kind) ? `${plural(e.counts?.answers || 0, 'answer')} · ${plural(e.counts?.posts || 0, 'post')}` : plural(e.counts?.posts || 0, 'post');
    const access = e.access?.mode === 'chosen' ? `${plural(e.access.count || 0, 'member')}, chosen` : 'All members';
    return `<tr>
      <td><span class="cm-badge k-${esc(e.kind)}">${KIND_ICON[e.kind] || ''}${esc(KIND_LABEL[e.kind] || e.kind)}</span></td>
      <td class="t"><a href="${esc(entryHref(e.id))}">${esc(e.title)}</a><small>${esc(meetingText(e.meeting))} · updated ${esc(relTime(e.activityAt))}</small></td>
      <td>${pill ? `<span class="cm-pill ${pill.tone}">${esc(pill.text)}</span>` : ''}</td>
      <td class="n">${esc(access)}</td>
      <td class="n">${esc(counts)}</td>
      <td><div class="acts">${this.actions(e)}</div></td>
    </tr>`;
  }

  draw() {
    let body;
    if (this._state === 'loading' || this._state === 'idle') body = '<div class="cm-skel"></div>';
    else if (this._state === 'error') body = `<div class="cm-err"><span>${esc(this._error?.message || 'Community did not load.')}</span><button type="button" class="cm-quiet" data-retry style="margin-left:auto">Try again</button></div>`;
    else {
      const shown = this._entries.filter((e) => !this._filter || e.status === this._filter);
      body = `<div class="chips" role="group" aria-label="Filter">${FILTERS.map(([k, l]) => `<button type="button" class="chip" data-filter="${k}" aria-pressed="${this._filter === k}">${esc(l)}</button>`).join('')}</div>
        ${shown.length ? `<table><thead><tr><th>Kind</th><th>Entry</th><th>State</th><th>Who can see it</th><th>Activity</th><th></th></tr></thead><tbody>${shown.map((e) => this.rowHtml(e)).join('')}</tbody></table>`
          : `<div class="empty">${this._entries.length ? 'No entries in this state.' : 'No entries yet. Start one with New entry.'}</div>`}`;
    }
    this.set(this.css(COMMUNITY_CSS + CSS) + `<div class="bar"><p>Polls and topics members see at <a href="/community/">gbti.network/community</a>. Each entry is shared with all members or with members you choose.</p>
      <button type="button" class="cm-btn" data-new>New entry</button></div>${body}<div class="msg" data-msg></div>`);
    this.on('[data-retry]', 'click', () => this.load());
    this.on('[data-new]', 'click', () => this.openEditor('create'));
    for (const b of this.$$('[data-filter]')) b.addEventListener('click', () => { this._filter = b.dataset.filter; this.draw(); });
    for (const b of this.$$('[data-op]')) b.addEventListener('click', () => this.op(b.dataset.op, b.dataset.id, b));
    for (const b of this.$$('[data-edit]')) b.addEventListener('click', () => this.openEditor('edit', b.dataset.edit));
    for (const b of this.$$('[data-access]')) b.addEventListener('click', () => this.openEditor('access', b.dataset.access));
  }

  async op(op, id, btn) {
    btn.disabled = true;
    try { await this.client.communityAdmin(op, { id }); await this.load(); } catch (e) {
      btn.disabled = false;
      const m = this.$('[data-msg]');
      if (m) m.innerHTML = `<span class="bad" role="status">${esc(e?.message || 'That did not work.')}</span>`;
    }
  }

  async openEditor(mode, id) {
    await import('./gbti-community-editor.mjs');
    let entry = null;
    if (id) {
      try { entry = await this.client.communityEntry(id); } catch (e) {
        const m = this.$('[data-msg]');
        if (m) m.innerHTML = `<span class="bad" role="status">${esc(e?.message || 'That entry did not load.')}</span>`;
        return;
      }
    }
    const ed = document.createElement('gbti-community-editor');
    ed.client = this.client;
    document.body.appendChild(ed);
    ed.addEventListener('community-saved', () => this.load());
    if (mode === 'create') ed.openCreate();
    else if (mode === 'access') ed.openAccess(entry.entry);
    else ed.openEdit(entry.entry, { answered: (entry.results?.total || 0) > 0 });
  }
}

define('gbti-community-manager', GbtiCommunityManager);
export { GbtiCommunityManager };
