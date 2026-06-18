// <gbti-shares-feed> (SOW-018; SOW-041 P2): the EXTENSION/client-only Shares reading stream. No public website
// surface; this is where a member reads the co-op's status updates. SOW-041 makes a Share a FIRST-CLASS content
// item: the stream is now a thin adapter over the shared <gbti-card-list> (the same card every content type uses
// — coin glyph + Members lock + author/time), and clicking a Share opens a focused READING view (the note body +
// an always-open discussion thread) instead of stacking expanded cards. The body+discussion engine (decrypt via
// the Worker, SOW-016; threads via SOW-032's listShareComments + the inert <gbti-comment-box>) is unchanged.
// A Locked account gets a splash; the key never reaches the page.
import { GbtiElement, define, esc } from '../base.mjs';
import './gbti-card-list.mjs';

const LOCKED = new Set(['expired', 'cancelled', 'none', 'banned']);

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .head { display:flex; align-items:baseline; justify-content:space-between; margin:4px 0 12px; }
  .head h3 { margin:0; font-family:var(--font-display, var(--font-body)); font-size:16px; }
  .refresh { background:transparent; border:0; color:var(--muted); cursor:pointer; font:inherit; font-size:13px; }
  .refresh:hover { color:var(--brand); }
  .muted { color:var(--muted); font-size:13.5px; }
  .empty { color:var(--muted); font-size:12.5px; margin:0 0 8px; }

  /* reading view (a focused Share + its discussion) */
  .back { border:1px solid var(--line); background:var(--panel); color:var(--fg); border-radius:8px; font:inherit; font-weight:600; font-size:13px; padding:6px 13px; cursor:pointer; margin:0 0 14px; }
  .back:hover { border-color:var(--accent); color:var(--accent); }
  .reading .who { display:flex; align-items:baseline; gap:8px; }
  .reading .who .name { font-weight:700; font-size:14px; }
  .reading .who .when { color:var(--muted); font-size:12px; }
  .reading .badge { margin-left:auto; font-size:10.5px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:1px 8px; }
  .reading .title { font-weight:700; font-size:18px; margin-top:8px; }
  .reading .desc { color:var(--muted); font-size:13.5px; margin-top:2px; }
  .body { margin-top:10px; font-size:14.5px; line-height:1.6; }
  .body :is(h1,h2,h3,h4){ font-weight:700; margin:.8em 0 .3em; }
  .body p { margin:0 0 .7em; } .body ul,.body ol { margin:0 0 .7em 1.2em; }
  .body a { color:var(--accent, var(--brand)); }
  .body pre { background:var(--bg, rgba(0,0,0,.05)); padding:10px; border-radius:8px; overflow:auto; }
  .link { display:inline-flex; align-items:center; gap:6px; margin-top:10px; font-size:12.5px; color:var(--brand); text-decoration:none; }
  .tags { margin-top:10px; display:flex; gap:6px; flex-wrap:wrap; }
  .chip { font-size:11px; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:1px 8px; }
  .locked { color:var(--muted); font-size:13.5px; } .locked a { color:var(--brand); font-weight:600; }
  .splash { text-align:center; padding:40px 16px; }
  .splash .lock { font-size:30px; } .splash h3 { margin:10px 0 4px; } .splash a { color:var(--brand); font-weight:600; }

  /* SOW-032 discussion (now always-open in the reading view) */
  .discussion-wrap { margin-top:22px; border-top:1px solid var(--line); padding-top:14px; }
  .discussion-wrap h4 { margin:0 0 10px; font-size:14px; }
  .thread { display:flex; flex-direction:column; gap:10px; margin-bottom:8px; }
  .comment { border-left:2px solid var(--line); padding-left:10px; }
  .comment.reply { margin-left:16px; }
  .cmeta { display:flex; align-items:baseline; gap:8px; font-size:12px; }
  .cmeta .cname { font-weight:700; } .cmeta .cwhen { color:var(--muted); }
  .cmeta .cbadge { font-size:9.5px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:0 6px; }
  .cbody { margin-top:3px; font-size:13.5px; line-height:1.5; }
  .cbody p { margin:0 0 .5em; } .cbody :is(h1,h2,h3,h4){ font-weight:700; margin:.6em 0 .2em; }
  .cbody a { color:var(--accent, var(--brand)); }
  .cbody pre { background:var(--bg, rgba(0,0,0,.05)); padding:8px; border-radius:6px; overflow:auto; }
  .clocked { font-size:12.5px; color:var(--muted); } .clocked a { color:var(--brand); font-weight:600; }
