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
import { commentBodyTooLong, COMMENT_MAX_BYTES } from '../prose-editor-core.mjs';
import './gbti-prose-editor.mjs'; // one prose surface backed by markdown, full width, a quiet header of controls (owner, 2026-09-11)

const LOCKED = new Set(['expired', 'cancelled', 'none', 'banned']);

const CSS = `
  :host { display: block; font-family: var(--font-body); color: var(--fg); }
  .nudge { margin-top: 20px; padding: 16px; border: 1.5px dashed var(--line); border-radius: 12px; background: var(--panel); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); font-size: 13.5px; color: var(--muted); }
  .nudge a { color: var(--brand); font-weight: 600; }
  button.open { margin-top: 16px; font: inherit; font-weight: 600; font-size: 14px; padding: 9px 16px; border: 1.5px solid var(--line); border-radius: 10px; background: var(--panel); color: var(--fg); cursor: pointer; }
  button.open:hover { border-color: var(--brand); color: var(--brand); }
  .edit { font: inherit; font-size: 12px; background: none; border: 0; color: var(--muted); cursor: pointer; padding: 0; }
  .edit:hover { color: var(--brand); text-decoration: underline; }
  .form { margin-top: 14px; }
  gbti-prose-editor { display: block; }
  /* Members only | Public: the comment's audience, the author's choice (SOW-044's members-only rule ended 2026-09-11). */
  .vis { display: inline-flex; gap: 2px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 3px; }
  .vis button { font: inherit; font-weight: 600; font-size: 12.5px; padding: 5px 11px; border: 0; border-radius: 6px; background: transparent; color: var(--muted); cursor: pointer; }
  .vis button.on { background: var(--brand); color: #fff; }
  .vis[hidden] { display: none; }
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
  /** The host sits in a flex row beside "edited . view history" (the article page) or the discussion's footer; an
   *  open form must take the whole row (owner, 2026-09-11: the edit form was half the width of its card), and the
   *  Edit link or the Write a comment button must not. */
  _fullRow(on) { this.style.flex = on ? '1 1 100%' : ''; this.style.width = on ? '100%' : ''; }
  _renderEditAffordance() {
    this._fullRow(false);
    if (!this._identity || this._identity.username !== this._editAuthor) { this.set(this.css(CSS) + ''); return; } // not the author: invisible
    this.set(this.css(CSS) + `<button class="edit" type="button">Edit</button>`);
    this.on('.edit', 'click', () => this._openEdit());
  }

  async _openEdit() {
    this.set(this.css(CSS) + `<p class="msg">Loading…</p>`);
    let body = ''; let visibility = 'members';
    try { const c = await this.client.getComment({ id: this._editId }); body = c?.body ?? ''; visibility = c?.visibility ?? c?.frontmatter?.visibility ?? 'members'; }
    catch { this.set(this.css(CSS) + `<p class="msg err">Could not load the comment.</p><button class="edit" type="button">Retry</button>`); this.on('.edit', 'click', () => this._openEdit()); return; }
    this._form({ body, edit: true, visibility });
  }

  // ---- COMPOSE mode ----
  _renderCompose() {
    if (LOCKED.has(this._membership)) { this.set(this.css(CSS) + `<div class="nudge">Your membership has lapsed. <a href="https://gbti.network/membership/">Renew</a> to comment.</div>`); return; }
    if (this._membership === 'trialing') { this.set(this.css(CSS) + `<div class="nudge">Commenting requires a paid membership. <a href="https://gbti.network/membership/">Upgrade</a> to join the conversation.</div>`); return; }
    if (!this._identity) { this.set(this.css(CSS) + `<div class="nudge">Sign in with the GBTI client to comment. <a href="https://gbti.network/membership/">Become a member</a>.</div>`); return; }
    this._fullRow(false);
    this.set(this.css(CSS) + `<button class="open" type="button">Write a comment</button>`);
    this.on('.open', 'click', () => this._form({ body: '', edit: false }));
  }

  _form({ body, edit, visibility = 'members' }) {
    // The audience is the author's choice (owner, 2026-09-11; SOW-044 had made every comment members-only except
    // a from-the-author intro). Members only stays the default. The intro checkbox (post/product/prompt, compose
    // only) still forces public and hides the control, since an intro is public by definition. Edit mode
    // prefills the comment's current audience, and a flip re-publishes it (members -> public deletes the old
    // ciphertext; public -> members encrypts).
    const isIntroTarget = ['post', 'project', 'prompt'].includes(this._target().type);
    const noteRow = (!edit && isIntroTarget)
      ? `<label class="chk"><input type="checkbox" data-authornote /> Post as my public "from the author" note</label>`
      : '';
    const vis = visibility === 'public' ? 'public' : 'members';
    this._fullRow(true);
    const visRow = `<div class="vis" role="group" aria-label="Who can read this comment" data-vis-row>
        <button type="button" data-vis="members" class="${vis === 'members' ? 'on' : ''}" aria-pressed="${vis === 'members'}">Members only</button>
        <button type="button" data-vis="public" class="${vis === 'public' ? 'on' : ''}" aria-pressed="${vis === 'public'}">Public</button>
      </div>`;
    this.set(this.css(CSS) + `
      <div class="form">
        <gbti-prose-editor data-editor></gbti-prose-editor>
        <div class="row">
          ${visRow}
          ${noteRow}
          <div class="actions">
            <span class="msg" aria-live="polite"></span>
            <button class="cancel" type="button">Cancel</button>
            <button class="post" type="button">${edit ? 'Save' : 'Post'}</button>
          </div>
        </div>
      </div>`);
    const ed = this.$('[data-editor]');
    if (ed) ed.value = body || '';
    this._vis = vis;
    this.$$('[data-vis]').forEach((b) => b.addEventListener('click', () => {
      this._vis = b.dataset.vis === 'public' ? 'public' : 'members';
      this.$$('[data-vis]').forEach((x) => { const on = x.dataset.vis === this._vis; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
    }));
    // An intro is public by definition: checking it forces Public and hides the control; unchecking restores it.
    this.$('[data-authornote]')?.addEventListener('change', (e) => {
      const row = this.$('[data-vis-row]');
      if (e.target.checked) { this._visBeforeNote = this._vis; this._vis = 'public'; if (row) row.hidden = true; }
      else { this._vis = this._visBeforeNote || 'members'; if (row) row.hidden = false; this.$$('[data-vis]').forEach((x) => { const on = x.dataset.vis === this._vis; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); }); }
    });
    this.on('.cancel', 'click', () => (edit ? this._renderEditAffordance() : this._renderCompose()));
    this.on('.post', 'click', () => (edit ? this._save() : this._post()));
  }

  /** The markdown in the editor, trimmed. */
  _bodyValue() { return String(this.$('[data-editor]')?.value || '').trim(); }

  async _post() {
    const wrap = this.$('.form'); const msg = this.$('.msg');
    const body = this._bodyValue();
    if (!body) { this._say(msg, 'Write something first.', 'err'); return; }
    if (commentBodyTooLong(body)) { this._say(msg, `The comment is too long (over ${COMMENT_MAX_BYTES} bytes).`, 'err'); return; }
    const t = this._target();
    // A checked author-note on a post/product/prompt is the public intro (public by definition); otherwise the
    // audience is the control's choice. Members only is the default.
    const authorNote = !!this.$('[data-authornote]')?.checked && ['post', 'project', 'prompt'].includes(t.type);
    const visibility = authorNote ? 'public' : (this._vis === 'public' ? 'public' : 'members');
    wrap?.classList.add('busy');
    try {
      const res = await this.client.postComment({ targetType: t.type, targetSlug: t.slug, body, visibility, authorNote });
      this._done(msg, submitAck({ prNumber: res?.prNumber }), 'gbti-comment-posted', res); // SOW-072 P2: consistent, accurate ack
    } catch (err) { this._fail(msg, err); wrap?.classList.remove('busy'); }
  }

  async _save() {
    const wrap = this.$('.form'); const msg = this.$('.msg');
    const body = this._bodyValue();
    if (!body) { this._say(msg, 'A comment cannot be empty.', 'err'); return; }
    if (commentBodyTooLong(body)) { this._say(msg, `The comment is too long (over ${COMMENT_MAX_BYTES} bytes).`, 'err'); return; }
    wrap?.classList.add('busy');
    try {
      // The audience rides with the edit: a flip re-publishes the comment (members -> public deletes the old
      // ciphertext, public -> members encrypts); an intro keeps its authorNote (editComment defaults it).
      const visibility = this._vis === 'public' ? 'public' : 'members';
      const res = await this.client.editComment({ id: this._editId, body, visibility });
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
