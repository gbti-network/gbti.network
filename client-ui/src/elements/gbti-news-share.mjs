// <gbti-news-share> (sow-171, owner 2026-10-01: "as superadmin looking at a news source within the extension we should
// have an ability to assisted post to our syndication targets"). The "Share to our channels" panel under a news story
// in the extension's reader, built to the approved design (https://claude.ai/artifact/RRJgnCYYhB3Q3hCZ8sT5FT, option A).
//
// Nothing shows until the superadmin presses the reader's "Share to our channels" button ("make sure that these extra
// items are not revealed initially"), and no channel is picked when it opens. Picking a hand-posted channel shows its
// draft (edit it, then Assist opens the site's own composer with it filled in, then Mark done records the post in the
// Social Queue under Manual done). Discord posts straight away through the existing news publish, to a channel the
// superadmin picks. dev.to is shown disabled: it crossposts a repo file, and a news story has none.
//
// The reader owns one node per story (so drafts survive the reader's re-renders) and calls open() and close(). The
// reader mounts it for a superadmin only; the Worker is the real gate on every call.
import { GbtiElement, define, esc } from '../base.mjs';
import { socialIcon } from '../social-icons.mjs';
import { composeUrl } from '../social-composer.mjs';
import { channelLimit } from '../../../membership/syndication-channels.mjs';
import {
  NEWS_SHARE_CHANNELS, NEWS_SHARE_LABELS, newsShareUrl, newsShareDraft, newsRedditComment, swapLink, formatNewsPost,
} from '../../../membership/news-share.mjs';

