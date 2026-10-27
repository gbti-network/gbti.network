// <gbti-prepared-listings> (sow-427, sow-481): the superadmin's INVITATIONS section. A prepared listing is a project
// written for someone who is not a member yet, waiting in KV with its own invitation until that person claims it
// under their own name.
//
// sow-481 gave it its own tab on the admin page (it sat third inside the Coupons tab) and the layout the owner picked
// on 2026-10-24 (Option B of the 2026-10-23 design round): READY TO SEND beside SENT AND WAITING, and LANDED as a strip
// underneath. Which lane a row sits in is preparedLane in the core. A sent invitation shows how long it has waited as
// plain words and is never coloured or flagged (owner, 2026-10-26).
//
// ONLY A SUPERADMIN CLIENT CARRIES `preparedList` (src/lib/workbench-prepared.ts attaches it only when the page was
// built with isSuperadmin), and the admin page imports this module only for a superadmin. An admin, and the
// extension, therefore never see it. The Worker re-checks superadmin on every call regardless; this element is the
// affordance, never the boundary.
//
// LOADS ONCE PER CLIENT (sow-334), the listings and the coupon registry together (Send again needs the active
// campaigns, which the coupon manager used to hand down when this lived inside it). A failed load shows the reason
// and a Try again button and waits to be asked; it never starts the next attempt from render(), which is how two
// admin sections once made hundreds of reads a second against a failing route. scripts/check-load-retry.mjs drives
// this element from the admin page markup.
//
// Rows come from the Worker's `listingSummary`, which never carries the personal message, the project body or an
// account number. Nothing here logs: the invitation code in each link is a bearer secret.

import { GbtiElement, define, esc } from '../base.mjs';
import {
  PREPARED_ACTION, PREPARE_NEW_HREF, preparedActions, preparedLinkFor, preparedProjectHref, preparedEditHref,
  preparedRowMeta, preparedStateLabel, preparedRowState, preparedDeleteConfirm, preparedResendCampaigns,
  preparedApplyResult, preparedLoadPlan, preparedLanes, preparedLaneSummary, preparedWaited,
} from '../prepared-listings-core.mjs';

