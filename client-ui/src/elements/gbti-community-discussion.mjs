// sow-494: <gbti-community-discussion>, the block under every Community entry (a poll, a typed poll, a topic). Members
// post rich text with images, reply to a post (one level), react with the standard eight emoji, and edit or delete
// their own posts. A superadmin also pins, hides and removes an image. A post reaches everyone on the entry within
// seconds, through the entry page's live poll, not after a site rebuild.
//
// The entry page sets `.data = { entryId, entry, discussion, viewer }` on every change. The composer is built ONCE
// and never redrawn by an update, so a half-written post and its attached images survive. While the member is
// editing or replying inline, the list is not redrawn either; the newest data is applied as soon as they finish.
//
// Images are uploaded the moment they are picked (to the member's own staging area, visible to them alone), then
// attached when the post is sent. Bodies render through the client's escape-first markdown renderer.
import { GbtiElement, define, esc } from '../base.mjs';
import { relTime, absTime } from '../time-core.mjs';
import { COMMUNITY_CSS } from './community-css.mjs';
import { initials, plural, uploadProblem, formatBytes, REACTIONS, LIMITS } from '../community-core.mjs';
import './gbti-prose-editor.mjs';

const EMOJI = Object.fromEntries(REACTIONS);

const CSS = `
  .disc { display: flex; flex-direction: column; gap: 16px; border-top: 1px solid var(--line); padding-top: 24px; margin-top: 24px; }
  .dh { display: flex; align-items: baseline; gap: 10px; }
  .dh h2 { font-size: 22px; font-weight: 700; }
  .dh span { font-size: 15px; color: var(--fg-mute); }
  .list { display: flex; flex-direction: column; gap: 14px; }
  .post { padding: 18px 20px; display: flex; flex-direction: column; gap: 12px; position: relative; }
  .post.pinned { border-color: var(--green); }
  .ph { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding-right: 40px; }
  .reply { position: relative; }
  .ph .menu { position: absolute; top: 12px; right: 12px; }
  .reply .ph .menu { top: -4px; right: 0; }
  .ph strong { font-size: 15px; }
  .ph .when { font-size: 13px; color: var(--fg-mute); }
  .ph .sp { flex: 1; }
  .md { font-size: 16px; line-height: 1.6; overflow-wrap: anywhere; }
  .md > :first-child { margin-top: 0; } .md > :last-child { margin-bottom: 0; }
  .md img { max-width: 100%; }
  .md pre { white-space: pre-wrap; background: var(--tint); padding: 10px 12px; border-radius: 8px; font-size: 14px; }
  .md blockquote { margin: 0 0 .7em; padding-left: 12px; border-left: 3px solid var(--line-2); color: var(--fg-soft); }
  .imgs { display: flex; flex-wrap: wrap; gap: 10px; }
  .img { position: relative; flex: 1 1 240px; max-width: 420px; min-width: 0; }
  .img img { display: block; width: 100%; max-height: 360px; object-fit: cover; border-radius: 8px; background: var(--tint); }
  .img a { display: block; }
  .img .rm { position: absolute; top: 6px; right: 6px; }
  .rx { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .chip { display: inline-flex; align-items: center; gap: 5px; min-height: 30px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--line-2); background: var(--paper); font-size: 13px; font-weight: 600; color: var(--fg-soft); }
  .chip:hover { background: var(--tint); }
  .chip.on { border-color: var(--green); background: var(--green-tint); color: var(--green-700); }
  .chip.on:hover { background: var(--green-tint); }
  .pick { display: flex; gap: 4px; padding: 6px; border: 1px solid var(--line-2); border-radius: 10px; background: var(--paper); box-shadow: 0 12px 30px rgba(37,35,43,.12); flex-wrap: wrap; }
  .pick button { width: 36px; height: 36px; border-radius: 8px; font-size: 18px; }
  .pick button:hover { background: var(--tint); }
  .pa { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
  .pa .n { font-size: 13px; color: var(--fg-mute); }
  .replies { display: flex; flex-direction: column; gap: 12px; margin-left: 12px; padding-left: 16px; border-left: 2px solid var(--line); }
  .reply { display: flex; flex-direction: column; gap: 8px; }
  .gone { padding: 14px 16px; border: 1px dashed var(--line-2); border-radius: 10px; color: var(--fg-mute); font-size: 14px; }
  .menu { position: relative; }
  .menu > button { width: 34px; height: 34px; border-radius: 8px; color: var(--fg-soft); font-size: 18px; line-height: 1; }
  .menu > button:hover { background: var(--tint); }
  .menu .pop { position: absolute; right: 0; top: 38px; z-index: 5; min-width: 190px; padding: 6px; border: 1px solid var(--line-2); border-radius: 10px; background: var(--paper); box-shadow: 0 12px 30px rgba(37,35,43,.14); display: flex; flex-direction: column; }
  .menu .pop button { text-align: left; padding: 9px 10px; border-radius: 6px; font-size: 14px; font-weight: 500; }
  .menu .pop button:hover { background: var(--tint); }
  .comp { border: 1.5px solid var(--green); border-radius: 12px; padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; background: var(--paper); }
  .comp.sub { border-width: 1px; border-color: var(--line-2); padding: 12px 14px; }
  .att { display: flex; flex-direction: column; gap: 8px; }
  .a { display: flex; align-items: center; gap: 12px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px; }
  .a img, .a .th { width: 56px; height: 42px; object-fit: cover; border-radius: 6px; background: var(--tint); flex: none; }
  .a .nm { flex: 1; min-width: 0; font-size: 14px; overflow-wrap: anywhere; }
  .a .nm small { display: block; color: var(--fg-mute); font-size: 12px; }
  .a .st { font-size: 13px; font-weight: 600; color: var(--green-700); }
  .a .st.up { color: var(--fg-soft); }
  .foot { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; border-top: 1px solid var(--line); padding-top: 12px; }
  .foot .lim { font-size: 13px; color: var(--fg-mute); }
  .foot .go { margin-left: auto; display: flex; gap: 10px; align-items: center; }
  .flash { font-size: 14px; font-weight: 600; color: var(--green-700); }
  .bad { font-size: 14px; font-weight: 600; color: var(--err); }
  .closed { padding: 14px 16px; border-radius: 10px; background: var(--tint); color: var(--fg-soft); font-size: 14px; }
  .first { padding: 28px 22px; text-align: center; display: flex; flex-direction: column; gap: 6px; align-items: center; }
  .first strong { font-size: 17px; }
  .first span { color: var(--fg-soft); font-size: 15px; }
  input[type="file"] { display: none; }
  @media (max-width: 640px) { .post { padding: 14px; } .replies { margin-left: 4px; padding-left: 12px; } }
`;