const PILLS = [...NEWS_SHARE_CHANNELS, 'discord', 'devto'];
const NOTES = {
  x: 'Opens X with this text filled in. Post it there, then press Mark done.',
  bluesky: 'Opens Bluesky with this text filled in. Post it there, then press Mark done.',
  linkedin: 'Opens LinkedIn with this text. LinkedIn does not always fill it in, so press Copy text first. The link becomes an article card.',
  reddit: 'Opens r/GBTI_network with the title and link filled in. Post it, paste the first comment under it, then press Mark done.',
  dailydev: 'Copies the text and opens the GBTI squad on daily.dev, which cannot be filled in. Paste it there, then press Mark done.',
  discord: 'Posts straight to Discord as the GBTI bot. A story goes to Discord once.',
};
const DONE_MSG = 'Marked done. It is listed in the Social Queue under Manual done, so nobody posts it twice.';
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const fmtWhen = (v) => { try { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };
// The Discord message as Discord shows it: **bold** and a whole-line _italic_ are the only markup formatNewsPost
// writes. Escaped first, and italic only for a whole line, so an underscore inside the link is left alone.
export const discordPreviewHtml = (msg) => String(msg || '').split('\n')
  .map((line) => esc(line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/^_(.+)_$/, '<em>$1</em>'))
  .join('<br>');
const listOr = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} or ${a[a.length - 1]}`);
const listAnd = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

const CSS = `
  :host { display:block; margin:16px 0 0; }
  :host([hidden]) { display:none !important; } /* the host's own display would otherwise beat the hidden attribute */
  .ns { border:1px solid var(--line); background:var(--panel); border-radius:7px; padding:18px; display:flex; flex-direction:column; gap:14px;
    -webkit-backdrop-filter:var(--glass-blur); backdrop-filter:var(--glass-blur); }
  .hd { display:flex; align-items:baseline; justify-content:space-between; gap:12px; }
  .eyebrow { font-size:11px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:var(--accent); }
  .who { font-size:11.5px; color:var(--fg-mute, var(--muted)); }
  .cov, .hint, .note { margin:0; font-size:12.5px; line-height:1.5; color:var(--muted); }
  .note { font-size:12px; }
  .pills { display:flex; flex-wrap:wrap; gap:8px; }
  button.pill { display:inline-flex; align-items:center; gap:7px; min-height:40px; padding:0 13px; border-radius:999px; font-size:13px; font-weight:600;
    background:transparent; color:var(--fg); border:1px solid var(--line-2, var(--line)); }
  button.pill:hover:not([disabled]) { background:transparent; border-color:var(--accent); }
  button.pill[aria-pressed="true"] { border:1.5px solid var(--accent); background:var(--green-tint); }
  button.pill[aria-pressed="true"]:hover { background:var(--green-tint); }
  button.pill[disabled] { opacity:1; color:var(--fg-mute, var(--muted)); border-style:dashed; cursor:not-allowed; }
  .pst { font-size:11.5px; font-weight:700; color:var(--accent); }
  .pst.soft { color:var(--muted); font-weight:600; }
  .sep { height:1px; background:var(--line); }
  .field { display:flex; flex-direction:column; gap:6px; }
  .flab { display:flex; justify-content:space-between; align-items:baseline; gap:10px; }
  label, .lab { display:block; margin:0; font-size:13px; font-weight:700; color:var(--fg); }
  .count { font-size:12px; font-weight:700; color:var(--fg-mute, var(--muted)); font-variant-numeric:tabular-nums; }
  .count.over { color:var(--danger); }
  textarea, input, select { font-family:var(--font-body); font-size:14px; line-height:1.55; color:var(--fg); background:var(--bg); border:1px solid var(--line-2, var(--line)); }
  textarea { min-height:0; }
  .linkline { font-size:13px; color:var(--muted); padding:9px 12px; border-radius:8px; border:1px dashed var(--line-2, var(--line)); word-break:break-all; }
  .linkto { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .linkto .lab { margin-right:4px; }
  button.seg { min-height:40px; padding:0 14px; border-radius:9px; font-size:13px; font-weight:600; background:transparent; color:var(--fg); border:1px solid var(--line-2, var(--line)); }
  button.seg:hover { background:transparent; border-color:var(--accent); }
  button.seg[aria-checked="true"] { background:var(--accent); border-color:var(--accent); color:var(--on-accent); }
  button.seg[aria-checked="true"]:hover { background:var(--accent); }
  .preview { font-size:14px; line-height:1.6; padding:12px 14px; border-radius:8px; border:1px solid var(--line); background:var(--bg); word-break:break-word; }
  .preview em { color:var(--muted); }
  .acts { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  button.pri { display:inline-flex; align-items:center; gap:8px; min-height:44px; padding:0 18px; border-radius:9px; font-size:13.5px; font-weight:700;
    background:var(--accent); color:var(--on-accent); border:1px solid var(--accent); }
  button.pri:hover:not([disabled]) { background:var(--accent); filter:brightness(1.08); }
  button.sec { min-height:44px; padding:0 16px; border-radius:9px; font-size:13.5px; font-weight:600; background:transparent; color:var(--fg); border:1px solid var(--line-2, var(--line)); }
  button.sec:hover:not([disabled]) { background:transparent; border-color:var(--accent); color:var(--accent); }
  button.pri[disabled], button.sec[disabled] { opacity:.6; cursor:default; }
  button.link { background:none; border:0; padding:0; color:var(--accent); font-weight:700; text-decoration:underline; }
  button.link:hover { background:none; }
  .msg { margin:0; font-size:12.5px; color:var(--accent); } .msg.err { color:var(--danger); }
`;

class GbtiNewsShare extends GbtiElement {
  constructor() {
    super();
    this._story = null;
    this._publisher = '';
    this._reset();
  }

  /** The story this panel shares: { guid, title, link, source, category, excerpt }. A new story starts fresh. */
  set story(s) { this._story = s || null; this._status = null; this._statusErr = null; this._reset(); if (this.isConnected) this.render(); }
  get story() { return this._story; }
  /** The publication's display name for "via <Publisher>" (the reader learns it after the story opens). */
  set publisher(p) { this._publisher = String(p || ''); if (this.isConnected) this.render(); }

  _reset() {
    this._target = '';
    this._linkTo = 'source';
    this._drafts = {};
    this._comment = null;
    this._opened = {};
    this._msg = null;
    this._discordChoice = '';
  }

  /** Shown by the reader's toggle: reveal, then read where the story has gone (each time, so another superadmin's
   *  posts show) and the Discord channels (once). */
  open() {
    this.hidden = false;
    this.render();
    this._loadStatus();
    if (!this._channels) this._loadChannels();
  }
  /** Hidden again by the toggle. The pick, the drafts and the message are forgotten. */
  close() {
    this.hidden = true;
    this._reset();
    this.render();
  }

  async _loadStatus() {
    const story = this._story;
    if (!story?.guid || !this.client?.newsShareStatus) return;
    this._statusErr = null;
    this.render();
    try {
      const r = await this.client.newsShareStatus(story.guid, story.category || '');
      if (this._story !== story) return;
      this._status = { discord: r?.discord || {}, channels: r?.channels || {} };
    } catch (e) {
      if (this._story !== story) return;
      this._statusErr = e?.message || 'Could not check where this story has been posted.';
    }
    this.render();
  }

  async _loadChannels() {
    if (!this.client?.discordChannels) { this._channels = []; return; }
    try {
      const r = await this.client.discordChannels();
      this._channels = (r?.channels || []).filter((c) => c.type === 0 || c.type === 5);
    } catch { this._channels = []; }
    this.render();
  }

  _posted(ch) {
    if (ch === 'discord') return Boolean(this._status?.discord?.posted);
    return Boolean(this._status?.channels?.[ch]);
  }
  _url() { return newsShareUrl(this._story || {}, this._linkTo); }
  _draft(ch) {
    if (this._drafts[ch] != null) return this._drafts[ch];
    return newsShareDraft(ch, this._story || {}, { linkTo: this._linkTo, publisher: this._publisher });
  }
  _commentText() {
    return this._comment != null ? this._comment : newsRedditComment(this._story || {}, { linkTo: this._linkTo, publisher: this._publisher });
  }

  _coverage() {
    if (this._statusErr) return '';
    if (!this._status) return 'Checking where this story has been posted...';
    const live = [...NEWS_SHARE_CHANNELS, 'discord'];
    const posted = live.filter((c) => this._posted(c)).map((c) => NEWS_SHARE_LABELS[c]);
    const not = live.filter((c) => !this._posted(c)).map((c) => NEWS_SHARE_LABELS[c]);
    return `${posted.length ? `Posted to ${listAnd(posted)}. ` : 'Not posted anywhere yet. '}${not.length ? `Not yet on ${listOr(not)}.` : 'Every channel has it.'}`;
  }

  _pill(ch) {
    const label = NEWS_SHARE_LABELS[ch];
    if (ch === 'devto') {
      return `<button type="button" class="pill" disabled title="dev.to takes pages we publish ourselves">${socialIcon('devto', 15)}<span>${label}</span><span class="pst soft">GBTI pages only</span></button>`;
    }
    const st = this._posted(ch) ? '<span class="pst">Posted</span>' : this._opened[ch] ? '<span class="pst soft">Opened</span>' : '';
    return `<button type="button" class="pill" data-pick="${ch}" aria-pressed="${this._target === ch}">${socialIcon(ch, 15)}<span>${label}</span>${st}</button>`;
  }

  _linkChoice() {
    const host = hostOf(this._story?.link) || 'the publication';
    const seg = (v, text) => `<button type="button" class="seg" role="radio" data-link="${v}" aria-checked="${this._linkTo === v}">${esc(text)}</button>`;
    return `<div class="linkto" role="radiogroup" aria-labelledby="ns-linkto"><span class="lab" id="ns-linkto">Link to</span>`
      + seg('source', `The article on ${host}`) + seg('gbti', 'Our news page on gbti.network') + '</div>';
  }

  _counter(ch, text) {
    const limit = channelLimit(ch);
    const over = text.length > limit;
    return `<span class="count${over ? ' over' : ''}" data-count>${text.length} / ${limit}${over ? ' (too long)' : ''}</span>`;
  }

  _composer(ch) {
    const label = NEWS_SHARE_LABELS[ch];
    if (ch === 'discord') {
      const d = this._status?.discord || {};
      const chosen = this._discordChoice || d.channelId || d.mappedChannelId || '';
      const opts = (this._channels || []).map((c) => `<option value="${esc(c.id)}"${c.id === chosen ? ' selected' : ''}>#${esc(c.name)}</option>`).join('');
      const picker = this._channels == null
        ? '<p class="note">Loading the Discord channels...</p>'
        : opts
          ? `<select id="ns-dc" data-dc ${d.posted ? 'disabled' : ''}>${chosen ? '' : '<option value="" selected>Pick a channel</option>'}${opts}</select>`
          : '<p class="note">Could not load the Discord channels, so the story goes to the channel for its category.</p>';
      return `<div class="field"><label for="ns-dc">Channel</label>${picker}</div>`
        + `<div class="field"><span class="lab">Message</span><div class="preview">${discordPreviewHtml(formatNewsPost(this._story || {}))}</div></div>`;
    }
    if (ch === 'reddit') {
      const title = this._draft('reddit');
      return `<div class="field"><div class="flab"><label for="ns-title">Title for r/GBTI_network</label>${this._counter('reddit', title)}</div>`
        + `<input id="ns-title" type="text" data-draft value="${esc(title)}"></div>`
        + `<div class="field"><span class="lab">Link</span><div class="linkline">${esc(this._url())}</div></div>`
        + `<div class="field"><label for="ns-comment">First comment</label><textarea id="ns-comment" rows="3" data-comment>${esc(this._commentText())}</textarea></div>`;
    }
    const text = this._draft(ch);
    return `<div class="field"><div class="flab"><label for="ns-text">Post text for ${esc(label)}</label>${this._counter(ch, text)}</div>`
      + `<textarea id="ns-text" rows="${ch === 'linkedin' ? 7 : 4}" data-draft>${esc(text)}</textarea></div>`;
  }

  _actions(ch) {
    const label = NEWS_SHARE_LABELS[ch];
    if (ch === 'discord') {
      const posted = this._posted('discord');
      return `<div class="acts"><button type="button" class="pri" data-discord${posted || this._busy ? ' disabled' : ''}>${socialIcon('discord', 15)} `
        + `${posted ? 'Posted to Discord' : this._busy ? 'Posting...' : 'Post now to Discord'}</button></div>`;
    }
    const done = this._posted(ch);
    return `<div class="acts"><button type="button" class="pri" data-assist>${socialIcon(ch, 15)} Assist post to ${esc(label)}</button>`
      + `<button type="button" class="sec" data-copy>${ch === 'reddit' ? 'Copy comment' : 'Copy text'}</button>`
      + `<button type="button" class="sec" data-done${done ? ' disabled' : ''}>${done ? 'Done' : 'Mark done'}</button></div>`;
  }

  _postedLine(ch) {
    if (ch === 'discord') {
      const at = this._status?.discord?.postedAt;
      return this._posted('discord') ? `<p class="note">Posted to Discord${at ? ` on ${esc(fmtWhen(at))}` : ''}.</p>` : '';
    }
    const rec = this._status?.channels?.[ch];
    if (!rec) return '';
    const when = rec.doneAt ? ` on ${esc(fmtWhen(rec.doneAt))}` : '';
    return `<p class="note">Marked done${rec.doneBy ? ` by ${esc(rec.doneBy)}` : ''}${when}. You can still post it again.</p>`;
  }

  render() {
    if (!this._story) { this.set(this.css(CSS)); return; }
    const ch = this._target;
    const cov = this._statusErr
      ? `<p class="cov msg err" role="status">${esc(this._statusErr)} <button type="button" class="link" data-retry>Try again</button></p>`
      : `<p class="cov">${esc(this._coverage())}</p>`;
    const body = ch
      ? '<div class="sep"></div>'
        + (ch === 'discord' ? '' : this._linkChoice())
        + this._composer(ch)
        + `<p class="note">${esc(NOTES[ch] || '')}</p>`
        + (this._msg?.text === DONE_MSG ? '' : this._postedLine(ch)) // just marked: the message below already says so
        + this._actions(ch)
        + (this._msg ? `<p class="msg${this._msg.err ? ' err' : ''}" role="status">${esc(this._msg.text)}</p>` : '')
      : '<p class="hint">Pick a channel to write its post.</p>';
    this.set(this.css(CSS)
      + '<section class="ns" aria-label="Share to our channels">'
      + '<div class="hd"><span class="eyebrow">Share to our channels</span><span class="who">Superadmin</span></div>'
      + cov
      + `<div class="pills" role="group" aria-label="Channel">${PILLS.map((c) => this._pill(c)).join('')}</div>`
      + body
      + '</section>');
    this._wire();
  }

  _wire() {
    this.$$('[data-pick]').forEach((b) => b.addEventListener('click', () => {
      this._target = b.dataset.pick;
      this._msg = null;
      this.render();
    }));
    this.$$('[data-link]').forEach((b) => b.addEventListener('click', () => this._setLink(b.dataset.link)));
    const draft = this.$('[data-draft]');
    draft?.addEventListener('input', () => {
      this._drafts[this._target] = draft.value;
      const counter = this.$('[data-count]');
      if (counter) counter.outerHTML = this._counter(this._target, draft.value);
    });
    const comment = this.$('[data-comment]');
    comment?.addEventListener('input', () => { this._comment = comment.value; });
    const dc = this.$('[data-dc]');
    dc?.addEventListener('change', () => { this._discordChoice = dc.value; });
    this.$('[data-assist]')?.addEventListener('click', () => this._assist());
    this.$('[data-copy]')?.addEventListener('click', () => this._copy());
    this.$('[data-done]')?.addEventListener('click', () => this._markDone());
    this.$('[data-discord]')?.addEventListener('click', () => this._postDiscord());
    this.$('[data-retry]')?.addEventListener('click', () => this._loadStatus());
  }

  /** Switching the link keeps edits: the old address inside an edited draft becomes the new one. */
  _setLink(v) {
    if (v === this._linkTo) return;
    const from = this._url();
    this._linkTo = v === 'gbti' ? 'gbti' : 'source';
    const to = this._url();
    for (const k of Object.keys(this._drafts)) this._drafts[k] = swapLink(this._drafts[k], from, to);
    this._msg = null;
    this.render();
  }

  _assist() {
    const ch = this._target;
    const text = this._draft(ch);
    // daily.dev cannot be filled in, so its text goes to the clipboard first. Nothing is awaited before window.open,
    // so the click still counts as the user's own gesture for the new tab.
    const copied = ch === 'dailydev' ? navigator.clipboard?.writeText?.(text) : null;
    const url = composeUrl({ channel: ch, text, url: this._url() });
    if (url) { try { window.open(url, '_blank', 'noopener'); } catch { /* a blocked popup; Copy still works */ } }
    this._opened[ch] = true;
    const label = NEWS_SHARE_LABELS[ch];
    this._msg = { text: ch === 'reddit' ? 'Opened Reddit with the title and link filled in. Post it, paste the first comment, then press Mark done.'
      : ch === 'dailydev' ? 'Copied the post text and opened the GBTI squad. Paste it there, then press Mark done.'
        : `Opened ${label} with the text. Post it there, then press Mark done.` };
    this.render();
    Promise.resolve(copied).catch(() => { this._msg = { text: 'Opened the GBTI squad, but the text did not copy. Press Copy text, then paste it there.', err: true }; this.render(); });
  }

  async _copy() {
    const ch = this._target;
    const text = ch === 'reddit' ? this._commentText() : this._draft(ch);
    try { await navigator.clipboard.writeText(text); this._msg = { text: ch === 'reddit' ? 'Copied the first comment.' : 'Copied the post text.' }; }
    catch { this._msg = { text: 'Could not copy automatically; select the text to copy it.', err: true }; }
    this.render();
  }

  /** Shows as done at once, then settles with the Worker; a refusal puts it back and says why. */
  async _markDone() {
    const ch = this._target;
    const story = this._story;
    if (!ch || !story?.guid || !this.client?.newsShareDone) return;
    const url = this._url();
    if (!url) { this._msg = { text: 'This story has no web address to post, so it cannot be marked done.', err: true }; this.render(); return; }
    const status = this._status || { discord: {}, channels: {} };
    const prev = status.channels[ch] ?? null;
    this._status = { ...status, channels: { ...status.channels, [ch]: { doneAt: Date.now(), doneBy: null } } };
    this._msg = { text: DONE_MSG };
    this.render();
    try {
      const r = await this.client.newsShareDone({
        guid: story.guid, channel: ch, title: story.title || '', url, category: story.category || '',
        text: this._draft(ch), ...(ch === 'reddit' ? { commentText: this._commentText() } : {}),
      });
      if (this._story !== story) return;
      if (r?.done) this._status = { ...this._status, channels: { ...this._status.channels, [ch]: r.done } };
    } catch (e) {
      if (this._story !== story) return;
      this._status = { ...this._status, channels: { ...this._status.channels, [ch]: prev } };
      this._msg = { text: e?.message || 'Could not record the post. Try again in a minute.', err: true };
    }
    this.render();
  }

  async _postDiscord() {
    const story = this._story;
    if (!story?.guid || this._busy || !this.client?.publishNews) return;
    const d = this._status?.discord || {};
    // Only a channel the superadmin CHOSE is sent. The category's own channel is the Worker's default, so leaving the
    // picker alone keeps the plain route (which does not depend on reading the guild's channel list).
    const channelId = this._discordChoice && this._discordChoice !== d.mappedChannelId ? this._discordChoice : '';
    if (!channelId && !d.mappedChannelId && (this._channels || []).length) { this._msg = { text: 'Pick a Discord channel first.', err: true }; this.render(); return; }
    this._busy = true;
    this._msg = null;
    this.render();
    try {
      const r = await this.client.publishNews(story, channelId ? { channelId } : {});
      if (this._story !== story) return;
      if (r?.posted || r?.alreadyPosted) {
        this._status = { ...(this._status || { channels: {} }), discord: { ...d, posted: true, postedAt: d.postedAt || new Date().toISOString(), channelId: r.channelId ?? channelId } };
        this._msg = { text: r.posted ? 'Posted to Discord.' : 'Already posted to Discord.' };
      } else {
        const cat = story.category ? ` (category: ${story.category})` : '';
        this._msg = { text: `${r?.reason || 'No Discord channel is set for this story.'}${cat}`, err: true };
      }
    } catch (e) {
      if (this._story !== story) return;
      this._msg = { text: e?.message || 'Could not post to Discord.', err: true };
    }
    this._busy = false;
    this.render();
  }
}

define('gbti-news-share', GbtiNewsShare);
export { GbtiNewsShare, PILLS as NEWS_SHARE_PILLS, NOTES as NEWS_SHARE_NOTES };
