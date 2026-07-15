// <gbti-social-queue> (SOW-121): the superadmin Social Queue popup. A manual-assist worklist for channels
// that cost money to post (X, after its free API tier was deprecated): the system renders + queues the post,
// a human posts it by hand through the FREE web composer, then marks it done. Three tabs: To do (pending
// tasks: Assist -> the pre-filled web composer, Done, Delete), Manual done (posted-by-hand history), and Auto
// done (the adapter-posted activity, reused from client.syndicationQueue()). Superadmin-gated by the Worker
// (a non-superadmin read 403s); this component renders that error state. Inert without a client. It renders
// its own centered panel inside the shell's .compose-modal overlay; the X close button dispatches
// gbti-social-close for the overlay to catch.
import { GbtiElement, define, esc } from '../base.mjs';

// The free web composer for a manual-assist channel (X opens the intent composer, pre-filled). Inlined here
// (rather than importing the membership helper) so the client bundle carries no cross-package dependency.
const composeUrl = (channel, text) => (channel === 'x' ? `https://twitter.com/intent/tweet?text=${encodeURIComponent(String(text || ''))}` : null);
const CH_LABEL = { x: 'X', discord: 'Discord', reddit: 'Reddit', devto: 'dev.to', linkedin: 'LinkedIn', mastodon: 'Mastodon', bluesky: 'Bluesky' };
const SRC_LABEL = { share: 'Share', post: 'Article', product: 'Product', prompt: 'Prompt' };

const CSS = `
  :host { display:block; width:min(760px, 94vw); max-height:86vh; overflow:auto; background:var(--bg); color:var(--fg);
    border:1.5px solid var(--line); border-radius:14px; box-shadow:var(--sh-lg, 0 24px 60px rgba(0,0,0,.4)); font-family:var(--font-body); }
  .hd { display:flex; align-items:center; gap:12px; padding:16px 18px; border-bottom:1.5px solid var(--line); position:sticky; top:0; background:var(--bg); z-index:2; }
  .hd h2 { margin:0; font-family:var(--font-display, inherit); font-weight:800; font-size:17px; flex:1; }
  .hd .x { background:none; border:1.5px solid var(--line); border-radius:8px; color:var(--fg-mute, var(--muted)); width:32px; height:32px; cursor:pointer; font-size:16px; line-height:1; }
  .hd .x:hover { border-color:var(--fg-mute, var(--muted)); }
  .body { padding:14px 18px 18px; }
  .tabs { display:flex; gap:4px; margin:0 0 12px; }
  .tab { font:inherit; font-size:12.5px; font-weight:700; color:var(--muted); background:none; border:1.5px solid var(--line); border-radius:999px; padding:5px 12px; cursor:pointer; }
  .tab.on { color:var(--brand); border-color:var(--brand); background:var(--brand-tint, rgba(31,158,95,.1)); }
  .tab .n { font-family:var(--font-mono, monospace); font-size:10.5px; opacity:.8; margin-left:5px; }
  .hint { color:var(--muted); font-size:12px; margin:0 0 12px; line-height:1.5; }
  .msg { font-size:12.5px; color:var(--accent); margin:0 0 10px; } .msg.err { color:var(--danger, #e06c6c); }
  .empty { padding:22px 10px; text-align:center; color:var(--muted); font-family:var(--font-mono, monospace); font-size:12px; }
  .busy { opacity:.55; pointer-events:none; }

  .task { border:1.5px solid var(--line); border-radius:10px; padding:12px 13px; margin:0 0 10px; }
  .task .top { display:flex; align-items:center; gap:8px; margin-bottom:7px; flex-wrap:wrap; }
  .ch { font-size:10px; font-weight:800; letter-spacing:.04em; text-transform:uppercase; color:var(--brand); border:1px solid var(--brand); border-radius:5px; padding:1px 6px; }
  .src { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:1px 7px; }
  .task .ti { font-weight:700; font-size:13.5px; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .task .when { font-size:11px; color:var(--muted); font-variant-numeric:tabular-nums; white-space:nowrap; }
  .task .txt { font-size:12.5px; color:var(--fg-soft, var(--fg)); background:var(--hover); border-radius:7px; padding:8px 10px; margin:0 0 9px; white-space:pre-wrap; word-break:break-word; line-height:1.5; max-height:120px; overflow:auto; }
  .acts { display:flex; gap:7px; flex-wrap:wrap; }
  .btn { font:inherit; font-size:12px; font-weight:700; border-radius:7px; padding:6px 12px; cursor:pointer; border:1.5px solid var(--line); background:none; color:var(--fg); }
  .btn.assist { color:#fff; background:var(--brand); border-color:var(--brand); }
  .btn.assist:hover { filter:brightness(1.06); }
  .btn.done { color:var(--brand); border-color:var(--brand); }
  .btn.del { color:var(--danger, #e06c6c); } .btn.del:hover { border-color:var(--danger, #e06c6c); }
  .btn.copy:hover, .btn.done:hover { border-color:var(--fg-mute, var(--muted)); }
`;