// Every button class below names its OWN hover background: BASE_CSS gives a bare `button:hover` the brand green,
// which outranks a single class and turned hovered controls into solid green blocks elsewhere (sow-349). An anchor
// wearing a button class also needs text-decoration:none, or the UA underline survives (sow-356). A coloured left
// border never gets a radius on that side (owner, 2026-10-23), so the accent cards square their left corners.
const CSS = `
  :host { display:block; }
  [hidden] { display:none !important; }
  .pl-head { display:flex; align-items:center; gap:10px 14px; flex-wrap:wrap; margin:0 0 16px; }
  .pl-sum { font-size:13px; color:var(--muted); flex:1 1 260px; }
  .pl-msg { font-size:13px; color:var(--accent); margin:0 0 14px; }
  .pl-msg.warn { color:var(--danger); }
  .pl-lanes { display:grid; grid-template-columns:repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap:20px; align-items:start; }
  .pl-lane { display:flex; flex-direction:column; gap:10px; min-width:0; }
  .pl-lane-h { display:flex; align-items:center; gap:9px; margin:0; font-family:var(--font-body); font-size:12.5px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; color:var(--muted); }
  .pl-count { font-family:var(--font-mono, monospace); font-size:11px; font-weight:500; letter-spacing:0; border-radius:999px; padding:1px 8px; background:var(--hover); color:var(--fg); }
  .pl-count.go { background:var(--green-tint); color:var(--accent); }
  .pl-card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:13px 15px; min-width:0; }
  .pl-card.accent { border-left:3px solid var(--brand); border-radius:0 10px 10px 0; }
  .pl-card.busy { opacity:.55; pointer-events:none; }
  .pl-top { display:flex; align-items:center; gap:9px; flex-wrap:wrap; }
  .pl-title { font-weight:600; font-size:15px; color:var(--fg); overflow-wrap:anywhere; }
  .pl-st { font-family:var(--font-mono, monospace); font-size:10.5px; text-transform:uppercase; letter-spacing:.06em; border:1px solid var(--line-2); border-radius:999px; padding:2px 8px; color:var(--muted); white-space:nowrap; }
  .pl-st.ready, .pl-st.claimed { background:var(--green-tint); border-color:transparent; color:var(--accent); }
  .pl-st.sent, .pl-st.publishing { background:var(--hover); border-color:transparent; color:var(--fg); }
  .pl-st.unknown { color:var(--danger); border-color:var(--danger); }
  .pl-meta { margin:5px 0 0; font-size:12.5px; color:var(--fg-mute); display:flex; flex-wrap:wrap; gap:4px 12px; }
  .pl-waited { color:var(--fg); }
  .pl-note { margin:7px 0 0; font-size:12.5px; color:var(--fg-mute); }
  .pl-link { display:flex; align-items:center; gap:8px; margin-top:9px; flex-wrap:wrap; }
  .pl-link input { flex:1 1 260px; width:auto; min-width:0; font-family:var(--font-mono, monospace); font-size:12px; padding:6px 9px; }
  .pl-acts { display:flex; align-items:flex-start; gap:7px; margin-top:11px; flex-wrap:wrap; }
  .pl-acts select { width:auto; min-width:0; font-size:12.5px; padding:5px 8px; }
  .pl-btn { display:inline-flex; align-items:center; border:1px solid var(--line-2); background:var(--panel); color:var(--fg); border-radius:8px; font:inherit; font-size:12.5px; font-weight:500; padding:5px 11px; cursor:pointer; text-decoration:none; }
  .pl-btn:hover { background:var(--hover); border-color:var(--line-2); color:var(--fg); }
  .pl-btn:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  .pl-btn[disabled] { opacity:.55; cursor:default; }
  .pl-btn.pl-go { background:var(--accent); border-color:var(--accent); color:var(--on-accent); font-weight:600; }
  .pl-btn.pl-go:hover { background:var(--accent); border-color:var(--fg); color:var(--on-accent); }
  .pl-btn.pl-quiet { border-color:transparent; background:transparent; color:var(--fg-mute); padding:5px 7px; }
  .pl-btn.pl-quiet:hover { background:var(--hover); border-color:transparent; color:var(--fg); }
  .pl-btn.pl-danger { color:var(--danger); }
  .pl-btn.pl-danger:hover { background:var(--hover); border-color:var(--danger); color:var(--danger); }
  .pl-more { display:inline-block; }
  .pl-more > summary { list-style:none; display:inline-flex; align-items:center; border:1px solid var(--line-2); background:var(--panel); color:var(--fg); border-radius:8px; font-size:12.5px; padding:5px 10px; cursor:pointer; user-select:none; }
  .pl-more > summary::-webkit-details-marker { display:none; }
  .pl-more > summary:hover { background:var(--hover); }
  .pl-more > summary:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  .pl-more[open] > summary { background:var(--hover); }
  .pl-menu { display:flex; gap:7px; flex-wrap:wrap; margin-top:8px; }
  .pl-new { display:inline-flex; align-items:center; border:1px solid var(--line-2); background:var(--panel); color:var(--fg); border-radius:8px; font-weight:600; font-size:13px; padding:6px 12px; text-decoration:none; }
  .pl-new:hover { background:var(--hover); border-color:var(--line-2); color:var(--fg); }
  .pl-new:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  .pl-confirm { margin-top:10px; padding:9px 11px; border:1px solid var(--danger); border-radius:8px; font-size:13px; color:var(--fg); display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .pl-confirm span { flex:1 1 220px; }
  .pl-empty { border:1px dashed var(--line-2); border-radius:10px; padding:18px; text-align:center; color:var(--fg-mute); font-size:13px; }
  .pl-empty a { color:var(--accent); }
  .pl-strip { margin-top:22px; padding-top:16px; border-top:1px solid var(--line); }
  .pl-strip .pl-lane-h { margin-bottom:10px; }
  .pl-strip-list { display:flex; flex-direction:column; gap:10px; }
  .pl-strip .pl-card { padding:10px 14px; }
  .pl-strip .pl-acts { margin-top:8px; }
  .pl-bad { margin-top:22px; }
`;

class GbtiPreparedListings extends GbtiElement {
  async load() {
    const client = this.client;
    this._loadedFor = client;
    this._status = 'loading';
    const ask = (fn) => Promise.resolve().then(fn).catch(() => null);
    const [list, pool] = await Promise.all([
      ask(() => client.preparedList()),
      // The registry feeds Send again only. A failure here leaves the lanes readable and says so on a revoked card.
      ask(() => (typeof client.couponPool === 'function' ? client.couponPool() : null)),
    ]);
    if (client !== this.client) return; // a newer client arrived meanwhile; its own single load is the one that counts
    const rows = Array.isArray(list?.listings) ? list.listings : null;
    this._couponList = Array.isArray(pool?.coupons) ? pool.coupons : null;
    this._rows = rows;
    this._status = rows ? 'ready' : 'failed';
    this.render();
  }

