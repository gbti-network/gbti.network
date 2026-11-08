// sow-494: <gbti-community-list>, the Community forum list at /community/. One row per entry the member can see,
// typed (Poll, Typed poll, Topic), live entries first, with the discussion count and the latest post. A member never
// meets an entry that is not shared with them: the Worker leaves it out, so the list does not hint at it.
//
// The first load runs when a client arrives (render-triggered). A failed load shows its own Retry and is never
// retried on its own, so a Worker outage cannot turn into a request storm.
import { GbtiElement, define, esc } from '../base.mjs';
import { relTime, absTime } from '../time-core.mjs';
import { COMMUNITY_CSS, KIND_ICON } from './community-css.mjs';
import {
  KIND_LABEL, initials, meetingText, rowMeta, discussionCell, resultLine, entryHref, statusPill, isPollKind, plural,
} from '../community-core.mjs';

const PAGE = 20;

const CSS = `
  .head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 22px; }
  .head .txt { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  .kick { color: var(--green-700); }
  h1 { font-family: var(--f-display); font-size: 46px; line-height: 1.05; font-weight: 700; }
  .lead { margin: 0; font-size: 16px; color: var(--fg-soft); max-width: 640px; }
  .filters { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 22px; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .chip { min-height: 40px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--line-2); background: var(--paper); color: var(--fg); font-weight: 600; font-size: 14px; }
  .chip:hover { background: var(--tint); }
  .chip[aria-pressed="true"] { background: var(--fg); color: var(--paper); border-color: var(--fg); }
  .chip[aria-pressed="true"]:hover { background: var(--fg); }
  .meet { margin-left: auto; display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--fg-soft); }
  .meet select { min-height: 40px; padding: 0 10px; font-size: 14px; font-weight: 500; max-width: 260px; }
  .table { background: var(--paper); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
  .row { display: grid; grid-template-columns: minmax(0, 1fr) 120px 180px; gap: 16px; padding: 18px 22px; border-bottom: 1px solid var(--line); }
  .row:last-child { border-bottom: 0; }
  .row.hd { padding: 12px 22px; background: var(--paper-2); color: var(--fg-mute); }
  .row.live { background: var(--green-tint); }
  .ent { display: flex; gap: 14px; align-items: flex-start; min-width: 0; }
  .ent .cm-badge { min-width: 104px; }
  .ttl { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .ttl a { font-size: 17px; font-weight: 700; line-height: 1.35; color: var(--fg); text-decoration: none; overflow-wrap: anywhere; }
  .ttl a:hover { color: var(--green-700); text-decoration: underline; text-underline-offset: 3px; }
  .meta { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; font-size: 13px; color: var(--fg-mute); }
  .res { font-size: 13px; color: var(--fg-soft); }
  .disc { text-align: right; font-size: 15px; font-weight: 700; align-self: center; }
  .disc small { display: block; font-size: 12px; font-weight: 500; color: var(--fg-mute); }
  .last { display: flex; gap: 10px; align-items: center; align-self: center; min-width: 0; font-size: 13px; color: var(--fg-soft); line-height: 1.3; }
  .last span.when { display: block; color: var(--fg-mute); }
  .more { display: block; margin: 18px auto 0; color: var(--green-700); font-weight: 600; font-size: 15px; padding: 8px 12px; }
  .more:hover { color: var(--green); }
  .skel { display: flex; flex-direction: column; gap: 10px; }
  .empty { padding: 40px 22px; text-align: center; color: var(--fg-soft); }
  .empty strong { display: block; color: var(--fg); font-size: 17px; margin-bottom: 4px; }
  @media (max-width: 760px) {
    h1 { font-size: 38px; }
    .row.hd { display: none; }
    .row { grid-template-columns: minmax(0, 1fr) auto; gap: 10px 14px; padding: 16px; }
    .ent { grid-column: 1 / -1; flex-direction: column; gap: 10px; }
    .ent .cm-badge { min-width: 0; }
    .disc { text-align: left; order: 2; display: flex; gap: 6px; align-items: baseline; }
    .disc small { display: inline; }
    .last { order: 1; }
    .meet { margin-left: 0; width: 100%; }
    .meet select { flex: 1; max-width: none; }
  }
`;

