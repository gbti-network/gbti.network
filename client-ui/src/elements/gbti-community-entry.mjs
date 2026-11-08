// sow-494: <gbti-community-entry entry-id="...">, one Community entry's page at /community/entry/?id=. It renders by
// the entry's kind: a poll with choices, a poll with a typed answer, or a topic (the host's prompt). Every kind has
// its discussion underneath (<gbti-community-discussion>). A superadmin also gets the host panel: live tallies, the
// state actions, Edit, Manage access, and the typed-answer tidy-up.
//
// LIVE. While the entry is live and the tab is in view, the page asks the Worker every 4 seconds whether anything
// changed (`updates`, the cheap gate), and every 20 seconds otherwise; it stops while the tab is hidden. A reply of
// `unchanged` costs nothing to render. A failed poll waits and tries again on the next tick, never in a loop.
//
// An entry that does not exist and one not shared with this member look the same: the Worker answers not_found for
// both, and this page names nothing.
import { GbtiElement, define, esc } from '../base.mjs';
import { relTime, absTime } from '../time-core.mjs';
import { COMMUNITY_CSS, KIND_ICON } from './community-css.mjs';
import {
  KIND_LABEL, isPollKind, initials, meetingText, statusPill, barRows, answerState, pollDelay, sharedLine,
  answeredLine, threadCounts, plural, normalizeTyped, typedMax, entryHref,
} from '../community-core.mjs';
import './gbti-community-discussion.mjs';

const CSS = `
  .crumb { font-size: 14px; color: var(--fg-mute); margin-bottom: 18px; }
  .crumb a { color: var(--green-700); }
  .hdr { display: flex; flex-direction: column; gap: 12px; margin-bottom: 24px; }
  .hdr .line { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 14px; color: var(--fg-mute); }
  h1 { font-family: var(--f-display); font-size: 38px; line-height: 1.1; font-weight: 700; overflow-wrap: anywhere; }
  .who { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 14px; color: var(--fg-soft); }
  .stack { display: flex; flex-direction: column; gap: 24px; }
  .ans { padding: 26px 28px; display: flex; flex-direction: column; gap: 16px; }
  .ans legend, .ans .ask { font-size: 15px; color: var(--fg-soft); margin-bottom: 8px; padding: 0; }
  fieldset { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  .opt { display: flex; align-items: center; gap: 14px; min-height: 56px; padding: 0 18px; border: 1.5px solid var(--line-2); border-radius: 10px; cursor: pointer; background: var(--paper); }
  .opt span { font-size: 17px; font-weight: 500; overflow-wrap: anywhere; }
  .opt:hover { border-color: var(--green); }
  .opt.on { border-color: var(--green); background: var(--green-tint); }
  .opt.dim { opacity: .55; }
  .opt.locked { cursor: default; }
  .opt.locked:hover { border-color: var(--line-2); }
  .opt.on.locked:hover { border-color: var(--green); }
  .typed { display: flex; flex-direction: column; gap: 8px; font-size: 15px; color: var(--fg-soft); }
  .typed input { min-height: 50px; padding: 0 16px; border: 1.5px solid var(--line-2); font-size: 17px; font-weight: 500; width: 100%; }
  .typed input.on { border-color: var(--green); background: var(--green-tint); }
  .acts { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .acts .msg { font-size: 14px; color: var(--fg-mute); }
  .every { display: flex; flex-wrap: wrap; gap: 8px; }
  .every span { padding: 6px 12px; border-radius: 999px; background: var(--tint); font-size: 14px; overflow-wrap: anywhere; }
  .sub { font-size: 15px; font-weight: 700; margin: 4px 0 0; }
  .prompt { padding: 22px 24px; display: flex; flex-direction: column; gap: 14px; }
  .prompt .by { display: flex; align-items: center; gap: 10px; font-size: 14px; color: var(--fg-mute); }
  .prompt .by strong { color: var(--fg); }
  .md { font-size: 16px; line-height: 1.6; overflow-wrap: anywhere; }
  .md > :first-child { margin-top: 0; } .md > :last-child { margin-bottom: 0; }
  .md img { max-width: 100%; }
  .pimgs { display: flex; flex-wrap: wrap; gap: 10px; }
  .pimgs img { max-width: 420px; width: 100%; max-height: 320px; object-fit: cover; border-radius: 8px; background: var(--tint); }
  .closed-note { padding: 14px 16px; border-radius: 10px; background: var(--tint); color: var(--fg-soft); font-size: 14px; }
  .host { padding: 22px 24px; display: flex; flex-direction: column; gap: 16px; border: 1.5px dashed var(--line-2); background: var(--paper-2); }
  .host .top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 14px; color: var(--fg-mute); }
  .big { display: flex; align-items: baseline; gap: 10px; }
  .big b { font-family: var(--f-display); font-size: 44px; line-height: 1; }
  .big span { color: var(--fg-soft); font-size: 15px; }
  .host .rule { font-size: 13px; color: var(--fg-mute); }
  .tidy { display: flex; flex-direction: column; gap: 10px; }
  .grp { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px 12px; align-items: center; padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--paper); }
  .grp .nm { font-weight: 700; overflow-wrap: anywhere; }
  .grp .sp { grid-column: 1 / -1; font-size: 13px; color: var(--fg-mute); overflow-wrap: anywhere; }
  .grp .ops { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
  .grp input, .grp select { min-height: 34px; padding: 0 8px; font-size: 14px; }
  .flash { font-size: 14px; color: var(--green-700); font-weight: 600; }
  .bad { font-size: 14px; color: var(--err); font-weight: 600; }
  @media (max-width: 640px) {
    h1 { font-size: 30px; }
    .ans, .prompt, .host { padding: 18px; }
    .grp { grid-template-columns: 1fr; }
    .grp .ops { justify-content: flex-start; }
  }
`;