  render() {
    // A different client (a sign-in change, a late setClient) earns exactly one fresh load; the same client never
    // loads twice from here, however often the host re-renders. preparedLoadPlan is the tested decision.
    const plan = preparedLoadPlan({ status: this._status, loadedFor: this._loadedFor, client: this.client });
    if (!plan.available) { this.set(''); return; }
    if (plan.reset) { this._status = 'idle'; this._rows = null; this._confirmId = null; this._linkId = null; }
    if (plan.load) this.load();
    const newLinkHtml = `<a class="pl-new" href="${esc(PREPARE_NEW_HREF)}">Prepare a new one</a>`;
    const msg = this._msg ? `<p class="pl-msg${this._msgWarn ? ' warn' : ''}" role="status">${esc(this._msg)}</p>` : '';
    if (this._status !== 'ready') {
      const failed = this._status === 'failed';
      const body = failed
        ? `<div class="pl-card accent"><div class="pl-title">The invitations did not load.</div><p class="pl-note">Nothing was changed. It waits to be asked again rather than retrying on its own.</p><div class="pl-acts"><button type="button" class="pl-btn" data-retry>Try again</button></div></div>`
        : '<p class="pl-sum">Loading the invitations...</p>';
      this.set(this.css(CSS) + `<div class="pl-head"><span class="pl-sum"></span>${newLinkHtml}</div>` + msg + body);
      if (failed) this.$('[data-retry]')?.addEventListener('click', () => { this._status = 'idle'; this._msg = null; this.render(); });
      return;
    }
    const lanes = preparedLanes(this._rows);
    const head = `<div class="pl-head"><span class="pl-sum">${esc(preparedLaneSummary(lanes))}</span>${newLinkHtml}</div>`;
    if (!(this._rows || []).length) {
      this.set(this.css(CSS) + head + msg + `<div class="pl-empty">No invitations yet. <a href="${esc(PREPARE_NEW_HREF)}">Prepare one</a> and it waits here until you send it.</div>`);
      return;
    }
    const laneHtml = (key, title, countClass, rows, empty) => `<section class="pl-lane" aria-label="${esc(title)}">
      <h3 class="pl-lane-h">${esc(title)} <span class="pl-count${countClass}">${esc(rows.length)}</span></h3>
      ${rows.length ? rows.map((r) => this._cardHtml(r, key)).join('') : `<div class="pl-empty">${esc(empty)}</div>`}
    </section>`;
    const lanesHtml = `<div class="pl-lanes">
      ${laneHtml('ready', 'Ready to send', ' go', lanes.ready, 'Nothing waiting to be sent.')}
      ${laneHtml('sent', 'Sent and waiting', '', lanes.sent, 'Nothing sent is waiting on a reply.')}
    </div>`;
    const landedHtml = lanes.landed.length ? `<section class="pl-strip" aria-label="Landed">
      <h3 class="pl-lane-h">Landed <span class="pl-count">${esc(lanes.landed.length)}</span></h3>
      <div class="pl-strip-list">${lanes.landed.map((r) => this._cardHtml(r, 'landed')).join('')}</div>
    </section>` : '';
    const badHtml = lanes.unreadable.length ? `<section class="pl-strip pl-bad" aria-label="Unreadable">
      <h3 class="pl-lane-h">Could not be read <span class="pl-count">${esc(lanes.unreadable.length)}</span></h3>
      <p class="pl-note">These records are left exactly as they are. Nothing here acts on them.</p>
      <div class="pl-strip-list">${lanes.unreadable.map((r) => this._cardHtml(r, 'unreadable')).join('')}</div>
    </section>` : '';
    this.set(this.css(CSS) + head + msg + lanesHtml + landedHtml + badHtml);
    this._wire();
  }

