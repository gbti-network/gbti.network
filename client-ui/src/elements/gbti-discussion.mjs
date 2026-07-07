// <gbti-discussion> (SOW-041): the shared comment-thread engine for ANY content type, factored out of
// gbti-shares-feed (SOW-032) so the SAME discussion renders under a Share, a post, a product, or a prompt — in
// the expanded reader and the shares stream alike. Lazy-loads the thread via client.listComments({targetType,
// targetSlug}), resolves each comment body (public -> preview; members -> Worker-decrypt -> preview, SOW-016),
// renders oldest-first, and mounts an inert <gbti-comment-box> for paid members to reply. Reloads only itself
// when a comment for its target is posted/edited. The token never reaches the page.
import { GbtiElement, define, esc } from '../base.mjs';
import './gbti-comment-box.mjs';
import { RANK } from '../mod-actions-core.mjs'; // SOW-071: the moderator+ gate for per-comment Hide

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .thread { display:flex; flex-direction:column; gap:10px; margin-bottom:8px; }
  /* SOW-067: each comment leads with the commenter's GitHub avatar, then a content column. */
  .comment { display:flex; gap:9px; border-left:2px solid var(--line); padding-left:10px; }
  .comment.reply { margin-left:16px; }
  .comment .cav { flex:none; width:22px; height:22px; border-radius:50%; overflow:hidden; background:var(--hover); display:grid; place-items:center; color:var(--muted); font-size:10px; font-weight:700; margin-top:1px; }
  .comment .cav img { width:100%; height:100%; object-fit:cover; }
  .comment .cmain { min-width:0; flex:1; }
  .cmeta { display:flex; align-items:center; gap:8px; font-size:12px; }
  .cmeta .cname { font-weight:700; } .cmeta .cwhen { color:var(--muted); }
  .cmeta .cbadge { font-size:9.5px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:0 6px; }
  .cmeta .cbadge.cnote { color:var(--s-green-fg, #1f9e5f); border-color:var(--s-green, #1f9e5f); }
  /* SOW-112 QA (owner-picked Option A): hover-reveal ghost actions — invisible until the row is hovered or
     focused, icon + label, Delete tints red only on its own hover. */
  .acts { display:inline-flex; gap:4px; margin-left:auto; opacity:0; transition:opacity .12s ease; }
  .comment:hover .acts, .acts:focus-within { opacity:1; }
  .abtn { display:inline-flex; align-items:center; gap:5px; font:inherit; font-size:11.5px; font-weight:600; color:var(--muted); background:none; border:none; border-radius:7px; padding:3px 9px; cursor:pointer; }
  .abtn:hover { background:var(--s-surface-2, rgba(255,255,255,.06)); color:var(--fg); }
  .abtn.danger:hover { background:color-mix(in srgb, var(--s-danger, #e06c6c) 14%, transparent); color:var(--s-danger, #e06c6c); }
  .abtn svg { width:13px; height:13px; }
  .ctomb { font-size:12.5px; color:var(--muted); border:1.5px dashed var(--line); border-radius:9px; padding:9px 12px; }
  .ctomb a { color:var(--s-green-fg, #1f9e5f); font-weight:600; }
  .ctomb.err { color:var(--s-danger, #e06c6c); border-color:var(--s-danger, #e06c6c); border-style:solid; }
  .cmeta .chide { margin-left:auto; font:inherit; font-size:11px; font-weight:700; color:var(--muted); background:transparent; border:1px solid var(--line); border-radius:6px; padding:2px 8px; cursor:pointer; }
  .cmeta .chide:hover { color:#c0392b; border-color:#c0392b; }
  .cbody { margin-top:3px; font-size:13.5px; line-height:1.5; }
  .cbody p { margin:0 0 .5em; } .cbody :is(h1,h2,h3,h4){ font-weight:700; margin:.6em 0 .2em; }
  .cbody a { color:var(--accent, var(--brand)); }
  .cbody pre { background:var(--bg, rgba(0,0,0,.05)); padding:8px; border-radius:6px; overflow:auto; }
  .clocked { font-size:12.5px; color:var(--muted); } .clocked a { color:var(--brand); font-weight:600; }
  .empty { color:var(--muted); font-size:12.5px; margin:0 0 8px; }
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
const lc = (s) => String(s || '').toLowerCase();
const authorName = (a) => (a === 'gbti' ? 'GBTI Network' : a || 'A member');
// SOW-067: the commenter's GitHub avatar (gbti/house -> the org logo). A missing author falls back to initials.
const ghLogin = (a) => (lc(a) === 'gbti' || lc(a) === 'house' ? 'gbti-network' : a);
const ghAvatar = (a) => (a ? `https://github.com/${encodeURIComponent(ghLogin(a))}.png?size=48` : '');
function avatarHtml(author) {
  const url = ghAvatar(author);
  const ini = esc((authorName(author) || '?').trim().charAt(0).toUpperCase() || '?');
  return `<span class="cav">${url ? `<img src="${esc(url)}" alt="" loading="lazy">` : ini}</span>`;
}

class GbtiDiscussion extends GbtiElement {
  static get observedAttributes() { return ['data-gbti-target-type', 'data-gbti-target-slug']; }

  connectedCallback() {
    super.connectedCallback?.();
    // A reply posted/edited for THIS target reloads the thread (the event bubbles + composed to document with
    // the targetSlug; we also match the type so two different items sharing a slug never cross-refresh).
    this._onComment = (e) => { if (e?.detail?.targetSlug === this._slug()) this.load(); };
    document.addEventListener('gbti-comment-posted', this._onComment);
    document.addEventListener('gbti-comment-edited', this._onComment);
    this.load();
  }
  disconnectedCallback() {
    super.disconnectedCallback?.();
    if (this._onComment) {
      document.removeEventListener('gbti-comment-posted', this._onComment);
      document.removeEventListener('gbti-comment-edited', this._onComment);
    }
  }
  attributeChangedCallback(name, oldV, newV) {
    if (oldV !== newV && this.isConnected) { this._loaded = false; this.load(); }
  }

  _type() { return this.dataset.gbtiTargetType || ''; }
  _slug() { return this.dataset.gbtiTargetSlug || ''; }
  _aliases() { return String(this.dataset.gbtiTargetAliases || '').split(',').filter(Boolean); } // SOW-112: pre-rename slugs

  async load() {
    const targetType = this._type();
    const targetSlug = this._slug();
    if (!targetType || !targetSlug) { this.set(this.css(CSS)); return; }
    if (!this.client) { this.set(this.css(CSS) + `<p class="empty">Open in the GBTI client to read the discussion.</p>`); return; }
    // SOW-071: read the viewer role once, so a moderator+ sees a per-comment Hide.
    if (this._role == null) {
      try {
        const st = await this.client.status?.();
        this._role = st?.role || 'member';
        this._me = st?.identity?.username || null; // own comments get a Delete
      } catch { this._role = 'member'; this._me = null; }
    }
    if (!this._loaded) this.set(this.css(CSS) + `<p class="empty">Loading the discussion…</p>`);
    let items = [];
    try { items = (await this.client.listComments({ targetType, targetSlug, aliases: this._aliases() }))?.items ?? []; }
    catch { this.set(this.css(CSS) + `<p class="empty">Could not load the discussion right now.</p>` + this._composeHtml(targetType, targetSlug)); return; }
    const resolved = await Promise.all(items.map((c) => this._resolveBody(c).then((html) => ({ c, html }))));
    this._render(targetType, targetSlug, resolved);
    this._loaded = true;
  }

  _render(targetType, targetSlug, rows) {
    this._last = { targetType, targetSlug, rows }; // re-render locally after a delete (no server round-trip)
    const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
    const TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
    const canMod = (RANK[this._role] ?? 0) >= RANK.moderator;
    const canRemove = (RANK[this._role] ?? 0) >= RANK.admin; // admin+ hard-deletes any member comment
    // SOW-112 QA: author notes pin FIRST with a badge (mirroring the public page), never mid-thread as
    // ordinary comments. The EDITOR mount sets data-gbti-hide-author-notes (the note has its own editing
    // section there), which drops them from the thread entirely.
    const hideNotes = this.hasAttribute('data-gbti-hide-author-notes');
    const visible = hideNotes ? rows.filter(({ c }) => !c.authorNote) : rows;
    const ordered = [...visible.filter(({ c }) => c.authorNote), ...visible.filter(({ c }) => !c.authorNote)];
    const thread = ordered.map(({ c, html }) => {
      // SOW-112 QA: a deleting/deleted comment renders as a tombstone IMMEDIATELY (optimistic — the popup
      // confirm is the commitment point; the server result upgrades the card or flips it to an error).
      const tombKey = [c.path, c.id, `members/${c.author}/comments/${c.id}.md`].find((k) => k && this._tomb?.has(k));
      if (tombKey) {
        const t = this._tomb.get(tombKey);
        if (t.phase === 'error') return `<div class="ctomb err">The deletion failed: ${esc(t.msg || 'try again')}. The comment is still live.</div>`;
        if (t.phase === 'busy') return `<div class="ctomb">Deleting the comment…</div>`;
        return `<div class="ctomb">Comment deleted here right away. The removal merges automatically and the public site updates in about 2 to 3 minutes. <a href="workspace.html#tab=prs">Track it under Pull requests</a>.</div>`;
      }
      const reply = c.parentId ? ' reply' : '';
      const badge = (c.authorNote ? `<span class="cbadge cnote">From the author</span>` : '')
        + (c.visibility === 'members' ? `<span class="cbadge">Members</span>` : '');
      const bodyHtml = (html && html.locked)
        ? `<div class="clocked">This reply is for members. <a href="https://gbti.network/membership/">Become a member</a> to unlock.</div>`
        : (typeof html === 'string' && html) ? `<div class="cbody">${html}</div>` : '';
      // SOW-071: a moderator+ can Hide a comment (deplatform its file -> draft, so it drops from the thread). Never a
      // house-authored intro (house/comments/<id>.md is not a members/ path; the server would 403 anyway).
      const houseComment = c.author === 'gbti' || c.author === 'house';
      const modPath = (!houseComment && c.author && c.id) ? (c.path || `members/${c.author}/comments/${c.id}.md`) : '';
      const hideBtn = canMod && modPath ? `<button class="abtn" type="button" data-hidec="${esc(modPath)}">${EYE} Hide</button>` : '';
      // Admin+ hard-delete (the existing admin 'remove' rail); a member deletes their OWN comment (a real
      // canonical file only — an in-flight echo has no path and reaps on its own).
      const own = this._me && c.author === this._me && c.path && c.id && !c.authorNote;
      const delBtn = canRemove && modPath ? `<button class="abtn danger" type="button" data-delc="${esc(modPath)}" data-key="${esc(modPath)}">${TRASH} Delete</button>`
        : own ? `<button class="abtn danger" type="button" data-delown="${esc(c.id)}" data-key="${esc(c.path)}">${TRASH} Delete</button>` : '';
      const acts = hideBtn || delBtn ? `<span class="acts">${hideBtn}${delBtn}</span>` : '';
      return `<div class="comment${reply}">${avatarHtml(c.author)}<div class="cmain">
        <div class="cmeta"><span class="cname">${esc(authorName(c.author))}</span><span class="cwhen">${esc(relTime(c.createdAt))}</span>${badge}${acts}</div>
        ${bodyHtml}
      </div></div>`;
    }).join('');
    const threadHtml = ordered.length ? `<div class="thread">${thread}</div>` : `<p class="empty">No replies yet. Start the conversation.</p>`;
    this.set(this.css(CSS) + threadHtml + this._composeHtml(targetType, targetSlug));
    this.$$('[data-hidec]').forEach((b) => b.addEventListener('click', () => this._hideComment(b.dataset.hidec)));
    this.$$('[data-delc]').forEach((b) => b.addEventListener('click', () => this._deleteComment(b.dataset.delc)));
    this.$$('[data-delown]').forEach((b) => b.addEventListener('click', () => this._deleteOwnComment(b.dataset.delown)));
  }

  // SOW-112 QA (owner-directed flow): popup confirm -> the card swaps to a tombstone IMMEDIATELY
  // (optimistic) -> the server result upgrades it, or flips it to an error card on failure.
  async _deleteComment(path) {
    if (typeof confirm === 'function' && !confirm('Delete this comment? The file is removed from the network (it remains in git history).')) return;
    this._tombstone(path, 'busy');
    try { await this.client.admin('remove', { path }); this._tombstone(path, 'done'); }
    catch (err) { this._tombstone(path, 'error', err?.message); }
  }

  async _deleteOwnComment(id) {
    if (typeof confirm === 'function' && !confirm('Delete your comment? It disappears here right away and leaves the public site in about 2 to 3 minutes.')) return;
    const row = (this._last?.rows || []).find((r) => r.c.id === id);
    const key = row?.c?.path || id;
    this._tombstone(key, 'busy');
    try { await this.client.deleteComment?.({ id }); this._tombstone(key, 'done'); }
    catch (err) { this._tombstone(key, 'error', err?.message); }
  }

  _tombstone(key, phase, msg) {
    if (!key) return;
    (this._tomb ??= new Map()).set(key, { phase, msg });
    if (this._last) this._render(this._last.targetType, this._last.targetSlug, this._last.rows);
  }

  // SOW-071: hide a comment (moderator+): deplatform its file -> draft, then reload the thread.
  async _hideComment(path) {
    if (typeof confirm === 'function' && !confirm('Hide this comment? It is set to draft and removed from the thread.')) return;
    try { await this.client.admin('deplatform', { path }); this.load(); }
    catch { /* fail-soft: leave the comment; the server is the authority */ }
  }

  // A fresh <gbti-comment-box> for this target (it handles its own paid/trial/visitor gating UX). The injected
  // client is process-global, so it upgrades + talks to the same host with nothing to wire here.
  _composeHtml(targetType, targetSlug) {
    return `<gbti-comment-box data-gbti-target-type="${esc(targetType)}" data-gbti-target-slug="${esc(targetSlug)}"></gbti-comment-box>`;
  }

  async _resolveBody(c) {
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

define('gbti-discussion', GbtiDiscussion);
export { GbtiDiscussion };
