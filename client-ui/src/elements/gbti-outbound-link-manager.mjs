// <gbti-outbound-link-manager> (sow-289 Phase 1): the superadmin's READ-ONLY board of the outbound partner links.
// Every link in house/outbound-links.yml (path, partner, destination, status, its provenance note) beside its
// estimated click history from house/outbound-clicks.yml, which reconcile rolls up daily from Cloudflare zone
// analytics.
//
// sow-359 gave it a WRITE path (sow-289's Phase 4): mint a link, repoint or relabel one, retire or restore
// one. The controls appear only when a client is injected, so the read-only board is unchanged for a host
// that does not provide one, and the Worker re-checks superadmin regardless of what this renders.
//
// A write is a pull request that auto-merges and reaches the edge at the NEXT DEPLOY, while the two JSON
// artifacts this board reads are built at that same deploy. So a save says so in words and updates the list
// optimistically: otherwise the superadmin saves, sees the old value, and concludes it failed.
//
// There is no delete, deliberately. Removing a row turns a link in an old post into a 404; Retired takes a
// link out of use while its redirect keeps answering.
//
// It reads the two PUBLIC build artifacts (/outbound-links.json, /outbound-clicks.json) directly, the way
// <gbti-welcome> reads /members-index.json: the data is git-native and public, so it needs no Worker route, no client
// method and no change to the routing chokepoint (client.mjs). It renders with or without an injected client; the host
// page decides who sees the tab.
//
// TWO RULES THE BOARD HOLDS. A date the rollup did not query is "not measured", never 0: the store's `coverage` says
// which dates were queried, and the board counts a window's unmeasured days out loud. And a failed load is its own
// state (sow-334): it shows the failure and a Try again button and does NOT retry on its own, so a bad answer cannot
// become a storm of requests.
//
// Numbers are ESTIMATES (the analytics dataset samples). clicks = 301 answers; crawlers = the subset of clicks from a
// well-known crawler agent (owner decision 2026-09-15: shown beside the clicks, neither dropped nor blended);
// other = every answer that was not a 301 (Cloudflare's own Early Hints probes land there), shown so a fault is visible.
import { GbtiElement, define, esc } from '../base.mjs';
import { WINDOWS, windowFor, LINK_STATUSES, STATUS_LABELS, suggestPath, draftFromLink, addPayload, updatePayload, statusPayload, savedMessage, applyLocally } from '../outbound-manager-core.mjs';
// sow-359: WINDOWS and windowFor moved into the core so the CTA manager can show a card's clicks too. Re-exported
// here because test/outbound-clicks.test.mjs imports them from this file, and that binding is worth keeping.
export { WINDOWS, windowFor };

const SITE = 'https://gbti.network';
class GbtiOutboundLinkManager extends GbtiElement {
  connectedCallback() { super.connectedCallback?.(); if (!this._links && !this._loading && !this._failed) this.load(); }

