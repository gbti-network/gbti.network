// sow-494: <gbti-community-editor>, the superadmin's dialog for a Community entry. Three ways in:
//   openCreate()                 New entry: pick a kind, write it, choose the meeting and who can see it, then
//                                Save for later (a draft only superadmins see) or Open now.
//   openEdit(entry, {answered})  Edit an entry. A poll's question and answers lock once a member has answered.
//   openAccess(entry)            Manage access alone: All members, or chosen members picked by name.
// It emits `community-saved` with { id } after a successful save, then removes itself. The Worker re-checks the role
// on every call; this dialog is only drawn for a client that carries the superadmin methods.
import { GbtiElement, define, esc } from '../base.mjs';
import { COMMUNITY_CSS, KIND_ICON } from './community-css.mjs';
import { KIND_LABEL, LIMITS, shoptalkMeetings, meetingText, initials, plural, uploadProblem, formatBytes } from '../community-core.mjs';
import './gbti-prose-editor.mjs';

const KINDS = [
  ['poll', 'Poll with choices', 'Members pick one answer.'],
  ['typed', 'Poll with a typed answer', 'Each member types a short answer.'],
  ['topic', 'Topic', 'Members post text and images beneath your prompt.'],
];

const CSS = `
  dialog { width: min(720px, calc(100vw - 32px)); max-height: calc(100vh - 48px); padding: 0; border: 1px solid var(--line-2); border-radius: 14px;
    background: var(--paper); color: var(--fg); box-shadow: 0 28px 60px rgba(37,35,43,.25); }
  dialog::backdrop { background: rgba(28,26,33,.55); }
  .dlg { display: flex; flex-direction: column; max-height: calc(100vh - 50px); }
  .top { display: flex; align-items: flex-start; gap: 12px; padding: 20px 24px 14px; border-bottom: 1px solid var(--line); }
  .top h2 { font-family: var(--f-display); font-size: 26px; font-weight: 700; line-height: 1.15; }
  .top p { margin: 4px 0 0; font-size: 14px; color: var(--fg-mute); overflow-wrap: anywhere; }
  .top .x { margin-left: auto; width: 36px; height: 36px; border-radius: 8px; font-size: 22px; color: var(--fg-soft); flex: none; }
  .top .x:hover { background: var(--tint); }
  .body { padding: 18px 24px; overflow-y: auto; display: flex; flex-direction: column; gap: 18px; }
  .bot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 14px 24px 18px; border-top: 1px solid var(--line); }
  .bot .msg { flex: 1; min-width: 160px; font-size: 14px; }
  .lbl { display: block; font-family: var(--f-mono); font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--fg-mute); margin-bottom: 8px; }
  .kinds { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
  .kind { display: flex; flex-direction: column; gap: 6px; padding: 14px; border: 1.5px solid var(--line-2); border-radius: 10px; text-align: left; background: var(--paper); }
  .kind:hover { border-color: var(--green); background: var(--paper); }
  .kind[aria-pressed="true"] { border-color: var(--green); background: var(--green-tint); }
  .kind[aria-pressed="true"]:hover { background: var(--green-tint); }
  .kind b { display: flex; align-items: center; gap: 8px; font-size: 15px; }
  .kind b svg { width: 16px; height: 16px; color: var(--green-700); }
  .kind span { font-size: 13px; color: var(--fg-soft); }
  .inp { width: 100%; min-height: 44px; padding: 0 12px; font-size: 15px; font-weight: 500; }
  .opts { display: flex; flex-direction: column; gap: 8px; }
  .optrow { display: flex; gap: 8px; align-items: center; }
  .optrow .inp { flex: 1; }
  .optrow button { width: 34px; height: 34px; border-radius: 8px; color: var(--fg-soft); flex: none; font-size: 16px; }
  .optrow button:hover { background: var(--tint); }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .radio, .check { display: flex; align-items: flex-start; gap: 10px; font-size: 15px; cursor: pointer; padding: 4px 0; }
  .radio small, .check small { display: block; font-size: 13px; color: var(--fg-mute); }
  .people { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--paper-2); }
  .found { display: flex; flex-direction: column; gap: 4px; max-height: 180px; overflow-y: auto; }
  .who { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 8px; background: var(--paper); }
  .who .nm { flex: 1; min-width: 0; font-size: 14px; overflow-wrap: anywhere; }
  .who .nm small { color: var(--fg-mute); }
  .pimgs { display: flex; flex-direction: column; gap: 8px; }
  .pi { display: flex; align-items: center; gap: 10px; font-size: 14px; }
  .pi img { width: 56px; height: 42px; object-fit: cover; border-radius: 6px; background: var(--tint); }
  .pi .nm { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .lockd { font-size: 13px; color: var(--amber-text); }
  input[type="file"] { display: none; }
  .bad { color: var(--err); font-weight: 600; }
  .ok { color: var(--green-700); font-weight: 600; }
  @media (max-width: 640px) { .kinds, .two { grid-template-columns: 1fr; } .top, .body, .bot { padding-left: 16px; padding-right: 16px; } }
`;

