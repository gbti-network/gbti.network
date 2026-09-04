// <gbti-applications-manager> (sow-293): the superadmin CREATOR APPLICATION review lane.
//
// Content Creator is granted by application now, not bought, so an application is work waiting on a human.
// The intake page stores it and emails the owner; this is where it gets decided. Without this screen the rest
// of sow-293 solicits applications that have nowhere to go.
//
// UNLIKE the coupon and news-source managers beside it, this opens NO pull request. An application is prose a
// person wrote about themselves, keyed by github_id, so it lives in KV per the storage boundary and the
// decision writes straight to the Worker. Same disposition as the issued-invite surface (sow-231).
//
// APPROVING GRANTS A REAL TIER, which is why every guard here leans the strict way:
//   - The Worker writes the Content Creator grant BEFORE marking the record approved, so an interrupted
//     approval leaves the application pending and returns it to this lane, rather than marking somebody
//     approved with no access.
//   - A CORRUPT record renders as corrupt and its decision buttons are DISABLED. The Worker refuses it too
//     (applicationState fails to `unknown`, never `pending`), so this is the second of two, not the only one.
//   - A decline is confirmed like an approval. It is not destructive, but it is a person being told no, and
//     a misclick that reads as an accident is worse than one extra dialog.
//
// Inert in public (no injected client). Host-agnostic: the website admin page and the extension admin page
// both mount it, and each supplies its own transport.
import { GbtiElement, define, esc } from '../base.mjs';

const CSS = `
  :host { display:block; }
  .head { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; margin:0 0 12px; }
  .head h3 { margin:0; font-family:var(--font-display, inherit); font-size:17px; }
  .hint { font-size:12.5px; color:var(--muted); }
  .msg { font-size:13px; color:var(--accent); margin:0 0 12px; }
  .muted { color:var(--muted); font-size:13px; }
  .app { border:1px solid var(--line); border-radius:10px; padding:12px 14px; margin:0 0 10px; }
  .app.corrupt { border-color:var(--amber, #a9781c); }
  .who { display:flex; align-items:baseline; gap:9px; flex-wrap:wrap; margin:0 0 8px; }
  .who b { font-size:14px; }
  .st { font-size:11px; text-transform:uppercase; letter-spacing:.04em; border:1px solid var(--line); border-radius:999px; padding:1px 8px; color:var(--muted); }
  .st.pending { color:var(--accent); border-color:var(--accent); }
  .st.approved { color:var(--green-fg, #1f9e5f); border-color:var(--green, #1f9e5f); }
  .st.declined, .st.unknown { color:var(--amber, #a9781c); border-color:var(--amber, #a9781c); }
  .fld { margin:7px 0 0; }
  .fld .lb { font-size:11.5px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); margin:0 0 2px; }
  .fld .val { font-size:13px; white-space:pre-wrap; overflow-wrap:anywhere; }
  .acts { display:flex; gap:8px; margin-top:11px; flex-wrap:wrap; }
  button { font:inherit; font-size:12.5px; font-weight:700; border-radius:7px; padding:5px 12px; cursor:pointer; background:none; border:1.5px solid var(--line); color:var(--fg); }
  button:hover:not([disabled]) { border-color:var(--accent); color:var(--accent); }
  button[disabled] { opacity:.45; cursor:default; }
  .note { flex:1 1 200px; min-width:0; font:inherit; font-size:12.5px; color:var(--fg); background:var(--paper, transparent); border:1px solid var(--line); border-radius:7px; padding:5px 9px; }
`;

/** Never render an empty field as blank: the applicant was told two of the three were optional. */
const NONE = '(not provided)';

class GbtiApplicationsManager extends GbtiElement {
  // The static admin markup upgrades BEFORE setClient injects the client, so the first render has no client.
  // render() retries the load once it lands, guarded by _loading so it cannot loop. Same shape as the coupon
  // and news-source managers; getting this wrong makes a working manager report as a false defect.
  connectedCallback() { super.connectedCallback?.(); }

  async load() {
    if (!this.client) { this.render(); return; }
    try {
      this._apps = (await this.client.creatorApplications?.())?.applications ?? [];
    } catch {
      this._apps = [];
      this._msg = 'Could not load creator applications.';
    }
    this._loading = false;
    this.render();
  }

