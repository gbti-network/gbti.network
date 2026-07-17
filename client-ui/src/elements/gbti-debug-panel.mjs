// <gbti-debug-panel> (SOW-124): the superadmin Debug panel. A dumb, host-AGNOSTIC view over the devlog rings:
// it holds the on/off toggle, the merged ring (the extension's page realm + background realm, or the npm host),
// a Copy-all + Clear, and area/search filters. It touches NO chrome/fs API itself; the host (the extension shell)
// injects a small `adapter` that does the realm plumbing, exactly like the other elements read the host `client`.
// Superadmin-only in practice: the avatar-menu item that opens it is superadmin-gated, and the background ring
// read is role-checked. Every logged value is already redacted by the devlog core, so no secret can appear here.
import { GbtiElement, define, esc } from '../base.mjs';

const fmtTime = (ms) => { try { return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { return ''; } };
const fmtData = (d) => { if (d === undefined) return ''; try { return JSON.stringify(d); } catch { return String(d); } };
const fmtLine = (e) => `${new Date(e.t).toISOString()} [${e.realm || 'app'}:${e.area}] ${e.msg}${e.data !== undefined ? ' ' + fmtData(e.data) : ''}`;

const CSS = `
  :host { display:block; width:70vw; max-width:1100px; max-height:86vh; overflow:hidden; display:flex; flex-direction:column;
    background:var(--bg); color:var(--fg); border:1.5px solid var(--line); border-radius:7px; box-shadow:var(--sh-lg, 0 24px 60px rgba(0,0,0,.4)); font-family:var(--font-body); }
  .hd { display:flex; align-items:center; gap:12px; padding:14px 18px; border-bottom:1.5px solid var(--line); flex:none; }
  .hd h2 { margin:0; font-family:var(--font-display, inherit); font-weight:800; font-size:16px; letter-spacing:.02em; text-transform:uppercase; flex:1; }
  .hd .x { background:none; border:1.5px solid var(--line); border-radius:7px; color:var(--fg-mute, var(--muted)); width:32px; height:32px; cursor:pointer; font-size:15px; line-height:1; }
  .hd .x:hover { border-color:var(--fg-mute, var(--muted)); }
  .body { padding:12px 18px 16px; overflow:auto; flex:1; }
  .hint { color:var(--muted); font-size:11.5px; margin:0 0 10px; line-height:1.5; }
  .empty { padding:26px 10px; text-align:center; color:var(--muted); font-family:var(--font-mono, monospace); font-size:12px; }

  .bar { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:0 0 10px; }
  .bar select, .bar input { width:auto; font:inherit; font-size:12px; color:var(--fg); background:var(--bg); border:1.5px solid var(--line); border-radius:7px; padding:6px 9px; outline:none; }
  .bar input { flex:1; min-width:150px; } .bar select:focus, .bar input:focus { border-color:var(--brand); }
  .btn { font:inherit; font-size:12px; font-weight:700; border-radius:7px; padding:6px 11px; cursor:pointer; border:1.5px solid var(--line); background:none; color:var(--fg); }
  .btn:hover { border-color:var(--fg-mute, var(--muted)); }
  .toggle { color:#fff; background:var(--muted); border-color:var(--muted); } .toggle.on { background:var(--brand); border-color:var(--brand); }
  .count { align-self:center; font-family:var(--font-mono, monospace); font-size:11px; color:var(--muted); margin-left:auto; }
  .flash { font-size:12px; color:var(--brand); margin:0 0 8px; }

  table { width:100%; border-collapse:collapse; font-family:var(--font-mono, monospace); font-size:11.5px; }
  th { text-align:left; color:var(--muted); font-weight:700; padding:4px 8px; border-bottom:1.5px solid var(--line); position:sticky; top:0; background:var(--bg); }
  td { padding:4px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  td.t { white-space:nowrap; color:var(--muted); font-variant-numeric:tabular-nums; }
  .badge { display:inline-block; font-size:9.5px; font-weight:800; text-transform:uppercase; letter-spacing:.04em; border:1px solid var(--line); border-radius:5px; padding:1px 5px; color:var(--muted); }
  .badge.page { color:var(--brand); border-color:var(--brand); } .badge.bg { color:var(--accent); border-color:var(--accent); }
  td.msg { color:var(--fg); } td.data { color:var(--fg-soft, var(--muted)); word-break:break-word; max-width:340px; }
`;

const AREA_LABEL = { all: 'All areas', reader: 'reader', membership: 'membership', dispatch: 'dispatch', shares: 'shares', worker: 'worker' };

class GbtiDebugPanel extends GbtiElement {
  connectedCallback() {
    super.connectedCallback();
    this._entries = [];
    this._enabled = false;
    this._area = 'all';
    this._q = '';
    this._flash = '';
    this.render();
    this.refresh();
  }

  // The host (extension shell) sets this: { isEnabled(), refresh() -> entries[], toggle(on), clear() }. Setting it
  // triggers a refresh so the panel fills as soon as the host wires it (avoids the client-ready load race).
  set adapter(a) { this._adapter = a; this.refresh(); }
  get adapter() { return this._adapter; }

  async refresh() {
    if (!this._adapter) { this.render(); return; }
    this._enabled = !!(this._adapter.isEnabled && this._adapter.isEnabled());
    try { this._entries = (await this._adapter.refresh()) || []; } catch { this._entries = []; }
    this.render();
  }

  async _toggle() {
    const next = !this._enabled;
    try { await this._adapter?.toggle?.(next); } catch { /* best-effort */ }
    this._enabled = next;
    this._flash = next ? 'Debug logging is ON. Reproduce the issue, then read the lines below.' : 'Debug logging is OFF.';
    this.render();
  }

  async _clear() {
    try { await this._adapter?.clear?.(); } catch { /* best-effort */ }
    this._entries = [];
    this._flash = 'Cleared.';
    this.render();
  }

  _copyAll() {
    const text = this._filtered().map(fmtLine).join('\n');
    try { navigator.clipboard?.writeText?.(text); this._flash = `Copied ${this._filtered().length} lines.`; }
    catch { this._flash = 'Copy failed (clipboard unavailable).'; }
    this.render();
  }

  _areas() {
    const set = new Set(this._entries.map((e) => e.area).filter(Boolean));
    return ['all', ...[...set].sort()];
  }

  _filtered() {
    const q = this._q.trim().toLowerCase();
    return this._entries
      .filter((e) => (this._area === 'all' || e.area === this._area) && (!q || fmtLine(e).toLowerCase().includes(q)))
      .slice()
      .sort((a, b) => a.t - b.t);
  }

  render() {
    const rows = this._filtered();
    const areaOpts = this._areas().map((a) => `<option value="${esc(a)}"${a === this._area ? ' selected' : ''}>${esc(AREA_LABEL[a] || a)}</option>`).join('');
    const table = rows.length
      ? `<table><thead><tr><th>Time</th><th>Realm</th><th>Area</th><th>Message</th><th>Data</th></tr></thead><tbody>${rows.map((e) => `
          <tr><td class="t">${esc(fmtTime(e.t))}</td>
            <td><span class="badge ${e.realm === 'bg' ? 'bg' : e.realm === 'page' ? 'page' : ''}">${esc(e.realm || 'app')}</span></td>
            <td>${esc(e.area)}</td><td class="msg">${esc(e.msg)}</td>
            <td class="data">${esc(fmtData(e.data))}</td></tr>`).join('')}</tbody></table>`
      : `<p class="empty">${this._enabled ? 'No log lines yet. Reproduce the action you want to inspect.' : 'Debug logging is off. Turn it on, then reproduce the issue.'}</p>`;

    this.set(this.css(CSS) + `
      <div class="hd">
        <h2>Debug</h2>
        <button class="x" data-close type="button" aria-label="Close">&times;</button>
      </div>
      <div class="body">
        <p class="hint">Superadmin only. Turns on structured, redacted diagnostics across the extension (the page and the background). Secrets are never logged. Use it to see why a feed, membership check, or action behaved unexpectedly.</p>
        <div class="bar">
          <button class="btn toggle ${this._enabled ? 'on' : ''}" data-toggle type="button">${this._enabled ? 'Logging: ON' : 'Logging: OFF'}</button>
          <select data-area>${areaOpts}</select>
          <input data-q type="search" placeholder="Filter lines" value="${esc(this._q)}" />
          <button class="btn" data-refresh type="button">Refresh</button>
          <button class="btn" data-copy type="button">Copy</button>
          <button class="btn" data-clear type="button">Clear</button>
          <span class="count">${rows.length} lines</span>
        </div>
        ${this._flash ? `<p class="flash">${esc(this._flash)}</p>` : ''}
        ${table}
      </div>`);

    this.$('[data-close]')?.addEventListener('click', () => this.emit('gbti-debug-close'));
    this.$('[data-toggle]')?.addEventListener('click', () => this._toggle());
    this.$('[data-refresh]')?.addEventListener('click', () => this.refresh());
    this.$('[data-copy]')?.addEventListener('click', () => this._copyAll());
    this.$('[data-clear]')?.addEventListener('click', () => this._clear());
    this.$('[data-area]')?.addEventListener('change', (e) => { this._area = e.target.value; this.render(); });
    this.$('[data-q]')?.addEventListener('input', (e) => { this._q = e.target.value; this.render(); });
  }
}

define('gbti-debug-panel', GbtiDebugPanel);
export { GbtiDebugPanel };
