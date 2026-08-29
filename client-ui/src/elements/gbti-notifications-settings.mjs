// <gbti-notifications-settings> (SOW-186 C3): the account "Notifications" surface. Two parts, both host-agnostic
// (they talk ONLY to the injected client): a "Default for everyone you follow" 5x2 matrix bound to the member's
// global prefs (getPrefs/setPrefs {notify}), and a "People you follow" list (getFollows) whose per-follow override
// is edited in the shared <gbti-notify-modal>. Inert in public (no client -> a sign-in nudge). Follows the
// gbti-account load-race pattern (_loaded/_loading, _maybeLoad from render) so it upgrades the moment setClient runs.
import { GbtiElement, define, esc } from '../base.mjs';
import { MATRIX_ROWS, defaultMatrix, matrixToNotify, toggleCell, summarizeFollow, isCustomFollow } from '../notify-matrix-core.mjs';
import { openNotifyModal } from './gbti-notify-modal.mjs';

const SITE = 'https://gbti.network';
const CHANNELS = [
  { key: 'api', label: 'In app' },
  { key: 'email', label: 'Email' },
];

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .sec { background:var(--panel); border:1.5px solid var(--line); border-radius:16px; box-shadow:0 1px 2px rgba(0,0,0,.05); overflow:hidden; margin:0 0 22px; }
  .sec-h { padding:20px 24px 16px; }
  .sec-h h3 { margin:0; font-family:var(--font-display, var(--font-body)); font-weight:700; font-size:20px; letter-spacing:-.005em; }
  .sec-h p { margin:5px 0 0; color:var(--muted); font-size:14px; line-height:1.5; max-width:60ch; }
  .sec-h .cnt { font-family:var(--font-mono, monospace); font-size:12px; color:var(--muted); }
  .rows { border-top:1.5px solid var(--line); }
  /* the default matrix */
  .mrow { display:grid; grid-template-columns:1fr auto auto; gap:12px; align-items:center; padding:14px 24px; }
  .mrow + .mrow { border-top:1px solid var(--line); }
  .mrow .rl { font-weight:600; font-size:15px; }
  .pill { border:1.5px solid var(--line); background:var(--hover); color:var(--muted); border-radius:999px; padding:7px 15px;
    font:inherit; font-weight:600; font-size:12.5px; cursor:pointer; min-width:70px; text-align:center; transition:background .12s ease, color .12s ease, border-color .12s ease; }
  .pill.on { background:var(--brand); border-color:var(--brand); color:#fff; }
  .pill[disabled] { opacity:.6; cursor:default; }
  .note { padding:14px 24px 18px; color:var(--muted); font-size:12.5px; line-height:1.45; }
  .msg { font-size:13px; padding:0 24px 14px; } .msg:empty { padding:0; } .msg.ok { color:var(--green-700, #0f6f40); } .msg.err { color:var(--danger); }
  /* the follows list */
  .frow { display:grid; grid-template-columns:auto 1fr auto auto; gap:14px; align-items:center; padding:14px 24px; width:100%; border:0; background:transparent; color:var(--fg); font:inherit; text-align:left; cursor:pointer; }
  .frow + .frow { border-top:1px solid var(--line); }
  .frow:hover { background:var(--hover); }
  .frow .av { width:38px; height:38px; border-radius:50%; background:var(--hover); object-fit:cover; }
  .frow .ft { min-width:0; }
  .frow .ft .t { font-weight:600; font-size:15px; }
  .frow .ft .d { color:var(--muted); font-size:13px; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .tag { font-family:var(--font-mono, monospace); font-size:10px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; border-radius:999px; padding:3px 9px; background:var(--hover); color:var(--muted); }
  .tag.custom { background:var(--green-tint, rgba(31,158,95,.12)); color:var(--green-700, #0f6f40); }
  .chev { color:var(--muted); }
  .empty { padding:22px 24px; color:var(--muted); font-size:14px; }
  .empty a { color:var(--brand); font-weight:600; }
  .nudge { padding:18px 20px; border:1.5px dashed var(--line); border-radius:16px; background:var(--panel); font-size:14px; color:var(--muted); }
  .nudge a { color:var(--brand); font-weight:600; }
`;

const CHEV = `<svg class="chev" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

class GbtiNotificationsSettings extends GbtiElement {
  _loaded = false;
  _loading = false;

  _maybeLoad() {
    if (this.client && !this._loaded && !this._loading) { this._loading = true; this._load(); }
  }

  async _load() {
    const guard = (p) => Promise.race([
      Promise.resolve(p).then((v) => v, () => null),
      new Promise((res) => { setTimeout(() => res(null), 8000); }),
    ]);
    try {
      const [prefs, follows] = await Promise.all([guard(this.client.getPrefs?.()), guard(this.client.getFollows?.())]);
      this._global = prefs?.notify;
      this._matrix = defaultMatrix(this._global);
      const list = Array.isArray(follows) ? follows : (follows?.following ?? []);
      this._follows = list.filter((e) => e && e.username).sort((a, b) => a.username.localeCompare(b.username));
      this._prefsOk = !!prefs;
    } catch { /* render whatever resolved */ }
    this._loaded = true; this._loading = false;
    this.render();
  }

  async _reloadFollows() {
    try {
      const follows = await this.client.getFollows?.();
      const list = Array.isArray(follows) ? follows : (follows?.following ?? []);
      this._follows = list.filter((e) => e && e.username).sort((a, b) => a.username.localeCompare(b.username));
    } catch { /* keep the current list */ }
    this.render();
  }

  async _toggleDefault(key, channel) {
    if (!this._prefsOk) return;
    const prev = this._matrix;
    this._matrix = toggleCell(this._matrix, key, channel); // optimistic
    this.render();
    try {
      const prefs = await this.client.setPrefs({ notify: matrixToNotify(this._matrix) });
      if (prefs && prefs.notify) { this._global = prefs.notify; this._matrix = defaultMatrix(prefs.notify); }
      this._say('ok', 'Saved. This applies to everyone you follow unless you set them separately.');
      this.render();
    } catch {
      this._matrix = prev; // revert
      this._say('err', 'Could not save that just now. Try again in a moment.');
      this.render();
    }
  }

  _openFollow(username) {
    openNotifyModal(username, () => this._reloadFollows());
  }

  _say(kind, text) { this._msg = { kind, text }; }

  render() {
    this._maybeLoad();
    if (!this.client) { this.set(this.css(CSS) + `<div class="nudge">Open this in the GBTI client or extension to manage notifications. <a href="${SITE}/membership/">Become a member</a>.</div>`); return; }
    if (!this._loaded) { this.set(this.css(CSS) + `<section class="sec"><div class="sec-h"><p style="margin:0">Loading your notifications…</p></div></section>`); return; }

    const matrix = this._matrix || defaultMatrix(this._global);
    const matrixRows = MATRIX_ROWS.map((r) => {
      const cell = matrix[r.key] || {};
      const pills = CHANNELS.map((c) => `<button type="button" class="pill${cell[c.key] ? ' on' : ''}" data-cell="${r.key}:${c.key}" aria-pressed="${!!cell[c.key]}" ${this._prefsOk ? '' : 'disabled'}>${esc(c.label)}</button>`).join('');
      return `<div class="mrow"><div class="rl">${esc(r.label)}</div>${pills}</div>`;
    }).join('');

    const follows = this._follows || [];
    const customCount = follows.filter((f) => isCustomFollow(f)).length;
    const listHtml = follows.length
      ? follows.map((f) => {
          const u = esc(f.username);
          const custom = isCustomFollow(f);
          return `<button type="button" class="frow" data-follow="${u}">
            <img class="av" src="https://github.com/${u}.png?size=76" alt="" width="38" height="38" loading="lazy" />
            <span class="ft"><span class="t">@${u}</span><span class="d">${esc(summarizeFollow(f, this._global))}</span></span>
            <span class="tag${custom ? ' custom' : ''}">${custom ? 'Custom' : 'Default'}</span>
            ${CHEV}
          </button>`;
        }).join('')
      : `<div class="empty">You are not following anyone yet. <a href="${SITE}/members/">Find members to follow</a>, then choose what each one sends you here.</div>`;

    const msg = this._msg ? `<div class="msg ${this._msg.kind}" aria-live="polite">${esc(this._msg.text)}</div>` : `<div class="msg" aria-live="polite"></div>`;
    const prefsNote = this._prefsOk ? '' : `<div class="msg err">Could not load your default settings right now. Reopen this page to retry.</div>`;

    this.set(this.css(CSS) + `
      <section class="sec">
        <div class="sec-h"><h3>Default for everyone you follow</h3><p>What arrives when someone you follow publishes. In app is the header bell; email is a single morning digest. These apply to every follow unless you set one separately below.</p></div>
        <div class="rows">${matrixRows}</div>
        <div class="note">Email arrives as one digest each morning, never one message per item.</div>
        ${prefsNote}
        ${msg}
      </section>
      <section class="sec">
        <div class="sec-h"><h3>People you follow</h3><p>Fine-tune what any one member sends you. <span class="cnt">${customCount} of ${follows.length} set separately</span></p></div>
        <div class="rows">${listHtml}</div>
      </section>`);
    this._wire();
  }

  _wire() {
    this.$$('[data-cell]').forEach((el) => el.addEventListener('click', () => { const [k, c] = el.dataset.cell.split(':'); this._toggleDefault(k, c); }));
    this.$$('[data-follow]').forEach((el) => el.addEventListener('click', () => this._openFollow(el.dataset.follow)));
  }
}

define('gbti-notifications-settings', GbtiNotificationsSettings);
export { GbtiNotificationsSettings };
