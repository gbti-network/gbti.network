// <gbti-quote-manager> (SOW-063 P3): the superadmin splash-quote-pool manager. Lists quotes from house/quotes.yml
// (client.quotePool) and lets a superadmin ADD / REMOVE / ENABLE-DISABLE each via the admin ops, which open an
// auto-merged house PR (the SOW-038 governance model; the host token never leaves the host and the gate is the real
// boundary). Edits go live at the Pages-deploy cadence (the extension reads the rebuilt /quotes.json). Inert in
// public (no injected client). Host-agnostic. A sibling of <gbti-news-source-manager>. Quotes are keyed by text.
import { GbtiElement, define, esc } from '../base.mjs';

const CSS = `
  :host { display:block; }
  .head { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; margin:0 0 12px; }
  .head h3 { margin:0; font-family:var(--font-display, inherit); font-size:17px; }
  .hint { font-size:12.5px; color:var(--muted); }
  .msg { font-size:13px; color:var(--accent); margin:0 0 12px; }
  .busy { opacity:.55; pointer-events:none; }
  .add { display:flex; gap:8px; flex-wrap:wrap; margin:0 0 14px; }
  .add textarea { flex:2 1 280px; min-width:0; font:inherit; color:var(--fg); background:var(--paper, transparent); border:1px solid var(--line); border-radius:7px; padding:7px 9px; resize:vertical; min-height:38px; }
  .add input { flex:1 1 140px; min-width:0; font:inherit; color:var(--fg); background:var(--paper, transparent); border:1px solid var(--line); border-radius:7px; padding:7px 9px; }
  .btn { flex:none; border:1px solid var(--accent); background:var(--accent); color:#fff; border-radius:7px; font:inherit; font-weight:700; font-size:13px; padding:7px 14px; cursor:pointer; }
  .list { list-style:none; margin:0; padding:0; }
  .q { border-top:1px solid var(--line); }
  .q:first-child { border-top:0; }
  .q.off { opacity:.55; }
  .row { display:flex; align-items:flex-start; gap:10px; padding:10px 2px; }
  .tx { flex:1; min-width:0; }
  .quote { display:block; color:var(--fg); font-size:14px; line-height:1.45; }
  .by { display:block; font-size:12.5px; color:var(--muted); margin-top:2px; }
  .lk { flex:none; border:1px solid var(--line); background:var(--paper, transparent); color:var(--fg); border-radius:7px; font:inherit; font-size:12.5px; font-weight:600; padding:5px 11px; cursor:pointer; }
  .lk:hover { border-color:var(--accent); color:var(--accent); }
  .lk.danger:hover { border-color:var(--danger, #e06c6c); color:var(--danger, #e06c6c); }
  .muted { color:var(--muted); }
`;

class GbtiQuoteManager extends GbtiElement {
  connectedCallback() { super.connectedCallback?.(); this.load(); }

  async load() {
    if (!this.client) { this.render(); return; }
    try { this._quotes = (await this.client.quotePool())?.quotes || []; }
    catch { this._quotes = []; this._msg = 'Could not load the quotes.'; }
    this.render();
  }

  render() {
    if (!this.client) { this.set(this.css(CSS) + `<p class="muted">Open in the GBTI client (admin) to manage quotes.</p>`); return; }
    if (!this._quotes) { this.set(this.css(CSS) + `<p class="muted">Loading quotes...</p>`); return; }
    const enabled = this._quotes.filter((q) => q && q.enabled !== false).length;
    const rows = this._quotes.map((q) => {
      const on = q && q.enabled !== false;
      return `<li class="q ${on ? '' : 'off'}"><div class="row">`
        + `<span class="tx"><span class="quote">${esc(q.text || '')}</span><span class="by">${esc(q.author || '')}</span></span>`
        + `<button class="lk" type="button" data-toggle="${esc(q.text || '')}" data-on="${on ? '1' : '0'}">${on ? 'Disable' : 'Enable'}</button>`
        + `<button class="lk danger" type="button" data-remove="${esc(q.text || '')}">Remove</button>`
        + `</div></li>`;
    }).join('');
    this.set(this.css(CSS) + `<div class="${this._busy ? 'busy' : ''}">
      <div class="head"><h3>Splash quotes</h3><span class="hint">${this._quotes.length} quotes, ${enabled} enabled &middot; edits open an auto-merged house PR</span></div>
      ${this._msg ? `<p class="msg">${esc(this._msg)}</p>` : ''}
      <div class="add">
        <textarea data-add-text placeholder="The quote text"></textarea>
        <input data-add-author type="text" placeholder="Author" />
        <button class="btn" type="button" data-add>Add quote</button>
      </div>
      <p class="hint" style="margin:-6px 0 14px">The new-tab splash shows one enabled quote, rotating every 12 hours. Disable a quote to retire it without losing the history.</p>
      <ul class="list">${rows || '<li class="muted">No quotes yet.</li>'}</ul>
    </div>`);
    this._wire();
  }

  _wire() {
    this.on('[data-add]', 'click', () => {
      const text = (this.$('[data-add-text]')?.value || '').trim();
      const author = (this.$('[data-add-author]')?.value || '').trim();
      if (!text) { this._msg = 'A quote text is required.'; this.render(); return; }
      if (!author) { this._msg = 'An author is required.'; this.render(); return; }
      this._run(() => this.client.addQuote({ text, author }));
    });
    this.$$('[data-toggle]').forEach((b) => b.addEventListener('click', () =>
      this._run(() => this.client.setQuoteEnabled({ text: b.dataset.toggle, enabled: b.dataset.on !== '1' }))));
    this.$$('[data-remove]').forEach((b) => b.addEventListener('click', () => {
      const text = b.dataset.remove;
      if (typeof confirm === 'function' && !confirm(`Remove this quote?\n\n"${text}"`)) return;
      this._run(() => this.client.removeQuote({ text }));
    }));
  }

  async _run(fn) {
    this._busy = true; this._msg = ''; this.render();
    try {
      const r = await fn();
      this._msg = r?.noop ? 'No change (already in that state).'
        : (r?.number ? `Opened PR #${r.number} (auto-merges; the list updates after it lands + the site redeploys).` : 'Done.');
    } catch (e) {
      this._msg = e?.message || 'That edit failed.';
    }
    this._busy = false;
    await this.load();
  }
}

define('gbti-quote-manager', GbtiQuoteManager);
export { GbtiQuoteManager };