`;

function relTime(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t, day = 86400000;
  if (diff < day) return 'today';
  const d = Math.floor(diff / day);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`;
  return `${Math.floor(d / 365)} year${Math.floor(d / 365) === 1 ? '' : 's'} ago`;
}
const authorName = (a) => (a === 'gbti' ? 'GBTI Network' : a || 'A member');
const shareTitle = (it) => it.title || it.shortDescription || (it.url ? `Link: ${hostOf(it.url)}` : 'Member share');

class GbtiSharesFeed extends GbtiElement {
  connectedCallback() {
    super.connectedCallback();
    this._items = null; // raw shares
    this._reading = null; // the share being read, or null (the list)
    this._locked = false;
    // Refresh the feed when a Share is posted from the composer (event bubbles + composed to document).
    this._onPosted = () => { this._reading = null; this.reload(); };
    document.addEventListener('gbti-share-posted', this._onPosted);
    // SOW-032: a posted/edited comment reloads ONLY the open thread (the reading view's discussion), keyed on slug.
    this._onComment = (e) => { const slug = e?.detail?.targetSlug; if (slug) this._reloadOpenThread(slug); };
    document.addEventListener('gbti-comment-posted', this._onComment);
    document.addEventListener('gbti-comment-edited', this._onComment);
    this.reload();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._onPosted) document.removeEventListener('gbti-share-posted', this._onPosted);
    if (this._onComment) {
      document.removeEventListener('gbti-comment-posted', this._onComment);
      document.removeEventListener('gbti-comment-edited', this._onComment);
    }
  }

  async reload() {
    if (!this.client) { this.set(this.css(CSS) + `<p class="muted">Open in the GBTI client to read Shares.</p>`); return; }
    this.set(this.css(CSS) + `<p class="muted">Loading the co-op stream…</p>`);
    let membership = 'unknown';
    try { membership = (await this.client.status())?.membership ?? 'unknown'; } catch { membership = 'unknown'; }
    this._locked = LOCKED.has(membership);
    if (this._locked) return this._splash();
    try { this._items = (await this.client.listShares())?.items ?? []; }
    catch { this.set(this.css(CSS) + `<p class="muted">Could not load Shares right now.</p>`); return; }
    this.render();
  }

  render() {
    if (this._locked) return this._splash();
    if (this._reading) { this._renderReading(this._reading); return; }
    this._renderList();
  }

  // The stream as the shared content-item card list. A Share has no image, so the card shows the coin category
  // glyph (glyphFor type fallback). No openHref -> the card emits card-open, which opens the reading view.
  _renderList() {
    const head = `<div class="head"><h3>Co-op stream</h3><button class="refresh" type="button">Refresh</button></div>`;
    const items = this._items || [];
    if (!items.length) {
      this.set(this.css(CSS) + head + `<p class="muted">No Shares yet. Post the first one with the + button.</p>`);
      this.on('.refresh', 'click', () => this.reload());
      return;
    }
    this.set(this.css(CSS) + head + `<div data-list></div>`);
    this.on('.refresh', 'click', () => this.reload());
    const list = document.createElement('gbti-card-list');
    list.mode = 'detailed';
    // Carry the full Share through the projection so card-open returns it (the card only reads a few fields).
    list.items = items.map((it) => ({ ...it, type: 'share', title: shareTitle(it), excerpt: it.title ? (it.shortDescription || '') : '', thumb: null, createdAt: it.createdAt }));
    list.addEventListener('card-open', (e) => { const it = e.detail?.item; if (it) { this._reading = it; this.render(); } });
    this.$('[data-list]')?.replaceChildren(list);
  }

  // The focused reading view: the Share's body + an always-open discussion thread.
  _renderReading(share) {
    const slug = share.author && share.id ? `${share.author}/${share.id}` : '';
    const badge = share.visibility === 'members' ? `<span class="badge">Members</span>` : '';
    const title = share.title ? `<div class="title">${esc(share.title)}</div>` : '';
    const desc = share.shortDescription ? `<div class="desc">${esc(share.shortDescription)}</div>` : '';
    const link = share.url ? `<a class="link" href="${esc(share.url)}" target="_blank" rel="noopener nofollow">🔗 ${esc(hostOf(share.url))}</a>` : '';
    const tags = (share.tags || []).length ? `<div class="tags">${share.tags.map((t) => `<span class="chip">#${esc(t)}</span>`).join('')}</div>` : '';
    const discussion = slug ? `<div class="discussion-wrap"><h4>Discussion</h4><div class="discussion" data-slug="${esc(slug)}"><p class="empty">Loading the discussion…</p></div></div>` : '';
    this.set(this.css(CSS) + `<button class="back" type="button" data-back>&larr; Back to the stream</button>
      <article class="reading">
        <div class="who"><span class="name">${esc(authorName(share.author))}</span><span class="when">${esc(relTime(share.createdAt))}</span>${badge}</div>
        ${title}${desc}
        <div class="body" data-body><p class="empty">Loading…</p></div>
        ${link}${tags}${discussion}
      </article>`);
    this.on('[data-back]', 'click', () => { this._reading = null; this.render(); });
    // Resolve the body (decrypt for a members Share) + load the discussion, both async, fail-soft.
    this._fillBody(share);
    if (slug) this._loadThread(slug);
  }

  async _fillBody(share) {
    const html = await this._resolveBody(share);
    const el = this.$('[data-body]');
    if (!el) return;
    if (html && html.locked) el.innerHTML = `<div class="locked">This Share is for members. <a href="https://gbti.network/membership/">Become a member</a> to unlock.</div>`;
    else el.innerHTML = (typeof html === 'string' && html) ? html : `<p class="muted">No note.</p>`;
  }

  async _resolveBody(it) {
    try {
      if (it.visibility === 'members') {
        if (!it.encryptedBody) return ''; // a members Share with no body
        const { text } = await this.client.decrypt({ encPath: it.encryptedBody });
        return (await this.client.preview({ body: text }))?.html ?? '';
      }
      return it.body ? (await this.client.preview({ body: it.body }))?.html ?? '' : '';
    } catch (err) {
      const locked = err?.code === 'membership-required' || err?.code === 'not-authenticated';
      return { locked };
    }
  }

  _splash() {
    this.set(this.css(CSS) + `<div class="splash"><div class="lock">🔒</div><h3>Your access is locked</h3>
      <p class="muted">Your membership has lapsed. <a href="https://gbti.network/membership/">Renew</a> to read the community Shares stream again.</p></div>`);
  }

  /** Reload an OPEN thread in place (after a reply is posted/edited); no-op if no discussion is mounted. */
  _reloadOpenThread(slug) {
    const panel = this.$(`.discussion[data-slug="${cssEscape(slug)}"]`);
    if (panel) this._loadThread(slug);
  }

  async _loadThread(slug) {
    const panel = this.$(`.discussion[data-slug="${cssEscape(slug)}"]`);
    if (!panel) return;
    if (!this.client) { panel.innerHTML = `<p class="empty">Open in the GBTI client to read the discussion.</p>`; return; }
    let items = [];
    try { items = (await this.client.listShareComments({ targetSlug: slug }))?.items ?? []; }
    catch { panel.innerHTML = `<p class="empty">Could not load the discussion right now.</p>` + this._composeHtml(slug); return; }
    const resolved = await Promise.all(items.map((c) => this._resolveCommentBody(c).then((html) => ({ c, html }))));
    this._renderThread(panel, slug, resolved);
  }

  _renderThread(panel, slug, rows) {
    const thread = rows.map(({ c, html }) => {
      const reply = c.parentId ? ' reply' : '';
      const badge = c.visibility === 'members' ? `<span class="cbadge">Members</span>` : '';
      const bodyHtml = (html && html.locked)
        ? `<div class="clocked">This reply is for members. <a href="https://gbti.network/membership/">Become a member</a> to unlock.</div>`
        : (typeof html === 'string' && html) ? `<div class="cbody">${html}</div>` : '';
      return `<div class="comment${reply}">
        <div class="cmeta"><span class="cname">${esc(authorName(c.author))}</span><span class="cwhen">${esc(relTime(c.createdAt))}</span>${badge}</div>
        ${bodyHtml}
      </div>`;
    }).join('');
    const threadHtml = rows.length ? `<div class="thread">${thread}</div>` : `<p class="empty">No replies yet. Start the conversation.</p>`;
    panel.innerHTML = threadHtml + this._composeHtml(slug);
  }

  // A fresh <gbti-comment-box> for this Share (the element handles its own paid/trial/visitor gating UX). The
  // injected client is process-global, so it upgrades + talks to the same host with nothing to wire here.
  _composeHtml(slug) {
    return `<gbti-comment-box data-gbti-target-type="share" data-gbti-target-slug="${esc(slug)}"></gbti-comment-box>`;
  }

  async _resolveCommentBody(c) {
    try {
      if (c.visibility === 'members') {
        if (!c.encryptedBody) return ''; // a members comment with no body
        const { text } = await this.client.decrypt({ encPath: c.encryptedBody });
        return (await this.client.preview({ body: text }))?.html ?? '';
      }
      return c.body ? (await this.client.preview({ body: c.body }))?.html ?? '' : '';
    } catch (err) {
      const locked = err?.code === 'membership-required' || err?.code === 'not-authenticated';
      return { locked };
    }
  }
}

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'link'; }
}

// Escape a value for safe interpolation inside a double-quoted attribute selector ([data-slug="…"]).
function cssEscape(s) {
  return String(s ?? '').replace(/["\\]/g, '\\$&');
}

define('gbti-shares-feed', GbtiSharesFeed);
export { GbtiSharesFeed };
