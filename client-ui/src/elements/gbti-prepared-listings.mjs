// <gbti-prepared-listings> (sow-427): the superadmin's list of PREPARED PROJECT LISTINGS, mounted inside
// <gbti-coupon-manager> below the issued invites. A prepared listing is a project written for someone who is not a
// member yet, waiting in KV with its own invitation until that person claims it under their own name.
//
// ONLY A SUPERADMIN CLIENT CARRIES `preparedList` (src/lib/workbench-prepared.ts attaches it only when the page
// was built with isSuperadmin), and the coupon manager mounts this element only when it is there. An admin, and
// the extension, therefore never see it. The Worker re-checks superadmin on every call regardless; this element is
// the affordance, never the boundary.
//
// LOADS ONCE PER CLIENT (sow-334). A failed load shows the reason and a Try again button and waits to be asked; it
// never starts the next attempt from render(), which is how two admin sections once made hundreds of reads a second
// against a failing route. scripts/check-load-retry.mjs drives this element through the coupon manager.
//
// Rows come from the Worker's `listingSummary`, which never carries the personal message, the project body or an
// account number. Nothing here logs: the invitation code in each link is a bearer secret.

import { GbtiElement, define, esc } from '../base.mjs';
import {
  PREPARED_ACTION, PREPARE_NEW_HREF, preparedActions, preparedLinkFor, preparedProjectHref, preparedEditHref,
  preparedRowMeta, preparedStateLabel, preparedRowState, preparedDeleteConfirm, preparedResendCampaigns,
  preparedApplyResult, preparedLoadPlan,
} from '../prepared-listings-core.mjs';

// Every button class below names its OWN hover background: BASE_CSS gives a bare `button:hover` the brand green,
// which outranks a single class and turned hovered controls into solid green blocks elsewhere (sow-349). An anchor
// wearing a button class also needs text-decoration:none, or the UA underline survives (sow-356).
const CSS = `
  :host { display:block; }
  [hidden] { display:none !important; }
  .pl-head { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; margin:26px 0 12px; padding-top:20px; border-top:1px solid var(--line); }
  .pl-head h3 { margin:0; font-family:var(--font-display, inherit); font-size:17px; }
  .pl-hint { font-size:12.5px; color:var(--muted); flex:1 1 320px; }
  .pl-msg { font-size:13px; color:var(--accent); margin:0 0 12px; }
  .pl-msg.warn { color:var(--danger); }
  .pl-list { list-style:none; margin:0; padding:0; }
  .pl-row { border-top:1px solid var(--line); padding:12px 2px; }
  .pl-row:first-child { border-top:0; }
  .pl-row.busy { opacity:.55; pointer-events:none; }
  .pl-top { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .pl-title { font-weight:700; font-size:14.5px; color:var(--fg); overflow-wrap:anywhere; }
  .pl-st { font-family:var(--font-mono, monospace); font-size:11px; text-transform:uppercase; letter-spacing:.08em; border:1px solid var(--line); border-radius:999px; padding:2px 8px; color:var(--muted); }
  .pl-st.prepared { color:var(--accent); border-color:var(--accent); }
  .pl-st.publishing { color:var(--fg); border-color:var(--fg); }
  .pl-st.revoked, .pl-st.unknown { color:var(--danger); border-color:var(--danger); }
  .pl-meta { margin-top:5px; font-size:12.5px; color:var(--muted); display:flex; flex-wrap:wrap; gap:4px 14px; }
  .pl-link { display:flex; align-items:center; gap:8px; margin-top:8px; flex-wrap:wrap; }
  .pl-link input { flex:1 1 300px; width:auto; min-width:0; font-family:var(--font-mono, monospace); font-size:12px; padding:6px 9px; }
  .pl-acts { display:flex; align-items:center; gap:8px; margin-top:8px; flex-wrap:wrap; }
  .pl-acts select { width:auto; min-width:0; font-size:12.5px; padding:5px 8px; }
  .pl-btn { display:inline-flex; align-items:center; border:1px solid var(--line); background:var(--panel); color:var(--fg); border-radius:7px; font:inherit; font-size:12.5px; font-weight:600; padding:5px 11px; cursor:pointer; text-decoration:none; }
  .pl-btn:hover { background:var(--hover); border-color:var(--accent); color:var(--fg); }
  .pl-btn:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  .pl-btn[disabled] { opacity:.55; cursor:default; }
  .pl-btn.pl-danger { color:var(--danger); }
  .pl-btn.pl-danger:hover { background:var(--hover); border-color:var(--danger); color:var(--danger); }
  .pl-new { display:inline-flex; align-items:center; border:1px solid var(--accent); background:var(--accent); color:var(--on-accent); border-radius:7px; font-weight:700; font-size:13px; padding:7px 14px; text-decoration:none; }
  .pl-new:hover { background:var(--accent); border-color:var(--fg); color:var(--on-accent); }
  .pl-new:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  .pl-confirm { margin-top:9px; padding:9px 11px; border:1px solid var(--danger); border-radius:8px; font-size:13px; color:var(--fg); display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .pl-confirm span { flex:1 1 260px; }
  .pl-empty { font-size:13px; color:var(--muted); padding:10px 2px; }
`;

