// sow-494: <gbti-community-list>, the Community forum list at /community/. One row per entry the member can see,
// typed (Poll, Typed poll, Topic), live entries first, with the discussion count and the latest post. A member never
// meets an entry that is not shared with them: the Worker leaves it out, so the list does not hint at it.
//
// The first load runs when a client arrives (render-triggered). A failed load shows its own Retry and is never
// retried on its own, so a Worker outage cannot turn into a request storm.
//
// sow-498: a right sidebar (design round 4b, option L1): Live now, the next Shop Talk, and for a superadmin what is
// waiting on them, with New entry (community-list-side.mjs). It reads the entries this page already loaded, keeping
// the last UNFILTERED load so a filter on the table does not empty "Live now". The page passes the call's time in
// the `call-time` attribute, from house/shoptalk.yml at build time.
import { GbtiElement, define, esc } from '../base.mjs';
import { relTime, absTime } from '../time-core.mjs';
import { COMMUNITY_CSS, KIND_ICON } from './community-css.mjs';
import { LIST_SIDE_CSS, listSideHtml } from './community-list-side.mjs';
import {
  KIND_LABEL, faceHtml, meetingText, rowMeta, cardPeopleLine, discussionCell, resultLine, entryHref, statusPill, isPollKind, plural,
} from '../community-core.mjs';

const PAGE = 20;