class GbtiCommunityEditor extends GbtiElement {
  constructor() {
    super();
    this._mode = null;
    this._f = null;
    this._members = null; // the picker list, loaded on first use
    this._q = '';
  }

  skipClientRender() { return this._mode != null; }
  render() { if (this._mode) this.draw(); }

  openCreate() {
    this._mode = 'create';
    this._f = { kind: 'poll', title: '', prompt: '', options: ['', ''], hint: '', answerLength: 'short', countMatching: true, changeable: true,
      publishOnClose: false, imagesAllowed: true, meeting: this.defaultMeeting(), access: { mode: 'all', members: [] }, images: [] };
    this.show();
  }

  openEdit(entry, { answered = false } = {}) {
    this._mode = 'edit';
    this._entry = entry;
    this._answered = answered && entry.kind !== 'topic';
    const s = entry.settings || {};
    this._f = { kind: entry.kind, title: entry.title, prompt: entry.prompt || '', options: [...(entry.options || [])], hint: s.hint || '', answerLength: s.answerLength || 'short',
      countMatching: s.countMatching !== false, changeable: s.changeable !== false, publishOnClose: s.publishOnClose === true, imagesAllowed: s.imagesAllowed !== false,
      meeting: { label: entry.meeting?.label || '', date: entry.meeting?.date || '' }, access: this.accessOf(entry),
      images: (entry.promptImages || []).map((i) => ({ id: i.id, name: i.name, state: 'ready', src: this.client.communityImageSrc(entry.id, i.id) })) };
    if (entry.meeting?.label) this._customMeeting = !shoptalkMeetings().some((m) => m.label === entry.meeting.label && m.date === entry.meeting.date);
    this.show();
  }

  openAccess(entry) {
    this._mode = 'access';
    this._entry = entry;
    this._f = { access: this.accessOf(entry) };
    this.show();
    this.loadMembers();
  }

  accessOf(entry) {
    const members = (entry.access?.members || []).map((m) => ({ githubId: m.githubId, username: m.login }));
    return { mode: entry.access?.mode === 'chosen' ? 'chosen' : 'all', members };
  }

  defaultMeeting() {
    const next = shoptalkMeetings().find((m) => m.next);
    return next ? { label: next.label, date: next.date } : { label: '', date: '' };
  }

  show() {
    this.draw();
    const d = this.$('dialog');
    if (d && !d.open) { try { d.showModal(); } catch { d.setAttribute('open', ''); } }
    if (this._f.access?.mode === 'chosen') this.loadMembers();
  }

  close() {
    this.$('dialog')?.close?.();
    this.remove();
  }

  // ---- drawing -----------------------------------------------------------------------------------------------