  _cardHtml(row, lane) {
    const id = String(row?.id || '');
    const st = preparedRowState(row);
    const acts = preparedActions(row);
    const has = (a) => acts.includes(a);
    const title = row?.title || row?.slug || (id ? 'Listing ' + id : 'Untitled project'); // plain text, escaped where it is used
    const pillClass = lane === 'ready' && st === 'prepared' ? 'ready' : lane === 'sent' ? 'sent' : st;
    const pill = lane === 'sent' ? 'Sent' : lane === 'ready' && st === 'prepared' ? 'Ready' : preparedStateLabel(row);
    const waited = preparedWaited(row);
    const metaHtml = preparedRowMeta(row).map((m) => `<span>${esc(m)}</span>`).join('')
      + (waited ? `<span class="pl-waited">${esc(waited)}</span>` : '');
    const btn = (act, label, cls = '') => `<button type="button" class="pl-btn${cls}" data-act="${esc(act)}" data-id="${esc(id)}">${esc(label)}</button>`;
    const shown = [];
    const more = [];
    if (has(PREPARED_ACTION.copy)) shown.push(btn('copy', 'Copy link'));
    if (has(PREPARED_ACTION.markSent)) shown.push(btn('mark-sent', 'Mark sent', ' pl-go'));
    if (has(PREPARED_ACTION.view)) shown.push(`<a class="pl-btn" href="${esc(preparedProjectHref(row))}" target="_blank" rel="noopener">View project</a>`);
    if (has(PREPARED_ACTION.resend)) {
      const camps = preparedResendCampaigns(this._couponList, row);
      const optsHtml = camps.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
      if (camps.length) shown.push(`<select data-camp="${esc(id)}" aria-label="Campaign for the new link for ${esc(title)}">${optsHtml}</select>${btn('resend', 'Send again')}`);
      else shown.push(`<span class="pl-note">${esc(this._couponList ? 'No active campaign to send it again with.' : 'The campaigns did not load. Reload the page to send it again.')}</span>`);
    }
    if (has(PREPARED_ACTION.edit)) shown.push(`<a class="pl-btn" href="${esc(preparedEditHref(id))}">Edit</a>`);
    if (has(PREPARED_ACTION.unmarkSent)) shown.push(btn('unmark-sent', 'Not sent yet', ' pl-quiet'));
    if (has(PREPARED_ACTION.revoke)) more.push(btn('revoke', 'Revoke'));
    if (has(PREPARED_ACTION.remove)) more.push(btn('delete', st === 'claimed' ? 'Delete the record' : 'Delete', ' pl-danger'));
    const moreHtml = more.length
      ? `<details class="pl-more"${this._openId === id ? ' open' : ''} data-more="${esc(id)}"><summary aria-label="More actions for ${esc(title)}">&middot;&middot;&middot;</summary><div class="pl-menu">${more.join('')}</div></details>`
      : '';
    const link = this._linkId === id ? preparedLinkFor(row) : null;
    const linkHtml = link ? `<div class="pl-link"><input readonly value="${esc(link)}" aria-label="Invitation link for ${esc(title)}" /></div>` : '';
    const noteHtml = st === 'publishing'
      ? '<p class="pl-note">Edit, revoke and delete wait until the pull request merges or closes. Only the link can be copied.</p>'
      : st === 'revoked' ? '<p class="pl-note">There is no link to copy until it is sent again under a live campaign.</p>' : '';
    const confirmHtml = this._confirmId === id && has(PREPARED_ACTION.remove)
      ? `<div class="pl-confirm"><span>${esc(preparedDeleteConfirm(row))}</span>${btn('confirm-delete', 'Delete for good', ' pl-danger')}${btn('cancel-delete', 'Keep it')}</div>`
      : '';
    const accent = lane === 'ready' && st === 'prepared' ? ' accent' : '';
    return `<article class="pl-card${accent}${this._busyId === id ? ' busy' : ''}" data-id="${esc(id)}">
      <div class="pl-top"><span class="pl-title">${esc(title)}</span><span class="pl-st ${esc(pillClass)}">${esc(pill)}</span></div>
      ${metaHtml ? `<p class="pl-meta">${metaHtml}</p>` : ''}
      ${noteHtml}
      ${shown.length || moreHtml ? `<div class="pl-acts">${shown.join('')}${moreHtml}</div>` : ''}
      ${linkHtml}
      ${confirmHtml}
    </article>`;
  }

  _wire() {
    this.$$('[data-act]').forEach((b) => b.addEventListener('click', () => this._act(b.dataset.act, b.dataset.id, b)));
    // Remember which menu is open, so a re-render after an action inside it does not snap it shut under the pointer.
    this.$$('[data-more]').forEach((d) => d.addEventListener('toggle', () => {
      if (d.open) this._openId = d.dataset.more;
      else if (this._openId === d.dataset.more) this._openId = null;
    }));
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
      } catch {
        // The clipboard was refused (an unfocused page, a browser setting). Show the link to copy by hand.
        this._linkId = id;
        this.render();
      }
      return;
    }
    if (act === 'delete') { this._confirmId = id; this.render(); return; }
    if (act === 'cancel-delete') { this._confirmId = null; this.render(); return; }
    if (act === 'mark-sent') {
      await this._run(id, () => this.client.preparedMarkSent(id), 'Marked sent. It now waits under Sent and waiting.');
    } else if (act === 'unmark-sent') {
      await this._run(id, () => this.client.preparedUnmarkSent(id), 'Moved back to Ready to send.');
    } else if (act === 'revoke') {
      await this._run(id, () => this.client.preparedRevoke(id), 'Revoked. Its link no longer works; Send again gives it a new one.');
    } else if (act === 'resend') {
      const campaign = this.$(`[data-camp="${id}"]`)?.value || null;
      await this._run(id, () => this.client.preparedResend(id, campaign), 'A new link is ready and the row is back in Ready to send. The old link no longer works.');
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
      if (this._openId === id) this._openId = null;
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