class GbtiCommunityList extends GbtiElement {
  constructor() {
    super();
    this._state = 'idle'; // idle | loading | ok | error | signedout | membership
    this._data = null;
    this._shown = PAGE;
    const p = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
    this._kind = ['poll', 'topic'].includes(p.get('kind')) ? p.get('kind') : '';
    this._meeting = p.get('meeting') || '';
  }

  get isHost() { return typeof this.client?.communityAdmin === 'function'; }

  render() {
    if (!this.client) { this.set(this.css(COMMUNITY_CSS + CSS) + this.headHtml() + '<div class="skel"><div class="cm-skel"></div><div class="cm-skel"></div></div>'); return; }
    if (this._state === 'idle') { this.load(); return; }
    this.draw();
  }

  async load() {
    this._state = 'loading';
    this.draw();
    try {
      this._data = await this.client.communityList({ kind: this._kind, meeting: this._meeting });
      this._state = 'ok';
    } catch (e) {
      this._error = e;
      const code = String(e?.code || '');
      if (code === 'unauthorized' || code === 'not-authenticated') this._state = 'signedout';
      else if (code === 'forbidden' && /paid membership/i.test(String(e?.message || ''))) this._state = 'membership';
      else this._state = 'error';
    }
    this.draw();
  }

  headHtml() {
    return `<div class="head"><div class="txt">
        <span class="cm-mono kick">Members · Our meetings</span>
        <h1>Community</h1>
        <p class="lead">Polls and topics from our meetings. Open any entry to take part or join its discussion.</p>
      </div>${this.isHost ? '<button type="button" class="cm-btn" data-new>New entry</button>' : ''}</div>`;
  }

  filtersHtml() {
    const chip = (k, label) => `<button type="button" class="chip" data-kind="${k}" aria-pressed="${this._kind === k}">${label}</button>`;
    const meetings = this._data?.meetings || [];
    const opt = (v, label) => `<option value="${esc(v)}"${this._meeting === v ? ' selected' : ''}>${esc(label)}</option>`;
    return `<div class="filters">
      <div class="chips" role="group" aria-label="Type">${chip('', 'Everything')}${chip('poll', 'Polls')}${chip('topic', 'Topics')}</div>
      <label class="meet">Meeting <select data-meeting>${opt('', 'All meetings')}${meetings.map((m) => opt(m.key, meetingText(m))).join('')}${opt('-', 'Between meetings')}</select></label>
    </div>`;
  }

  rowHtml(e) {
    const kind = e.kind;
    const pill = statusPill(e);
    const disc = discussionCell(e);
    const last = e.lastPost ? { name: e.lastPost.login, at: e.lastPost.at } : { name: e.author?.login || '', at: e.createdAt };
    const result = resultLine(e);
    return `<div class="row${e.status === 'live' ? ' live' : ''}" role="row">
      <div class="ent" role="cell">
        <span class="cm-badge k-${esc(kind)}">${KIND_ICON[kind] || ''}${esc(KIND_LABEL[kind] || kind)}</span>
        <div class="ttl">
          <a href="${esc(entryHref(e.id))}">${esc(e.title)}</a>
          <span class="meta">${pill && pill.tone !== 'outline' ? `<span class="cm-pill ${pill.tone}">${esc(pill.text)}</span>` : ''}<span>${esc(rowMeta(e))}</span></span>
          ${result ? `<span class="res">${esc(result)}</span>` : ''}
        </div>
      </div>
      <span class="disc" role="cell" aria-label="${esc(`${plural(disc.count, 'post')}${disc.sub ? `, ${disc.sub}` : ''}`)}">${disc.count}<small>${esc(disc.sub || (disc.count === 1 ? 'post' : 'posts'))}</small></span>
      <span class="last" role="cell"><span class="cm-av" aria-hidden="true">${esc(initials(last.name))}</span>
        <span>${esc(last.name)}<span class="when" title="${esc(absTime(last.at))}">${esc(relTime(last.at))}</span></span></span>
    </div>`;
  }

