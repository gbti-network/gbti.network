// <gbti-syndicate-now> (SOW-088): the superadmin "Manually Syndicate" control in the reader sidebar. A
// button (rendered ONLY for a superadmin; the Worker is the real boundary) opens a modal: step 1 pick the
// destination (Discord, Reddit pending, X, Bluesky, LinkedIn, Mastodon), step 2 edit the stored per-type
// template with a LIVE preview (the SAME pure renderTemplate the Worker uses, so preview equals post),
// pick the Discord channel (real names, PRE-selected from the item's category mapping), then publish via
// POST /api/syndicate-now (direct post + a tracker record). A prior send shows a warning line but never
// blocks (owner-decided: re-shares are sometimes the point).
//
// Attributes: data-gbti-type (post|product|prompt|share), data-gbti-slug (share: "<author>/<id>"),
// data-gbti-author, data-gbti-title, data-gbti-url (absolute), data-gbti-category (RAW top-level taxonomy
// key or a share's flat topic), data-gbti-image (optional).
import { GbtiElement, define, esc } from '../base.mjs';
import { renderTemplate } from '../../../membership/syndication-format.mjs';
import { channelForCategoryPath } from '../../../membership/news-channels.mjs';

const DEST_LABEL = { discord: 'Discord', reddit: 'Reddit', x: 'X', bluesky: 'Bluesky', linkedin: 'LinkedIn', mastodon: 'Mastodon' };

const CSS = `
  :host { display:block; }
  .snbtn { display:block; width:100%; font:inherit; font-weight:700; font-size:13px; padding:9px 14px; border:1.5px solid var(--line); border-radius:0; background:var(--panel); color:var(--fg); cursor:pointer; margin:0 0 14px; }
  .snbtn:hover { border-color:var(--accent); color:var(--accent); }
  .overlay { position:fixed; inset:0; background:rgba(10,12,11,.62); z-index:60; display:flex; align-items:center; justify-content:center; }
  .panel { width:min(560px, calc(100% - 32px)); max-height:calc(100vh - 48px); overflow-y:auto; background:var(--bg, #16181a); color:var(--fg); border:1.5px solid var(--line); border-radius:12px; padding:18px 20px; }
  .panel h3 { margin:0 0 4px; font-family:var(--font-display, var(--font-body)); font-size:17px; }
  .sub { color:var(--muted); font-size:12.5px; margin:0 0 14px; }
  .tiles { display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; }
  .tile { font:inherit; font-weight:700; font-size:13px; padding:14px 10px; border:1.5px solid var(--line); border-radius:10px; background:var(--panel); color:var(--fg); cursor:pointer; text-align:center; }
  .tile:hover:not([disabled]) { border-color:var(--accent); color:var(--accent); }
  .tile[disabled] { opacity:.45; cursor:default; }
  .tile .why { display:block; font-weight:400; font-size:10.5px; color:var(--muted); margin-top:4px; }
  label { display:block; font-size:12px; font-weight:600; color:var(--muted); margin:12px 0 4px; }
  textarea, select { width:100%; box-sizing:border-box; font:inherit; font-size:13px; padding:8px 10px; border:1.5px solid var(--line); border-radius:8px; background:var(--panel); color:var(--fg); }
  textarea { min-height:74px; font-family:var(--font-mono, monospace); font-size:12.5px; }
  .preview { border:1.5px dashed var(--line); border-radius:8px; padding:10px 12px; font-size:13px; white-space:pre-wrap; word-break:break-word; background:var(--hover, rgba(0,0,0,.15)); }
  .warn { color:#d8a13d; font-size:12.5px; margin-top:10px; }
  .err { color:#e06c6c; font-size:12.5px; margin-top:10px; }
  .okmsg { color:var(--accent); font-size:13px; margin-top:10px; }
  .okmsg a { color:var(--accent); }
  .actions { display:flex; justify-content:space-between; align-items:center; gap:10px; margin-top:16px; }
  .go { font:inherit; font-weight:700; font-size:13.5px; padding:9px 18px; border:0; border-radius:10px; background:var(--brand); color:#fff; cursor:pointer; }
  .go[disabled] { opacity:.55; cursor:default; }
  .ghost { font:inherit; font-size:13px; padding:8px 14px; border:1.5px solid var(--line); border-radius:10px; background:transparent; color:var(--muted); cursor:pointer; }
  .ghost:hover { color:var(--fg); }
  .spin { display:inline-block; width:12px; height:12px; border:2px solid currentColor; border-right-color:transparent; border-radius:50%; animation:sn-spin .7s linear infinite; vertical-align:-1px; margin-right:7px; }
  @keyframes sn-spin { to { transform:rotate(360deg); } }
`;