class GbtiSocialQueue extends GbtiElement {
  connectedCallback() {
    super.connectedCallback();
    this._tab = this._tab || 'todo';
    this._data = null; // { pending, done }
    this._auto = null; // syndicationQueue() sent bucket (lazy)
    this._msg = '';
    this._err = false;
    this._busy = false;
    if (this.client) this.load();
    else this.render();
  }

  async load() {
    if (!this.client) { this.render(); return; }
    this._loading = true;
    try {
      this._data = await this.client.socialQueue();
      this._err = false;
    } catch (e) {
      this._err = true;
      this._msg = e?.message || 'Could not load the Social Queue.';
    }
    this._loading = false;
    this.render();
  }

  async _loadAuto() {
    if (this._auto || !this.client) return;
    try { const q = await this.client.syndicationQueue(); this._auto = Array.isArray(q?.sent) ? q.sent : []; }
    catch { this._auto = []; }
    this.render();
  }

  render() {
    if (!this.client) { this.set(this.css(CSS) + this._shell(`<p class="empty">Open in the GBTI client (superadmin) to use the Social Queue.</p>`)); this._wireClose(); return; }
    if (this._err) { this.set(this.css(CSS) + this._shell(`<p class="msg err">${esc(this._msg)}</p><button class="btn" data-reload type="button">Retry</button>`)); this._wireClose(); this.$('[data-reload]')?.addEventListener('click', () => this.load()); return; }
    if (!this._data) { if (!this._loading) this.load(); this.set(this.css(CSS) + this._shell(`<p class="empty">Loading the Social Queue...</p>`)); this._wireClose(); return; }

    const pending = this._data.pending || [];
    const done = this._data.done || [];
    const auto = this._auto || [];
    const tabBtn = (k, label, n) => `<button class="tab ${this._tab === k ? 'on' : ''}" data-tab="${k}" type="button">${label}<span class="n">${n}</span></button>`;
    let list = '';
    if (this._tab === 'todo') list = pending.length ? pending.map((t) => this._todoRow(t)).join('') : `<p class="empty">Nothing to post by hand right now.</p>`;
    else if (this._tab === 'manual') list = done.length ? done.map((t) => this._doneRow(t)).join('') : `<p class="empty">No manual posts yet.</p>`;
    else list = auto.length ? auto.map((it) => this._autoRow(it)).join('') : `<p class="empty">No automated posts yet.</p>`;

    const hint = this._tab === 'todo'
      ? 'These would have auto-posted to a pay-to-post channel. Click Assist to open the free web composer with the text pre-filled, post it by hand, then mark it Done.'
      : this._tab === 'manual' ? 'Posts you have already sent by hand.' : 'Posts the system sent automatically (Discord, dev.to, and other free channels).';

    this.set(this.css(CSS) + this._shell(`
      ${this._msg ? `<p class="msg">${esc(this._msg)}</p>` : ''}
      <div class="tabs">
        ${tabBtn('todo', 'To do', pending.length)}
        ${tabBtn('manual', 'Manual done', done.length)}
        ${tabBtn('auto', 'Auto done', auto.length || '')}
      </div>
      <p class="hint">${esc(hint)}</p>
      <div class="${this._busy ? 'busy' : ''}">${list}</div>
    `));
    this._wireClose();
    this.$$('[data-tab]').forEach((b) => b.addEventListener('click', () => { this._tab = b.dataset.tab; if (this._tab === 'auto') this._loadAuto(); this.render(); }));
    this.$$('[data-assist]').forEach((b) => b.addEventListener('click', () => this._assist(b.dataset.assist)));
    this.$$('[data-copy]').forEach((b) => b.addEventListener('click', () => this._copy(b.dataset.copy)));
    this.$$('[data-done]').forEach((b) => b.addEventListener('click', () => this._action('done', b.dataset.done)));
    this.$$('[data-del]').forEach((b) => b.addEventListener('click', () => this._action('delete', b.dataset.del)));
  }