  draw() {
    const m = this._mode;
    const title = m === 'create' ? 'New entry' : m === 'edit' ? 'Edit entry' : 'Who can see this entry';
    const sub = m === 'create' ? 'Only superadmins start entries. Members answer, post and reply.' : `${KIND_LABEL[this._entry?.kind] || ''} · ${this._entry?.title || ''}`;
    const body = m === 'access' ? this.accessHtml() : this.formHtml();
    const buttons = m === 'create'
      ? '<button type="button" class="cm-btn2" data-save="draft">Save for later</button><button type="button" class="cm-btn" data-save="open">Open now</button>'
      : m === 'edit' ? '<button type="button" class="cm-btn2" data-close>Cancel</button><button type="button" class="cm-btn" data-save="edit">Save changes</button>'
        : '<button type="button" class="cm-btn2" data-close>Cancel</button><button type="button" class="cm-btn" data-save="access">Save access</button>';
    this.set(this.css(COMMUNITY_CSS + CSS) + `<dialog aria-labelledby="dlg-t"><div class="dlg">
      <div class="top"><div><h2 id="dlg-t">${esc(title)}</h2><p>${esc(sub)}</p></div><button type="button" class="x" data-close aria-label="Close">×</button></div>
      <div class="body">${body}</div>
      <div class="bot"><span class="msg" data-msg></span>${buttons}</div>
    </div></dialog>`);
    this.wireShell();
    this.wire();
  }

  formHtml() {
    const f = this._f;
    const kinds = this._mode === 'create' ? `<div><span class="lbl">Kind</span><div class="kinds">${KINDS.map(([k, label, hint]) => `<button type="button" class="kind" data-kind="${k}" aria-pressed="${f.kind === k}">
        <b>${KIND_ICON[k]}${esc(label)}</b><span>${esc(hint)}</span></button>`).join('')}</div></div>` : '';
    const locked = this._answered;
    const title = `<label><span class="lbl">${f.kind === 'topic' ? 'Title' : 'Question'}</span>
      <input class="inp" data-f="title" maxlength="${LIMITS.title}" value="${esc(f.title)}"${locked ? ' disabled' : ''}></label>
      ${locked ? '<p class="lockd" style="margin:6px 0 0">Members have answered, so the question and answers are locked.</p>' : ''}`;
    let kindBlock = '';
    if (f.kind === 'poll') {
      kindBlock = `<div><span class="lbl">Answers (2 to 8)</span><div class="opts">${f.options.map((o, i) => `<div class="optrow">
          <input class="inp" data-opt="${i}" maxlength="${LIMITS.option}" value="${esc(o)}" aria-label="Answer ${i + 1}"${locked ? ' disabled' : ''}>
          ${locked ? '' : `<button type="button" data-up="${i}" aria-label="Move up"${i === 0 ? ' disabled' : ''}>↑</button><button type="button" data-rm="${i}" aria-label="Remove answer ${i + 1}"${f.options.length <= 2 ? ' disabled' : ''}>×</button>`}
        </div>`).join('')}</div>
        ${locked || f.options.length >= LIMITS.optionsMax ? '' : '<button type="button" class="cm-quiet" data-add-opt style="margin-top:6px">Add an answer</button>'}</div>
        ${this.checkHtml('changeable', 'Members can change their answer until it closes')}
        ${this.checkHtml('publishOnClose', 'Publish the results as soon as it closes')}`;
    } else if (f.kind === 'typed') {
      kindBlock = `<label><span class="lbl">Hint inside the answer box</span><input class="inp" data-f="hint" maxlength="${LIMITS.hint}" value="${esc(f.hint)}" placeholder="A movie title"></label>
        <div><span class="lbl">Answer length</span><div class="two">
          ${this.radioHtml('answerLength', 'short', `Short, up to ${LIMITS.typedShort} characters`)}${this.radioHtml('answerLength', 'long', `A sentence, up to ${LIMITS.typedLong}`)}</div></div>
        ${this.checkHtml('countMatching', 'Count matching answers together in the results')}
        ${this.checkHtml('changeable', 'Members can change their answer until it closes')}
        ${this.checkHtml('publishOnClose', 'Publish the results as soon as it closes')}`;
    } else {
      kindBlock = `<div><span class="lbl">Prompt</span><gbti-prose-editor data-prompt placeholder="What should members post? Images are welcome."></gbti-prose-editor></div>
        <div><span class="lbl">Images with the prompt</span><div class="pimgs" data-pimgs>${this.promptImgsHtml()}</div>
          ${f.images.filter((i) => i.state !== 'error').length < LIMITS.promptImages ? '<button type="button" class="cm-btn2 sm" data-add-pimg style="margin-top:8px">Add an image</button><input type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple data-pfile>' : ''}</div>
        ${this.checkHtml('imagesAllowed', 'Members can add images to their posts')}`;
    }
    return `${kinds}<div>${title}</div>${kindBlock}${this.meetingHtml()}${this.accessHtml()}`;
  }