class GbtiSyndicateNow extends GbtiElement {
  render() {
    if (!this.client) { this.set(''); return; }
    if (this._role === undefined && !this._loading) { this._loading = true; this._gate(); }
    if (this._role !== 'superadmin') { this.set(''); return; }
    this.set(this.css(CSS) + `<button class="snbtn" type="button">Manually Syndicate</button>${this._open ? this._modalHtml() : ''}`);
    this.on('.snbtn', 'click', () => { this._open = true; this._step = 'dest'; this._result = null; this._err = null; this.render(); this._loadInfo(); });
    if (this._open) this._wireModal();
  }

  async _gate() {
    try { this._role = (await this.client.status())?.role || 'member'; }
    catch { this._role = 'member'; }
    this._loading = false;
    this.render();
  }

  _item() {
    const d = this.dataset || {};
    return {
      source: d.gbtiType || '',
      targetSlug: d.gbtiSlug || '',
      targetType: d.gbtiType || '',
      author: d.gbtiAuthor || '',
      title: d.gbtiTitle || '',
      url: d.gbtiUrl || '',
      image: d.gbtiImage || undefined,
      category: d.gbtiCategory || undefined,
      categoryPath: d.gbtiCategoryPath ? d.gbtiCategoryPath.split(',').filter(Boolean) : undefined, // SOW-088: leaf-first routing
      authorDiscord: d.gbtiDiscord || undefined, // SOW-088: the public profile Discord handle
      visibility: 'public',
    };
  }

  async _loadInfo() {
    try {
      const [info, queue] = await Promise.all([
        this.client.getSyndicateNow(),
        this.client.syndicationQueue().catch(() => null),
      ]);
      this._info = info;
      const key = `${this._item().source}:${this._item().targetSlug}`;
      const prior = [...(queue?.sent ?? []), ...(queue?.failed ?? [])].filter((it) => (it.id || '').startsWith(key + '#'));
      this._prior = prior.filter((it) => it.status === 'sent');
    } catch (err) {
      this._err = err?.message || 'Could not load the syndication destinations.';
    }
    this.render();
  }

  _modalHtml() {
    const body = !this._info && !this._err
      ? `<p class="sub"><span class="spin"></span>Loading destinations…</p>`
      : this._err && !this._info
        ? `<p class="err">${esc(this._err)}</p>`
        : this._step === 'dest' ? this._destHtml() : this._composeHtml();
    return `<div class="overlay" data-overlay><div class="panel">
      <h3>Manually Syndicate</h3>
      <p class="sub">${esc(this._item().title || this._item().targetSlug)}</p>
      ${body}
    </div></div>`;
  }

  _destHtml() {
    const tiles = (this._info?.destinations ?? []).map((d) => {
      const label = DEST_LABEL[d.id] || d.id;
      return d.ready
        ? `<button class="tile" type="button" data-dest="${esc(d.id)}">${esc(label)}</button>`
        : `<button class="tile" type="button" disabled>${esc(label)}<span class="why">${esc(d.reason || 'not available')}</span></button>`;
    }).join('');
    const prior = this._prior?.length
      ? `<p class="warn">Already syndicated ${this._prior.length === 1 ? 'once' : `${this._prior.length} times`} (last: ${esc(new Date(Math.max(...this._prior.map((p) => p.sentAt || p.enqueuedAt || 0))).toLocaleString())}). Publishing again posts a duplicate.</p>`
      : '';
    return `<label>Destination</label><div class="tiles">${tiles}</div>${prior}
      <div class="actions"><button class="ghost" type="button" data-close>Cancel</button><span></span></div>`;
  }