class GbtiCommunityEntry extends GbtiElement {
  constructor() {
    super();
    this._state = 'idle'; // idle | loading | ok | missing | signedout | membership | error
    this._d = null;
    this._choice = null;
    this._changing = false;
    this._timer = null;
    this._onVis = () => this.schedule(true);
  }

  get entryId() { return this.getAttribute('entry-id') || ''; }
  get isHost() { return typeof this.client?.communityAdmin === 'function'; }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('visibilitychange', this._onVis);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('visibilitychange', this._onVis);
    clearTimeout(this._timer);
  }
  // Once loaded, a late page-wide client broadcast must not rebuild the page (it would recreate the discussion and
  // drop a half-written post). The page hands this element its own client, so a broadcast is ignored anyway.
  skipClientRender() { return this._state === 'ok'; }

  render() {
    if (!this.client) { this.set(this.css(COMMUNITY_CSS + CSS) + '<div class="cm-skel"></div>'); return; }
    if (this._state === 'idle') { this.load(); return; }
    this.draw();
  }

  classify(e) {
    const code = String(e?.code || '');
    if (code === 'not_found') return 'missing';
    if (code === 'unauthorized' || code === 'not-authenticated') return 'signedout';
    if (code === 'forbidden' && /paid membership/i.test(String(e?.message || ''))) return 'membership';
    return 'error';
  }

  async load() {
    if (!this.entryId) { this._state = 'missing'; this.draw(); return; }
    this._state = 'loading';
    this.draw();
    try {
      this.accept(await this.client.communityEntry(this.entryId));
      this._state = 'ok';
    } catch (e) {
      this._error = e;
      this._state = this.classify(e);
    }
    this.draw();
    this.schedule();
  }

  /** Take a fresh entry. The member's unsent choice survives a refresh unless their saved answer changed. */
  accept(d) {
    const before = JSON.stringify(this._d?.mine ?? null);
    this._d = d;
    if (JSON.stringify(d?.mine ?? null) !== before) { this._choice = null; this._changing = false; }
    if (typeof document !== 'undefined' && d?.entry?.title) document.title = `${d.entry.title} · Community · GBTI Network`;
  }

  /** The live poll. `now` asks at once (the tab came back into view). */
  schedule(now = false) {
    clearTimeout(this._timer);
    if (this._state !== 'ok' || !this._d) return;
    const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
    const delay = pollDelay({ live: this._d.entry.status === 'live', visible });
    if (delay == null) return;
    this._timer = setTimeout(() => this.tick(), now ? 0 : delay);
  }

  async tick() {
    if (!this.isConnected || this._state !== 'ok') return;
    try {
      const r = await this.client.communityUpdates(this.entryId, this._d.version);
      if (r && !r.unchanged && r.entry) { this.accept(r); this.refresh(); }
    } catch (e) {
      const s = this.classify(e);
      if (s !== 'error') { this._state = s; this._error = e; this.draw(); return; }
    }
    this.schedule();
  }

  /** Redraw after a change, keeping the discussion element (and the member's unsent post) in place. */
  refresh() {
    const main = this.$('[data-main]');
    if (!main) return;
    // A typed answer the member has not sent yet survives the redraw, cursor and all.
    const t = this.$('[data-text]');
    const keep = t && !t.disabled ? { value: t.value, focused: this.root.activeElement === t, at: t.selectionStart } : null;
    main.innerHTML = this.mainHtml();
    const n = this.$('[data-text]');
    if (keep && n && !n.disabled) {
      n.value = keep.value;
      if (keep.focused) { n.focus(); try { n.setSelectionRange(keep.at, keep.at); } catch { /* not a text input */ } }
    }
    this.wireMain();
    const send = this.$('[data-send]');
    if (send && n && !n.disabled) send.disabled = !n.value.trim();
    this.feedDiscussion();
  }

  draw() {
    let body;
    if (this._state === 'loading' || this._state === 'idle') body = '<div class="stack" aria-busy="true"><div class="cm-skel"></div><div class="cm-skel"></div></div>';
    else if (this._state === 'missing') {
      body = `<div class="cm-card cm-state"><h2>This entry is not shared with you</h2>
        <p>Entries in Community are shared with chosen members. If you think you should be on this one, ask the host on the call or in Discord.</p>
        <a class="cm-btn2" href="/community/">Back to Community</a></div>`;
    } else if (this._state === 'signedout') {
      const back = encodeURIComponent(`${location.pathname}${location.search}`);
      body = `<div class="cm-card cm-state"><h2>Sign in to take part</h2><p>Community entries are for members.</p><a class="cm-btn" href="/login/?return_to=${back}">Sign in</a></div>`;
    } else if (this._state === 'membership') {
      body = `<div class="cm-state amber"><h2>Community is part of membership</h2><p>Members answer the polls we run on our calls and join each entry's discussion.</p><a class="cm-btn" href="/membership/">See membership</a></div>`;
    } else if (this._state === 'error') {
      body = `<div class="cm-card cm-state"><h2>This entry did not load</h2><p>${esc(this._error?.message || 'Something went wrong.')}</p><button type="button" class="cm-btn2" data-retry>Try again</button></div>`;
    } else {
      const kind = this._d.entry.kind;
      body = `<nav class="crumb" aria-label="Breadcrumb"><a href="/community/">Community</a> › ${esc(KIND_LABEL[kind] || kind)}</nav>
        <div data-main>${this.mainHtml()}</div>
        <gbti-community-discussion></gbti-community-discussion>`;
    }
    this.set(this.css(COMMUNITY_CSS + CSS) + body);
    this.on('[data-retry]', 'click', () => this.load());
    if (this._state === 'ok') {
      const disc = this.$('gbti-community-discussion');
      if (disc) {
        disc.client = this.client;
        disc.addEventListener('community-changed', () => this.pull());
      }
      this.wireMain();
      this.feedDiscussion();
    }
  }

  feedDiscussion() {
    const disc = this.$('gbti-community-discussion');
    if (disc && this._d) disc.data = { entryId: this.entryId, entry: this._d.entry, discussion: this._d.discussion, viewer: this._d.viewer };
  }

  /** Ask for changes now, after this member did something. */
  async pull() {
    try {
      const r = await this.client.communityUpdates(this.entryId, this._d?.version ?? 0);
      if (r && !r.unchanged && r.entry) { this.accept(r); this.refresh(); }
    } catch { /* the next tick tries again */ }
    this.schedule();
  }

  // ---- the page body -----------------------------------------------------------------------------------------

  mainHtml() {
    const { entry } = this._d;
    const pill = statusPill(entry);
    const kind = entry.kind;
    const counts = threadCounts(this._d.discussion);
    const stats = kind === 'topic' ? ` · ${plural(counts.posts, 'post')} · ${plural(counts.replies, 'reply', 'replies')}` : '';
    const faces = (entry.access?.members || []).slice(0, 6).map((m) => `<span class="cm-av" title="${esc(m.login)}">${esc(initials(m.login))}</span>`).join('');
    return `<div class="hdr">
        <div class="line">
          <span class="cm-badge k-${esc(kind)}">${KIND_ICON[kind] || ''}${esc(KIND_LABEL[kind] || kind)}</span>
          ${pill ? `<span class="cm-pill ${pill.tone}">${esc(pill.text)}</span>` : ''}
          <span>${esc(meetingText(entry.meeting))} · started by ${esc(entry.author?.login || 'the host')}${esc(stats)}</span>
        </div>
        <h1>${esc(entry.title)}</h1>
        <div class="who">
          ${faces ? `<span class="cm-faces" aria-hidden="true">${faces}</span>` : ''}
          <span>${esc(sharedLine(entry.access))}</span>
          ${this.isHost ? '<button type="button" class="cm-btn2 sm" data-access>Manage access</button>' : ''}
        </div>
      </div>
      <div class="stack">
        ${this.isHost ? this.hostHtml() : ''}
        ${kind === 'topic' ? this.promptHtml() : this.pollHtml()}
      </div>`;
  }

  promptHtml() {
    const { entry } = this._d;
    const html = entry.prompt ? this.renderMd(entry.prompt) : '';
    const imgs = (entry.promptImages || []).map((i) => `<img src="${esc(this.client.communityImageSrc(entry.id, i.id))}" alt="${esc(i.name)}" loading="lazy">`).join('');
    const closed = entry.status === 'closed' ? `<div class="closed-note">This topic closed${entry.closedAt ? ` on ${esc(new Date(entry.closedAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }))}` : ''}. Everything posted stays here to read; new posts and replies are off.</div>` : '';
    if (!html && !imgs) return closed;
    return `<section class="cm-card prompt" aria-label="The host's prompt">
        <div class="by"><span class="cm-av lg" aria-hidden="true">${esc(initials(entry.author?.login))}</span><strong>${esc(entry.author?.login || '')}</strong><span>Host</span></div>
        ${html ? `<div class="md">${html}</div>` : ''}${imgs ? `<div class="pimgs">${imgs}</div>` : ''}
      </section>${closed}`;
  }

  renderMd(md) {
    try { return this.client.preview({ body: md }).html; } catch { return `<p>${esc(md)}</p>`; }
  }

  pollHtml() {
    const { entry, mine, results } = this._d;
    const state = answerState(entry, mine);
    if (state === 'published') return this.resultsHtml(results, mine);
    if (state === 'draft') return `<section class="cm-card cm-raised ans"><p class="ask">This poll has not opened yet. Members cannot see it until you open it.</p>${entry.kind === 'poll' ? this.choicesHtml(true) : this.typedHtml(true)}</section>`;
    const locked = state === 'closed' || (state === 'answered' && !this._changing);
    const block = entry.kind === 'poll' ? this.choicesHtml(locked) : this.typedHtml(locked);
    let acts;
    if (state === 'closed') acts = `<span class="msg">Voting is closed. Results appear here once they are published.</span>`;
    else if (state === 'answered' && !this._changing) {
      const can = entry.settings?.changeable !== false;
      acts = `${can ? '<button type="button" class="cm-btn2" data-change>Change my answer</button>' : ''}<span class="cm-ok">Answer saved.</span><span class="msg">${esc(can ? 'You can change it until the poll closes. ' : '')}Results appear here once they are published.</span>`;
    } else {
      acts = `<button type="button" class="cm-btn" data-send${this.ready() ? '' : ' disabled'}>Send my answer</button><span class="msg">${esc(answeredLine(entry))}</span>`;
    }
    return `<section class="cm-card cm-raised ans" aria-label="Your answer">${block}<div class="acts">${acts}</div><div data-msg></div></section>`;
  }

  ready() {
    const { entry } = this._d;
    if (entry.kind === 'poll') return Number.isInteger(this._choice ?? this._d.mine?.choice);
    const v = this.$('[data-text]')?.value ?? this._d.mine?.text ?? '';
    return String(v).trim().length > 0;
  }

  choicesHtml(locked) {
    const { entry, mine } = this._d;
    const picked = this._choice ?? mine?.choice ?? null;
    const opts = (entry.options || []).map((label, i) => {
      const on = picked === i;
      const dim = locked && entry.status === 'closed' && !on;
      return `<label class="opt${on ? ' on' : ''}${dim ? ' dim' : ''}${locked ? ' locked' : ''}">
        <input type="radio" name="choice" value="${i}"${on ? ' checked' : ''}${locked ? ' disabled' : ''}><span>${esc(label)}</span></label>`;
    }).join('');
    return `<fieldset><legend>${locked ? 'Your answer' : 'Choose one answer.'}</legend>${opts}</fieldset>`;
  }

  typedHtml(locked) {
    const { entry, mine } = this._d;
    const value = mine?.text ?? '';
    return `<label class="typed">${locked ? 'Your answer' : 'Type your answer.'}
      <input type="text" data-text maxlength="${typedMax(entry)}" placeholder="${esc(entry.settings?.hint || '')}" value="${esc(value)}"${locked ? ' disabled' : ''} class="${mine && locked ? 'on' : ''}" autocomplete="off"></label>`;
  }

  resultsHtml(results, mine) {
    const { entry } = this._d;
    const rows = barRows(results);
    const marker = entry.kind === 'typed' ? 'Includes yours' : 'Your answer';
    const bars = rows.map((r) => `<div class="cm-bar${r.lead ? ' lead' : ''}">
        <span class="lbl">${esc(r.label)}${r.mine ? `<span class="cm-yours">${marker}</span>` : ''}</span>
        <span class="num">${r.count} · ${r.pct}%</span>
        <span class="trk"><span class="fill" style="width:${r.pct}%"></span></span></div>`).join('');
    const every = entry.kind === 'typed' && (results?.every || []).length
      ? `<p class="sub">Every answer, as typed</p><div class="every">${results.every.map((a) => `<span>${esc(a)}</span>`).join('')}</div>
         <p class="cm-mute" style="margin:0;font-size:13px">Answers that match are counted together. Names are never shown.</p>`
      : '';
    return `<section class="cm-card cm-raised ans" aria-label="Results">
        <p class="ask" style="margin:0">${esc(plural(results?.total || 0, 'answer'))}${mine ? '. Yours is marked.' : '.'}</p>
        <div class="cm-bars">${bars || '<p class="cm-mute" style="margin:0">Nobody answered this poll.</p>'}</div>${every}
      </section>`;
  }

  // ---- the host panel ----------------------------------------------------------------------------------------

  hostHtml() {
    const { entry, results } = this._d;
    const poll = isPollKind(entry.kind);
    const st = entry.status;
    const btn = (op, label, cls = 'cm-btn2') => `<button type="button" class="${cls}" data-op="${op}">${esc(label)}</button>`;
    const acts = [];
    if (st === 'draft') acts.push(btn('open', 'Open now', 'cm-btn'));
    if (st === 'live') acts.push(btn('close', poll ? 'Close voting' : 'Close topic', 'cm-btn'));
    if (poll && st === 'closed') acts.push(btn('publish', 'Publish results', 'cm-btn'), btn('open', 'Reopen voting'));
    if (poll && st === 'live') acts.push(`<button type="button" class="cm-btn2" disabled title="Close voting first">Publish results</button>`);
    if (poll && st === 'published') acts.push(btn('unpublish', 'Unpublish results'));
    if (!poll && st === 'closed') acts.push(btn('open', 'Reopen topic'));
    if (poll && st !== 'draft') acts.push(btn(entry.locked ? 'unlock' : 'lock', entry.locked ? 'Reopen the discussion' : 'Close the discussion'));
    acts.push('<button type="button" class="cm-btn2" data-copy>Copy the link</button>', '<button type="button" class="cm-btn2" data-edit>Edit</button>', '<button type="button" class="cm-quiet cm-danger" data-op="delete">Delete</button>');
    const opened = entry.openedAt ? `Opened ${new Date(entry.openedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · ` : '';
    let live = '';
    if (poll && results) {
      const rows = barRows(results);
      live = `<div class="big"><b>${results.total}</b><span>${st === 'live' ? 'answers so far, updating live' : plural(results.total, 'answer')}</span></div>
        ${entry.kind === 'poll' ? `<div class="cm-bars">${rows.map((r) => `<div class="cm-bar${r.lead ? ' lead' : ''}"><span class="lbl">${esc(r.label)}</span><span class="num">${r.count} · ${r.pct}%</span><span class="trk"><span class="fill" style="width:${r.pct}%"></span></span></div>`).join('')}</div>` : this.tidyHtml(results)}
        ${st !== 'published' ? `<div class="cm-note">Only superadmins see ${entry.kind === 'typed' ? 'answers' : 'these counts'} while voting is open. Members see results after you publish them.</div>` : ''}`;
    }
    const rule = poll ? 'Edit locks the question and answers once the first member answers. Publish unlocks once voting is closed.' : 'Closing a topic turns new posts and replies off. Everything posted stays to read.';
    return `<section class="cm-card host" aria-label="Host controls">
        <div class="top"><span class="cm-mono">You are the host</span><span>${esc(opened)}${esc(meetingText(entry.meeting))}</span></div>
        ${live}
        <div class="acts">${acts.join('')}</div>
        <div data-host-msg></div>
        <p class="rule" style="margin:0">${esc(rule)}</p>
      </section>`;
  }

  tidyHtml(results) {
    const groups = results.groups || [];
    if (!groups.length && !(results.hidden || []).length) return '<p class="cm-mute" style="margin:0">Answers appear here as members send them.</p>';
    const others = (g) => groups.filter((x) => x.key !== g.key).map((x) => `<option value="${esc(x.norms?.[0] || '')}">${esc(x.label)}</option>`).join('');
    const rows = groups.map((g, i) => `<div class="grp" data-g="${i}">
        <span class="nm">${esc(g.label)} <span class="cm-mute" style="font-weight:500">· ${g.count}</span></span>
        <span class="ops">
          <button type="button" class="cm-btn2 sm" data-rename="${i}">Rename</button>
          ${groups.length > 1 ? `<select data-merge="${i}" aria-label="Merge ${esc(g.label)} into another answer"><option value="">Merge into…</option>${others(g)}</select>` : ''}
          <button type="button" class="cm-btn2 sm" data-hide="${i}">Hide</button>
        </span>
        ${(g.spellings || []).length > 1 ? `<span class="sp">Typed as: ${g.spellings.map((s) => esc(s)).join(', ')}</span>` : ''}
      </div>`).join('');
    const hidden = (results.hidden || []).length
      ? `<p class="sub">Hidden from the results</p><div class="every">${results.hidden.map((h, i) => `<span>${esc(h)} <button type="button" class="cm-quiet" data-unhide="${i}">Show</button></span>`).join('')}</div>`
      : '';
    return `<p class="sub">Answers as they arrive, matched together</p><div class="tidy">${rows}</div>${hidden}`;
  }

  // ---- wiring ------------------------------------------------------------------------------------------------

  wireMain() {
    for (const r of this.$$('input[name="choice"]')) {
      r.addEventListener('change', () => { this._choice = Number(r.value); this.refresh(); });
    }
    const text = this.$('[data-text]');
    if (text && !text.disabled) {
      text.addEventListener('input', () => { const b = this.$('[data-send]'); if (b) b.disabled = !text.value.trim(); });
      text.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && text.value.trim()) { ev.preventDefault(); this.send(); } });
    }
    this.on('[data-send]', 'click', () => this.send());
    this.on('[data-change]', 'click', () => { this._changing = true; this.refresh(); this.$('[data-text]')?.focus(); });
    for (const b of this.$$('[data-op]')) b.addEventListener('click', () => this.hostOp(b.dataset.op, b));
    this.on('[data-copy]', 'click', () => this.copyLink());
    this.on('[data-edit]', 'click', () => this.openEditor('edit'));
    this.on('[data-access]', 'click', () => this.openEditor('access'));
    const groups = this._d?.results?.groups || [];
    for (const b of this.$$('[data-rename]')) b.addEventListener('click', () => this.rename(groups[Number(b.dataset.rename)]));
    for (const b of this.$$('[data-hide]')) b.addEventListener('click', () => this.hideGroup(groups[Number(b.dataset.hide)]));
    for (const s of this.$$('[data-merge]')) s.addEventListener('change', () => { if (s.value) this.tidy({ action: 'merge', norm: groups[Number(s.dataset.merge)]?.norms?.[0], into: s.value }); });
    for (const b of this.$$('[data-unhide]')) b.addEventListener('click', () => this.tidy({ action: 'unhide', norm: normalizeTyped(this._d.results.hidden[Number(b.dataset.unhide)]) }));
  }

  say(sel, text, bad = false) {
    const el = this.$(sel);
    if (el) el.innerHTML = text ? `<span class="${bad ? 'bad' : 'flash'}" role="status">${esc(text)}</span>` : '';
  }

  async send() {
    const { entry } = this._d;
    const answer = entry.kind === 'poll' ? { choice: this._choice ?? this._d.mine?.choice } : { text: this.$('[data-text]')?.value || '' };
    const b = this.$('[data-send]');
    if (b) { b.disabled = true; b.textContent = 'Sending'; }
    try {
      const r = await this.client.communityAnswer(entry.id, answer);
      this._d.mine = r?.mine || this._d.mine;
      this._changing = false;
      this._choice = null;
      this.refresh();
      await this.pull();
    } catch (e) {
      if (b) { b.disabled = false; b.textContent = 'Send my answer'; }
      this.say('[data-msg]', e?.message || 'Your answer was not saved. Try again.', true);
    }
  }

  async hostOp(op, btn) {
    if (op === 'delete' && !confirm('Delete this entry, its answers and its whole discussion? This cannot be undone.')) return;
    if (btn) btn.disabled = true;
    try {
      await this.client.communityAdmin(op, { id: this.entryId });
      if (op === 'delete') { location.href = '/community/'; return; }
      await this.pull();
    } catch (e) {
      if (btn) btn.disabled = false;
      this.say('[data-host-msg]', e?.message || 'That did not work. Try again.', true);
    }
  }

  async tidy(payload) {
    try { await this.client.communityAdmin('tidy', { id: this.entryId, ...payload }); await this.pull(); } catch (e) { this.say('[data-host-msg]', e?.message || 'That did not work.', true); }
  }

  rename(g) {
    if (!g) return;
    const label = prompt('Rename this answer group', g.label);
    if (label && label.trim() && label.trim() !== g.label) this.tidy({ action: 'rename', norm: g.norms?.[0], label: label.trim() });
  }

  async hideGroup(g) {
    if (!g) return;
    for (const norm of g.norms || []) {
      try { await this.client.communityAdmin('tidy', { id: this.entryId, action: 'hide', norm }); } catch (e) { this.say('[data-host-msg]', e?.message || 'That did not work.', true); return; }
    }
    await this.pull();
  }

  async copyLink() {
    const url = `${location.origin}${entryHref(this.entryId)}`;
    try { await navigator.clipboard.writeText(url); this.say('[data-host-msg]', 'Link copied. Paste it into the call chat.'); } catch { prompt('Copy this link', url); }
  }

  async openEditor(mode) {
    await import('./gbti-community-editor.mjs');
    const ed = document.createElement('gbti-community-editor');
    ed.client = this.client;
    document.body.appendChild(ed);
    ed.addEventListener('community-saved', () => this.pull());
    if (mode === 'access') ed.openAccess(this._d.entry); else ed.openEdit(this._d.entry, { answered: (this._d.results?.total || 0) > 0 });
  }
}

define('gbti-community-entry', GbtiCommunityEntry);
export { GbtiCommunityEntry, relTime, absTime };
