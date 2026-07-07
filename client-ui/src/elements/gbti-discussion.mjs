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
    const canMod = (RANK[this._role] ?? 0) >= RANK.moderator;
    const canRemove = (RANK[this._role] ?? 0) >= RANK.admin; // admin+ hard-deletes any member comment
    // SOW-112 QA: author notes pin FIRST with a badge (mirroring the public page), never mid-thread as
    // ordinary comments.
    const ordered = [...rows.filter(({ c }) => c.authorNote), ...rows.filter(({ c }) => !c.authorNote)];
    const thread = ordered.map(({ c, html }) => {
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
      const hideBtn = canMod && modPath ? `<button class="chide" type="button" data-hidec="${esc(modPath)}">Hide</button>` : '';
      // Admin+ hard-delete (the existing admin 'remove' rail); a member deletes their OWN comment (a real
      // canonical file only — an in-flight echo has no path and reaps on its own).
      const own = this._me && c.author === this._me && c.path && c.id && !c.authorNote;
      const delBtn = canRemove && modPath ? `<button class="chide" type="button" data-delc="${esc(modPath)}">Delete</button>`
        : own ? `<button class="chide" type="button" data-delown="${esc(c.id)}">Delete</button>` : '';
      return `<div class="comment${reply}">${avatarHtml(c.author)}<div class="cmain">
        <div class="cmeta"><span class="cname">${esc(authorName(c.author))}</span><span class="cwhen">${esc(relTime(c.createdAt))}</span>${badge}${hideBtn}${delBtn}</div>
        ${bodyHtml}
      </div></div>`;
    }).join('');
    const threadHtml = rows.length ? `<div class="thread">${thread}</div>` : `<p class="empty">No replies yet. Start the conversation.</p>`;
    this.set(this.css(CSS) + threadHtml + this._composeHtml(targetType, targetSlug));
    this.$$('[data-hidec]').forEach((b) => b.addEventListener('click', () => this._hideComment(b.dataset.hidec)));
    this.$$('[data-delc]').forEach((b) => b.addEventListener('click', () => this._deleteComment(b.dataset.delc)));
    this.$$('[data-delown]').forEach((b) => b.addEventListener('click', () => this._deleteOwnComment(b.dataset.delown)));
  }

  // SOW-112 QA: admin+ hard-deletes any member comment (the existing admin 'remove' rail: a real file delete
  // whose PR auto-merges for a superadmin and falls to the review lane for a plain admin).
  async _deleteComment(path) {
    if (typeof confirm === 'function' && !confirm('Delete this comment? The file is removed from the network (it remains in git history).')) return;
    try { await this.client.admin('remove', { path }); this.load(); }
    catch { /* fail-soft: the server is the authority */ }
  }

  // SOW-112 QA: a member deletes their OWN comment (own-folder delete PR; auto-merges; off the site at the
  // next deploy).
  async _deleteOwnComment(id) {
    if (typeof confirm === 'function' && !confirm('Delete your comment? It leaves the site at the next deploy (a few minutes).')) return;
    try { await this.client.deleteComment?.({ id }); this.load(); }
    catch { /* fail-soft */ }
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