const CSS = `
  .layout { display: grid; grid-template-columns: minmax(0, 1fr) 280px; grid-template-areas: "head side" "body side";
    grid-template-rows: auto 1fr; column-gap: 32px; row-gap: 16px; align-items: start; }
  .layout > .head { grid-area: head; margin-bottom: 0; }
  .layout > .side { grid-area: side; }
  .layout > .body { grid-area: body; min-width: 0; }
  .head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
  .head .txt { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .kick { color: var(--green-700); }
  h1 { font-family: var(--f-display); font-size: 34px; line-height: 1.05; font-weight: 700; }
  .lead { margin: 0; font-size: 14.5px; color: var(--fg-soft); max-width: 640px; }
  .filters { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .chip { min-height: 34px; padding: 0 12px; border-radius: var(--cm-r); border: 1px solid var(--line-2); background: var(--paper); color: var(--fg); font-weight: 600; font-size: 13px; }
  .chip:hover { background: var(--tint); }
  .chip[aria-pressed="true"] { background: var(--fg); color: var(--paper); border-color: var(--fg); }
  .chip[aria-pressed="true"]:hover { background: var(--fg); }
  .meet { margin-left: auto; display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--fg-soft); }
  .meet select { min-height: 34px; padding: 0 8px; font-size: 13px; font-weight: 500; max-width: 260px; }
  .table { background: var(--paper); border: 1px solid var(--line); border-radius: var(--cm-r); overflow: hidden; }
  .row { display: grid; grid-template-columns: minmax(0, 1fr) 96px 164px; gap: 14px; padding: 12px 16px; border-bottom: 1px solid var(--line); }
  .row:last-child { border-bottom: 0; }
  .row.hd { padding: 8px 16px; background: var(--paper-2); color: var(--fg-mute); }
  .row.live { background: var(--green-tint); }
  /* sow-498: the kind and the state ride one line above the title, so the title has the whole column. */
  .ent { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .tags { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .ent > a { font-size: 15px; font-weight: 700; line-height: 1.35; color: var(--fg); text-decoration: none; overflow-wrap: anywhere; }
  .ent > a:hover { color: var(--green-700); text-decoration: underline; text-underline-offset: 3px; }
  .meta { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; font-size: 12.5px; color: var(--fg-mute); }
  .res { font-size: 13px; color: var(--fg-soft); }
  .ppl { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 12.5px; color: var(--fg-mute); }
  .ppl .stack { display: inline-flex; align-items: center; }
  .ppl .f { display: inline-flex; margin-left: -6px; border-radius: 50%; box-shadow: 0 0 0 2px var(--ring, var(--paper)); }
  .ppl .f:first-child { margin-left: 0; }
  .ppl .cm-av { width: 22px; height: 22px; }
  .ppl .plus { margin-left: 4px; font-size: 12px; font-weight: 600; color: var(--fg-soft); }
  .row.live { --ring: var(--green-tint); }
  .disc { text-align: right; font-size: 13px; font-weight: 700; align-self: center; }
  .disc small { display: block; font-size: 12px; font-weight: 500; color: var(--fg-mute); }
  .disc.quiet { font-weight: 500; color: var(--fg-mute); }
  .last { display: flex; gap: 8px; align-items: center; align-self: center; min-width: 0; font-size: 12.5px; color: var(--fg-soft); line-height: 1.3; }
  .last span.when { display: block; color: var(--fg-mute); }
  .more { display: block; margin: 14px auto 0; color: var(--green-700); font-weight: 600; font-size: 14px; padding: 8px 12px; }
  .more:hover { color: var(--green); }
  .skel { display: flex; flex-direction: column; gap: 10px; }
  .empty { padding: 28px 16px; text-align: center; color: var(--fg-soft); }
  .empty strong { display: block; color: var(--fg); font-size: 15px; margin-bottom: 4px; }
  @media (max-width: 900px) {
    .layout { grid-template-columns: minmax(0, 1fr); grid-template-areas: "head" "body" "side"; grid-template-rows: auto; }
    .layout.host { grid-template-areas: "head" "side" "body"; }
  }
  @media (max-width: 760px) {
    h1 { font-size: 28px; }
    .row.hd { display: none; }
    .row { grid-template-columns: minmax(0, 1fr) auto; gap: 8px 12px; padding: 12px; }
    .ent { grid-column: 1 / -1; gap: 8px; }
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
    if (!this.client) { this.set(this.css(COMMUNITY_CSS + CSS + LIST_SIDE_CSS) + this.headHtml() + '<div class="skel"><div class="cm-skel"></div><div class="cm-skel"></div></div>'); return; }
    if (this._state === 'idle') { this.load(); return; }
    this.draw();
  }

  async load() {
    this._state = 'loading';
    this.draw();
    try {
      this._data = await this.client.communityList({ kind: this._kind, meeting: this._meeting });
      if (!this._kind && !this._meeting) this._overview = this._data?.entries || [];
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
      </div></div>`;
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

  /** sow-501: up to six overlapping faces, "+N" for the rest, then who they are. No links: the title is the row's link. */
  facesHtml(e) {
    const line = cardPeopleLine(e);
    if (!line) return '';
    const list = (e.people.list || []).slice(0, 6);
    const more = (Number(e.people.count) || 0) - list.length;
    const faces = list.map((p) => `<span class="f" title="${esc(p.login || '')}">${faceHtml(p)}</span>`).join('');
    return `<span class="ppl">${faces ? `<span class="stack">${faces}${more > 0 ? `<span class="plus">+${more}</span>` : ''}</span>` : ''}<span>${esc(line)}</span></span>`;
  }

  rowHtml(e) {
    const kind = e.kind;
    const pill = statusPill(e);
    const disc = discussionCell(e);
    // With no post yet, the latest thing that happened is the entry being started, and the line says so.
    const last = e.lastPost ? { name: e.lastPost.login, githubId: e.lastPost.githubId, at: e.lastPost.at, verb: '' } : { name: e.author?.login || '', githubId: e.author?.githubId, at: e.createdAt, verb: 'started ' };
    const result = resultLine(e);
    return `<div class="row${e.status === 'live' ? ' live' : ''}" role="row">
      <div class="ent" role="cell">
        <span class="tags"><span class="cm-badge k-${esc(kind)}">${KIND_ICON[kind] || ''}${esc(KIND_LABEL[kind] || kind)}</span>${pill ? `<span class="cm-pill ${pill.tone}">${esc(pill.text)}</span>` : ''}</span>
        <a href="${esc(entryHref(e.id))}">${esc(e.title)}</a>
        <span class="meta">${esc(rowMeta(e))}</span>
        ${this.facesHtml(e)}
        ${result ? `<span class="res">${esc(result)}</span>` : ''}
      </div>
      <span class="disc${disc.quiet ? ' quiet' : ''}" role="cell">${esc(disc.primary)}${disc.secondary ? `<small>${esc(disc.secondary)}</small>` : ''}</span>
      <span class="last" role="cell">${faceHtml({ githubId: last.githubId, login: last.name })}
        <span>${esc(last.name)}<span class="when" title="${esc(absTime(last.at))}">${esc(last.verb)}${esc(relTime(last.at))}</span></span></span>
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
            <div class="row hd" role="row"><span class="cm-mono" role="columnheader">Entry</span><span class="cm-mono" role="columnheader" style="text-align:right">Activity</span><span class="cm-mono" role="columnheader">Latest</span></div>
            ${shown.map((e) => this.rowHtml(e)).join('')}
          </div>${entries.length > shown.length ? '<button type="button" class="more" data-more>Show older entries</button>' : ''}`
        : `<div class="table"><div class="empty">${filtered
          ? '<strong>Nothing matches these filters</strong>Try Everything, or All meetings.'
          : `<strong>Nothing here yet</strong>${this.isHost ? 'Start the first entry with New entry.' : 'Entries from our meetings appear here once the host shares them with you.'}`}</div></div>`);
    }
    if (this._state === 'ok') {
      const side = listSideHtml({ entries: this._overview || this._data?.entries || [], isHost: this.isHost, callTime: this.getAttribute('call-time') || '' });
      body = `<div class="layout ${this.isHost ? 'host' : 'member'}">${this.headHtml()}<aside class="side" aria-label="Now and next">${side}</aside><div class="body">${body}</div></div>`;
    } else {
      body = this.headHtml() + body;
    }
    this.set(this.css(COMMUNITY_CSS + CSS + LIST_SIDE_CSS) + body);
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
