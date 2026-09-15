// <gbti-cta-manager> (sow-281): the SUPERADMIN manager of the registered content CTAs (house/ctas.yml). Lists every
// CTA with its enabled state, lets a superadmin add one, edit its text and destination, enable or disable it, and
// assign it to (or unassign it from) any content item by type and ref. Every write is an admin op that lands as an
// auto-merged house PR (houseEditAck says so); the registry is superadmin-pinned in CODEOWNERS and the Worker ops
// carry ROLE_RANK.superadmin, so this surface is UX, not the boundary. A sibling of <gbti-quote-manager>.
//
// It reads TWO things: the live registry through the client (client.ctaPool, the Worker or the host's git read) so
// an edit shows at once, and the built /ctas.json artifact for the RESOLUTION of each assignment (title, link, and
// whether the ref names a real item). The artifact lags a deploy by a few minutes, so an assignment the artifact has
// not seen yet is shown as "resolving on the next deploy", never as broken. An assignment the artifact resolved to
// nothing is shown in red: the three states the SOW demands (no CTA, a disabled CTA, an assignment to nothing) are
// all distinct here. A failed load is its own state (sow-334): it shows the failure and a Try again button and does
// NOT retry on its own.
import { GbtiElement, define, esc } from '../base.mjs';
import { houseEditAck } from '../workspace-core.mjs';

const SITE = 'https://gbti.network';
const TYPES = ['prompt', 'post', 'project', 'share'];
const FIELDS = [
  ['label', 'Label', 'The card eyebrow, e.g. the book title'],
  ['line', 'Line', 'The one sentence on the card'],
  ['button', 'Button', 'Names the partner, e.g. Get the book on Amazon'],
  ['destination', 'Destination', 'https://... (an amazon CTA links straight to amazon with tag=)'],
  ['partner', 'Partner', 'amazon, codeable, ...'],
  ['note', 'Note', 'Where the URL came from, whose tag it carries'],
];

const CSS = `
  :host { display:block; }
  .head { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; margin:0 0 12px; }
  .hint { font-size:12.5px; color:var(--muted); }
  .msg { font-size:13px; color:var(--accent); margin:0 0 12px; }
  .busy { opacity:.55; pointer-events:none; }
  .btn { flex:none; border:1px solid var(--accent); background:var(--accent); color:#fff; border-radius:7px; font:inherit; font-weight:700; font-size:13px; padding:7px 14px; cursor:pointer; }
  .lk { flex:none; border:1px solid var(--line); background:var(--paper, transparent); color:var(--fg); border-radius:7px; font:inherit; font-size:12.5px; font-weight:600; padding:5px 11px; cursor:pointer; }
  .lk:hover { border-color:var(--accent); color:var(--accent); }
  .lk.danger:hover { border-color:var(--danger, #e06c6c); color:var(--danger, #e06c6c); }
  .form { display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:8px 12px; margin:0 0 14px; padding:12px; border:1px solid var(--line); border-radius:9px; }
  .form label { display:flex; flex-direction:column; gap:4px; font-size:12px; color:var(--muted); min-width:0; }
  .form input, .form select, .form textarea { font:inherit; font-size:13.5px; color:var(--fg); background:var(--paper, transparent); border:1px solid var(--line); border-radius:7px; padding:6px 9px; min-width:0; }
  .form textarea { resize:vertical; min-height:36px; }
  .form .acts { grid-column:1 / -1; display:flex; gap:8px; flex-wrap:wrap; }
  .list { list-style:none; margin:0; padding:0; }
  .c { border-top:1px solid var(--line); padding:12px 2px; }
  .c:first-child { border-top:0; }
  .c.off { opacity:.6; }
  .top { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .label { font-size:14.5px; font-weight:700; color:var(--fg); }
  .badge { font-size:11px; font-weight:700; letter-spacing:.02em; text-transform:uppercase; border-radius:999px; padding:2px 8px; border:1px solid var(--line); color:var(--muted); }
  .state.on { color:var(--accent); border-color:var(--accent); }
  .acts-r { margin-left:auto; display:flex; gap:6px; flex-wrap:wrap; }
  .line { margin:6px 0 0; font-size:13.5px; color:var(--fg); }
  .dest { display:block; font-size:12.5px; margin-top:3px; overflow-wrap:anywhere; }
  .dest a { color:var(--accent); }
  details { margin-top:6px; }
  summary { cursor:pointer; font-size:12.5px; color:var(--muted); }
  .note { font-size:13px; line-height:1.5; margin:6px 0 0; white-space:pre-line; }
  .items { list-style:none; margin:8px 0 0; padding:0; }
  .it { display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding:5px 0; font-size:13px; }
  .it .ty { font-family:var(--font-mono, monospace); font-size:11.5px; color:var(--muted); }
  .it a { color:var(--accent); }
  .it .bad { color:var(--danger, #e06c6c); font-weight:600; }
  .it .pending, .it .draft { color:var(--muted); }
  .assign { display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-top:8px; }
  .assign select, .assign input { font:inherit; font-size:13px; color:var(--fg); background:var(--paper, transparent); border:1px solid var(--line); border-radius:7px; padding:5px 8px; min-width:0; }
  .assign input { flex:1 1 200px; }
  .muted { color:var(--muted); }
  [hidden] { display:none !important; }
`;