class GbtiPreparedListings extends GbtiElement {
  /** The coupon registry the host manager already read, for the Send again campaign choice. Never fetched here. */
  set coupons(list) {
    this._couponList = Array.isArray(list) ? list : [];
    if (this._status === 'ready' && this.isConnected) this.render();
  }

  async load() {
    const client = this.client;
    this._loadedFor = client;
    this._status = 'loading';
    let rows = null;
    try {
      const r = await client.preparedList();
      rows = Array.isArray(r?.listings) ? r.listings : null;
    } catch { rows = null; }
    if (client !== this.client) return; // a newer client arrived meanwhile; its own single load is the one that counts
    this._rows = rows;
    this._status = rows ? 'ready' : 'failed';
    this.render();
  }

  render() {
    // A different client (a sign-in change, a late setClient) earns exactly one fresh load; the same client never
    // loads twice from here, however often the host re-renders. preparedLoadPlan is the tested decision.
    const plan = preparedLoadPlan({ status: this._status, loadedFor: this._loadedFor, client: this.client });
    if (!plan.available) { this.set(''); return; }
    if (plan.reset) { this._status = 'idle'; this._rows = null; this._confirmId = null; }
    if (plan.load) this.load();
    const head = `<div class="pl-head"><h3>Prepared listings</h3>
      <span class="pl-hint">Projects prepared for someone who is not a member yet. Each has its own invitation link; the person claims the project under their own name with a free year, and writes their own author note.</span>
      <a class="pl-new" href="${esc(PREPARE_NEW_HREF)}">Prepare a listing</a></div>`;
    const msg = this._msg ? `<p class="pl-msg${this._msgWarn ? ' warn' : ''}" role="status">${esc(this._msg)}</p>` : '';
    if (this._status === 'loading') { this.set(this.css(CSS) + head + msg + '<p class="pl-empty">Loading prepared listings...</p>'); return; }
    if (this._status === 'failed') {
      this.set(this.css(CSS) + head + msg + `<p class="pl-empty">Could not load the prepared listings. The coupons and invites above are unaffected. <button type="button" class="pl-btn" data-retry>Try again</button></p>`);
      this.$('[data-retry]')?.addEventListener('click', () => { this._status = 'idle'; this._msg = null; this.render(); });
      return;
    }
    const rows = (this._rows || []).map((row) => this._rowHtml(row)).join('');
    this.set(this.css(CSS) + head + msg + `<ul class="pl-list">${rows || '<li class="pl-empty">No prepared listings yet.</li>'}</ul>`);
    this._wire();
  }

