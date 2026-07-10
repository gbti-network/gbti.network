// <gbti-syndication-tracker> (SOW-058 + SOW-088): the superadmin PUBLISHING ACTIVITY view of the
// syndication queue, as a kanban board (owner-directed 2026-07-10). Reads client.syndicationQueue()
// -> { pending, approved, sent, cancelled, failed } and renders one column per state with item cards:
// a PENDING card shows Approve + Reject (superadmin only), an APPROVED card shows Cancel until the
// drain posts it. The role gate here is UX-only — the Worker (GET admin-gated, approve/cancel
// superadmin-only) is the real boundary. Mounted inside the admin Syndication tab; inert without a
// client (nested elements read the shared client registry).
import { GbtiElement, define, esc } from '../base.mjs';

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .hint { color:var(--muted); font-size:12px; margin:0 0 12px; }
  .msg { font-size:13px; color:var(--accent); margin:6px 0 12px; }
  .msg.err { color:var(--danger, #e06c6c); }
  .muted { color:var(--muted); font-size:13.5px; }
  .busy { opacity:.55; pointer-events:none; }

  /* kanban board */
  .kb { display:grid; grid-auto-flow:column; grid-auto-columns:minmax(230px, 1fr); gap:12px; overflow-x:auto; padding-bottom:6px; align-items:start; }
  .kcol { background:var(--bg); border:1.5px solid var(--line); border-radius:10px; min-width:0; }
  .kcol-h { display:flex; align-items:center; gap:8px; padding:10px 12px; border-bottom:1.5px solid var(--line); }
  .kcol-h .kdot { width:8px; height:8px; border-radius:50%; flex:none; }
  .kcol-h .kn { font-family:var(--font-mono, monospace); font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:var(--muted); font-weight:700; }
  .kcol-h .kc { margin-left:auto; font-family:var(--font-mono, monospace); font-size:11px; background:var(--hover); border-radius:999px; padding:1px 8px; color:var(--muted); }
  .kcol[data-k="pending"] .kdot { background:#d8901a; }
  .kcol[data-k="approved"] .kdot { background:#3f74d6; }
  .kcol[data-k="sent"] .kdot { background:var(--brand); }
  .kcol[data-k="failed"] .kdot { background:var(--danger, #e06c6c); }
  .kcol[data-k="cancelled"] .kdot { background:var(--muted); }
  .kcards { padding:10px; display:flex; flex-direction:column; gap:10px; max-height:520px; overflow-y:auto; }
  .kempty { font-family:var(--font-mono, monospace); font-size:11.5px; color:var(--muted); padding:6px 2px 10px; text-align:center; }

  .kcard { background:var(--panel); border:1.5px solid var(--line); border-radius:10px; padding:11px 12px; }
  .kcard .top { display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-bottom:6px; }
  .src { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:1px 7px; }
  .manual { font-size:9.5px; font-weight:800; letter-spacing:.05em; color:#d8901a; border:1px solid #d8901a; border-radius:3px; padding:1px 5px; }
  .flag { font-size:10px; font-weight:700; color:#8a5a00; background:rgba(240,170,20,.18); border:1px solid rgba(240,170,20,.5); border-radius:6px; padding:1px 6px; }
  .cat { font-size:10.5px; color:var(--muted); }
  .kcard b.ti { display:block; font-size:13px; line-height:1.35; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
  .kcard .d { font-size:11px; color:var(--muted); margin-top:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .chs { display:flex; gap:4px; flex-wrap:wrap; margin-top:7px; }
  .ch { font-size:10.5px; border-radius:999px; padding:1px 7px; border:1px solid var(--line); color:var(--muted); text-decoration:none; }
  .ch.sent { color:var(--accent); border-color:var(--accent); } .ch.failed { color:var(--danger, #e06c6c); border-color:var(--danger, #e06c6c); }
  .ch.skipped { opacity:.7; }
  .acts { display:flex; gap:8px; margin-top:9px; }
  .approve { flex:1; font:inherit; font-size:12px; font-weight:700; color:#fff; background:var(--brand); border:1px solid var(--brand); border-radius:7px; padding:6px 10px; cursor:pointer; }
  .approve:hover { filter:brightness(1.06); }
  .cancel { flex:1; font:inherit; font-size:12px; font-weight:600; color:var(--danger, #e06c6c); background:none; border:1px solid var(--line); border-radius:7px; padding:6px 10px; cursor:pointer; }
  .cancel:hover { border-color:var(--danger, #e06c6c); }
  .when { font-size:10.5px; color:var(--muted); font-variant-numeric:tabular-nums; margin-top:7px; }
`;

const SRC_LABEL = { share: 'Share', post: 'Article', product: 'Product', prompt: 'Prompt' };
const COLUMNS = [
  { key: 'pending', label: 'Pending approval', mode: 'pending' },
  { key: 'approved', label: 'Approved', mode: 'approved' },
  { key: 'sent', label: 'Sent', mode: 'done' },
  { key: 'failed', label: 'Failed', mode: 'done' },
  { key: 'cancelled', label: 'Cancelled', mode: 'done' },
];

class GbtiSyndicationTracker extends GbtiElement {
  // SOW-070 fix: in static admin markup this upgrades BEFORE the host injects the client. render() retries
  // the load the moment the client arrives (setClient re-renders subscribers) -- no eager load().
  connectedCallback() {
    super.connectedCallback();
    this._data = null;
    this._msg = '';
    this._err = false;
    this._busy = false;
  }

  async load() {
    if (!this.client) { this.render(); return; }
    try { this._data = await this.client.syndicationQueue(); this._err = false; }
    catch (e) { this._data = null; this._err = true; this._msg = e?.message || 'Could not load the syndication queue.'; }
    this._loading = false;
    this.render();
  }

  render() {
    if (!this.client) { this.set(this.css(CSS) + `<p class="muted">Open in the GBTI client (admin) to view the publishing activity.</p>`); return; }
    if (this._err) { this.set(this.css(CSS) + `<p class="msg err">${esc(this._msg)}</p><button class="cancel" data-reload type="button" style="color:var(--accent);flex:none">Retry</button>`); this.$('[data-reload]')?.addEventListener('click', () => this.load()); return; }
    if (!this._data) { if (!this._err && !this._loading) { this._loading = true; this.load(); } this.set(this.css(CSS) + `<p class="muted">Loading the publishing activity...</p>`); return; }
    const d = this._data;
    this.set(this.css(CSS) + `<div class="${this._busy ? 'busy' : ''}">
      <p class="hint">A pending item posts to every enabled channel once approved (or after the hold window when auto-post is on). Flagged items always wait for a human.</p>
      ${this._msg ? `<p class="msg">${esc(this._msg)}</p>` : ''}
      <div class="kb">${COLUMNS.map((c) => this._column(c, d[c.key])).join('')}</div>
    </div>`);
    this.$$('[data-approve]').forEach((b) => b.addEventListener('click', () => this._approve(b.dataset.approve)));
    this.$$('[data-cancel]').forEach((b) => b.addEventListener('click', () => this._cancel(b.dataset.cancel)));
  }

  _column({ key, label, mode }, items) {
    const list = Array.isArray(items) ? items : [];
    const cards = list.map((it) => this._card(it, mode)).join('');
    return `<div class="kcol" data-k="${esc(key)}">
      <div class="kcol-h"><span class="kdot"></span><span class="kn">${esc(label)}</span><span class="kc">${list.length}</span></div>
      <div class="kcards">${cards || `<div class="kempty">— empty —</div>`}</div>
    </div>`;
  }

  _card(it, mode) {
    const src = SRC_LABEL[it.source] || it.source || '';
    const title = it.title || it.targetSlug || it.id || '(untitled)';
    // SOW-087 flags are loud (a flagged item always needs an explicit approval); SOW-088 manual sends are
    // visibly distinct from the auto pipeline, and a superseded twin says why it was cancelled.
    const manual = it.trigger === 'manual' ? `<span class="manual">MANUAL${it.manualBy ? ` · ${esc(String(it.manualBy))}` : ''}</span>` : '';
    const flags = Array.isArray(it.flags) && it.flags.length ? it.flags.map((f) => `<span class="flag">⚠ ${esc(f)}</span>`).join('') : '';
    const cat = it.category ? `<span class="cat">#${esc(it.category)}</span>` : '';
    const when = it.sentAt || it.cancelledAt || it.enqueuedAt;
    const whenLine = when ? `<div class="when">${esc(new Date(when).toLocaleString())}</div>` : '';
    const reason = it.cancelReason ? `<div class="d">${esc(it.cancelReason)}</div>` : '';
    let tail = '';
    if (mode === 'pending') {
      tail = `<div class="acts"><button class="approve" data-approve="${esc(it.id)}" type="button">Approve</button><button class="cancel" data-cancel="${esc(it.id)}" type="button">Reject</button></div>`;
    } else if (mode === 'approved') {
      tail = `<div class="acts"><button class="cancel" data-cancel="${esc(it.id)}" type="button">Cancel</button></div>`;
    } else {
      tail = `<div class="chs">${this._channels(it.perChannel)}</div>`;
    }
    return `<div class="kcard">
      <div class="top"><span class="src">${esc(src)}</span>${manual}${flags}${cat}</div>
      <b class="ti">${esc(title)}</b>
      ${it.url ? `<div class="d">${esc(it.url)}</div>` : ''}${reason}${tail}${whenLine}
    </div>`;
  }

  _channels(perChannel) {
    if (!perChannel || typeof perChannel !== 'object') return '';
    return Object.entries(perChannel).map(([name, r]) => {
      const status = r?.status || 'pending';
      return r?.url
        ? `<a class="ch ${esc(status)}" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(name)}</a>`
        : `<span class="ch ${esc(status)}">${esc(name)}: ${esc(status)}</span>`;
    }).join('');
  }

  async _approve(id) {
    if (!id) return;
    this._busy = true; this.render();
    try {
      const r = await this.client.approveSyndication({ id });
      this._msg = r?.approved ? 'Approved. It posts to every enabled channel on the next tick.' : `Could not approve (status: ${r?.status || 'unknown'}).`;
      await this.load();
    } catch (e) {
      this._msg = e?.message || 'Approve failed.';
    } finally {
      this._busy = false;
      this.render();
    }
  }

  async _cancel(id) {
    if (!id) return;
    if (typeof confirm === 'function' && !confirm('Reject this syndication item? It will not be posted.')) return;
    this._busy = true; this.render();
    try {
      const r = await this.client.cancelSyndication({ id });
      this._msg = r?.cancelled ? 'Removed from the queue.' : `Could not cancel (status: ${r?.status || 'unknown'}).`;
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