  checkHtml(key, label) {
    return `<label class="check"><input type="checkbox" data-c="${key}"${this._f[key] ? ' checked' : ''}><span>${esc(label)}</span></label>`;
  }
  radioHtml(key, value, label) {
    return `<label class="radio"><input type="radio" name="${key}" data-r="${key}" value="${value}"${this._f[key] === value ? ' checked' : ''}><span>${esc(label)}</span></label>`;
  }

  promptImgsHtml() {
    return this._f.images.map((i, n) => (i.state === 'error'
      ? `<div class="cm-err"><span><strong>${esc(i.problem.title)}</strong>${esc(i.problem.detail)}</span><button type="button" class="cm-quiet" data-pdrop="${n}" style="margin-left:auto">Dismiss</button></div>`
      : `<div class="pi">${i.src || i.preview ? `<img src="${esc(i.src || i.preview)}" alt="">` : ''}<span class="nm">${esc(i.name)}${i.size ? ` · ${esc(formatBytes(i.size))}` : ''}</span>
          <span class="${i.state === 'up' ? 'cm-mute' : 'ok'}">${i.state === 'up' ? 'Uploading' : 'Ready'}</span><button type="button" class="cm-quiet" data-pdrop="${n}">Remove</button></div>`)).join('');
  }

  meetingHtml() {
    const f = this._f;
    const list = shoptalkMeetings();
    const cur = `${f.meeting.label}|${f.meeting.date}`;
    const known = list.some((m) => `${m.label}|${m.date}` === cur);
    const custom = this._customMeeting || (f.meeting.label && !known);
    const opts = list.map((m) => `<option value="${esc(`${m.label}|${m.date}`)}"${!custom && cur === `${m.label}|${m.date}` ? ' selected' : ''}>${esc(m.text)}${m.next ? ' (next)' : ''}</option>`).join('');
    return `<div><span class="lbl">Meeting</span>
      <select class="inp" data-meeting>${opts}<option value="-"${!f.meeting.label ? ' selected' : ''}>Between meetings</option><option value="other"${custom ? ' selected' : ''}>Another meeting</option></select>
      ${custom ? `<div class="two" style="margin-top:8px"><input class="inp" data-ml maxlength="${LIMITS.meetingLabel}" placeholder="Meeting name" value="${esc(f.meeting.label)}" aria-label="Meeting name">
        <input class="inp" type="date" data-md value="${esc(f.meeting.date)}" aria-label="Meeting date"></div>` : ''}</div>`;
  }