  _rowHtml(row) {
    const id = String(row?.id || '');
    const st = preparedRowState(row);
    const acts = preparedActions(row);
    const title = row?.title || row?.slug || 'Untitled project';
    const link = preparedLinkFor(row);
    const meta = preparedRowMeta(row).map((m) => `<span>${esc(m)}</span>`).join('');
    const btn = (act, label, extra = '') => `<button type="button" class="pl-btn${extra}" data-act="${act}" data-id="${esc(id)}">${esc(label)}</button>`;
    const parts = [];
    if (acts.includes(PREPARED_ACTION.edit)) parts.push(`<a class="pl-btn" href="${esc(preparedEditHref(id))}">Edit</a>`);
    if (acts.includes(PREPARED_ACTION.view)) parts.push(`<a class="pl-btn" href="${esc(preparedProjectHref(row))}" target="_blank" rel="noopener">View project</a>`);
    if (acts.includes(PREPARED_ACTION.revoke)) parts.push(btn('revoke', 'Revoke'));
    if (acts.includes(PREPARED_ACTION.resend)) {
      const camps = preparedResendCampaigns(this._couponList, row);
      const opts = camps.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
      parts.push(camps.length
        ? `<select data-camp="${esc(id)}" aria-label="Campaign for the new link">${opts}</select>${btn('resend', 'Send again')}`
        : `<span class="pl-meta">No active campaign to send it again with.</span>`);
    }
    if (acts.includes(PREPARED_ACTION.remove)) parts.push(btn('delete', 'Delete', ' pl-danger'));
    const confirm = this._confirmId === id && acts.includes(PREPARED_ACTION.remove)
      ? `<div class="pl-confirm"><span>${esc(preparedDeleteConfirm(row))}</span>${btn('confirm-delete', 'Delete for good', ' pl-danger')}${btn('cancel-delete', 'Keep it')}</div>`
      : '';
    return `<li class="pl-row${this._busyId === id ? ' busy' : ''}" data-id="${esc(id)}">
      <div class="pl-top"><span class="pl-title">${esc(title)}</span><span class="pl-st ${esc(st)}">${esc(preparedStateLabel(row))}</span></div>
      ${meta ? `<div class="pl-meta">${meta}</div>` : ''}
      ${link ? `<div class="pl-link"><input readonly value="${esc(link)}" aria-label="Invitation link for ${esc(title)}" />${btn('copy', 'Copy link')}</div>` : ''}
      ${parts.length ? `<div class="pl-acts">${parts.join('')}</div>` : ''}
      ${confirm}
    </li>`;
  }

  _wire() {
    this.$$('[data-act]').forEach((b) => b.addEventListener('click', () => this._act(b.dataset.act, b.dataset.id, b)));
  }

  _row(id) { return (this._rows || []).find((r) => r?.id === id) || null; }

  async _act(act, id, button) {
    const row = this._row(id);
    if (!row) return;
    if (act === 'copy') {
      const link = preparedLinkFor(row);
      if (!link) return;
      try {
        await navigator.clipboard.writeText(link);
        button.textContent = 'Copied';
        setTimeout(() => { button.textContent = 'Copy link'; }, 1500);
      } catch { /* the clipboard was refused; the link is in the box beside the button */ }
      return;
    }
    if (act === 'delete') { this._confirmId = id; this.render(); return; }
    if (act === 'cancel-delete') { this._confirmId = null; this.render(); return; }
    if (act === 'revoke') {
      await this._run(id, () => this.client.preparedRevoke(id), 'Revoked. Its link no longer works; Send again gives it a new one.');
    } else if (act === 'resend') {
      const campaign = this.$(`[data-camp="${id}"]`)?.value || null;
      await this._run(id, () => this.client.preparedResend(id, campaign), 'Sent again with a new link. Copy it from the listing; the old link no longer works.');
    } else if (act === 'confirm-delete') {
      this._confirmId = null;
      await this._run(id, () => this.client.preparedDelete(id), 'Deleted.', { deletedId: id });
    }
  }

  async _run(id, fn, okMsg, opts = {}) {
    this._busyId = id;
    this._msg = null;
    this.render();
    try {
      const r = await fn();
      this._rows = preparedApplyResult(this._rows, r, opts);
      this._msg = okMsg;
      this._msgWarn = false;
    } catch (err) {
      this._msg = err?.message || 'That did not go through. Nothing was changed; try again.';
      this._msgWarn = true;
    }
    this._busyId = null;
    this.render();
  }
}

define('gbti-prepared-listings', GbtiPreparedListings);
export { GbtiPreparedListings };
