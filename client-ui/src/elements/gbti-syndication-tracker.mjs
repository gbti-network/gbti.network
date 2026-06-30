// <gbti-syndication-tracker> (SOW-058): the superadmin read-view of the syndication queue. Reads
// client.syndicationQueue() -> { pending, approved, sent, cancelled, failed } and renders the buckets. NOTHING posts
// until a superadmin approves it: a PENDING item shows Approve + Reject (superadmin only), an APPROVED item shows a
// Cancel until the drain posts it. The role gate here is UX-only — the Worker (GET admin-gated, approve/cancel
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
  .approve { flex:none; font:inherit; font-size:12.5px; font-weight:700; color:#fff; background:var(--accent); border:1px solid var(--accent); border-radius:6px; padding:5px 12px; cursor:pointer; }
  .approve:hover { filter:brightness(1.05); }
  .busy { opacity:.55; pointer-events:none; }
`;

const SRC_LABEL = { share: 'Share', post: 'Article', product: 'Product', prompt: 'Prompt' };

class GbtiSyndicationTracker extends GbtiElement {
  // SOW-070 fix: in admin.html's static markup, so it upgrades BEFORE admin.mjs injects the client. render() retries
  // the load the moment the client arrives (setClient re-renders subscribers) -- no eager load() that early-returns.
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
    if (!this.client) { this.set(this.css(CSS) + `<p class="muted">Open in the GBTI client (admin) to view syndication.</p>`); return; }
    if (this._err) { this.set(this.css(CSS) + `<div class="head"><h3>Syndication</h3></div><p class="msg err">${esc(this._msg)}</p><button class="cancel" data-reload type="button" style="color:var(--accent)">Retry</button>`); this.$('[data-reload]')?.addEventListener('click', () => this.load()); return; }
    if (!this._data) { if (!this._err && !this._loading) { this._loading = true; this.load(); } this.set(this.css(CSS) + `<p class="muted">Loading syndication queue...</p>`); return; }
    const d = this._data;
    this.set(this.css(CSS) + `<div class="${this._busy ? 'busy' : ''}">
      <div class="head"><h3>Syndication queue</h3><span class="hint">Nothing posts until a superadmin approves it. Approved items post to every enabled channel on the next tick.</span></div>
      ${this._msg ? `<p class="msg">${esc(this._msg)}</p>` : ''}
      ${this._bucket('Pending approval', d.pending, 'pending')}
      ${this._bucket('Approved', d.approved, 'approved')}
      ${this._bucket('Sent', d.sent, 'done')}
      ${this._bucket('Failed', d.failed, 'done')}
      ${this._bucket('Cancelled', d.cancelled, 'done')}
    </div>`);
    this.$$('[data-approve]').forEach((b) => b.addEventListener('click', () => this._approve(b.dataset.approve)));
    this.$$('[data-cancel]').forEach((b) => b.addEventListener('click', () => this._cancel(b.dataset.cancel)));
  }

  _bucket(label, items, mode) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return `<div class="bucket"><h4>${esc(label)} (0)</h4><p class="muted">None.</p></div>`;
    const rows = list.map((it) => {
      const src = SRC_LABEL[it.source] || it.source || '';
      const title = it.title || it.targetSlug || it.id || '(untitled)';
      let right;
      if (mode === 'pending') {
        right = `<button class="approve" data-approve="${esc(it.id)}" type="button">Approve</button><button class="cancel" data-cancel="${esc(it.id)}" type="button">Reject</button>`;
      } else if (mode === 'approved') {
        right = `<span class="when">posting soon</span><button class="cancel" data-cancel="${esc(it.id)}" type="button">Cancel</button>`;
      } else {
        right = `<span class="chs">${this._channels(it.perChannel)}</span>`;
      }
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
