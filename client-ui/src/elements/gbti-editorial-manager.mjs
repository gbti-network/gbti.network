// <gbti-editorial-manager> (sow-323 Phase 4): the superadmin EDITORIAL REVIEW QUEUE.
//
// Every member article, project and prompt starts members-only and a superadmin decides what becomes public
// (owner, 2026-09-12). The Worker records what is waiting and can publish it; this is where a person looks at
// the list and decides. Without this screen the queue exists and nothing ever opens it.
//
// It replaces <gbti-applications-manager> in the same slot on both admin pages, and deliberately does NOT copy
// that element's rank mismatch: the tab it sat in was superadmin-gated on the website and ungated in the
// extension, so an extension admin saw a lane whose every request the Worker refused. Both pages now gate it.
//
// APPROVING PUBLISHES TO THE OPEN WEB, which is why every guard here leans the strict way:
//   - The Worker commits the item BEFORE marking the record approved, so an interrupted approval leaves it
//     waiting and it comes back to this lane, rather than reading as approved with nothing published.
//   - A CORRUPT record renders as corrupt and cannot be decided. The Worker refuses it too, so this is the
//     second of two rather than the only one.
//   - Setting aside is confirmed like approving. It is not destructive, but it is a decision about somebody's
//     work, and the prompt says plainly that they are not told.
//   - A FAILED LOAD waits to be asked again (sow-334). Retrying from render() on "not loaded yet" is what made
//     the Channels manager fire 500 reads in two seconds against a failing route.
//
// Inert in public (no injected client). Host-agnostic: the website admin page and the extension admin page
// both mount it, and each supplies its own transport.
import { GbtiElement, define, esc } from '../base.mjs';
import { rowDecidable, rowSummary, decidePrompt, decidedMessage, queueSummary, typeLabel } from '../editorial-queue-view.mjs';

const CSS = `
  :host { display:block; }
  [hidden] { display:none !important; }
  .head { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; margin:0 0 12px; }
  .head h3 { margin:0; font-family:var(--font-display, inherit); font-size:17px; }
  .hint { font-size:12.5px; color:var(--muted); }
  .msg { font-size:13px; color:var(--accent); margin:0 0 12px; }
  .muted { color:var(--muted); font-size:13px; }
  .row { border:1px solid var(--line); border-radius:10px; padding:12px 14px; margin:0 0 10px; }
  .row.corrupt { border-color:var(--amber, #a9781c); }
  .top { display:flex; align-items:baseline; gap:9px; flex-wrap:wrap; margin:0 0 4px; }
  .top b { font-size:14px; overflow-wrap:anywhere; }
  .st { font-size:11px; text-transform:uppercase; letter-spacing:.04em; border:1px solid var(--line); border-radius:999px; padding:1px 8px; color:var(--muted); }
  .st.pending { color:var(--accent); border-color:var(--accent); }
  .st.approved { color:var(--green-fg, #1f9e5f); border-color:var(--green, #1f9e5f); }
  .st.dismissed, .st.unknown { color:var(--amber, #a9781c); border-color:var(--amber, #a9781c); }
  .sub { font-size:12.5px; color:var(--muted); overflow-wrap:anywhere; }
  .acts { display:flex; gap:8px; margin-top:11px; flex-wrap:wrap; align-items:center; }
  a.read { font-size:12.5px; color:var(--accent); }
  button, .lk { font:inherit; font-size:12.5px; font-weight:700; border-radius:7px; padding:5px 12px; cursor:pointer; background:none; border:1.5px solid var(--line); color:var(--fg); }
  button:hover:not([disabled]) { border-color:var(--accent); color:var(--accent); }
  button[disabled] { opacity:.45; cursor:default; }
`;

class GbtiEditorialManager extends GbtiElement {
  // The static admin markup upgrades BEFORE setClient injects the client, so the first render has no client.
  // render() starts the load once the client lands, guarded by _loading so it cannot loop, and a FAILURE sets
  // _failed rather than clearing _items: clearing them is what turns "it broke" back into "not loaded yet".
  connectedCallback() { super.connectedCallback?.(); }

