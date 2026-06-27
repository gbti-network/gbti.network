// <gbti-comment-box> (SOW-027): upgrades the inert comment hook baked by CommentBox.astro. Two modes from its
// data-* attrs:
//   COMPOSE (no data-gbti-comment-id): a "Write a comment" form. Paid members post via client.postComment();
//     a trial/locked member sees an upgrade nudge; a visitor is sent to /membership/. (The server + gate are
//     the real boundary; this is just UX.)
//   EDIT (data-gbti-comment-id + data-gbti-comment-author): renders an "Edit" link ONLY when the signed-in
//     member IS that comment's author; opens an inline editor prefilled via client.getComment(), saves via
//     client.editComment() (which sets updatedAt, so the "edited . view history" link appears after the build).
// The host holds the token; this element only calls the injected client. Comment bodies are never baked into
// the page (the edit form fetches the current body on demand).
import { GbtiElement, define, esc } from '../base.mjs';
import { submitAck, failHint } from '../workspace-core.mjs'; // SOW-072 P2: the one consistent submit acknowledgement

const LOCKED = new Set(['expired', 'cancelled', 'none', 'banned']);

const CSS = `
  :host { display: block; font-family: var(--font-body); color: var(--fg); }
  .nudge { margin-top: 20px; padding: 16px; border: 1.5px dashed var(--line); border-radius: 12px; background: var(--panel); font-size: 13.5px; color: var(--muted); }
  .nudge a { color: var(--brand); font-weight: 600; }
  button.open { margin-top: 16px; font: inherit; font-weight: 600; font-size: 14px; padding: 9px 16px; border: 1.5px solid var(--line); border-radius: 10px; background: var(--panel); color: var(--fg); cursor: pointer; }
  button.open:hover { border-color: var(--brand); color: var(--brand); }
  .edit { font: inherit; font-size: 12px; background: none; border: 0; color: var(--muted); cursor: pointer; padding: 0; }
  .edit:hover { color: var(--brand); text-decoration: underline; }
  .form { margin-top: 14px; }
  textarea { width: 100%; box-sizing: border-box; min-height: 90px; resize: vertical; font: inherit; font-size: 14px; padding: 10px 12px; border: 1.5px solid var(--line); border-radius: 10px; background: var(--panel); color: var(--fg); }
  textarea:focus { outline: none; border-color: var(--brand); }
  .row { display: flex; gap: 10px; align-items: center; margin-top: 10px; flex-wrap: wrap; }
  label.chk { font: inherit; font-size: 13px; color: var(--muted); }
  .actions { margin-left: auto; display: flex; gap: 8px; align-items: center; }
  button.post { font: inherit; font-weight: 700; font-size: 14px; padding: 8px 16px; border: 0; border-radius: 10px; background: var(--brand); color: #fff; cursor: pointer; }
  button.cancel { font: inherit; font-size: 13px; background: none; border: 0; color: var(--muted); cursor: pointer; }
  .msg { font-size: 13px; } .msg.err { color: #c0392b; } .msg.ok { color: var(--brand); }
  .busy { opacity: .55; pointer-events: none; }
`;

class GbtiCommentBox extends GbtiElement {
  get _editId() { return this.dataset?.gbtiCommentId || this.getAttribute?.('data-gbti-comment-id') || null; }
  get _editAuthor() { return this.dataset?.gbtiCommentAuthor || this.getAttribute?.('data-gbti-comment-author') || null; }
  _target() {
    return { type: this.dataset?.gbtiTargetType || this.getAttribute?.('data-gbti-target-type'), slug: this.dataset?.gbtiTargetSlug || this.getAttribute?.('data-gbti-target-slug') };
  }

  connectedCallback() {
    super.connectedCallback();
    this._init();
  }

  async _init() {
    if (!this.client) return; // inert: no host -> the baked light-DOM fallback stays visible
    let s = null;
    try { s = await this.client.status(); } catch { s = null; }
    this._membership = s?.membership ?? 'unknown';
    this._identity = s?.identity ?? null;
    this._editId ? this._renderEditAffordance() : this._renderCompose();
  }

  // ---- EDIT mode: only the comment's author sees an Edit link ----
  _renderEditAffordance() {
    if (!this._identity || this._identity.username !== this._editAuthor) { this.set(this.css(CSS) + ''); return; } // not the author: invisible
    this.set(this.css(CSS) + `<button class="edit" type="button">Edit</button>`);
    this.on('.edit', 'click', () => this._openEdit());
  }

  async _openEdit() {
    this.set(this.css(CSS) + `<p class="msg">Loading…</p>`);
    let body = '';
    try { body = (await this.client.getComment({ id: this._editId }))?.body ?? ''; }
    catch { this.set(this.css(CSS) + `<p class="msg err">Could not load the comment.</p><button class="edit" type="button">Retry</button>`); this.on('.edit', 'click', () => this._openEdit()); return; }
    this._form({ body, edit: true });
  }

