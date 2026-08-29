// <gbti-notify-modal> (SOW-186 C3): the reusable per-follow notification-preferences modal. Opened imperatively
// (`el.open(username)`) from BOTH the account notifications settings list and the follow control's tune button, so
// "follow someone" and "choose what that follow sends me" are one surface. Host-agnostic: it talks ONLY to the
// injected client (getPrefs for the global default, getFollows for this member's override, setFollow to save the
// per-follow matrix or clear it). Following is a free-tier perk, so no paid gate here; the Worker is the authority.
//
// The model is one global default with a sparse per-follow override (the design's decision). "Use my default"
// saves notify:null (clears the override); "Set separately" saves the full edited matrix. An absent override
// resolves, per channel, to the member's global default and then the system default (in-app on, email off).
import { GbtiElement, define, esc } from '../base.mjs';
import { MATRIX_ROWS, defaultMatrix, resolveMatrix, toggleCell, notifyPayload } from '../notify-matrix-core.mjs';

const CHANNELS = [
  { key: 'api', label: 'In app' },
  { key: 'email', label: 'Email' },
];

const CSS = `
  :host { position:fixed; inset:0; z-index:2147483000; display:none; }
  :host([open]) { display:block; }
  .scrim { position:absolute; inset:0; background:rgba(12,10,16,.55); -webkit-backdrop-filter:blur(2px); backdrop-filter:blur(2px); }
  .card { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:min(460px, calc(100vw - 32px));
    max-height:calc(100vh - 48px); overflow:auto; background:var(--panel); color:var(--fg); border:1.5px solid var(--line);
    border-radius:18px; box-shadow:0 20px 60px rgba(0,0,0,.35); font-family:var(--font-body); }
  .hd { display:flex; align-items:center; gap:12px; padding:18px 20px 14px; border-bottom:1.5px solid var(--line); }
  .hd .av { width:40px; height:40px; border-radius:50%; flex:none; background:var(--hover); object-fit:cover; }
  .hd .mtx { flex:1; min-width:0; }
  .hd .mtx .t { font-weight:700; font-size:16px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .hd .mtx .d { color:var(--muted); font-size:13px; margin-top:2px; }
  .x { border:0; background:transparent; color:var(--muted); cursor:pointer; font-size:20px; line-height:1; padding:6px; border-radius:8px; }
  .x:hover { background:var(--hover); color:var(--fg); }
  .bd { padding:16px 20px; }
  .modes { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin:0 0 16px; }
  .mode { text-align:left; border:1.5px solid var(--line); background:var(--panel); border-radius:12px; padding:12px 13px; cursor:pointer; font:inherit; color:var(--fg); }
  .mode:hover { border-color:var(--accent); }
  .mode.on { border-color:var(--brand); background:var(--green-tint, rgba(31,158,95,.10)); }
  .mode .mt { font-weight:600; font-size:14px; }
  .mode .md { color:var(--muted); font-size:12px; margin-top:3px; line-height:1.4; }
  .grid { border:1.5px solid var(--line); border-radius:12px; overflow:hidden; }
  .grow { display:grid; grid-template-columns:1fr auto auto; gap:10px; align-items:center; padding:11px 14px; }
  .grow + .grow { border-top:1px solid var(--line); }
  .grow .rl { font-weight:600; font-size:14px; }
  .pill { border:1.5px solid var(--line); background:var(--hover); color:var(--muted); border-radius:999px; padding:6px 13px;
    font:inherit; font-weight:600; font-size:12.5px; cursor:pointer; min-width:64px; text-align:center; transition:background .12s ease, color .12s ease, border-color .12s ease; }
  .pill.on { background:var(--brand); border-color:var(--brand); color:#fff; }
  .grid[data-locked] { opacity:.55; }
  .grid[data-locked] .pill { cursor:default; }
  .note { color:var(--muted); font-size:12.5px; margin:12px 2px 0; line-height:1.45; }
  .ft { display:flex; align-items:center; gap:10px; padding:14px 20px 18px; border-top:1.5px solid var(--line); }
  .ft .sp { flex:1; }
  button.act { font:inherit; font-weight:600; font-size:14px; padding:9px 16px; border-radius:10px; border:1.5px solid var(--line); background:var(--panel); color:var(--fg); cursor:pointer; }
  button.act:hover { border-color:var(--accent); color:var(--accent); }
  button.primary { background:var(--brand); border-color:var(--brand); color:#fff; }
  button.primary:hover { background:var(--brand-dark); border-color:var(--brand-dark); color:#fff; }
  button.unfollow { border-color:transparent; color:var(--danger); background:transparent; padding-left:0; }
  button.unfollow:hover { text-decoration:underline; color:var(--danger); }
  button[disabled] { opacity:.6; cursor:default; }
  .msg { font-size:13px; padding:0 20px; color:var(--danger); } .msg:empty { padding:0; }
  .load { padding:34px 20px; text-align:center; color:var(--muted); font-size:14px; }
`;