  async load() {
    if (!this.client) { this.render(); return; }
    this._loading = true;
    this._failed = false;
    try {
      const res = await this.client.editorialQueue?.();
      this._items = Array.isArray(res?.items) ? res.items : [];
    } catch (err) {
      this._items = null;
      this._failed = true;
      this._msg = `Could not read the review queue (${err?.message || 'unknown error'}).`;
    }
    this._loading = false;
    this.render();
  }

  render() {
    if (!this.client) {
      this.set(this.css(CSS) + '<p class="muted">Open in the GBTI client as a superadmin to review member content.</p>');
      return;
    }
    if (this._failed) {
      this.set(this.css(CSS) + `<p class="msg">${esc(this._msg)}</p><button type="button" data-retry-load>Try again</button>`);
      this.$('[data-retry-load]')?.addEventListener('click', () => this.load());
      return;
    }
    if (!this._items) {
      if (!this._loading) this.load();
      this.set(this.css(CSS) + '<p class="muted">Loading the review queue...</p>');
      return;
    }

    const rows = this._items.map((i) => this._rowHtml(i)).join('');
    this.set(this.css(CSS) + `
      <div class="head">
        <h3>Editorial review</h3>
        <span class="hint">${esc(queueSummary(this._items))}</span>
      </div>
      ${this._msg ? `<p class="msg">${esc(this._msg)}</p>` : ''}
      ${rows || '<p class="muted">Nothing has been submitted yet. Member articles, projects and prompts arrive here when their author publishes them.</p>'}
    `);

    this.$$('[data-decide]').forEach((b) => b.addEventListener('click', () => this._decide(b.dataset.path, b.dataset.decide)));
  }

  _rowHtml(item) {
    const state = String(item?.state || 'unknown');
    const corrupt = item?.corrupt === true || state === 'unknown';
    const path = String(item?.path || '');
    const title = item?.title || item?.slug || path || 'an unnamed item';
    const decided = item?.decidedAt
      ? `<div class="sub">${esc(state)} by ${esc(item.decidedByLogin || item.decidedBy || 'a superadmin')} on ${esc(String(item.decidedAt).slice(0, 10))}</div>`
      : '';
    const read = item?.url ? `<a class="read" href="${esc(item.url)}" target="_blank" rel="noopener">Read it</a>` : '';
    const acts = rowDecidable(item)
      ? `<div class="acts">${read}
           <button data-decide="approve" data-path="${esc(path)}" type="button">Approve for the public site</button>
           <button data-decide="dismiss" data-path="${esc(path)}" type="button">Set aside</button>
         </div>`
      : corrupt
        ? '<div class="acts"><button type="button" disabled>Cannot be decided: this record is malformed</button></div>'
        : (read ? `<div class="acts">${read}</div>` : '');
    return `<div class="row${corrupt ? ' corrupt' : ''}">
      <div class="top"><b>${esc(title)}</b><span class="st ${esc(state)}">${esc(corrupt ? 'malformed' : state)}</span></div>
      <div class="sub">${esc(corrupt ? `${typeLabel(item?.type)} at ${path}` : rowSummary(item))}</div>
      ${decided}${acts}
    </div>`;
  }

  async _decide(path, decision) {
    const item = (this._items || []).find((i) => String(i?.path) === String(path));
    // eslint-disable-next-line no-alert
    if (typeof confirm === 'function' && !confirm(decidePrompt(item, decision))) return;
    this.$$('[data-decide]').forEach((b) => { b.disabled = true; });
    this._msg = decision === 'approve' ? 'Approving...' : 'Setting aside...';
    try {
      await this.client.decideEditorial({ path: String(path), decision });
      this._msg = decidedMessage(item, decision);
    } catch (err) {
      this._msg = err?.message || 'The decision could not be recorded.';
    }
    // Reload, so the lane shows what the Worker actually stored rather than what we sent it. A failed reload
    // lands on the retry message with the decision message already delivered above.
    this._items = null;
    this.render();
  }
}

define('gbti-editorial-manager', GbtiEditorialManager);
export { GbtiEditorialManager };
