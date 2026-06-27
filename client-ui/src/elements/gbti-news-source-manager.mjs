// <gbti-news-source-manager> (SOW-056 P2): the superadmin news-source-pool manager. Lists the sources from
// house/news-sources.yml (client.newsSourcePool) and lets a superadmin ADD / REMOVE / ENABLE-DISABLE each via the
// admin ops, which open an auto-merged house PR (the SOW-038 governance model; the key never leaves the host's
// token + the gate is the real boundary). Edits go live at the Pages-deploy cadence (the worker reads the rebuilt
// /news-sources.json next cron). Inert in public (no injected client). Host-agnostic.
import { GbtiElement, define, esc } from '../base.mjs';
import { submitAck } from '../workspace-core.mjs'; // SOW-072 P2: the one consistent submit acknowledgement

const hostOf = (url) => { try { return new URL(url).host; } catch { return url || ''; } };

const CSS = `
  :host { display:block; }
  .head { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; margin:0 0 12px; }
  .head h3 { margin:0; font-family:var(--font-display, inherit); font-size:17px; }
  .hint { font-size:12.5px; color:var(--muted); }
  .msg { font-size:13px; color:var(--accent); margin:0 0 12px; }
  .busy { opacity:.55; pointer-events:none; }
  .add { display:flex; gap:8px; flex-wrap:wrap; margin:0 0 14px; }
  .add input { flex:1 1 130px; min-width:0; font:inherit; color:var(--fg); background:var(--paper, transparent); border:1px solid var(--line); border-radius:7px; padding:7px 9px; }
  .add input[data-add-url] { flex:2 1 220px; }
  .btn { flex:none; border:1px solid var(--accent); background:var(--accent); color:#fff; border-radius:7px; font:inherit; font-weight:700; font-size:13px; padding:7px 14px; cursor:pointer; }
  .list { list-style:none; margin:0; padding:0; }
  .src { border-top:1px solid var(--line); }
  .src:first-child { border-top:0; }
  .src.off { opacity:.55; }
  .row { display:flex; align-items:center; gap:10px; padding:9px 2px; }
  .id { font-family:var(--font-mono, monospace); font-size:12px; color:var(--muted); flex:none; }
  .nm { font-weight:600; color:var(--fg); }
  .url { font-size:12.5px; color:var(--muted); text-decoration:none; }
  .url:hover { color:var(--accent); }
  .sp { flex:1; }
  .lk { flex:none; border:1px solid var(--line); background:var(--paper, transparent); color:var(--fg); border-radius:7px; font:inherit; font-size:12.5px; font-weight:600; padding:5px 11px; cursor:pointer; }
  .lk:hover { border-color:var(--accent); color:var(--accent); }
  .lk.danger:hover { border-color:var(--danger, #e06c6c); color:var(--danger, #e06c6c); }
  .muted { color:var(--muted); }
`;

class GbtiNewsSourceManager extends GbtiElement {
  connectedCallback() { super.connectedCallback?.(); this.load(); }

  async load() {
    if (!this.client) { this.render(); return; }
    try { this._sources = (await this.client.newsSourcePool())?.sources || []; }
    catch { this._sources = []; this._msg = 'Could not load the news sources.'; }
    this.render();
  }

  render() {
    if (!this.client) { this.set(this.css(CSS) + `<p class="muted">Open in the GBTI client (admin) to manage news sources.</p>`); return; }
    if (!this._sources) { this.set(this.css(CSS) + `<p class="muted">Loading news sources...</p>`); return; }
    const enabled = this._sources.filter((s) => s && s.enabled !== false).length;
    const rows = this._sources.map((s) => {
      const on = s && s.enabled !== false;
      return `<li class="src ${on ? '' : 'off'}"><div class="row">`
        + `<code class="id">${esc(s.id || '')}</code><span class="nm">${esc(s.name || '')}</span>`
        + `<a class="url" href="${esc(s.url || '')}" target="_blank" rel="noopener nofollow">${esc(hostOf(s.url))}</a>`
        + `<span class="sp"></span>`
        + `<button class="lk" type="button" data-toggle="${esc(s.id)}" data-on="${on ? '1' : '0'}">${on ? 'Disable' : 'Enable'}</button>`
        + `<button class="lk danger" type="button" data-remove="${esc(s.id)}">Remove</button>`
        + `</div></li>`;
    }).join('');
    this.set(this.css(CSS) + `<div class="${this._busy ? 'busy' : ''}">
      <div class="head"><h3>News sources</h3><span class="hint">${this._sources.length} sources, ${enabled} enabled &middot; edits open an auto-merged house PR</span></div>
      ${this._msg ? `<p class="msg">${esc(this._msg)}</p>` : ''}
      <div class="add">
        <input data-add-id type="text" placeholder="source-id (optional)" />
        <input data-add-name type="text" placeholder="Name" />
        <input data-add-url type="text" placeholder="https://... RSS/Atom feed URL" />
        <button class="btn" type="button" data-add>Add source</button>
      </div>
      <p class="hint" style="margin:-6px 0 14px">The next news ingest confirms the feed fetches; a source that never returns items can be removed here.</p>
      <ul class="list">${rows || '<li class="muted">No sources yet.</li>'}</ul>
    </div>`);
    this._wire();
  }

  _wire() {
    this.on('[data-add]', 'click', () => {
      const id = (this.$('[data-add-id]')?.value || '').trim();
      const name = (this.$('[data-add-name]')?.value || '').trim();
      const url = (this.$('[data-add-url]')?.value || '').trim();
      // Client-side URL validation for immediate feedback (the pure edit re-checks server-side). A full
      // fetch+parseFeed check is not done here: the extension cannot fetch arbitrary URLs (narrow host_permissions
      // by design), and the news ingest is fail-soft (a non-fetching source returns 0 items, no outage) — remove it
      // here if it never returns items. See the SOW for the optional server-side validate-feed follow-up.
      if (!url) { this._msg = 'A feed URL is required.'; this.render(); return; }
      let ok = false;
      try { ok = /^https?:$/.test(new URL(url).protocol); } catch { ok = false; }
      if (!ok) { this._msg = 'Enter a valid http(s) RSS/Atom feed URL.'; this.render(); return; }
      this._run(() => this.client.addNewsSource({ id, name, url }));
    });
    this.$$('[data-toggle]').forEach((b) => b.addEventListener('click', () =>
      this._run(() => this.client.setNewsSourceEnabled({ id: b.dataset.toggle, enabled: b.dataset.on !== '1' }))));
    this.$$('[data-remove]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.remove;
      if (typeof confirm === 'function' && !confirm(`Remove news source "${id}"?`)) return;
      this._run(() => this.client.removeNewsSource({ id }));
    }));
  }

  async _run(fn) {
    this._busy = true; this._msg = ''; this.render();
    try {
      const r = await fn();
      this._msg = r?.noop ? 'No change (already in that state).'
        : (r?.number ? submitAck({ prNumber: r.number, autoMerge: true }) : 'Done.'); // SOW-072 P2: consistent ack
    } catch (e) {
      this._msg = e?.message || 'That edit failed.';
    }
    this._busy = false;
    await this.load();
  }
}

define('gbti-news-source-manager', GbtiNewsSourceManager);
export { GbtiNewsSourceManager };