class GbtiNotifyModal extends GbtiElement {
  static get observedAttributes() { return ['open']; }

  /** Open the modal for one followed member. */
  open(username) {
    const u = String(username || '').trim().toLowerCase();
    if (!/^[a-z0-9](?:-?[a-z0-9])*$/.test(u)) return;
    this._username = u;
    this._loaded = false;
    this._saving = false;
    this._err = '';
    this.setAttribute('open', '');
    this.render();
    this._load();
  }

  close() {
    this.removeAttribute('open');
    this._open = false;
    this.set(this.css(CSS)); // tear the DOM down so nothing lingers behind the scrim
    this.emit('gbti:notify-closed');
  }

  async _load() {
    if (!this.client) { this._err = 'Sign in to manage notifications.'; this._loaded = true; this.render(); return; }
    let global; let follow;
    try {
      const [prefs, follows] = await Promise.all([
        Promise.resolve(this.client.getPrefs?.()).catch(() => null),
        Promise.resolve(this.client.getFollows?.()).catch(() => null),
      ]);
      global = prefs?.notify;
      const list = Array.isArray(follows) ? follows : (follows?.following ?? []);
      follow = list.find((e) => (e?.username || '').toLowerCase() === this._username) || null;
    } catch { /* fall through to defaults */ }
    this._global = global;
    this._following = !!follow;
    this._override = follow?.notify || null;
    this._mode = this._override ? 'custom' : 'default';
    // The editable matrix seeds from the override when custom, else from the resolved global default.
    this._matrix = this._override ? resolveMatrix(this._override, global) : defaultMatrix(global);
    this._loaded = true;
    this.render();
  }

  _setMode(mode) {
    if (this._mode === mode) return;
    // Entering custom from default seeds the grid with the current global default as a starting point.
    if (mode === 'custom' && !this._override) this._matrix = defaultMatrix(this._global);
    this._mode = mode;
    this.render();
  }

  _toggle(key, channel) {
    if (this._mode !== 'custom') return;
    this._matrix = toggleCell(this._matrix, key, channel);
    this.render();
  }

  async _save() {
    if (this._saving) return;
    this._saving = true; this._err = ''; this.render();
    try {
      await this.client.setFollow({ username: this._username, on: true, notify: notifyPayload(this._mode, this._matrix) });
      this.emit('gbti:notify-saved', { username: this._username });
      this.close();
    } catch (err) {
      this._saving = false;
      this._err = /sign in|paid|auth/i.test(err?.message || '') ? 'Sign in to manage notifications.' : 'Could not save that just now. Try again in a moment.';
      this.render();
    }
  }

  async _unfollow() {
    if (this._saving) return;
    this._saving = true; this._err = ''; this.render();
    try {
      await this.client.setFollow({ username: this._username, on: false });
      this.emit('gbti:notify-saved', { username: this._username, unfollowed: true });
      this.close();
    } catch {
      this._saving = false;
      this._err = 'Could not unfollow just now. Try again in a moment.';
      this.render();
    }
  }