  accessHtml() {
    const a = this._f.access;
    const chosen = a.mode === 'chosen';
    const picked = a.members.map((m) => `<div class="who"><span class="cm-av" aria-hidden="true">${esc(initials(m.username))}</span><span class="nm">${esc(m.username || m.githubId)}</span>
      <button type="button" class="cm-quiet" data-unpick="${esc(m.githubId)}">Remove</button></div>`).join('');
    let found = '';
    if (chosen) {
      if (this._members == null) found = '<p class="cm-mute" style="margin:0;font-size:14px">Loading members…</p>';
      else if (this._members.error) found = `<p class="bad" style="margin:0;font-size:14px">${esc(this._members.error)}</p>`;
      else {
        const q = this._q.trim().toLowerCase();
        const have = new Set(a.members.map((m) => m.githubId));
        const hits = this._members.list.filter((m) => !have.has(m.githubId) && (!q || m.username.toLowerCase().includes(q))).slice(0, 30);
        found = hits.length ? hits.map((m) => `<div class="who"><span class="cm-av" aria-hidden="true">${esc(initials(m.username))}</span><span class="nm">${esc(m.username)}</span>
          <button type="button" class="cm-btn2 sm" data-pick="${esc(m.githubId)}">Add</button></div>`).join('') : `<p class="cm-mute" style="margin:0;font-size:14px">${q ? 'No member by that name.' : 'Everyone is on it.'}</p>`;
      }
    }
    return `<div><span class="lbl">Who can see it</span>
      <label class="radio"><input type="radio" name="access" data-access="all"${chosen ? '' : ' checked'}><span>All members<small>Every paying member can see it and take part.</small></span></label>
      <label class="radio"><input type="radio" name="access" data-access="chosen"${chosen ? ' checked' : ''}><span>Chosen members<small>Only the members you pick by name. Everyone else never meets it: not in the list, not by its link.</small></span></label>
      ${chosen ? `<div class="people">
        <strong style="font-size:14px">${esc(plural(a.members.length, 'member'))} can see it</strong>
        ${picked ? `<div class="found">${picked}</div>` : ''}
        <input class="inp" data-search placeholder="Add a member by name" value="${esc(this._q)}" aria-label="Add a member by name">
        <div class="found" data-found>${found}</div>
        <p class="cm-mute" style="margin:0;font-size:13px">Removing someone hides the entry from them at once. What they already posted stays for the others. Superadmins always see every entry.</p>
      </div>` : ''}</div>`;
  }

  // ---- wiring ------------------------------------------------------------------------------------------------

  /** The dialog, its close controls and the save buttons are built once per draw(), so they are wired once, here. */
  wireShell() {
    const d = this.$('dialog');
    d?.addEventListener('cancel', (ev) => { ev.preventDefault(); this.close(); });
    for (const b of this.$$('[data-close]')) b.addEventListener('click', () => this.close());
    for (const b of this.$$('[data-save]')) b.addEventListener('click', () => this.save(b.dataset.save));
  }

