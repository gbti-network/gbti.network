// <gbti-site-settings-manager> (sow-271): the SUPERADMIN site-wide presentation toggles. Reads the resolved
// toggles from house/site-settings.yml (client.siteSettings) and flips each one via the admin ops, which open an
// auto-merged house PR (the SOW-038 governance model; the host token never leaves the host and the SOW-005 gate
// is the real boundary). A sibling of <gbti-quote-manager>, deliberately the same shape.
//
// TWO things this component says out loud, because both have surprised people:
//   1. A flip is NOT instant. It lands as a PR and goes live on the next Pages deploy, roughly three minutes.
//      The switch showing the new position while the site still shows the old one is expected, not a bug.
//   2. Each toggle carries its registry description, which states what it does NOT govern. The extension CTA
//      switch hides adverts and leaves the "Extension required" capability notices alone; someone expecting it
//      to remove every mention of the extension should read that before filing it as broken.
// Inert in public (no injected client). Host-agnostic.
import { GbtiElement, define, esc } from '../base.mjs';
import { submitAck } from '../workspace-core.mjs'; // SOW-072 P2: the one consistent submit acknowledgement

const CSS = `
  :host { display:block; }
  .hint { font-size:12.5px; color:var(--muted); }
  .msg { font-size:13px; color:var(--accent); margin:0 0 12px; }
  .busy { opacity:.55; pointer-events:none; }
  .list { list-style:none; margin:0; padding:0; }
  .s { border-top:1px solid var(--line); }
  .s:first-child { border-top:0; }
  .row { display:flex; align-items:flex-start; gap:12px; padding:12px 2px; }
  .tx { flex:1; min-width:0; }
  .label { display:block; color:var(--fg); font-size:14px; font-weight:600; }
  .desc { display:block; font-size:12.5px; color:var(--muted); margin-top:3px; line-height:1.45; }
  .state { flex:none; align-self:center; font-size:12px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; min-width:26px; text-align:right; }
  .state.on { color:var(--accent); }
  .state.off { color:var(--muted); }
  .lk { flex:none; align-self:center; border:1px solid var(--line); background:var(--paper, transparent); color:var(--fg); border-radius:7px; font:inherit; font-size:12.5px; font-weight:600; padding:5px 11px; cursor:pointer; }
  .lk:hover { border-color:var(--accent); color:var(--accent); }
  .muted { color:var(--muted); }
  [hidden] { display:none !important; } /* an explicit display beats the UA [hidden] rule inside a shadow root */
`;

class GbtiSiteSettingsManager extends GbtiElement {
  // The client-ready race (see gbti-quote-manager): this element sits in admin.html's static markup and upgrades
  // BEFORE admin.mjs injects the client, so loading eagerly here would stick on "Loading...". render() retries.
  connectedCallback() { super.connectedCallback?.(); }

  async load() {
    if (!this.client) { this.render(); return; }
    try {
      const r = await this.client.siteSettings();
      this._settings = r?.settings || {};
      this._toggles = Array.isArray(r?.toggles) ? r.toggles : [];
    } catch {
      this._settings = {}; this._toggles = []; this._msg = 'Could not load the site settings.';
    }
    this._loading = false;
    this.render();
  }

  render() {
    if (!this.client) { this.set(this.css(CSS) + `<p class="muted">Open in the GBTI client (superadmin) to manage site settings.</p>`); return; }
    if (!this._toggles) { if (!this._loading) { this._loading = true; this.load(); } this.set(this.css(CSS) + `<p class="muted">Loading site settings...</p>`); return; }
    const rows = this._toggles.map((t) => {
      const on = this._settings?.[t.key] === true;
      return `<li class="s"><div class="row">`
        + `<span class="tx"><span class="label">${esc(t.label || t.key)}</span><span class="desc">${esc(t.description || '')}</span></span>`
        + `<span class="state ${on ? 'on' : 'off'}">${on ? 'On' : 'Off'}</span>`
        + `<button class="lk" type="button" data-toggle="${esc(t.key)}" data-on="${on ? '1' : '0'}">Turn ${on ? 'off' : 'on'}</button>`
        + `</div></li>`;
    }).join('');
    this.set(this.css(CSS) + `<div class="${this._busy ? 'busy' : ''}">
      ${this._msg ? `<p class="msg">${esc(this._msg)}</p>` : ''}
      <ul class="list">${rows || '<li class="muted">No site settings are defined.</li>'}</ul>
      <p class="hint" style="margin:14px 0 0">Superadmin only. A flip opens a pull request against house/site-settings.yml and goes live on the next site deploy, about three minutes later, so the switch will read the new position before the site does.</p>
    </div>`);
    this._wire();
  }

  _wire() {
    this.$$('[data-toggle]').forEach((b) => b.addEventListener('click', () =>
      this._run(() => this.client.setSiteToggle({ key: b.dataset.toggle, enabled: b.dataset.on !== '1' }))));
  }

  async _run(fn) {
    this._busy = true; this._msg = ''; this.render();
    try {
      const r = await fn();
      this._msg = r?.noop ? 'No change (already in that state).'
        : (r?.prNumber ? submitAck({ prNumber: r.prNumber, autoMerge: false }) : 'Done.');
    } catch (e) {
      this._msg = e?.message || 'That change failed.';
    }
    this._busy = false;
    await this.load();
  }
}

define('gbti-site-settings-manager', GbtiSiteSettingsManager);
export { GbtiSiteSettingsManager };
