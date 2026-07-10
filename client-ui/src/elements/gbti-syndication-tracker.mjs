// <gbti-syndication-tracker> (SOW-058 + SOW-088): the superadmin PUBLISHING ACTIVITY view of the
// syndication queue, as a compact filterable DATATABLE (owner-directed 2026-07-10; the kanban read poorly
// with lopsided buckets). Reads client.syndicationQueue() -> { pending, approved, sent, cancelled, failed },
// merges the buckets into one newest-first list with a status column, and filters client-side by status,
// type, trigger, and a title search. A PENDING row shows Approve + Reject (superadmin only), an APPROVED
// row shows Cancel until the drain posts it. The role gate here is UX-only — the Worker (GET admin-gated,
// approve/cancel superadmin-only) is the real boundary. Inert without a client.
import { GbtiElement, define, esc } from '../base.mjs';

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .hint { color:var(--muted); font-size:12px; margin:0 0 10px; }
  .msg { font-size:13px; color:var(--accent); margin:6px 0 10px; }
  .msg.err { color:var(--danger, #e06c6c); }
  .muted { color:var(--muted); font-size:13.5px; }
  .busy { opacity:.55; pointer-events:none; }

  /* filter bar */
  .fbar { display:flex; gap:8px; flex-wrap:wrap; margin:0 0 10px; }
  /* the shared BASE_CSS widens every select/input to 100%; the filter bar wants natural inline widths */
  .fbar select, .fbar input { width:auto; font:inherit; font-size:12.5px; color:var(--fg); background:var(--bg);
    border:1.5px solid var(--line); border-radius:7px; padding:6px 9px; outline:none; }
  .fbar select:focus, .fbar input:focus { border-color:var(--brand); }
  .fbar input { flex:1; min-width:140px; }
  .fbar .count { align-self:center; font-family:var(--font-mono, monospace); font-size:11px; color:var(--muted); margin-left:auto; }

  /* the datatable: low padding, dense rows */
  .twrap { border:1.5px solid var(--line); border-radius:7px; overflow-x:auto; }
  table { width:100%; border-collapse:collapse; font-size:12.5px; }
  thead th { font-family:var(--font-mono, monospace); font-size:10px; letter-spacing:.06em; text-transform:uppercase;
    color:var(--muted); text-align:left; font-weight:700; padding:7px 10px; border-bottom:1.5px solid var(--line);
    background:var(--hover); white-space:nowrap; }
  tbody td { padding:6px 10px; border-top:1px solid var(--line); vertical-align:middle; }
  tbody tr:first-child td { border-top:0; }
  tbody tr:hover td { background:var(--hover); }
  td.ti { max-width:340px; }
  td.ti .t { font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:block; max-width:340px; }
  td.ti a.t { color:var(--fg); text-decoration:none; }
  td.ti a.t:hover { color:var(--accent); }
  td.ti .r { font-size:11px; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:block; max-width:340px; }
  .st { display:inline-flex; align-items:center; gap:6px; font-family:var(--font-mono, monospace); font-size:10.5px;
    letter-spacing:.04em; text-transform:uppercase; color:var(--muted); white-space:nowrap; }
  .st .dot { width:7px; height:7px; border-radius:50%; flex:none; }
  .st-pending .dot { background:#d8901a; } .st-approved .dot { background:#3f74d6; }
  .st-sent .dot { background:var(--brand); } .st-failed .dot { background:var(--danger, #e06c6c); }
  .st-cancelled .dot { background:var(--muted); }
  .src { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--muted);
    border:1px solid var(--line); border-radius:999px; padding:1px 7px; white-space:nowrap; }
  .manual { font-size:9.5px; font-weight:800; letter-spacing:.05em; color:#d8901a; border:1px solid #d8901a; border-radius:3px; padding:0 4px; margin-left:5px; }
  .flag { font-size:10px; font-weight:700; color:#8a5a00; background:rgba(240,170,20,.18); border:1px solid rgba(240,170,20,.5); border-radius:5px; padding:0 5px; margin-left:5px; }
  .chs { display:flex; gap:4px; flex-wrap:wrap; }
  .ch { font-size:10px; border-radius:999px; padding:0 6px; border:1px solid var(--line); color:var(--muted); text-decoration:none; white-space:nowrap; }
  .ch.sent { color:var(--accent); border-color:var(--accent); } .ch.failed { color:var(--danger, #e06c6c); border-color:var(--danger, #e06c6c); }
  .ch.skipped { opacity:.7; }
  td.wh { font-size:11px; color:var(--muted); font-variant-numeric:tabular-nums; white-space:nowrap; }
  td.ac { white-space:nowrap; text-align:right; }
  .approve { font:inherit; font-size:11.5px; font-weight:700; color:#fff; background:var(--brand); border:1px solid var(--brand); border-radius:7px; padding:4px 10px; cursor:pointer; }
  .approve:hover { filter:brightness(1.06); }
  .cancel { font:inherit; font-size:11.5px; font-weight:600; color:var(--danger, #e06c6c); background:none; border:1px solid var(--line); border-radius:7px; padding:4px 10px; cursor:pointer; margin-left:6px; }
  .cancel:hover { border-color:var(--danger, #e06c6c); }
  .empty { padding:14px 10px; font-family:var(--font-mono, monospace); font-size:11.5px; color:var(--muted); text-align:center; }
`;

const SRC_LABEL = { share: 'Share', post: 'Article', product: 'Product', prompt: 'Prompt' };
const STATUSES = ['pending', 'approved', 'sent', 'failed', 'cancelled'];

class GbtiSyndicationTracker extends GbtiElement {
  // SOW-070 fix: in static admin markup this upgrades BEFORE the host injects the client. render() retries
  // the load the moment the client arrives (setClient re-renders subscribers) -- no eager load().
  connectedCallback() {
    super.connectedCallback();
    this._data = null;
    this._msg = '';
    this._err = false;
    this._busy = false;
    this._fStatus = this._fStatus || 'all';
    this._fType = this._fType || 'all';
    this._fTrigger = this._fTrigger || 'all';
    this._fQ = this._fQ || '';
  }

  async load() {
    if (!this.client) { this.render(); return; }
    try { this._data = await this.client.syndicationQueue(); this._err = false; }
    catch (e) { this._data = null; this._err = true; this._msg = e?.message || 'Could not load the syndication queue.'; }
    this._loading = false;
    this.render();
  }

  /** Merge the buckets into one list with a status field, newest activity first. */
  _rows() {
    const d = this._data || {};
    const all = [];
    for (const st of STATUSES) for (const it of (Array.isArray(d[st]) ? d[st] : [])) all.push({ ...it, _st: st });
    all.sort((a, b) => (b.sentAt || b.cancelledAt || b.enqueuedAt || 0) - (a.sentAt || a.cancelledAt || a.enqueuedAt || 0));
    const q = this._fQ.trim().toLowerCase();
    return all.filter((it) =>
      (this._fStatus === 'all' || it._st === this._fStatus)
      && (this._fType === 'all' || it.source === this._fType)
      && (this._fTrigger === 'all' || (this._fTrigger === 'manual' ? it.trigger === 'manual' : it.trigger !== 'manual'))
      && (!q || String(it.title || it.targetSlug || '').toLowerCase().includes(q)));
  }

  render() {
    if (!this.client) { this.set(this.css(CSS) + `<p class="muted">Open in the GBTI client (admin) to view the publishing activity.</p>`); return; }
    if (this._err) { this.set(this.css(CSS) + `<p class="msg err">${esc(this._msg)}</p><button class="cancel" data-reload type="button" style="color:var(--accent)">Retry</button>`); this.$('[data-reload]')?.addEventListener('click', () => this.load()); return; }
    if (!this._data) { if (!this._err && !this._loading) { this._loading = true; this.load(); } this.set(this.css(CSS) + `<p class="muted">Loading the publishing activity...</p>`); return; }
    const rows = this._rows();
    const opt = (v, label, cur) => `<option value="${esc(v)}"${cur === v ? ' selected' : ''}>${esc(label)}</option>`;
    const body = rows.map((it) => this._row(it)).join('');
    this.set(this.css(CSS) + `<div class="${this._busy ? 'busy' : ''}">
      <p class="hint">A pending item posts to every enabled channel once approved (or after the hold window when auto-post is on). Flagged items always wait for a human.</p>
      ${this._msg ? `<p class="msg">${esc(this._msg)}</p>` : ''}
      <div class="fbar">
        <select data-f="status" aria-label="Filter by status">${opt('all', 'All statuses', this._fStatus)}${STATUSES.map((s) => opt(s, s[0].toUpperCase() + s.slice(1), this._fStatus)).join('')}</select>
        <select data-f="type" aria-label="Filter by type">${opt('all', 'All types', this._fType)}${Object.entries(SRC_LABEL).map(([v, l]) => opt(v, l, this._fType)).join('')}</select>
        <select data-f="trigger" aria-label="Filter by trigger">${opt('all', 'Manual + auto', this._fTrigger)}${opt('manual', 'Manual only', this._fTrigger)}${opt('auto', 'Auto only', this._fTrigger)}</select>
        <input data-f="q" type="search" placeholder="Search titles" value="${esc(this._fQ)}" aria-label="Search titles" />
        <span class="count">${rows.length} item${rows.length === 1 ? '' : 's'}</span>
      </div>
      <div class="twrap"><table>
        <thead><tr><th>Status</th><th>Type</th><th>Item</th><th>Channels</th><th>When</th><th></th></tr></thead>
        <tbody>${body || `<tr><td colspan="6"><div class="empty">Nothing matches the filters.</div></td></tr>`}</tbody>
      </table></div>
    </div>`);
    this.$$('[data-f]').forEach((el) => el.addEventListener(el.dataset.f === 'q' ? 'input' : 'change', () => {
      if (el.dataset.f === 'status') this._fStatus = el.value;
      else if (el.dataset.f === 'type') this._fType = el.value;
      else if (el.dataset.f === 'trigger') this._fTrigger = el.value;
      else this._fQ = el.value;
      const focusQ = el.dataset.f === 'q';
      this.render();
      if (focusQ) { const q = this.$('[data-f="q"]'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
    }));
    this.$$('[data-approve]').forEach((b) => b.addEventListener('click', () => this._approve(b.dataset.approve)));
    this.$$('[data-cancel]').forEach((b) => b.addEventListener('click', () => this._cancel(b.dataset.cancel)));
  }

  _row(it) {
    const st = it._st;
    const title = it.title || it.targetSlug || it.id || '(untitled)';
    // SOW-087 flags are loud (a flagged item always needs an explicit approval); SOW-088 manual sends are
    // visibly distinct from the auto pipeline, and a superseded twin says why it was cancelled.
    const manual = it.trigger === 'manual' ? `<span class="manual">MANUAL${it.manualBy ? ` · ${esc(String(it.manualBy))}` : ''}</span>` : '';
    const flags = Array.isArray(it.flags) && it.flags.length ? it.flags.map((f) => `<span class="flag">⚠ ${esc(f)}</span>`).join('') : '';
    const when = it.sentAt || it.cancelledAt || it.enqueuedAt;
    const sub = it.cancelReason || it.url || '';
    let actions = '';
    if (st === 'pending') actions = `<button class="approve" data-approve="${esc(it.id)}" type="button">Approve</button><button class="cancel" data-cancel="${esc(it.id)}" type="button">Reject</button>`;
    else if (st === 'approved') actions = `<button class="cancel" data-cancel="${esc(it.id)}" type="button" style="margin-left:0">Cancel</button>`;
    const t = it.url
      ? `<a class="t" href="${esc(it.url)}" target="_blank" rel="noopener">${esc(title)}</a>`
      : `<span class="t">${esc(title)}</span>`;
    return `<tr>
      <td><span class="st st-${esc(st)}"><span class="dot"></span>${esc(st)}</span></td>
      <td><span class="src">${esc(SRC_LABEL[it.source] || it.source || '')}</span></td>
      <td class="ti">${t}${manual}${flags}${sub ? `<span class="r">${esc(sub)}</span>` : ''}</td>
      <td><span class="chs">${this._channels(it.perChannel)}</span></td>
      <td class="wh">${when ? esc(new Date(when).toLocaleString()) : ''}</td>
      <td class="ac">${actions}</td>
    </tr>`;
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
