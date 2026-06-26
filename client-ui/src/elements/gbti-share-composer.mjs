// <gbti-share-composer> (SOW-018): the extension-only authoring surface for member "Shares" (status updates).
// Shares are NOT a public website experience; this composer lives in the GBTI client/extension. It encodes the
// access model directly from client.status().membership:
//   - paid           -> the full composer (note + optional link + visibility), posts via client.postShare()
//   - trialing       -> read-only notice: a trial may READ the community Shares stream but posting is paid
//   - expired/cancelled/none/banned (Locked) -> a lock splash (renew to rejoin); no composer
//   - unknown        -> show the composer optimistically (the oracle is down; publishShare + the gate are the
//                       real authority and will reject a genuinely non-paid post)
// The host holds the GitHub token; this element only calls the injected client.
import { GbtiElement, define, esc } from '../base.mjs';

const LOCKED = new Set(['expired', 'cancelled', 'none', 'banned']);

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:16px; }
  h3 { margin:0 0 4px; font-family:var(--font-display, var(--font-body)); font-size:16px; }
  .sub { margin:0 0 12px; font-size:13px; color:var(--muted); }
  textarea { width:100%; box-sizing:border-box; min-height:84px; resize:vertical; font:inherit; font-size:14px;
    padding:10px 12px; border:1.5px solid var(--line); border-radius:10px; background:var(--panel); color:var(--fg); }
  textarea:focus { outline:none; border-color:var(--brand); }
  input.title, input.desc { width:100%; box-sizing:border-box; font:inherit; padding:9px 12px; margin-bottom:8px;
    border:1.5px solid var(--line); border-radius:10px; background:var(--panel); color:var(--fg); }
  input.title { font-size:15px; font-weight:700; }
  input.desc { font-size:13px; }
  input.title:focus, input.desc:focus { outline:none; border-color:var(--brand); }
  .row { display:flex; gap:8px; margin-top:8px; flex-wrap:wrap; align-items:center; }
  input[type=url] { flex:1; min-width:160px; box-sizing:border-box; font:inherit; font-size:13px; padding:8px 10px;
    border:1.5px solid var(--line); border-radius:10px; background:var(--panel); color:var(--fg); }
  select { font:inherit; font-size:13px; padding:8px 10px; border:1.5px solid var(--line); border-radius:10px; background:var(--panel); color:var(--fg); }
  .actions { display:flex; justify-content:flex-end; align-items:center; gap:10px; margin-top:12px; }
  button.post { font:inherit; font-weight:700; font-size:14px; padding:9px 18px; border:0; border-radius:10px; background:var(--brand); color:#fff; cursor:pointer; }
  button.post[disabled] { opacity:.5; cursor:default; }
  .msg { font-size:13px; }
  .msg.err { color:#c0392b; }
  .msg.ok { color:var(--brand); }
  .notice { display:flex; gap:12px; align-items:flex-start; padding:16px; border:1.5px dashed var(--line); border-radius:12px; background:var(--hover, rgba(0,0,0,.03)); }
  .notice h3 { margin-bottom:2px; }
  .notice a { color:var(--brand); font-weight:600; }
  .lock { font-size:22px; line-height:1; }
  .busy { opacity:.55; pointer-events:none; }
  .og { margin-top:10px; }
  .og .ogmsg { font-size:12.5px; color:var(--muted); }
  .og .ogimg { display:block; max-width:100%; max-height:200px; object-fit:cover; border-radius:10px; border:1px solid var(--line); }
  .og .ogclear { margin-top:6px; font:inherit; font-size:12px; background:none; border:0; color:var(--muted); cursor:pointer; padding:0; }
  .og .ogclear:hover { color:var(--brand); text-decoration:underline; }
`;

class GbtiShareComposer extends GbtiElement {
  connectedCallback() {
    super.connectedCallback();
    this._loadStatus();
  }

  async _loadStatus() {
    if (!this.client) { this._membership = null; this.render(); return; }
    try {
      const s = await this.client.status();
      this._membership = s?.membership ?? 'unknown';
    } catch {
      this._membership = 'unknown';
    }
    this.render();
  }

  render() {
    const m = this._membership;
    if (!this.client) return this.set(this.css(CSS) + this._noticeHtml('Open in the GBTI client', 'Shares are posted from the GBTI browser extension or the desktop client. Open it to share an update.', '🧩'));
    if (m === undefined) return this.set(this.css(CSS) + `<div class="card"><p class="sub">Loading…</p></div>`);
    if (LOCKED.has(m)) return this._renderLocked();
    if (m === 'trialing') return this._renderTrial();
    return this._renderComposer(); // paid or unknown
  }

  _noticeHtml(title, body, glyph) {
    return `<div class="notice"><span class="lock">${glyph}</span><div><h3>${esc(title)}</h3><p class="sub" style="margin:0">${body}</p></div></div>`;
  }

  _renderLocked() {
    this.set(this.css(CSS) + this._noticeHtml(
      'Your access is locked',
      'Your membership has lapsed, so Shares are locked. <a href="https://gbti.network/membership/">Renew your membership</a> to read and post in the community stream again.',
      '🔒',
    ));
  }

  _renderTrial() {
    this.set(this.css(CSS) + this._noticeHtml(
      'Reading only on the free trial',
      'On the trial you can READ the community Shares stream. Posting Shares requires a paid membership. <a href="https://gbti.network/membership/">Upgrade to a paid membership</a> to post.',
      '👀',
    ));
  }

  _renderComposer() {
    this.set(this.css(CSS) + `
      <div class="card">
        <h3>Share an update</h3>
        <p class="sub">A short note or an off-network link for the co-op. Members-only by default.</p>
        <input class="title" type="text" placeholder="Title (optional)" maxlength="80" />
        <input class="desc" type="text" placeholder="Short description (optional)" maxlength="200" />
        <textarea placeholder="What are you reading, building, or finding?" maxlength="4000"></textarea>
        <div class="row">
          <input type="url" placeholder="https://… (optional link)" />
          <select aria-label="Visibility">
            <option value="members">Members only</option>
            <option value="public">Public</option>
          </select>
        </div>
        <div class="og" data-og hidden></div>
        <div class="actions">
          <span class="msg" aria-live="polite"></span>
          <button class="post" type="button">Post Share</button>
        </div>
      </div>`);
    this._image = null;
    this.on('.post', 'click', () => this._post());
    // SOW-057: fetch the link's OpenGraph preview on blur/enter so we can attach a featured image + soft-prefill.
    this.on('input[type=url]', 'change', () => this._fetchPreview());
  }

  // Fetch the link preview server-side (the Worker is SSRF-guarded). Updates ONLY the preview area + soft-prefills
  // EMPTY title/desc fields (never clobbering author text), so it does not re-render the composer.
  async _fetchPreview() {
    const url = (this.$('input[type=url]')?.value || '').trim();
    const box = this.$('[data-og]');
    if (!box) return;
    if (!/^https?:\/\//i.test(url) || !this.client?.ogPreview) { this._image = null; box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = `<span class="ogmsg">Fetching preview…</span>`;
    try {
      const og = await this.client.ogPreview({ url });
      const t = this.$('input.title'); if (t && !t.value.trim() && og?.title) t.value = String(og.title).slice(0, 80);
      const d = this.$('input.desc'); if (d && !d.value.trim() && og?.description) d.value = String(og.description).slice(0, 200);
      this._image = og?.image || null;
      if (this._image) {
        box.innerHTML = `<img class="ogimg" src="${esc(this._image)}" alt="" /><button class="ogclear" type="button" data-ogclear>Remove image</button>`;
        const clr = box.querySelector('[data-ogclear]');
        if (clr) clr.addEventListener('click', () => { this._image = null; box.hidden = true; box.innerHTML = ''; });
      } else { box.hidden = true; box.innerHTML = ''; }
    } catch { this._image = null; box.hidden = true; box.innerHTML = ''; }
  }

  async _post() {
    const card = this.$('.card');
    const title = (this.$('input.title')?.value || '').trim();
    const shortDescription = (this.$('input.desc')?.value || '').trim();
    const body = (this.$('textarea')?.value || '').trim();
    const url = (this.$('input[type=url]')?.value || '').trim();
    const visibility = this.$('select')?.value || 'members';
    const msg = this.$('.msg');
    if (!body && !url && !title) { this._say(msg, 'Add a title, a note, or a link first.', 'err'); return; }
    card?.classList.add('busy');
    try {
      const input = { visibility };
      if (title) input.title = title;
      if (shortDescription) input.shortDescription = shortDescription;
      if (url) input.url = url;
      if (this._image) input.image = this._image; // SOW-057: the featured image (OG-fetched, author-clearable)
      const res = await this.client.postShare({ input, body });
      this._say(msg, res?.encrypted ? 'Posted (members-only).' : 'Posted.', 'ok');
      for (const sel of ['input.title', 'input.desc', 'textarea', 'input[type=url]']) { const el = this.$(sel); if (el) el.value = ''; }
      this._image = null;
      const ogBox = this.$('[data-og]'); if (ogBox) { ogBox.hidden = true; ogBox.innerHTML = ''; }
      this.emit('gbti-share-posted', res);
    } catch (err) {
      if (err?.code === 'membership-required') {
        this._say(msg, 'Posting Shares requires a paid membership.', 'err');
      } else {
        this._say(msg, err?.message || 'Could not post the Share.', 'err');
      }
    } finally {
      card?.classList.remove('busy');
    }
  }

  _say(el, text, kind) {
    if (!el) return;
    el.textContent = text;
    el.className = `msg ${kind || ''}`;
  }
}

define('gbti-share-composer', GbtiShareComposer);
export { GbtiShareComposer };