  render() {
    if (!this.hasAttribute('open')) { this.set(this.css(CSS)); return; }
    const u = esc(this._username || '');
    const av = `https://github.com/${u}.png?size=80`;
    if (!this._loaded) {
      this.set(this.css(CSS) + `<div class="scrim" data-close></div><div class="card" role="dialog" aria-modal="true" aria-label="Notification preferences"><div class="load">Loading preferences…</div></div>`);
      this._wire();
      return;
    }
    const custom = this._mode === 'custom';
    // In default mode the grid shows the resolved global default (read-only); in custom it shows the editable matrix.
    const shown = custom ? this._matrix : defaultMatrix(this._global);
    const rowHtml = MATRIX_ROWS.map((r) => {
      const cell = shown[r.key] || {};
      const pills = CHANNELS.map((c) => `<button type="button" class="pill${cell[c.key] ? ' on' : ''}" data-cell="${r.key}:${c.key}" aria-pressed="${!!cell[c.key]}">${esc(c.label)}</button>`).join('');
      return `<div class="grow"><div class="rl">${esc(r.label)}</div>${pills}</div>`;
    }).join('');
    const modeCard = (mode, t, d) => `<button type="button" class="mode${this._mode === mode ? ' on' : ''}" data-mode="${mode}"><div class="mt">${t}</div><div class="md">${d}</div></button>`;
    this.set(this.css(CSS) + `
      <div class="scrim" data-close></div>
      <div class="card" role="dialog" aria-modal="true" aria-label="Notification preferences for ${u}">
        <div class="hd">
          <img class="av" src="${av}" alt="" width="40" height="40" loading="lazy" />
          <div class="mtx"><div class="t">@${u}</div><div class="d">What this follow sends you</div></div>
          <button class="x" type="button" data-close aria-label="Close">&times;</button>
        </div>
        <div class="bd">
          <div class="modes">
            ${modeCard('default', 'Use my default', 'Follow whatever your default settings send.')}
            ${modeCard('custom', 'Set separately', 'Choose exactly what this one member sends you.')}
          </div>
          <div class="grid"${custom ? '' : ' data-locked'}>${rowHtml}</div>
          <div class="note">Email arrives as one digest each morning, never one message per item.</div>
        </div>
        <div class="msg" aria-live="polite">${esc(this._err || '')}</div>
        <div class="ft">
          <button class="act unfollow" type="button" data-unfollow ${this._saving ? 'disabled' : ''}>Unfollow</button>
          <span class="sp"></span>
          <button class="act" type="button" data-close ${this._saving ? 'disabled' : ''}>Cancel</button>
          <button class="act primary" type="button" data-save ${this._saving ? 'disabled' : ''}>${this._saving ? 'Saving…' : 'Update preferences'}</button>
        </div>
      </div>`);
    this._wire();
  }

  _wire() {
    this.$$('[data-close]').forEach((el) => el.addEventListener('click', () => this.close()));
    this.$$('[data-mode]').forEach((el) => el.addEventListener('click', () => this._setMode(el.dataset.mode)));
    this.$$('[data-cell]').forEach((el) => el.addEventListener('click', () => { const [k, c] = el.dataset.cell.split(':'); this._toggle(k, c); }));
    this.on('[data-save]', 'click', () => this._save());
    this.on('[data-unfollow]', 'click', () => this._unfollow());
    if (!this._escBound) { this._escBound = (e) => { if (e.key === 'Escape' && this.hasAttribute('open')) this.close(); }; document.addEventListener('keydown', this._escBound); }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._escBound) { document.removeEventListener('keydown', this._escBound); this._escBound = null; }
  }
}

define('gbti-notify-modal', GbtiNotifyModal);
export { GbtiNotifyModal };

/** Open THE single page-level modal for `username`, creating it once on document.body. Both the account
 *  settings list and the follow control's tune button call this, so a re-render of either host never tears
 *  down an open modal. `onSaved(detail)` fires once per save/unfollow so the caller can refresh its own view. */
export function openNotifyModal(username, onSaved) {
  if (typeof document === 'undefined') return;
  let modal = document.querySelector('gbti-notify-modal');
  if (!modal) { modal = document.createElement('gbti-notify-modal'); document.body.appendChild(modal); }
  if (typeof onSaved === 'function') {
    const handler = (e) => { try { onSaved(e.detail); } finally { modal.removeEventListener('gbti:notify-saved', handler); } };
    modal.addEventListener('gbti:notify-saved', handler);
  }
  modal.open(username);
}
