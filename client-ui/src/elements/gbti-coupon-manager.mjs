// <gbti-coupon-manager> (SOW-119): the superadmin coupon manager. The CONFIG half is git-native: coupons
// live in house/coupons.yml and every edit opens an auto-merged house PR (the SOW-038 governance model;
// CODEOWNERS + the SOW-005 gate are the real boundary), going live at the next coupons:config mirror sync.
// The RUNTIME half (redemption counts + the shareable invite link) is Worker/KV via the admin endpoints.
// Inert in public (no injected client). Host-agnostic. A sibling of <gbti-news-source-manager>.
import { GbtiElement, define, esc } from '../base.mjs';
import { submitAck } from '../workspace-core.mjs';

const INVITE_PATH = '/codeable-invite/?t=';

const CSS = `
  :host { display:block; }
  .head { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; margin:0 0 12px; }
  .head h3 { margin:0; font-family:var(--font-display, inherit); font-size:17px; }
  .hint { font-size:12.5px; color:var(--muted); }
  .msg { font-size:13px; color:var(--accent); margin:0 0 12px; }
  .busy { opacity:.55; pointer-events:none; }
  .add { display:grid; grid-template-columns: 1.2fr .7fr .7fr 1.4fr auto; gap:8px; margin:0 0 16px; }
  @media (max-width: 760px) { .add { grid-template-columns: 1fr 1fr; } }
  .add input { min-width:0; font:inherit; color:var(--fg); background:var(--paper, transparent); border:1px solid var(--line); border-radius:7px; padding:7px 9px; }
  .btn { border:1px solid var(--accent); background:var(--accent); color:#fff; border-radius:7px; font:inherit; font-weight:700; font-size:13px; padding:7px 14px; cursor:pointer; }
  .list { list-style:none; margin:0; padding:0; }
  .c { border-top:1px solid var(--line); padding:12px 2px; }
  .c:first-child { border-top:0; }
  .c.off { opacity:.6; }
  .crow { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .code { font-family:var(--font-mono, monospace); font-weight:700; font-size:14px; color:var(--fg); letter-spacing:.04em; }
  .meta { font-size:12.5px; color:var(--muted); }
  .sp { flex:1; }
  .lk { border:1px solid var(--line); background:var(--paper, transparent); color:var(--fg); border-radius:7px; font:inherit; font-size:12.5px; font-weight:600; padding:5px 11px; cursor:pointer; }
  .lk:hover { border-color:var(--accent); color:var(--accent); }
  .linkrow { display:flex; align-items:center; gap:8px; margin-top:8px; flex-wrap:wrap; }
  .linkrow input { flex:1 1 320px; min-width:0; font-family:var(--font-mono, monospace); font-size:12px; color:var(--fg); background:var(--paper, transparent); border:1px solid var(--line); border-radius:7px; padding:6px 9px; }
  .use { margin-top:8px; font-size:12.5px; color:var(--muted); }
  .use b { color:var(--fg); }
  .reds { list-style:none; margin:6px 0 0; padding:0; }
  .reds li { font-size:12.5px; color:var(--muted); padding:2px 0; font-family:var(--font-mono, monospace); }
  .muted { color:var(--muted); }
`;

class GbtiCouponManager extends GbtiElement {
  // SOW-070: static admin.html markup upgrades before setClient; render() retries the load once the client lands.
  connectedCallback() { super.connectedCallback?.(); }

  async load() {
    if (!this.client) { this.render(); return; }
    try { this._coupons = (await this.client.couponPool())?.coupons || []; }
    catch { this._coupons = []; this._msg = 'Could not load the coupon registry.'; }
    try {
      const u = await this.client.couponUsage();
      this._usage = u?.usage || {};
      this._links = u?.links || {};
    } catch { this._usage = {}; this._links = {}; }
    this._loading = false;
    this.render();
  }

  _siteBase() {
    // The invite page lives on the public site regardless of which host renders this manager.
    return 'https://gbti.network';
  }