  draw() {
    let body;
    if (this._state === 'loading' || this._state === 'idle') {
      body = '<div class="skel" aria-busy="true" aria-label="Loading"><div class="cm-skel"></div><div class="cm-skel"></div><div class="cm-skel"></div></div>';
    } else if (this._state === 'signedout') {
      body = `<div class="cm-card cm-state"><h2>Sign in to see Community</h2><p>Polls and topics from our meetings are for members.</p>
        <a class="cm-btn" href="/login/?return_to=%2Fcommunity%2F">Sign in</a></div>`;
    } else if (this._state === 'membership') {
      body = `<div class="cm-state amber"><h2>Community is part of membership</h2><p>Members answer the polls we run on our calls, post in each topic, and come back to them later.</p>
        <a class="cm-btn" href="/membership/">See membership</a></div>`;
    } else if (this._state === 'error') {
      body = `<div class="cm-card cm-state"><h2>Community did not load</h2><p>${esc(this._error?.message || 'Something went wrong.')}</p>
        <button type="button" class="cm-btn2" data-retry>Try again</button></div>`;
    } else {
      const entries = this._data?.entries || [];
      const shown = entries.slice(0, this._shown);
      const filtered = this._kind || this._meeting;
      body = this.filtersHtml() + (entries.length
        ? `<div class="table" role="table" aria-label="Entries">
            <div class="row hd" role="row"><span class="cm-mono" role="columnheader">Entry</span><span class="cm-mono" role="columnheader" style="text-align:right">Discussion</span><span class="cm-mono" role="columnheader">Latest</span></div>
            ${shown.map((e) => this.rowHtml(e)).join('')}
          </div>${entries.length > shown.length ? '<button type="button" class="more" data-more>Show older entries</button>' : ''}`
        : `<div class="table"><div class="empty">${filtered
          ? '<strong>Nothing matches these filters</strong>Try Everything, or All meetings.'
          : `<strong>Nothing here yet</strong>${this.isHost ? 'Start the first entry with New entry.' : 'Entries from our meetings appear here once the host shares them with you.'}`}</div></div>`);
    }
    this.set(this.css(COMMUNITY_CSS + CSS) + this.headHtml() + body);
    this.wire();
  }

  wire() {
    this.on('[data-retry]', 'click', () => this.load());
    this.on('[data-more]', 'click', () => { this._shown += PAGE; this.draw(); });
    for (const b of this.$$('[data-kind]')) b.addEventListener('click', () => { this._kind = b.dataset.kind; this.filterChanged(); });
    this.on('[data-meeting]', 'change', (ev) => { this._meeting = ev.target.value; this.filterChanged(); });
    this.on('[data-new]', 'click', () => this.openEditor());
  }

  filterChanged() {
    this._shown = PAGE;
    try {
      const p = new URLSearchParams(location.search);
      if (this._kind) p.set('kind', this._kind); else p.delete('kind');
      if (this._meeting) p.set('meeting', this._meeting); else p.delete('meeting');
      const qs = p.toString();
      history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}`);
    } catch { /* the filter still applies; only the address does not follow */ }
    this.load();
  }

  async openEditor() {
    await import('./gbti-community-editor.mjs');
    const ed = document.createElement('gbti-community-editor');
    ed.client = this.client;
    document.body.appendChild(ed);
    ed.addEventListener('community-saved', (ev) => {
      const id = ev.detail?.id;
      if (id) location.href = entryHref(id);
      else this.load();
    });
    ed.openCreate();
  }
}

define('gbti-community-list', GbtiCommunityList);
export { GbtiCommunityList, isPollKind };
