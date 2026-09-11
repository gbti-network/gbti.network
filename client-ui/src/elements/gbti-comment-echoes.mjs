// <gbti-comment-echoes>: the author's OWN pending comments on a public content page (SOW-076 echoes, shown on
// the website since 2026-09-11). The page's comment thread is static (built), so a fresh comment could not appear
// there until the site rebuilt; this element sits between the thread and the composer and renders the caller's
// echoes as cards that look like landed comments, each with a note on its merge status. It reads them through
// client.listComments (both hosts merge echoes there and tag them _pending), renders each body through
// client.preview with autoEmbed (a bare video link frames the player, like the built comment will), bumps the
// static "N Comments" heading and hides the "No comments yet" card while a row is pending, and polls the pull
// list for the merge outcome for a few minutes. Inert with no client (an anonymous visitor sees nothing).
import { GbtiElement, define, esc } from '../base.mjs';
import { EMBED_POSTER_CSS, wireEmbedPosters } from '../embed-lightbox.mjs';
import { relTime } from '../time-core.mjs';
import { pendingRows, pullOutcome, echoNote, pullsOf } from '../comment-echo-core.mjs';

const POLL_MS = 15000;
const POLL_MAX = 20; // five minutes, then the next page load reads the outcome
const CSS = `
  /* No :host(:empty) here: the light DOM is ALWAYS empty (everything renders into the shadow root), so that
     rule hid the element permanently. The harness DOM probe passed while the screenshot showed nothing
     (2026-09-11). With no rows the shadow root is empty and the block has no height, which is the hidden state. */
  :host { display:block; }
  .rows { list-style:none; padding:0; margin:24px 0 0; display:flex; flex-direction:column; gap:24px; }
  .card { border:1px solid var(--line); border-radius:12px; background:var(--panel); padding:20px; display:flex; gap:14px; align-items:flex-start; }
  .cav { width:44px; height:44px; border-radius:999px; background:var(--hover); color:var(--muted); display:inline-flex; align-items:center; justify-content:center; font-weight:700; flex:none; overflow:hidden; }
  .cav img { width:100%; height:100%; object-fit:cover; }
  .main { flex:1; min-width:0; }
  .meta { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--muted); flex-wrap:wrap; }
  .name { font-weight:700; color:var(--fg); font-size:15px; }
  .badge { font-size:9.5px; text-transform:uppercase; letter-spacing:.04em; border:1px solid var(--line); border-radius:999px; padding:0 6px; white-space:nowrap; }
  .body { margin-top:8px; color:var(--fg); font-size:15px; line-height:1.6; }
  .body p { margin:0 0 .6em; } .body a { color:var(--accent, var(--brand)); }
  .body pre { background:var(--hover); padding:8px; border-radius:6px; overflow:auto; }
  ${EMBED_POSTER_CSS}
  .note { margin-top:10px; font-size:12.5px; color:var(--muted); display:flex; align-items:center; gap:8px; }
  .note.ok { color:var(--s-green-fg, #1f9e5f); } .note.bad { color:var(--danger, #c0392b); }
  .dot { width:8px; height:8px; border-radius:999px; background:currentColor; opacity:.7; flex:none; }
  .note.pending .dot { animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { opacity:.25 } 50% { opacity:.9 } }
`;

class GbtiCommentEchoes extends GbtiElement {
  connectedCallback() {
    super.connectedCallback?.();
    this._onPosted = (e) => { const d = e?.detail || {}; if (!d.targetSlug || d.targetSlug === this._slug()) this.load(); };
    document.addEventListener('gbti-comment-posted', this._onPosted);
    this.load();
  }
  disconnectedCallback() {
    super.disconnectedCallback?.();
    if (this._onPosted) document.removeEventListener('gbti-comment-posted', this._onPosted);
    this._stopPolling();
  }
  _type() { return this.dataset.gbtiTargetType || ''; }
  _slug() { return this.dataset.gbtiTargetSlug || ''; }