  render() {
    if (!this.client) { this.set(this.css(CSS) + `<p class="muted">Open in the GBTI client (admin) to manage coupons.</p>`); return; }
    if (!this._coupons) { if (!this._loading) { this._loading = true; this.load(); } this.set(this.css(CSS) + `<p class="muted">Loading coupons...</p>`); return; }

    const rows = this._coupons.map((c) => {
      const code = String(c.code || '').toUpperCase();
      const u = this._usage[code] || { count: 0, redemptions: [] };
      const token = this._links[code];
      const link = token ? `${this._siteBase()}${INVITE_PATH}${token}` : '';
      const reds = (u.redemptions || []).slice(0, 8).map((r) =>
        `<li>${esc(r.login || r.githubId)} · ${esc(String(r.redeemedAt || '').slice(0, 10))} → ${esc(String(r.until || '').slice(0, 10))}</li>`).join('');
      return `<li class="c${c.active === false ? ' off' : ''}" data-code="${esc(code)}">
        <div class="crow">
          <span class="code">${esc(code)}</span>
          <span class="meta">${esc(String(c.freeDays))} free day${Number(c.freeDays) === 1 ? '' : 's'}${c.maxRedemptions != null ? ` · max ${esc(String(c.maxRedemptions))}` : ' · unlimited'}${c.note ? ` · ${esc(c.note)}` : ''}</span>
          <span class="sp"></span>
          <button class="lk" data-toggle="${esc(code)}">${c.active === false ? 'Activate' : 'Deactivate'}</button>
          <button class="lk" data-rotate="${esc(code)}">${token ? 'Regenerate link' : 'Create link'}</button>
        </div>
        ${link ? `<div class="linkrow"><input readonly value="${esc(link)}" aria-label="Invite link for ${esc(code)}" /><button class="lk" data-copy="${esc(link)}">Copy</button></div>` : ''}
        <div class="use">Redemptions: <b>${esc(String(u.count ?? 0))}</b>${u.max != null ? ` of ${esc(String(u.max))}` : ''}</div>
        ${reds ? `<ul class="reds">${reds}</ul>` : ''}
      </li>`;
    }).join('');

    this.set(this.css(CSS) + `
      <div class="head"><h3>Coupons</h3><span class="hint">Free-time signup codes. Config edits land as an audited house PR and go live at the next mirror sync; links resolve immediately.</span></div>
      ${this._msg ? `<p class="msg">${esc(this._msg)}</p>` : ''}
      <div class="add">
        <input data-f="code" placeholder="CODE (A-Z 0-9)" maxlength="32" />
        <input data-f="freeDays" type="number" min="1" max="3650" placeholder="Free days" />
        <input data-f="maxRedemptions" type="number" min="1" placeholder="Max uses (empty = unlimited)" />
        <input data-f="note" placeholder="Note" maxlength="160" />
        <button class="btn" data-add>Add coupon</button>
      </div>
      <ul class="list">${rows || '<li class="c muted">No coupons yet.</li>'}</ul>
    `);

    this.$('[data-add]')?.addEventListener('click', () => this._add());
    this.$$('[data-toggle]').forEach((b) => b.addEventListener('click', () => this._toggle(b.dataset.toggle)));
    this.$$('[data-rotate]').forEach((b) => b.addEventListener('click', () => this._rotate(b.dataset.rotate)));
    this.$$('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1500); } catch { /* clipboard denied */ }
    }));
  }

  async _add() {
    const v = (k) => this.$(`[data-f="${k}"]`)?.value?.trim() ?? '';
    const code = v('code');
    const freeDays = Number(v('freeDays'));
    if (!code || !freeDays) { this._msg = 'A code and the free days are required.'; this.render(); return; }
    await this._run(() => this.client.addCoupon({ code, freeDays, note: v('note'), maxRedemptions: v('maxRedemptions') || null, expiresAt: null }), `Coupon ${code.toUpperCase()} added`);
  }

  async _toggle(code) {
    const cur = this._coupons.find((c) => String(c.code).toUpperCase() === code);
    const next = cur?.active === false;
    await this._run(() => this.client.updateCoupon({ code, patch: { active: next } }), `${code} ${next ? 'activated' : 'deactivated'}`);
  }

  async _rotate(code) {
    await this._run(() => this.client.rotateCouponLink({ code }), `New invite link for ${code} (old links are dead)`);
  }

  async _run(fn, okMsg) {
    try {
      const r = await fn();
      this._msg = r?.prNumber ? `${okMsg}. ${submitAck({ prNumber: r.prNumber })}` : okMsg;
    } catch (err) {
      this._msg = err?.message || 'The action failed.';
    }
    this._coupons = null; // reload both halves
    this.render();
  }
}

define('gbti-coupon-manager', GbtiCouponManager);