  /** Everything inside .body, which redraw() replaces. Wiring the shell here too fired Save once per redraw. */
  wire() {
    for (const b of this.$$('[data-kind]')) b.addEventListener('click', () => { this.capture(); this._f.kind = b.dataset.kind; this.redraw(); });
    for (const b of this.$$('[data-add-opt]')) b.addEventListener('click', () => { this.capture(); this._f.options.push(''); this.redraw(); this.$(`[data-opt="${this._f.options.length - 1}"]`)?.focus(); });
    for (const b of this.$$('[data-rm]')) b.addEventListener('click', () => { this.capture(); this._f.options.splice(Number(b.dataset.rm), 1); this.redraw(); });
    for (const b of this.$$('[data-up]')) b.addEventListener('click', () => { this.capture(); const i = Number(b.dataset.up); const o = this._f.options; [o[i - 1], o[i]] = [o[i], o[i - 1]]; this.redraw(); });
    this.on('[data-meeting]', 'change', (ev) => {
      this.capture();
      const v = ev.target.value;
      if (v === 'other') { this._customMeeting = true; this._f.meeting = { label: '', date: '' }; } else {
        this._customMeeting = false;
        const [label, date] = v === '-' ? ['', ''] : v.split('|');
        this._f.meeting = { label, date };
      }
      this.redraw();
    });
    for (const r of this.$$('[data-access]')) r.addEventListener('change', () => { this.capture(); this._f.access.mode = r.dataset.access; if (r.dataset.access === 'chosen') this.loadMembers(); this.redraw(); });
    this.on('[data-search]', 'input', (ev) => { this._q = ev.target.value; this.drawFound(); });
    for (const b of this.$$('[data-unpick]')) b.addEventListener('click', () => { this.capture(); this._f.access.members = this._f.access.members.filter((m) => m.githubId !== b.dataset.unpick); this.redraw(); });
    this.wireFound();
    this.on('[data-add-pimg]', 'click', () => this.$('[data-pfile]')?.click());
    this.on('[data-pfile]', 'change', (ev) => { this.capture(); this.addPromptFiles([...(ev.target.files || [])]); ev.target.value = ''; });
    for (const b of this.$$('[data-pdrop]')) b.addEventListener('click', () => { this.capture(); this._f.images.splice(Number(b.dataset.pdrop), 1); this.redraw(); });
    const pe = this.$('[data-prompt]');
    if (pe) pe.value = this._f.prompt || '';
  }

  wireFound() {
    for (const b of this.$$('[data-pick]')) b.addEventListener('click', () => {
      this.capture();
      const m = this._members?.list?.find((x) => x.githubId === b.dataset.pick);
      if (m && this._f.access.members.length < LIMITS.chosenMax) this._f.access.members.push({ githubId: m.githubId, username: m.username });
      this._q = '';
      this.redraw();
      this.$('[data-search]')?.focus();
    });
  }

  drawFound() {
    const box = this.$('[data-found]');
    if (!box) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = this.accessHtml();
    box.innerHTML = tmp.querySelector('[data-found]')?.innerHTML || '';
    this.wireFound();
  }

  /** Read every field back into the form state, so a redraw never loses typing. */
  capture() {
    const f = this._f;
    if (!f) return;
    const v = (sel) => this.$(sel)?.value;
    if (this._mode !== 'access') {
      if (v('[data-f="title"]') != null) f.title = v('[data-f="title"]');
      if (v('[data-f="hint"]') != null) f.hint = v('[data-f="hint"]');
      for (const inp of this.$$('[data-opt]')) f.options[Number(inp.dataset.opt)] = inp.value;
      for (const c of this.$$('[data-c]')) f[c.dataset.c] = c.checked;
      for (const r of this.$$('[data-r]')) if (r.checked) f[r.dataset.r] = r.value;
      const pe = this.$('[data-prompt]');
      if (pe) f.prompt = pe.value;
      if (this.$('[data-ml]')) f.meeting = { label: v('[data-ml]') || '', date: v('[data-md]') || '' };
    }
    if (this.$('[data-search]')) this._q = v('[data-search]') || '';
  }

  redraw() {
    const body = this.$('.body');
    const top = body ? body.scrollTop : 0;
    const was = this.$('dialog');
    if (!was) { this.draw(); return; }
    const msg = this.$('[data-msg]')?.innerHTML || '';
    body.innerHTML = this._mode === 'access' ? this.accessHtml() : this.formHtml();
    this.wire();
    const m = this.$('[data-msg]');
    if (m) m.innerHTML = msg;
    this.$('.body').scrollTop = top;
  }

  async loadMembers() {
    if (this._members) return;
    if (typeof this.client?.communityMembers !== 'function') { this._members = { error: 'The member list is for superadmins.' }; return; }
    try {
      const r = await this.client.communityMembers();
      this._members = { list: r.members || [] };
    } catch (e) {
      this._members = { error: e?.message || 'The member list could not be read. Try again in a moment.' };
    }
    if (this._f?.access?.mode === 'chosen') { this.capture(); this.redraw(); }
  }