  _composeHtml() {
    const dest = this._dest;
    const item = this._item();
    const template = this._template ?? (this._info?.templates?.[item.source] || '{title} {url}');
    const preview = renderTemplate(template, item, { limit: 2000 });
    let channelRow = '';
    if (dest === 'discord') {
      const groups = new Map();
      for (const c of this._channels || []) {
        const sec = c.section || 'Channels';
        if (!groups.has(sec)) groups.set(sec, []);
        groups.get(sec).push(c);
      }
      const selected = this._channelId || '';
      const opts = [...groups.entries()].map(([sec, list]) =>
        `<optgroup label="${esc(sec)}">${list.map((c) => `<option value="${esc(c.id)}"${c.id === selected ? ' selected' : ''}>#${esc(c.name)}</option>`).join('')}</optgroup>`).join('');
      // When the name list is unavailable the picker degrades to a manual channel-id input, never a dead end.
      const fwdSelected = this._forwardId ?? '';
      const fwdOpts = `<option value=""${fwdSelected ? '' : ' selected'}>Do not forward</option>` + [...groups.entries()].map(([sec, list]) =>
        `<optgroup label="${esc(sec)}">${list.map((c) => `<option value="${esc(c.id)}"${c.id === fwdSelected ? ' selected' : ''}>#${esc(c.name)}</option>`).join('')}</optgroup>`).join('');
      const preNote = this._preselectedNote === 'featured'
        ? ` <span style="font-weight:400">(pre-selected: the featured ${esc(item.source)} channel)</span>`
        : this._preselectedNote === 'category' ? ` <span style="font-weight:400">(pre-selected from the ${esc(item.category || '')} category)</span>` : '';
      channelRow = opts
        ? `<label>Channel${preNote}</label>
          <select data-channel>${opts}</select>
          <label>Forward to <span style="font-weight:400">(a secondary channel gets the Discord FORWARD of the original post${this._forwardNote ? `; pre-selected from the deepest mapped category` : ''})</span></label>
          <select data-forward>${fwdOpts}</select>`
        : `<label>Channel id <span style="font-weight:400">(the channel list did not load${this._chErr ? `: ${esc(this._chErr)}` : ''}; paste the Discord channel id)</span></label>
          <input data-channel-manual type="text" inputmode="numeric" placeholder="e.g. 1180150623346372638" value="${esc(this._channelId || '')}" style="width:100%;box-sizing:border-box;font:inherit;font-size:13px;padding:8px 10px;border:1.5px solid var(--line);border-radius:8px;background:var(--panel);color:var(--fg)" />`;
    }
    const prior = this._prior?.length ? `<p class="warn">This item already went out (${this._prior.length === 1 ? 'once' : `${this._prior.length} times`}). Publishing again posts a duplicate.</p>` : '';
    const fwdState = this._result?.forwarded
      ? (this._result.forwarded.error ? ` Forward failed: ${esc(this._result.forwarded.error)}.` : ' Forwarded to the secondary channel.')
      : '';
    const result = this._result
      ? `<p class="okmsg">Posted.${this._result.url ? ` <a href="${esc(this._result.url)}" target="_blank" rel="noopener">Open the post</a>` : ''}${fwdState}</p>`
      : '';
    return `<label>Destination</label><p class="sub" style="margin:0">${esc(DEST_LABEL[dest] || dest)} <button class="ghost" type="button" data-back style="padding:2px 10px;font-size:11.5px;margin-left:8px">change</button></p>
      <label>Message template <span style="font-weight:400">({title} {url} {content-type} {member-discord-username} {author} {fullName} {category})</span></label>
      <textarea data-template>${esc(template)}</textarea>
      <label>Preview</label>
      <div class="preview" data-preview>${esc(preview)}</div>
      ${channelRow}${prior}${this._err ? `<p class="err">${esc(this._err)}</p>` : ''}${result}
      <div class="actions">
        <button class="ghost" type="button" data-close>${this._result ? 'Done' : 'Cancel'}</button>
        <button class="go" type="button" data-publish ${this._busy || this._result ? 'disabled' : ''}>${this._busy ? '<span class="spin"></span>Publishing...' : 'Publish'}</button>
      </div>`;
  }

  _wireModal() {
    this.on('[data-close]', 'click', () => { this._open = false; this._template = null; this._err = null; this.render(); });
    this.on('[data-back]', 'click', () => { this._step = 'dest'; this._err = null; this._result = null; this.render(); });
    this.$$('[data-dest]').forEach((b) => b.addEventListener('click', () => this._pickDest(b.dataset.dest)));
    const ta = this.$('[data-template]');
    if (ta) ta.addEventListener('input', () => {
      this._template = ta.value;
      const pv = this.$('[data-preview]');
      if (pv) pv.textContent = renderTemplate(ta.value, this._item(), { limit: 2000 });
    });
    const sel = this.$('[data-channel]');
    if (sel) sel.addEventListener('change', () => { this._channelId = sel.value; });
    const manual = this.$('[data-channel-manual]');
    if (manual) manual.addEventListener('input', () => { this._channelId = manual.value.trim(); });
    const fwd = this.$('[data-forward]');
    if (fwd) fwd.addEventListener('change', () => { this._forwardId = fwd.value; });
    this.on('[data-publish]', 'click', () => this._publish());
  }

  async _pickDest(dest) {
    this._dest = dest;
    this._step = 'compose';
    this._err = null;
    this._result = null;
    if (dest === 'discord' && !this._channels) {
      try {
        const r = await this.client.discordChannels();
        const all = r?.channels ?? [];
        const sections = new Map(all.filter((c) => c.type === 4).map((c) => [c.id, c.name]));
        this._channels = all
          .filter((c) => c.type === 0 || c.type === 5)
          .map((c) => ({ ...c, section: sections.get(c.parentId) || 'Channels' }));
        this._chErr = null;
      } catch (err) { this._channels = []; this._chErr = err?.message || 'request failed'; }
      // Owner-decided default: the per-type FEATURED channel (#prompts for a prompt, etc.); the
      // category-mapped channel stays one click away in the same picker.
      // Leaf-first: the deepest mapped key on the item's full taxonomy path wins (skill -> #devops beats
      // the broad ai row), so per-leaf mappings set in the categories workspace drive the forward default.
      const it0 = this._item();
      const mapped = channelForCategoryPath({ channels: this._info?.channelMap ?? [] }, it0.categoryPath?.length ? it0.categoryPath : [it0.category]);
      const featured = this._info?.featured?.[this._item().source] || null;
      this._channelId = featured || mapped || this._channels[0]?.id || '';
      this._preselectedNote = featured ? 'featured' : (mapped ? 'category' : '');
      // The secondary FORWARD defaults to the category-mapped channel when it differs from the primary.
      this._forwardId = mapped && mapped !== this._channelId ? mapped : '';
      this._forwardNote = Boolean(this._forwardId);
    }
    this.render();
  }

  async _publish() {
    const item = this._item();
    const template = (this._template ?? (this._info?.templates?.[item.source] || '{title} {url}')).trim();
    if (!template) { this._err = 'A message template is required.'; this.render(); return; }
    this._busy = true; this._err = null; this.render();
    try {
      const payload = { destination: this._dest, item, template };
      if (this._dest === 'discord') {
        payload.channelId = this._channelId;
        if (this._forwardId && this._forwardId !== this._channelId) payload.forwardChannelId = this._forwardId;
      }
      this._result = await this.client.syndicateNow(payload);
      this._prior = [...(this._prior || []), { status: 'sent', sentAt: Date.now() }];
    } catch (err) {
      this._err = err?.message || 'The post failed.';
    }
    this._busy = false;
    this.render();
  }
}

define('gbti-syndicate-now', GbtiSyndicateNow);
export { GbtiSyndicateNow };