class GbtiCtaManager extends GbtiElement {
  // The client-ready race (see gbti-quote-manager): the element sits in static admin markup and upgrades before the
  // client is injected, so render() starts the load when the client arrives, never connectedCallback.
  connectedCallback() { super.connectedCallback?.(); }

  async load() {
    if (!this.client) { this.render(); return; }
    this._loading = true; this._failed = false;
    this.render();
    try {
      const [pool, built] = await Promise.all([
        this.client.ctaPool(),
        fetch(`${SITE}/ctas.json`, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(`ctas.json ${r.status}`); return r.json(); }),
      ]);
      this._ctas = Array.isArray(pool?.ctas) ? pool.ctas : [];
      this._types = Array.isArray(pool?.types) && pool.types.length ? pool.types : TYPES;
      this._built = new Map((Array.isArray(built?.ctas) ? built.ctas : []).map((c) => [c.id, c]));
    } catch (e) {
      this._ctas = null; this._built = null; this._failed = true;
      this._msg = `Could not load the CTAs (${e?.message || 'unknown error'}).`;
    }
    this._loading = false;
    this.render();
  }

  /** The built artifact's view of one assignment: resolved / unresolved / not yet built. */
  _resolution(ctaId, it) {
    const b = this._built?.get(ctaId);
    if (!b) return { state: 'pending' };
    const hit = (b.items || []).find((x) => x.type === it.type && x.ref === it.ref);
    if (!hit) return { state: 'pending' };
    if (!hit.resolved) return { state: 'missing' };
    return { state: hit.live ? 'live' : 'draft', title: hit.title, url: hit.url };
  }

  render() {
    if (!this.client) { this.set(this.css(CSS) + `<p class="muted">Open in the GBTI client (superadmin) to manage CTAs.</p>`); return; }
    if (this._failed) {
      this.set(this.css(CSS) + `<p class="msg">${esc(this._msg)}</p><button class="lk" type="button" data-retry-load>Try again</button>`);
      this.$('[data-retry-load]')?.addEventListener('click', () => this.load());
      return;
    }
    if (!this._ctas) { if (!this._loading) this.load(); this.set(this.css(CSS) + `<p class="muted">Loading CTAs...</p>`); return; }
    const enabled = this._ctas.filter((c) => c && c.enabled === true).length;
    const rows = this._ctas.map((c) => this._row(c)).join('');
    this.set(this.css(CSS) + `<div class="${this._busy ? 'busy' : ''}">
      <div class="head"><span class="hint">${this._ctas.length} CTA${this._ctas.length === 1 ? '' : 's'}, ${enabled} enabled</span>
        <button class="lk" type="button" data-show-add>${this._adding ? 'Cancel' : 'Add a CTA'}</button></div>
      ${this._msg ? `<p class="msg">${esc(this._msg)}</p>` : ''}
      ${this._adding ? this._form('add', {}) : ''}
      <p class="hint" style="margin:0 0 12px">A CTA renders as its own sidebar card on every item it is assigned to, above the weekly digest, only while it is enabled. Edits open a house PR and go live on the next site deploy. Disable a CTA to retire it; the history stays.</p>
      <ul class="list">${rows || '<li class="muted">No CTAs yet.</li>'}</ul>
    </div>`);
    this._wire();
  }

  _form(mode, c) {
    const v = (k) => esc(c?.[k] ?? '');
    const fields = FIELDS.map(([k, label, hint]) => k === 'note'
      ? `<label style="grid-column:1 / -1">${label}<textarea data-f="${k}" placeholder="${esc(hint)}">${v(k)}</textarea></label>`
      : `<label>${label}<input data-f="${k}" type="text" value="${v(k)}" placeholder="${esc(hint)}" /></label>`).join('');
    const idField = mode === 'add' ? `<label>Id (kebab-case)<input data-f="id" type="text" placeholder="stranger-in-a-strange-land" /></label>` : '';
    return `<div class="form" data-form="${mode}" data-id="${esc(c?.id || '')}">${idField}${fields}
      <div class="acts"><button class="btn" type="button" data-submit>${mode === 'add' ? 'Add CTA' : 'Save'}</button>${mode === 'edit' ? `<button class="lk" type="button" data-cancel-edit>Cancel</button>` : ''}</div></div>`;
  }

  _row(c) {
    const on = c.enabled === true;
    const id = esc(c.id || '');
    const items = (Array.isArray(c.items) ? c.items : []).map((it) => {
      const r = this._resolution(c.id, it);
      const key = `${esc(it.type)}:${esc(it.ref)}`;
      let body;
      if (r.state === 'live') body = `<a href="${esc(SITE + r.url)}" target="_blank" rel="noopener">${esc(r.title || it.ref)}</a>`;
      else if (r.state === 'draft') body = `<span>${esc(r.title || it.ref)}</span> <span class="draft">(no public page yet)</span>`;
      else if (r.state === 'missing') body = `<span class="bad">No such item: ${key}</span>`;
      else body = `<span>${esc(it.ref)}</span> <span class="pending">(resolving on the next deploy)</span>`;
      return `<li class="it" data-item="${key}"><span class="ty">${esc(it.type)}</span>${body}<button class="lk danger" type="button" data-unassign="${id}" data-type="${esc(it.type)}" data-ref="${esc(it.ref)}">Unassign</button></li>`;
    }).join('');
    const typeOpts = (this._types || TYPES).map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
    return `<li class="c ${on ? '' : 'off'}" data-cta="${id}">
      <div class="top"><span class="label">${esc(c.label || c.id)}</span><span class="badge">${esc(c.partner || '')}</span><span class="badge state ${on ? 'on' : ''}">${on ? 'Enabled' : 'Disabled'}</span>
        <span class="acts-r"><button class="lk" type="button" data-edit="${id}">${this._editing === c.id ? 'Close' : 'Edit'}</button><button class="lk" type="button" data-toggle="${id}" data-on="${on ? '1' : '0'}">${on ? 'Disable' : 'Enable'}</button></span></div>
      <p class="line">${esc(c.line || '')}</p>
      <span class="dest"><a href="${esc(c.destination || '#')}" target="_blank" rel="noopener">${esc(c.destination || '')}</a> <span class="muted">(button: ${esc(c.button || '')})</span></span>
      ${c.note ? `<details><summary>Note</summary><p class="note">${esc(c.note)}</p></details>` : ''}
      ${this._editing === c.id ? this._form('edit', c) : ''}
      <ul class="items">${items || '<li class="it muted">Assigned to nothing yet.</li>'}</ul>
      <div class="assign"><select data-assign-type="${id}">${typeOpts}</select><input data-assign-ref="${id}" type="text" placeholder="the item slug, or author/id for a share" /><button class="lk" type="button" data-assign="${id}">Assign</button></div>
    </li>`;
  }

  _read(form) {
    const out = {};
    form.querySelectorAll('[data-f]').forEach((el) => { out[el.dataset.f] = String(el.value || '').trim(); });
    return out;
  }

  _wire() {
    this.on('[data-show-add]', 'click', () => { this._adding = !this._adding; this._msg = ''; this.render(); });
    this.$$('[data-form] [data-submit]').forEach((b) => b.addEventListener('click', () => {
      const form = b.closest('[data-form]');
      const fields = this._read(form);
      if (form.dataset.form === 'add') {
        if (!fields.id) { this._msg = 'An id is required.'; this.render(); return; }
        this._run(() => this.client.addCta(fields), () => { this._adding = false; });
      } else {
        this._run(() => this.client.updateCta({ id: form.dataset.id, ...fields }), () => { this._editing = null; });
      }
    }));
    this.$$('[data-cancel-edit]').forEach((b) => b.addEventListener('click', () => { this._editing = null; this.render(); }));
    this.$$('[data-edit]').forEach((b) => b.addEventListener('click', () => { this._editing = this._editing === b.dataset.edit ? null : b.dataset.edit; this._msg = ''; this.render(); }));
    this.$$('[data-toggle]').forEach((b) => b.addEventListener('click', () =>
      this._run(() => this.client.setCtaEnabled({ id: b.dataset.toggle, enabled: b.dataset.on !== '1' }))));
    this.$$('[data-assign]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.assign;
      const type = this.$(`[data-assign-type="${CSS_ESC(id)}"]`)?.value || '';
      const ref = (this.$(`[data-assign-ref="${CSS_ESC(id)}"]`)?.value || '').trim();
      if (!ref) { this._msg = 'A ref is required (the item slug, or author/id for a share).'; this.render(); return; }
      this._run(() => this.client.assignCta({ id, type, ref }));
    }));
    this.$$('[data-unassign]').forEach((b) => b.addEventListener('click', () => {
      const { unassign: id, type, ref } = b.dataset;
      if (typeof confirm === 'function' && !confirm(`Unassign this CTA from ${type}:${ref}?`)) return;
      this._run(() => this.client.unassignCta({ id, type, ref }));
    }));
  }

  async _run(fn, after) {
    this._busy = true; this._msg = ''; this.render();
    try {
      const r = await fn();
      this._msg = r?.noop ? 'No change (already in that state).' : (r?.prNumber ? houseEditAck(r) : 'Done.');
      after?.();
    } catch (e) {
      this._msg = e?.message || 'That edit failed.';
    }
    this._busy = false;
    await this.load();
  }
}

// Ids are kebab-case by the core's rule, so a plain attribute selector is safe; this guards the quote regardless.
const CSS_ESC = (s) => String(s || '').replace(/["\\]/g, '\\$&');

define('gbti-cta-manager', GbtiCtaManager);
export { GbtiCtaManager };