  async load() {
    this._loading = true; this._failed = false; this._msg = '';
    this.render();
    try {
      const [links, clicks] = await Promise.all([
        fetch(`${SITE}/outbound-links.json`, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(`links ${r.status}`); return r.json(); }),
        fetch(`${SITE}/outbound-clicks.json`, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(`clicks ${r.status}`); return r.json(); }),
      ]);
      this._links = Array.isArray(links?.links) ? links.links : [];
      this._clicks = { coverage: Array.isArray(clicks?.coverage) ? clicks.coverage : [], clicks: clicks?.clicks && typeof clicks.clicks === 'object' ? clicks.clicks : {} };
    } catch {
      // sow-334: a failed load waits for Try again. No automatic retry, or a bad answer becomes a request storm.
      this._links = null; this._clicks = null; this._failed = true;
      this._msg = 'Could not load the outbound links or their click history.';
    }
    this._loading = false;
    this.render();
  }

  render() {
    if (this._failed) {
      this.set(this.css(CSS) + `<p class="msg">${esc(this._msg)}</p><button class="btn" type="button" data-retry-load>Try again</button>`);
      this.$('[data-retry-load]')?.addEventListener('click', () => this.load());
      return;
    }
    if (!this._links) { this.set(this.css(CSS) + `<p class="muted">Loading the outbound links...</p>`); return; }
    const now = new Date();
    const coverage = this._clicks.coverage;
    const latest = coverage.length ? [...coverage].sort().pop() : null; // never trust the artifact's order
    const rows = this._links.map((l) => {
      const stats = WINDOWS.map((d) => {
        const w = windowFor(this._clicks, l.path, d, now);
        const gap = w.unmeasured ? `<span class="sub gap">${w.unmeasured} of ${d} days not measured</span>` : `<span class="sub">${w.other} other answers</span>`;
        return `<div class="stat"><b>${w.measured ? w.clicks : '?'}</b> clicks in ${d} days <span class="sub">${w.measured ? `${w.crawlers} from known crawlers` : 'nothing measured yet'}</span> ${gap}</div>`;
      }).join('');
      const w30 = windowFor(this._clicks, l.path, 30, now);
      const history = w30.list.map((x) => x.measured
        ? `<tr><td>${x.date}</td><td>${x.clicks}</td><td>${x.crawlers}</td><td>${x.other}</td></tr>`
        : `<tr><td>${x.date}</td><td class="gap" colspan="3">not measured</td></tr>`).join('');
      return `<li class="lnk">
        <div class="top"><span class="path">${esc(l.path)}</span> <span class="partner">${esc(l.partner)}</span> <span class="badge ${esc(l.status)}">${esc(l.status)}</span></div>
        <span class="dest">to <a href="${esc(l.destination)}" target="_blank" rel="noopener noreferrer">${esc(l.destination)}</a></span>
        <div class="stats">${stats}</div>
        ${l.note ? `<details><summary>Where this destination came from</summary><p class="note">${esc(l.note)}</p></details>` : ''}
        <details><summary>Last 30 days, by day</summary><table><thead><tr><th>Day</th><th>Clicks</th><th>Crawlers</th><th>Other</th></tr></thead><tbody>${history}</tbody></table></details>
        ${this._canWrite() ? this._rowControls(l) : ''}
      </li>`;
    }).join('');
    this.set(this.css(CSS) + `
      <div class="head"><span class="hint">${this._links.length} links. Clicks are estimates from Cloudflare zone analytics: 301 answers only, rolled up daily by reconcile. ${latest ? `Measured through ${esc(latest)}.` : 'Nothing measured yet: the first rollup lands with the next daily reconcile.'}</span></div>
      ${this._msg ? `<p class="msg">${esc(this._msg)}</p>` : ''}
      ${this._canWrite() ? this._addForm() : ''}
      <ul class="list">${rows || '<li class="muted">No outbound links in the store.</li>'}</ul>
    `);
    this._wire();
  }

  /** Write controls show only with an injected client. The Worker re-checks superadmin whatever this renders. */
  _canWrite() { return !!(this.client && typeof this.client.addOutboundLink === 'function'); }

  _addForm() {
    const d = this._new || {};
    if (!this._adding) return `<div class="newlink"><button class="btn" type="button" data-new>Add a tracked link</button></div>`;
    const f = (k, label, ph) => `<label>${label}<input data-nf="${k}" value="${esc(d[k] || '')}" placeholder="${esc(ph)}"></label>`;
    return `<div class="newlink edit">
      ${f('partner', 'Partner (a short lowercase label)', 'acme')}
      ${f('path', 'Site path', '/outbound/acme')}
      ${f('destination', 'Destination', 'https://acme.example.com/?ref=YOURCODE')}
      ${f('note', 'Note (where this destination came from)', '')}
      ${this._err ? `<p class="err">${esc(this._err)}</p>` : ''}
      <div class="acts"><button class="btn" type="button" data-save-new ${this._busy ? 'disabled' : ''}>${this._busy ? 'Saving...' : 'Mint the link'}</button><button class="btn" type="button" data-cancel-new>Cancel</button></div>
    </div>`;
  }

  _rowControls(l) {
    const editing = this._editing === l.path;
    const status = LINK_STATUSES.map((v) => `<button class="btn ${String(l.status || 'live') === v ? 'on' : ''}" type="button" data-status="${esc(v)}" data-path="${esc(l.path)}">${esc(STATUS_LABELS[v])}</button>`).join('');
    if (!editing) return `<div class="acts">${status}<button class="btn" type="button" data-edit="${esc(l.path)}">Edit</button></div>`;
    const d = this._draft || draftFromLink(l);
    const f = (k, label) => `<label>${label}<input data-ef="${k}" value="${esc(d[k] || '')}"></label>`;
    return `<div class="acts">${status}</div>
      <div class="edit">
        ${f('destination', 'Destination')}
        ${f('partner', 'Partner')}
        ${f('note', 'Note')}
        <p class="sub">The path stays ${esc(l.path)}. Repointing keeps it, so this link keeps one click history.</p>
        ${this._err ? `<p class="err">${esc(this._err)}</p>` : ''}
        <div class="acts"><button class="btn" type="button" data-save-edit="${esc(l.path)}" ${this._busy ? 'disabled' : ''}>${this._busy ? 'Saving...' : 'Save'}</button><button class="btn" type="button" data-cancel-edit>Cancel</button></div>
      </div>`;
  }

  _wire() {
    this.$('[data-new]')?.addEventListener('click', () => { this._adding = true; this._new = {}; this._err = ''; this.render(); });
    this.$('[data-cancel-new]')?.addEventListener('click', () => { this._adding = false; this._err = ''; this.render(); });
    this.$$('[data-nf]').forEach((i) => i.addEventListener('input', () => {
      this._new = { ...(this._new || {}), [i.dataset.nf]: i.value };
      if (i.dataset.nf === 'path') this._pathTouched = true;
      // A partner with no path of its own gets one suggested, and it stays editable. The suggestion is written
      // STRAIGHT INTO THE FIELD rather than left in state for the next render: re-rendering on a keystroke
      // would take the caret with it, and leaving it in state only meant the form submitted a path the
      // superadmin never saw. Found by driving the form, not by reading it.
      if (i.dataset.nf === 'partner' && !this._pathTouched) {
        this._new.path = suggestPath(i.value);
        const pathInput = this.$('[data-nf="path"]');
        if (pathInput) pathInput.value = this._new.path;
      }
    }));
    this.$('[data-save-new]')?.addEventListener('click', () => this._run('add', addPayload(this._new || {}), 'Link minted'));
    this.$$('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      const l = (this._links || []).find((x) => x.path === b.dataset.edit);
      this._editing = b.dataset.edit; this._draft = draftFromLink(l); this._err = ''; this.render();
    }));
    this.$('[data-cancel-edit]')?.addEventListener('click', () => { this._editing = null; this._draft = null; this._err = ''; this.render(); });
    this.$$('[data-ef]').forEach((i) => i.addEventListener('input', () => { this._draft = { ...(this._draft || {}), [i.dataset.ef]: i.value }; }));
    this.$('[data-save-edit]')?.addEventListener('click', (e) => {
      const l = (this._links || []).find((x) => x.path === e.currentTarget.dataset.saveEdit);
      this._run('update', updatePayload(l, this._draft || {}), 'Link updated');
    });
    this.$$('[data-status]').forEach((b) => b.addEventListener('click', () => {
      const l = (this._links || []).find((x) => x.path === b.dataset.path);
      this._run('status', statusPayload(l, b.dataset.status), `Link set to ${STATUS_LABELS[b.dataset.status]}`);
    }));
  }

  /** One write, one place: refuse locally, call the client, report what happens next, update the list. */
  async _run(action, plan, what) {
    if (plan.noop) { this._err = ''; this._editing = null; this._msg = 'Nothing changed.'; this.render(); return; }
    if (plan.problem) { this._err = plan.problem; this.render(); return; }
    this._busy = true; this._err = ''; this.render();
    try {
      const call = action === 'add' ? this.client.addOutboundLink(plan.payload)
        : action === 'update' ? this.client.updateOutboundLink(plan.payload)
          : this.client.setOutboundLinkStatus(plan.payload);
      const res = await call;
      this._links = applyLocally(this._links, action, plan.payload);
      this._msg = savedMessage(what, res);
      this._adding = false; this._editing = null; this._draft = null; this._pathTouched = false;
    } catch (err) {
      // The core's refusal is the useful message (it knows why a destination is wrong), so it is shown as-is.
      this._err = err?.message ? String(err.message) : 'The change could not be saved.';
    }
    this._busy = false;
    this.render();
  }
}

define('gbti-outbound-link-manager', GbtiOutboundLinkManager);
export { GbtiOutboundLinkManager };