  _shell(inner) {
    return `<div class="hd"><h2>Social Queue</h2><button class="x" data-close type="button" aria-label="Close">✕</button></div><div class="body">${inner}</div>`;
  }
  _wireClose() { this.$('[data-close]')?.addEventListener('click', () => this.dispatchEvent(new CustomEvent('gbti-social-close', { bubbles: true, composed: true }))); }

  _byId(id) { return (this._data?.pending || []).find((t) => t.id === id) || (this._data?.done || []).find((t) => t.id === id) || null; }

  _todoRow(t) {
    const url = composeUrl(t.channel, t.text);
    const assist = url
      ? `<button class="btn assist" data-assist="${esc(t.id)}" type="button">Assist post to ${esc(CH_LABEL[t.channel] || t.channel)}</button>`
      : `<button class="btn copy" data-copy="${esc(t.id)}" type="button">Copy text</button>`;
    return `<div class="task">
      <div class="top"><span class="ch">${esc(CH_LABEL[t.channel] || t.channel)}</span><span class="src">${esc(SRC_LABEL[t.source] || t.source || '')}</span><span class="ti">${esc(t.title || t.itemId || '(untitled)')}</span></div>
      <div class="txt">${esc(t.text || '')}</div>
      <div class="acts">${assist}<button class="btn copy" data-copy="${esc(t.id)}" type="button">Copy</button><button class="btn done" data-done="${esc(t.id)}" type="button">Mark done</button><button class="btn del" data-del="${esc(t.id)}" type="button">Delete</button></div>
    </div>`;
  }
  _doneRow(t) {
    return `<div class="task">
      <div class="top"><span class="ch">${esc(CH_LABEL[t.channel] || t.channel)}</span><span class="src">${esc(SRC_LABEL[t.source] || t.source || '')}</span><span class="ti">${esc(t.title || '(untitled)')}</span><span class="when">${t.doneAt ? esc(new Date(t.doneAt).toLocaleString()) : ''}</span></div>
      <div class="acts"><button class="btn del" data-del="${esc(t.id)}" type="button">Delete</button></div>
    </div>`;
  }
  _autoRow(it) {
    const chans = it.perChannel && typeof it.perChannel === 'object'
      ? Object.entries(it.perChannel).map(([n, r]) => `<span class="ch" style="border-color:var(--line);color:var(--muted)">${esc(CH_LABEL[n] || n)}: ${esc(r?.status || 'sent')}</span>`).join(' ')
      : '';
    return `<div class="task"><div class="top"><span class="src">${esc(SRC_LABEL[it.source] || it.source || '')}</span><span class="ti">${esc(it.title || it.targetSlug || '(untitled)')}</span><span class="when">${it.sentAt ? esc(new Date(it.sentAt).toLocaleString()) : ''}</span></div><div class="acts" style="gap:5px">${chans}</div></div>`;
  }

  _assist(id) {
    const t = this._byId(id);
    if (!t) return;
    const url = composeUrl(t.channel, t.text);
    if (url) { try { window.open(url, '_blank', 'noopener'); } catch { /* popup blocked */ } }
    this._msg = 'Opened the composer. Post it, then click "Mark done".';
    this.render();
  }
  async _copy(id) {
    const t = this._byId(id);
    if (!t) return;
    try { await navigator.clipboard?.writeText?.(t.text || ''); this._msg = 'Copied the post text.'; }
    catch { this._msg = 'Could not copy automatically; select the text to copy it.'; }
    this.render();
  }
  async _action(action, id) {
    if (!id) return;
    if (action === 'delete' && typeof confirm === 'function' && !confirm('Delete this item from the Social Queue?')) return;
    this._busy = true; this.render();
    try {
      await this.client.socialQueueAction({ action, id });
      this._msg = action === 'done' ? 'Marked done.' : 'Deleted.';
      await this.load();
    } catch (e) {
      this._msg = e?.message || 'Action failed.';
    } finally {
      this._busy = false;
      this.render();
    }
  }
}

define('gbti-social-queue', GbtiSocialQueue);
export { GbtiSocialQueue };