  render() {
    if (!this.client) { this.set(''); return; }
    if (!this._rows) { if (!this._loading) this.load(); this.set(''); return; } // client arrived after connect: load now
    if (!this._rows.length) { this.set(''); this._syncPage(0); return; }
    const cards = this._rows.map(({ c, html, outcome }) => {
      const note = echoNote({ outcome, prNumber: c.prNumber });
      const ini = esc(String(c.author || '?').trim().charAt(0).toUpperCase() || '?');
      return `<li class="card" data-echo="${esc(String(c.id))}">
        <span class="cav">${this._avatar ? `<img src="${esc(this._avatar)}" alt="">` : ini}</span>
        <div class="main">
          <div class="meta"><span class="name">${esc(String(c.author || ''))}</span><span>${esc(relTime(c.createdAt))}</span><span class="badge">Yours, posting</span></div>
          <div class="body">${html}</div>
          <div class="note ${note.tone}" data-note><span class="dot" aria-hidden="true"></span><span>${esc(note.text)}</span></div>
        </div>
      </li>`;
    }).join('');
    this.set(this.css(CSS) + `<ul class="rows" aria-label="Your comments still posting">${cards}</ul>`);
    wireEmbedPosters(this.root);
    this._syncPage(this._rows.length);
  }

  async load() {
    const targetType = this._type(); const targetSlug = this._slug();
    if (!this.client || !targetType || !targetSlug || this._loading) return;
    this._loading = true;
    try {
      if (this._avatar === undefined) {
        try { const st = await this.client.status?.(); this._avatar = st?.identity?.avatar || st?.identity?.avatarUrl || null; } catch { this._avatar = null; }
      }
      const r = await this.client.listComments({ targetType, targetSlug });
      const pending = pendingRows(r?.items);
      const prev = new Map((this._rows || []).map((row) => [String(row.c.id), row.outcome]));
      this._rows = await Promise.all(pending.map(async (c) => ({ c, html: await this._html(c.body), outcome: prev.get(String(c.id)) || 'unknown' })));
    } catch { this._rows = []; }
    this._loading = false;
    this.render();
    this._startPolling();
  }

  async _html(body) {
    try { return (await this.client.preview({ body: body || '', autoEmbed: true }))?.html || ''; }
    catch { return `<p>${esc(body || '')}</p>`; }
  }

  // The static page around this element: the built heading count and the empty-state card.
  _syncPage(pendingCount) {
    const root = this.closest('#comments') || document;
    const h = root.querySelector('[data-comments-count]');
    if (h) {
      const base = Number(h.dataset.commentsCount) || 0;
      const n = base + pendingCount;
      h.textContent = `${n} ${n === 1 ? 'Comment' : 'Comments'}`;
    }
    const empty = root.querySelector('[data-comments-empty]');
    if (empty) empty.hidden = pendingCount > 0;
  }

  _startPolling() {
    this._stopPolling();
    const open = (this._rows || []).filter((row) => row.c.prNumber && !echoNote({ outcome: row.outcome }).terminal);
    if (!open.length || typeof this.client?.listPRs !== 'function') return;
    this._polls = 0;
    this._timer = setInterval(() => this._pollOnce().catch(() => {}), POLL_MS);
    this._pollOnce().catch(() => {});
  }
  _stopPolling() { if (this._timer) { clearInterval(this._timer); this._timer = null; } }
  async _pollOnce() {
    if (!this.isConnected || !this._rows?.length) { this._stopPolling(); return; }
    if (++this._polls > POLL_MAX) { this._stopPolling(); return; }
    const pulls = pullsOf(await this.client.listPRs());
    let changed = false;
    for (const row of this._rows) {
      const outcome = pullOutcome(pulls, row.c.prNumber);
      if (outcome !== 'unknown' && outcome !== row.outcome) { row.outcome = outcome; changed = true; }
    }
    if (changed) this.render();
    if (this._rows.every((row) => echoNote({ outcome: row.outcome }).terminal)) this._stopPolling();
  }
}

define('gbti-comment-echoes', GbtiCommentEchoes);
export { GbtiCommentEchoes };