  say(text, bad = false) { const el = this.$('[data-msg]'); if (el) el.innerHTML = text ? `<span class="${bad ? 'bad' : 'ok'}" role="status">${esc(text)}</span>` : ''; }

  // ---- prompt images -----------------------------------------------------------------------------------------

  async addPromptFiles(files) {
    for (const f of files) {
      const problem = uploadProblem({ name: f.name, size: f.size, type: f.type });
      if (problem) { this._f.images.push({ name: f.name, state: 'error', problem }); continue; }
      const preview = await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(String(r.result || '')); r.onerror = () => resolve(''); r.readAsDataURL(f); });
      // The bytes wait here until the entry exists (a new entry is created first, then its images are uploaded).
      this._f.images.push({ name: f.name, size: f.size, preview, dataBase64: preview, state: 'pending' });
    }
    this.redraw();
  }

  async uploadPending(id) {
    for (const img of this._f.images) {
      if (img.state !== 'pending') continue;
      img.state = 'up';
      const r = await this.client.communityUploadImage(id, { name: img.name, dataBase64: img.dataBase64 });
      img.id = r.id;
      img.state = 'ready';
    }
    return this._f.images.filter((i) => i.state === 'ready' && i.id).map((i) => i.id);
  }

  // ---- saving ------------------------------------------------------------------------------------------------

  input() {
    const f = this._f;
    const settings = f.kind === 'poll' ? { changeable: f.changeable, publishOnClose: f.publishOnClose }
      : f.kind === 'typed' ? { changeable: f.changeable, publishOnClose: f.publishOnClose, hint: f.hint, answerLength: f.answerLength, countMatching: f.countMatching }
        : { imagesAllowed: f.imagesAllowed };
    return {
      kind: f.kind, title: f.title, prompt: f.kind === 'topic' ? f.prompt : '', options: f.kind === 'poll' ? f.options.filter((o) => String(o).trim()) : [],
      settings, meeting: f.meeting, access: this.accessInput(),
    };
  }

  accessInput() {
    const a = this._f.access;
    return { mode: a.mode, members: a.mode === 'chosen' ? a.members.map((m) => m.githubId) : [], logins: Object.fromEntries(a.members.map((m) => [m.githubId, m.username || ''])) };
  }

  async save(how) {
    if (this._saving) return; // one save at a time, whatever fires the click
    this.capture();
    if (this._f.access?.mode === 'chosen' && !this._f.access.members.length) { this.say('Pick at least one member, or share it with all members.', true); return; }
    this._saving = true;
    for (const b of this.$$('[data-save]')) b.disabled = true;
    this.say('Saving');
    try {
      let id = this._entry?.id;
      if (how === 'access') {
        await this.client.communityAdmin('access', { id, access: this.accessInput() });
      } else if (how === 'edit') {
        const promptImages = this._f.kind === 'topic' ? await this.uploadPending(id) : undefined;
        await this.client.communityAdmin('edit', { id, input: { ...this.input(), ...(promptImages ? { promptImages } : {}) } });
      } else {
        const pending = this._f.kind === 'topic' && this._f.images.some((i) => i.state === 'pending');
        const r = await this.client.communityAdmin('create', { input: this.input(), open: how === 'open' && !pending });
        id = r.id;
        if (pending) {
          const promptImages = await this.uploadPending(id);
          await this.client.communityAdmin('edit', { id, input: { ...this.input(), promptImages } });
          if (how === 'open') await this.client.communityAdmin('open', { id });
        }
      }
      this.emit('community-saved', { id });
      this.close();
    } catch (e) {
      this._saving = false;
      for (const b of this.$$('[data-save]')) b.disabled = false;
      this.say(e?.message || 'That was not saved. Try again.', true);
    }
  }
}

define('gbti-community-editor', GbtiCommunityEditor);
export { GbtiCommunityEditor, meetingText };