  // ---- COMPOSE mode ----
  _renderCompose() {
    if (LOCKED.has(this._membership)) { this.set(this.css(CSS) + `<div class="nudge">Your membership has lapsed. <a href="https://gbti.network/membership/">Renew</a> to comment.</div>`); return; }
    if (this._membership === 'trialing') { this.set(this.css(CSS) + `<div class="nudge">Commenting requires a paid membership. <a href="https://gbti.network/membership/">Upgrade</a> to join the conversation.</div>`); return; }
    if (!this._identity) { this.set(this.css(CSS) + `<div class="nudge">Sign in with the GBTI client to comment. <a href="https://gbti.network/membership/">Become a member</a>.</div>`); return; }
    this.set(this.css(CSS) + `<button class="open" type="button">Write a comment</button>`);
    this.on('.open', 'click', () => this._form({ body: '', edit: false }));
  }

  _form({ body, edit }) {
    // SOW-044: comments are members-only by default and there is no free public/members choice. The ONLY public
    // comment is a from-the-author intro (authorNote), and only on a post/product/prompt — never on a Share. So
    // the author-note checkbox is the sole public path, shown only for those targets in compose mode. Edit mode
    // preserves the comment's existing audience (it only changes the body).
    const isIntroTarget = ['post', 'product', 'prompt'].includes(this._target().type);
    const noteRow = (!edit && isIntroTarget)
      ? `<label class="chk"><input type="checkbox" data-authornote /> Post as my public "from the author" note</label>`
      : '';
    this.set(this.css(CSS) + `
      <div class="form">
        <textarea placeholder="Write your comment (markdown supported)…" maxlength="8000">${esc(body)}</textarea>
        <div class="row">
          ${noteRow}
          <div class="actions">
            <span class="msg" aria-live="polite"></span>
            <button class="cancel" type="button">Cancel</button>
            <button class="post" type="button">${edit ? 'Save' : 'Post'}</button>
          </div>
        </div>
      </div>`);
    this.on('.cancel', 'click', () => (edit ? this._renderEditAffordance() : this._renderCompose()));
    this.on('.post', 'click', () => (edit ? this._save() : this._post()));
  }

  async _post() {
    const wrap = this.$('.form'); const msg = this.$('.msg');
    const body = (this.$('textarea')?.value || '').trim();
    if (!body) { this._say(msg, 'Write something first.', 'err'); return; }
    const t = this._target();
    // A checked author-note on a post/product/prompt is the public intro; everything else is members-only. The
    // server (publishComment) coerces independently, so this only sets the UX-correct intent.
    const authorNote = !!this.$('[data-authornote]')?.checked && ['post', 'product', 'prompt'].includes(t.type);
    const visibility = authorNote ? 'public' : 'members';
    wrap?.classList.add('busy');
    try {
      const res = await this.client.postComment({ targetType: t.type, targetSlug: t.slug, body, visibility, authorNote });
      this._done(msg, submitAck({ prNumber: res?.prNumber }), 'gbti-comment-posted', res); // SOW-072 P2: consistent, accurate ack
    } catch (err) { this._fail(msg, err); wrap?.classList.remove('busy'); }
  }

  async _save() {
    const wrap = this.$('.form'); const msg = this.$('.msg');
    const body = (this.$('textarea')?.value || '').trim();
    if (!body) { this._say(msg, 'A comment cannot be empty.', 'err'); return; }
    wrap?.classList.add('busy');
    try {
      // SOW-044: editing only changes the body; the comment's audience (public intro vs members) is preserved by
      // editComment (it defaults a missing authorNote/visibility to the existing values), so it never re-leaks.
      const res = await this.client.editComment({ id: this._editId, body });
      this._done(msg, submitAck({ prNumber: res?.prNumber }), 'gbti-comment-edited', res); // SOW-072 P2: consistent, accurate ack
    } catch (err) { this._fail(msg, err); wrap?.classList.remove('busy'); }
  }

  _done(msg, text, event, detail) {
    this._say(msg, text, 'ok');
    this.emit(event, detail);
  }
  _fail(msg, err) {
    const h = failHint(err); // SOW-072 P3: consistent failure copy + upgrade pointer across every composer
    this._say(msg, h.upgrade ? `${h.text} Upgrade at gbti.network/membership.` : h.text, 'err');
  }
  _say(el, text, kind) { if (el) { el.textContent = text; el.className = `msg ${kind || ''}`; } }
}

define('gbti-comment-box', GbtiCommentBox);
export { GbtiCommentBox };