  render() {
    if (!this.client) { this.set(this.css(CSS) + `<p class="muted">Open in the GBTI client (admin) to review creator applications.</p>`); return; }
    if (!this._apps) {
      if (!this._loading) { this._loading = true; this.load(); }
      this.set(this.css(CSS) + `<p class="muted">Loading applications...</p>`);
      return;
    }

    const pending = this._apps.filter((a) => a.state === 'pending').length;
    const rows = this._apps.map((a) => this._appHtml(a)).join('');
    this.set(this.css(CSS) + `
      <div class="head">
        <h3>Creator applications</h3>
        <span class="hint">${pending} awaiting a decision. Approving grants the Content Creator plan immediately; there is no payment step.</span>
      </div>
      ${this._msg ? `<p class="msg">${esc(this._msg)}</p>` : ''}
      ${rows || `<p class="muted">No applications yet. They arrive from <b>/creator-application/</b> and also email you.</p>`}
    `);

    this.$$('[data-decide]').forEach((b) => b.addEventListener('click', () => this._decide(b.dataset.id, b.dataset.decide)));
  }

  _appHtml(a) {
    const state = String(a.state || 'unknown');
    const corrupt = a.corrupt === true || state === 'unknown';
    const who = a.login ? `${a.login}` : `github_id ${a.githubId || '?'}`;
    const decided = a.decidedAt
      ? `<div class="fld"><div class="lb">Decision</div><div class="val">${esc(state)} by ${esc(a.decidedByLogin || a.decidedBy || 'a superadmin')} on ${esc(String(a.decidedAt).slice(0, 10))}${a.decisionNote ? ` — ${esc(a.decisionNote)}` : ''}</div></div>`
      : '';
    // Buttons only on a genuinely pending record. A corrupt one is SHOWN (so it is visible to the only
    // surface that could notice it) but is never approvable: approving would grant a real tier against
    // whatever identity the broken record happens to carry.
    const acts = state === 'pending' && !corrupt
      ? `<div class="acts">
           <input class="note" data-note="${esc(a.githubId)}" type="text" placeholder="Reason (optional, saved with the decision)" />
           <button data-decide="approved" data-id="${esc(a.githubId)}" type="button">Approve and grant Content Creator</button>
           <button data-decide="declined" data-id="${esc(a.githubId)}" type="button">Decline</button>
         </div>`
      : corrupt
        ? `<div class="acts"><button type="button" disabled>Cannot be decided: this record is malformed</button></div>`
        : '';
    return `<div class="app${corrupt ? ' corrupt' : ''}">
      <div class="who"><b>${esc(who)}</b><span class="st ${esc(state)}">${esc(state)}</span>
        <span class="hint">applied ${esc(String(a.submittedAt || '').slice(0, 10) || 'at an unknown time')}</span></div>
      <div class="fld"><div class="lb">Why they want to contribute</div><div class="val">${esc(a.why || NONE)}</div></div>
      <div class="fld"><div class="lb">Links to prior writing</div><div class="val">${esc(a.links || NONE)}</div></div>
      <div class="fld"><div class="lb">Topics they would cover</div><div class="val">${esc(a.topics || NONE)}</div></div>
      ${decided}${acts}
    </div>`;
  }

  async _decide(githubId, decision) {
    const app = (this._apps || []).find((a) => String(a.githubId) === String(githubId));
    const who = app?.login || `github_id ${githubId}`;
    // A decline is confirmed too. It is not destructive, but it tells a person no, and a misclick that reads
    // as an accident is worse than one extra dialog.
    const ask = decision === 'approved'
      ? `Approve ${who} and grant the Content Creator plan? This takes effect immediately.`
      : `Decline ${who}? They can revise their answer and apply again.`;
    // eslint-disable-next-line no-alert
    if (typeof confirm === 'function' && !confirm(ask)) return;
    // NOT CSS.escape: the module-level `CSS` string above shadows the global, so `CSS.escape` here is
    // undefined rather than the DOM helper. A github_id is digits only (the Worker keys KV on it), so a
    // plain attribute selector is correct AND cannot be broken by a quote.
    const safeId = String(githubId).replace(/[^0-9]/g, '');
    const note = safeId ? (this.$(`[data-note="${safeId}"]`)?.value?.trim() || '') : '';
    try {
      await this.client.decideCreatorApplication({ githubId: String(githubId), decision, note });
      this._msg = decision === 'approved'
        ? `${who} is now a Content Creator.`
        : `${who} was declined.`;
    } catch (err) {
      this._msg = err?.message || 'The decision could not be recorded.';
    }
    this._apps = null; // reload, so the lane reflects what the Worker actually stored rather than what we sent
    this.render();
  }
}

define('gbti-applications-manager', GbtiApplicationsManager);