class GbtiCommunityDiscussion extends GbtiElement {
  constructor() {
    super();
    this._data = null;
    this._built = false;
    this._inline = null; // { kind: 'edit' | 'reply', postId, keep? } while the member is writing in the list
    this._menu = null;
    this._picker = null;
    this._atts = []; // { key, name, size, preview, state: 'up' | 'ready' | 'error', id?, problem? }
  }

  set data(d) {
    this._data = d;
    if (!this._built) { this.render(); return; }
    if (this._inline) return; // applied when the member finishes: drawList reads the newest data
    this.drawList();
  }
  get data() { return this._data; }

  skipClientRender() { return this._built; }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._outside) document.removeEventListener('click', this._outside);
    this._built = false; // a reconnect builds the block again rather than writing into a detached one
  }

  get entry() { return this._data?.entry || {}; }
  get viewer() { return this._data?.viewer || {}; }
  get locked() { return !!this._data?.discussion?.locked || this.entry.status === 'draft'; }
  get imagesOn() { return !(this.entry.kind === 'topic' && this.entry.settings?.imagesAllowed === false); }

  render() {
    if (!this._data || !this.client) return;
    if (this._built) { this.drawList(); return; }
    this._built = true;
    this.set(this.css(COMMUNITY_CSS + CSS) + `<section class="disc" aria-labelledby="dh">
      <div class="dh"><h2 id="dh">Discussion</h2><span data-count></span></div>
      <div class="list" data-list></div>
      <div data-closed></div>
      <div class="comp" data-comp>
        <gbti-prose-editor data-editor placeholder="${esc(this.entry.kind === 'topic' ? 'Add your post. Text, links and images are welcome.' : 'Join the discussion. Text, links and images are welcome.')}"></gbti-prose-editor>
        <div class="att" data-atts></div>
        <div class="foot">
          ${this.imagesOn ? '<button type="button" class="cm-btn2 sm" data-add-img>Add an image</button><input type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple data-file>' : ''}
          <span class="lim">Members only.${this.imagesOn ? ` Up to ${LIMITS.postImages} images, 1 MB each.` : ''}</span>
          <span class="go"><span data-comp-msg></span><button type="button" class="cm-btn" data-send-post>Post</button></span>
        </div>
      </div>
    </section>`);
    this.on('[data-add-img]', 'click', () => this.$('[data-file]')?.click());
    this.on('[data-file]', 'change', (ev) => { this.addFiles([...(ev.target.files || [])]); ev.target.value = ''; });
    this.on('[data-send-post]', 'click', () => this.send());
    // The shadow root outlives a disconnect, so its one delegated listener is bound once, ever; a second one would
    // send every reaction and moderation click twice.
    if (!this._rootWired) { this._rootWired = true; this.root.addEventListener('click', (ev) => this.onClick(ev)); }
    this._outside = (ev) => { if ((this._menu || this._picker) && !ev.composedPath().includes(this)) { this._menu = null; this._picker = null; this.redraw(); } };
    document.addEventListener('click', this._outside);
    this.drawList();
  }

  // ---- the list ----------------------------------------------------------------------------------------------

  drawList() {
    const list = this.$('[data-list]');
    if (!list) return;
    const posts = this._data?.discussion?.posts || [];
    const n = this._data?.discussion?.count || 0;
    this.$('[data-count]').textContent = plural(n, 'post');
    list.innerHTML = posts.length ? posts.map((p) => this.postHtml(p)).join('') : this.emptyHtml();
    const comp = this.$('[data-comp]');
    if (comp) comp.hidden = this.locked;
    const closed = this.$('[data-closed]');
    if (closed) {
      closed.innerHTML = this.entry.status === 'draft'
        ? '<div class="closed">The discussion opens with the entry.</div>'
        : this.locked ? `<div class="closed">${this.entry.kind === 'topic' ? 'This topic is closed. Everything posted stays here to read; new posts and replies are off.' : 'This discussion is closed. Everything here stays to read.'}</div>` : '';
    }
    this.syncPost();
  }

  emptyHtml() {
    if (this.locked) return '<div class="cm-card first"><span>No posts were made here.</span></div>';
    return this.entry.kind === 'topic'
      ? '<div class="cm-card first"><strong>Be the first to post</strong><span>Add text, links and images. Everyone on this topic sees it within seconds.</span></div>'
      : '<div class="cm-card first"><strong>No posts yet</strong><span>Start the discussion. Everyone on this entry sees it within seconds.</span></div>';
  }

  md(body) {
    if (!body) return '';
    try { return this.client.preview({ body }).html; } catch { return `<p>${esc(body)}</p>`; }
  }

  imgHtml(p, editing) {
    if (!p.images?.length) return '';
    const keep = editing ? this._inline.keep : null;
    const shown = keep ? p.images.filter((i) => keep.includes(i.id)) : p.images;
    return `<div class="imgs">${shown.map((i) => {
      const src = this.client.communityImageSrc(this._data.entryId, i.id);
      const rm = editing ? `<button type="button" class="cm-btn2 sm rm" data-keep-off="${esc(i.id)}">Remove</button>`
        : this.viewer.superadmin && !p.own ? `<button type="button" class="cm-btn2 sm rm" data-mod="remove-image" data-post-id="${esc(p.id)}" data-img="${esc(i.id)}">Remove image</button>` : '';
      return `<div class="img"><a href="${esc(src)}" target="_blank" rel="noopener"><img src="${esc(src)}" alt="${esc(i.name)}" loading="lazy"></a>${rm}</div>`;
    }).join('')}</div>`;
  }

  reactionsHtml(p) {
    if (p.deleted) return '';
    const chips = (p.reactions || []).map((r) => `<button type="button" class="chip${r.mine ? ' on' : ''}" data-react="${esc(r.name)}" data-post-id="${esc(p.id)}"
      title="${esc((r.who || []).join(', '))}" aria-pressed="${r.mine}" aria-label="${esc(`${r.name}, ${r.count}`)}">${esc(r.emoji || EMOJI[r.name] || '')} ${r.count}</button>`).join('');
    const can = !this.locked;
    const pick = this._picker === p.id
      ? `<div class="pick" role="menu" aria-label="Add a reaction">${REACTIONS.map(([name, e]) => `<button type="button" role="menuitem" data-react="${esc(name)}" data-post-id="${esc(p.id)}" aria-label="${esc(name)}">${e}</button>`).join('')}</div>` : '';
    if (!chips && !can) return '';
    return `<div class="rx">${chips}${can ? `<button type="button" class="chip" data-pick="${esc(p.id)}" aria-label="Add a reaction" aria-expanded="${this._picker === p.id}">☺ +</button>` : ''}</div>${pick}`;
  }

  menuHtml(p) {
    const items = [];
    if (p.own && !p.deleted && !this.locked) items.push(['edit', 'Edit'], ['delete', 'Delete']);
    if (this.viewer.superadmin && !p.deleted) {
      if (!p.parentId) items.push(p.pinned ? ['mod:unpin', 'Unpin'] : ['mod:pin', 'Pin to the top']);
      items.push(p.hidden ? ['mod:unhide', 'Show this post'] : ['mod:hide', 'Hide this post']);
    }
    if (!items.length) return '';
    const open = this._menu === p.id;
    return `<span class="menu"><button type="button" data-menu="${esc(p.id)}" aria-haspopup="menu" aria-expanded="${open}" aria-label="Post actions">⋯</button>
      ${open ? `<span class="pop" role="menu">${items.map(([a, l]) => `<button type="button" role="menuitem" data-act="${a}" data-post-id="${esc(p.id)}">${esc(l)}</button>`).join('')}</span>` : ''}</span>`;
  }

  headHtml(p) {
    const name = p.author?.login || '';
    const edited = p.editedAt ? ' · edited' : '';
    return `<div class="ph"><span class="cm-av lg" aria-hidden="true">${esc(initials(name))}</span><strong>${esc(name)}</strong>
      <span class="when" title="${esc(absTime(p.at))}">${esc(relTime(p.at))}${edited}</span>
      ${p.pinned ? '<span class="cm-pill live">Pinned by the host</span>' : ''}${p.hidden ? '<span class="cm-pill muted">Hidden by the host</span>' : ''}
      <span class="sp"></span>${this.menuHtml(p)}</div>`;
  }

  bodyHtml(p) {
    if (this._inline?.kind === 'edit' && this._inline.postId === p.id) {
      return `<div class="comp sub"><gbti-prose-editor data-edit-editor placeholder="Edit your post"></gbti-prose-editor>${this.imgHtml(p, true)}
        <div class="foot"><span data-inline-msg></span><span class="go"><button type="button" class="cm-btn2" data-cancel>Cancel</button><button type="button" class="cm-btn" data-save-edit="${esc(p.id)}">Save</button></span></div></div>`;
    }
    return `${p.body ? `<div class="md">${this.md(p.body)}</div>` : ''}${this.imgHtml(p, false)}`;
  }

  postHtml(p) {
    if (p.deleted) {
      return `<div class="gone">This post was removed.</div>${p.replies?.length ? `<div class="replies">${p.replies.map((r) => this.replyHtml(r)).join('')}</div>` : ''}`;
    }
    if (p.hidden && !p.body && !p.images?.length && !p.own && !this.viewer.superadmin) {
      return `<div><div class="gone">A post here was hidden by the host.</div>${p.replies?.length ? `<div class="replies" style="margin-top:12px">${p.replies.map((r) => this.replyHtml(r)).join('')}</div>` : ''}</div>`;
    }
    const replies = p.replies || [];
    const replying = this._inline?.kind === 'reply' && this._inline.postId === p.id;
    return `<article class="cm-card post${p.pinned ? ' pinned' : ''}" data-post="${esc(p.id)}">
      ${this.headHtml(p)}${this.bodyHtml(p)}${this.reactionsHtml(p)}
      <div class="pa">${this.locked ? '' : `<button type="button" class="cm-btn2 sm" data-reply="${esc(p.id)}">Reply</button>`}${replies.length ? `<span class="n">${esc(plural(replies.length, 'reply', 'replies'))}</span>` : ''}</div>
      ${replies.length ? `<div class="replies">${replies.map((r) => this.replyHtml(r)).join('')}</div>` : ''}
      ${replying ? `<div class="comp sub"><gbti-prose-editor data-reply-editor placeholder="Write a reply"></gbti-prose-editor>
        <div class="foot"><span data-inline-msg></span><span class="go"><button type="button" class="cm-btn2" data-cancel>Cancel</button><button type="button" class="cm-btn" data-send-reply="${esc(p.id)}">Reply</button></span></div></div>` : ''}
    </article>`;
  }

  replyHtml(r) {
    if (r.deleted) return '';
    if (r.hidden && !r.body && !r.own && !this.viewer.superadmin) return '<div class="gone">A reply here was hidden by the host.</div>';
    return `<div class="reply" data-post="${esc(r.id)}">${this.headHtml(r)}${this.bodyHtml(r)}${this.reactionsHtml(r)}</div>`;
  }

  // ---- actions -----------------------------------------------------------------------------------------------

  onClick(ev) {
    const t = ev.target.closest?.('button');
    if (!t || !this.root.contains(t)) return;
    const pid = t.dataset.postId;
    if (t.dataset.menu) { this._menu = this._menu === t.dataset.menu ? null : t.dataset.menu; this._picker = null; this.redraw(); return; }
    if (t.dataset.pick) { this._picker = this._picker === t.dataset.pick ? null : t.dataset.pick; this._menu = null; this.redraw(); return; }
    if (t.dataset.react) { this._picker = null; this.act(() => this.client.communityReact(this._data.entryId, pid, t.dataset.react)); return; }
    if (t.dataset.reply) { this.startInline({ kind: 'reply', postId: t.dataset.reply }); return; }
    if (t.dataset.act === 'edit') { this.startInline({ kind: 'edit', postId: pid }); return; }
    if (t.dataset.act === 'delete') {
      this._menu = null;
      if (confirm('Delete this post? Replies to it stay.')) this.act(() => this.client.communityDeletePost(this._data.entryId, pid));
      else this.redraw();
      return;
    }
    if (t.dataset.act?.startsWith('mod:')) { this._menu = null; this.act(() => this.client.communityAdmin('moderate', { id: this._data.entryId, postId: pid, action: t.dataset.act.slice(4) })); return; }
    if (t.dataset.mod === 'remove-image') {
      if (confirm('Remove this image from the post?')) this.act(() => this.client.communityAdmin('moderate', { id: this._data.entryId, postId: pid, action: 'remove-image', imageId: t.dataset.img }));
      return;
    }
    if (t.dataset.keepOff && this._inline?.keep) { this._inline.keep = this._inline.keep.filter((x) => x !== t.dataset.keepOff); this.keepEditorText(); return; }
    if (t.dataset.cancel != null) { this.endInline(); return; }
    if (t.dataset.saveEdit) { this.saveEdit(t.dataset.saveEdit, t); return; }
    if (t.dataset.sendReply) { this.sendReply(t.dataset.sendReply, t); return; }
    if (t.dataset.dropAtt) { this.dropAtt(t.dataset.dropAtt); }
  }

  redraw() { if (this._inline) this.keepEditorText(); else this.drawList(); }

  findPost(id) {
    for (const p of this._data?.discussion?.posts || []) {
      if (p.id === id) return p;
      for (const r of p.replies || []) if (r.id === id) return r;
    }
    return null;
  }

  startInline(state) {
    this._menu = null;
    this._picker = null;
    const p = this.findPost(state.postId);
    if (state.kind === 'edit') state.keep = (p?.images || []).map((i) => i.id);
    this._inline = state;
    this.drawList();
    const ed = this.$(state.kind === 'edit' ? '[data-edit-editor]' : '[data-reply-editor]');
    if (ed) { if (state.kind === 'edit') ed.value = p?.body || ''; setTimeout(() => ed.$?.('[data-surface]')?.focus(), 0); }
  }

  /** Redraw the list while an inline editor is open, without losing what is typed in it. */
  keepEditorText() {
    const sel = this._inline?.kind === 'edit' ? '[data-edit-editor]' : '[data-reply-editor]';
    const text = this.$(sel)?.value ?? '';
    this.drawList();
    const ed = this.$(sel);
    if (ed) ed.value = text;
  }

  endInline() {
    this._inline = null;
    this.drawList();
  }

  async act(fn) {
    try { await fn(); this.emit('community-changed'); } catch (e) { this.flash(e?.message || 'That did not work. Try again.', true); }
    this.redraw();
  }

  async saveEdit(postId, btn) {
    const body = this.$('[data-edit-editor]')?.value || '';
    btn.disabled = true;
    try {
      await this.client.communityEditPost(this._data.entryId, postId, { body, images: this._inline?.keep });
      this.endInline();
      this.emit('community-changed');
    } catch (e) {
      btn.disabled = false;
      this.inlineMsg(e?.message || 'Your edit was not saved.');
    }
  }

  async sendReply(postId, btn) {
    const body = this.$('[data-reply-editor]')?.value || '';
    if (!body.trim()) { this.inlineMsg('Write a reply first.'); return; }
    btn.disabled = true;
    try {
      await this.client.communityPost(this._data.entryId, { body, parentId: postId });
      this.endInline();
      this.emit('community-changed');
    } catch (e) {
      btn.disabled = false;
      this.inlineMsg(e?.message || 'Your reply was not sent.');
    }
  }

  inlineMsg(text) { const el = this.$('[data-inline-msg]'); if (el) el.innerHTML = `<span class="bad" role="status">${esc(text)}</span>`; }

  flash(text, bad = false) {
    const el = this.$('[data-comp-msg]');
    if (!el) return;
    el.innerHTML = text ? `<span class="${bad ? 'bad' : 'flash'}" role="status">${esc(text)}</span>` : '';
    clearTimeout(this._flashT);
    if (!bad && text) this._flashT = setTimeout(() => { el.innerHTML = ''; }, 6000);
  }

  // ---- the composer ------------------------------------------------------------------------------------------

  drawAtts() {
    const box = this.$('[data-atts]');
    if (!box) return;
    box.innerHTML = this._atts.map((a) => {
      if (a.state === 'error') {
        return `<div class="cm-err" role="alert"><span aria-hidden="true">!</span><span><strong>${esc(a.problem.title)}</strong>${esc(a.problem.detail)}</span>
          <button type="button" class="cm-quiet" data-drop-att="${esc(a.key)}" style="margin-left:auto">Dismiss</button></div>`;
      }
      const th = a.preview ? `<img src="${esc(a.preview)}" alt="">` : '<span class="th"></span>';
      const st = a.state === 'up' ? '<span class="st up">Uploading</span>' : '<span class="st">Ready</span>';
      return `<div class="a">${th}<span class="nm">${esc(a.name)}<small>${esc(formatBytes(a.size))}</small></span>${st}
        <button type="button" class="cm-quiet" data-drop-att="${esc(a.key)}">Remove</button></div>`;
    }).join('');
    this.syncPost();
  }

  syncPost() {
    const b = this.$('[data-send-post]');
    if (!b) return;
    const uploading = this._atts.some((a) => a.state === 'up');
    b.disabled = uploading || this._sending === true;
    b.title = uploading ? 'Post waits for the upload' : '';
  }

  async addFiles(files) {
    for (const f of files) {
      const live = this._atts.filter((a) => a.state !== 'error').length;
      const key = `a${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
      if (live >= LIMITS.postImages) { this._atts.push({ key, state: 'error', problem: { title: `Up to ${LIMITS.postImages} images per post.`, detail: 'Remove one to add another.' } }); continue; }
      const problem = uploadProblem({ name: f.name, size: f.size, type: f.type });
      if (problem) { this._atts.push({ key, state: 'error', problem }); continue; }
      const att = { key, name: f.name, size: f.size, state: 'up', preview: '' };
      this._atts.push(att);
      this.drawAtts();
      try {
        const dataUrl = await readAsDataUrl(f);
        att.preview = dataUrl;
        this.drawAtts();
        const r = await this.client.communityUploadImage(this._data.entryId, { name: f.name, dataBase64: dataUrl });
        att.id = r.id;
        att.state = 'ready';
      } catch (e) {
        att.state = 'error';
        att.problem = { title: `${f.name} was not added.`, detail: e?.message || 'Try again.' };
      }
    }
    this.drawAtts();
  }

  dropAtt(key) {
    const a = this._atts.find((x) => x.key === key);
    this._atts = this._atts.filter((x) => x.key !== key);
    if (a?.id) this.client.communityDropImage(this._data.entryId, a.id).catch(() => {}); // staged images are swept after a day anyway
    this.drawAtts();
  }

  async send() {
    const ed = this.$('[data-editor]');
    const body = ed?.value || '';
    const images = this._atts.filter((a) => a.state === 'ready').map((a) => a.id);
    if (!body.trim() && !images.length) { this.flash('Write something or add an image first.', true); return; }
    this._sending = true;
    this.syncPost();
    try {
      await this.client.communityPost(this._data.entryId, { body, images });
      if (ed) ed.value = '';
      this._atts = [];
      this.drawAtts();
      this.flash('Posted. Everyone on this entry can see it.');
      this.emit('community-changed');
    } catch (e) {
      this.flash(e?.message || 'Your post was not sent. Try again.', true);
    }
    this._sending = false;
    this.syncPost();
  }
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('That file could not be read.'));
    r.readAsDataURL(file);
  });
}

define('gbti-community-discussion', GbtiCommunityDiscussion);
export { GbtiCommunityDiscussion };
