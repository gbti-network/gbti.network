// <gbti-syndication-tracker> (SOW-058): the superadmin read-view of the syndication queue. Reads
// client.syndicationQueue() -> { pending, sent, cancelled, failed } and renders four buckets. A PENDING item
// shows a countdown to its availableAt + a Cancel button (superadmin only); cancelling calls
// client.cancelSyndication({ id }). The role gate here is UX-only — the Worker (GET admin-gated, cancel
// superadmin-only) is the real boundary. Admin-only by where it is mounted; inert without a client.
import { GbtiElement, define, esc } from '../base.mjs';

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .head { display:flex; align-items:baseline; gap:10px; margin:0 0 8px; }
  .head h3 { margin:0; font-size:15px; }
  .hint { color:var(--muted); font-size:12px; }
  .msg { font-size:13px; color:var(--accent); margin:6px 0; }
  .msg.err { color:var(--danger); }
  .muted { color:var(--muted); font-size:13.5px; }
  .bucket { margin:0 0 18px; }
  .bucket h4 { margin:0 0 8px; font-size:13px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); }
  ul.rows { list-style:none; margin:0; padding:0; }
  .row { display:flex; align-items:center; gap:10px; padding:9px 2px; border-top:1px solid var(--line); }
  .row:first-child { border-top:0; }
  .it { flex:1; min-width:0; }
  .it b { font-size:14px; display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .it .d { font-size:12px; color:var(--muted); }
  .src { flex:none; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:1px 8px; }
  .when { flex:none; font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums; }
  .chs { display:flex; gap:5px; flex-wrap:wrap; }
  .ch { font-size:11px; border-radius:999px; padding:1px 7px; border:1px solid var(--line); color:var(--muted); }
  .ch.sent { color:var(--accent); border-color:var(--accent); } .ch.failed { color:var(--danger); border-color:var(--danger); }
  .ch.skipped { opacity:.7; }
  .cancel { flex:none; font:inherit; font-size:12.5px; font-weight:600; color:var(--danger); background:none; border:1px solid var(--line); border-radius:6px; padding:5px 10px; cursor:pointer; }
  .cancel:hover { border-color:var(--danger); }
  .busy { opacity:.55; pointer-events:none; }
`;

const SRC_LABEL = { share: 'Share', post: 'Article', product: 'Product', prompt: 'Prompt' };

function countdown(sec) {
  const s = Math.max(0, Number(sec) || 0);
  if (s <= 0) return 'sending now';
  const m = Math.floor(s / 60);
  if (m >= 60) return `in ${Math.floor(m / 60)}h ${m % 60}m`;
  if (m >= 1) return `in ${m}m`;
  return `in ${s}s`;
}

class GbtiSyndicationTracker extends GbtiElement {
  connectedCallback() {
    super.connectedCallback();
    this._data = null;
    this._msg = '';
    this._err = false;
    this._busy = false;
    this.load();
  }

  async load() {
    if (!this.client) { this.render(); return; }
    try { this._data = await this.client.syndicationQueue(); this._err = false; }
    catch (e) { this._data = null; this._err = true; this._msg = e?.message || 'Could not load the syndication queue.'; }
    this.render();
  }

  render() {
    if (!this.client) { this.set(this.css(CSS) + `<p class="muted">Open in the GBTI client (admin) to view syndication.</p>`); return; }
    if (this._err) { this.set(this.css(CSS) + `<div class="head"><h3>Syndication</h3></div><p class="msg err">${esc(this._msg)}</p><button class="cancel" data-reload type="button" style="color:var(--accent)">Retry</button>`); this.$('[data-reload]')?.addEventListener('click', () => this.load()); return; }
    if (!this._data) { this.set(this.css(CSS) + `<p class="muted">Loading syndication queue...</p>`); return; }
    const d = this._data;
    this.set(this.css(CSS) + `<div class="${this._busy ? 'busy' : ''}">
      <div class="head"><h3>Syndication queue</h3><span class="hint">Every item holds one hour; a superadmin can cancel before it sends.</span></div>
      ${this._msg ? `<p class="msg">${esc(this._msg)}</p>` : ''}
      ${this._bucket('Pending', d.pending, true)}
      ${this._bucket('Sent', d.sent, false)}
      ${this._bucket('Failed', d.failed, false)}
      ${this._bucket('Cancelled', d.cancelled, false)}
    </div>`);
    this.$$('[data-cancel]').forEach((b) => b.addEventListener('click', () => this._cancel(b.dataset.cancel)));
  }

  _bucket(label, items, pending) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return `<div class="bucket"><h4>${esc(label)} (0)</h4><p class="muted">None.</p></div>`;
    const rows = list.map((it) => {
      const src = SRC_LABEL[it.source] || it.source || '';
      const title = it.title || it.targetSlug || it.id || '(untitled)';
      const right = pending
        ? `<span class="when">${esc(countdown(it.secondsUntilAvailable))}</span><button class="cancel" data-cancel="${esc(it.id)}" type="button">Cancel</button>`
        : `<span class="chs">${this._channels(it.perChannel)}</span>`;
      return `<li class="row"><span class="src">${esc(src)}</span><span class="it"><b>${esc(title)}</b>${it.url ? `<span class="d">${esc(it.url)}</span>` : ''}</span>${right}</li>`;
    }).join('');
    return `<div class="bucket"><h4>${esc(label)} (${list.length})</h4><ul class="rows">${rows}</ul></div>`;
  }

  _channels(perChannel) {
    if (!perChannel || typeof perChannel !== 'object') return '';
    return Object.entries(perChannel).map(([name, r]) => {
      const status = r?.status || 'pending';
      const link = r?.url ? `<a class="ch ${esc(status)}" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(name)}</a>` : `<span class="ch ${esc(status)}">${esc(name)}: ${esc(status)}</span>`;
      return link;
    }).join('');
  }

  async _cancel(id) {
    if (!id) return;
    if (typeof confirm === 'function' && !confirm('Cancel this syndication item? It will not be posted.')) return;
    this._busy = true; this.render();
    try {
      const r = await this.client.cancelSyndication({ id });
      this._msg = r?.cancelled ? 'Cancelled.' : `Could not cancel (status: ${r?.status || 'unknown'}).`;
      await this.load();
    } catch (e) {
      this._msg = e?.message || 'Cancel failed.';
    } finally {
      this._busy = false;
      this.render();
    }
  }
}

define('gbti-syndication-tracker', GbtiSyndicationTracker);
export { GbtiSyndicationTracker };
