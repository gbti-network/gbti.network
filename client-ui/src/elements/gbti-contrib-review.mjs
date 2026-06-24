// <gbti-contrib-review> (SOW-028 P2/P3): review ONE incoming contribution. Loads the PR's per-file unified
// diff and the proposed new body (preview-as-merged via client.preview()), then lets the folder owner decide:
// Approve (submits a GitHub APPROVE review on the head SHA, which the SOW-005 gate reads -> auto-merge + the
// SOW-008 award), Request changes (a REQUEST_CHANGES review with a note), or Decline (close with a note). The
// client never merges directly. Inert on the public site (no client). The PR to review comes from the `number`
// attribute. On a decision it emits `contrib-decided` so the host can return to the inbox and refresh.
import { GbtiElement, define, esc } from '../base.mjs';
import { diffRows } from '../contrib-diff.mjs';
import { shortPath } from './gbti-contrib-inbox.mjs';

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  h2 { font-size:18px; margin:0 0 4px; }
  .sub { color:var(--muted); font-size:13px; margin:0 0 14px; }
  .sub a { color:var(--accent); }
  .tabs { display:inline-flex; gap:4px; background:var(--panel); border:1px solid var(--line); border-radius:999px; padding:3px; margin:0 0 12px; }
  .tab { border:0; background:transparent; color:var(--muted); font:inherit; font-weight:700; font-size:12.5px; padding:6px 14px; border-radius:999px; cursor:pointer; }
  .tab.on { background:var(--hover); color:var(--accent); }
  .file { margin:0 0 14px; border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  .file > .fh { background:var(--panel); padding:8px 12px; font-family:var(--font-mono,ui-monospace,monospace); font-size:12px; display:flex; justify-content:space-between; gap:10px; }
  .fh .sz .add { color:var(--accent); font-weight:700; } .fh .sz .del { color:var(--danger); font-weight:700; }
  pre.diff { margin:0; overflow:auto; font-family:var(--font-mono,ui-monospace,monospace); font-size:12px; line-height:1.5; }
  .dl { display:block; padding:0 12px; white-space:pre-wrap; word-break:break-word; }
  .dl.add { background:rgba(31,158,95,.12); }
  .dl.del { background:rgba(224,108,108,.14); }
  .dl.hunk { background:var(--hover); color:var(--muted); }
  .preview { border:1px solid var(--line); border-radius:10px; padding:16px 18px; background:var(--panel); }
  .preview + .preview { margin-top:12px; }
  .pmeta { color:var(--muted); font-size:12px; font-family:var(--font-mono,ui-monospace,monospace); margin:0 0 8px; }
  .award { margin-top:16px; border:1px solid var(--line); border-radius:10px; padding:13px 15px; background:var(--hover); }
  .award b { font-size:13px; } .award p { margin:5px 0 0; font-size:13.5px; color:var(--fg); }
  .award .zero { color:var(--muted); }
  .decide { margin-top:16px; border-top:1px solid var(--line); padding-top:16px; }
  textarea { width:100%; box-sizing:border-box; min-height:74px; resize:vertical; border:1px solid var(--line); border-radius:8px; padding:9px 11px; font:inherit; background:var(--panel); color:var(--fg); }
  .actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:11px; }
  .btn { border:1px solid var(--line); background:var(--panel); color:var(--fg); border-radius:8px; font:inherit; font-weight:700; font-size:13px; padding:8px 16px; cursor:pointer; }
  .btn:hover { border-color:var(--accent); }
  .btn.approve { background:var(--accent); border-color:var(--accent); color:#fff; }
  .btn.decline { color:var(--danger); }
  .btn[disabled] { opacity:.55; cursor:default; }
  .err { color:var(--danger); font-size:13px; margin-top:9px; }
  .muted { color:var(--muted); }
  .hint { color:var(--muted); font-size:12.5px; margin:10px 0 0; }
`;

class GbtiContribReview extends GbtiElement {
  static get observedAttributes() { return ['number']; }

  connectedCallback() {
    this._data = null;
    this._previews = {};
    this._tab = 'diff';
    this._busy = false;
    this._error = '';
    super.connectedCallback?.();
    this._load();
  }

  attributeChangedCallback(name, oldV, newV) {
    if (name === 'number' && oldV !== newV && this.isConnected) this._load();
  }

  get _number() {
    const n = Number(this.getAttribute('number'));
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  async _load() {
    if (!this.client || this._number == null) { this.render(); return; }
    this._data = null;
    this._error = '';
    this._previews = {};
    this.render(); // loading state
    try {
      this._data = await this.client.getContribution({ number: this._number });
      for (const p of this._data.proposed || []) {
        try { this._previews[p.filename] = (await this.client.preview({ body: p.body }))?.html || ''; } catch { /* skip preview */ }
      }
    } catch (e) {
      this._error = e?.code === 'forbidden'
        ? 'This contribution is no longer available to review (it may have been merged, closed, or changed).'
        : 'Could not load this contribution.';
    }
    this.render();
  }

  async _decide(decision) {
    if (this._busy || this._number == null) return;
    const msg = (this.$('[data-msg]')?.value || '').trim();
    if (decision === 'request-changes' && !msg) {
      this._error = 'Add a note describing the changes you would like before requesting changes.';
      this.render();
      return;
    }
    this._busy = true;
    this._error = '';
    this.render();
    try {
      await this.client.reviewContribution({ number: this._number, decision, message: msg });
      this.dispatchEvent(new CustomEvent('contrib-decided', { detail: { number: this._number, decision }, bubbles: true, composed: true }));
    } catch {
      this._error = 'Could not submit your decision. Try again, or review it on GitHub.';
      this._busy = false;
      this.render();
    }
  }

  render() {
    if (!this.client) return; // inert on the public site
    if (this._error && !this._data) {
      this.set(this.css(CSS) + `<p class="err">${esc(this._error)}</p>`);
      return;
    }
    if (!this._data) {
      this.set(this.css(CSS) + `<p class="muted">Loading the contribution...</p>`);
      return;
    }
    const d = this._data;
    const body = this._tab === 'preview' ? this._previewHtml() : this._diffHtml();
    this.set(
      this.css(CSS) +
        `<h2>${esc(d.title || 'Contribution #' + d.number)}</h2>
         <p class="sub">From ${d.author?.login ? '@' + esc(d.author.login) : 'a member'} &middot;
           <a href="${esc(d.html_url || '#')}" target="_blank" rel="noopener">#${esc(d.number)} on GitHub</a></p>
         <div class="tabs" role="tablist">
           <button class="tab ${this._tab === 'diff' ? 'on' : ''}" data-tab="diff" type="button">Changes</button>
           <button class="tab ${this._tab === 'preview' ? 'on' : ''}" data-tab="preview" type="button">Preview as merged</button>
         </div>
         <div>${body}</div>
         ${this._awardHtml()}
         ${this._decideHtml()}`,
    );
    this.$$('[data-tab]').forEach((b) => b.addEventListener('click', () => { this._tab = b.dataset.tab; this.render(); }));
    this.$$('[data-decide]').forEach((b) => b.addEventListener('click', () => this._decide(b.dataset.decide)));
  }

  _diffHtml() {
    const files = this._data.files || [];
    if (files.length === 0) return `<p class="muted">No file changes.</p>`;
    return files.map((f) => {
      const rows = diffRows(f.patch)
        .map((r) => `<span class="dl ${r.cls}">${esc(r.text) || '&nbsp;'}</span>`)
        .join('');
      const diff = f.patch ? `<pre class="diff">${rows}</pre>` : `<p class="dl ctx muted" style="padding:10px 12px">Binary or large file (no inline diff). View it on GitHub.</p>`;
      return `<div class="file"><div class="fh"><span>${esc(shortPath(f.filename))} <span class="muted">(${esc(f.status)})</span></span>
        <span class="sz"><span class="add">+${f.additions | 0}</span> <span class="del">&minus;${f.deletions | 0}</span></span></div>${diff}</div>`;
    }).join('');
  }

  _previewHtml() {
    const proposed = this._data.proposed || [];
    if (proposed.length === 0) return `<p class="muted">No readable content to preview (the change touches non-article files only).</p>`;
    return proposed.map((p) => {
      const html = this._previews[p.filename];
      return `<div class="preview"><p class="pmeta">${esc(shortPath(p.filename))}</p>${html || '<p class="muted">Preview unavailable.</p>'}</div>`;
    }).join('');
  }

  // SOW-028 P4 / SOW-059: surface the reward at the decision point. The contributor is credited on this content
  // (the stacked-avatar footnote) and earns a contribution point. Under the touch-based model the revenue cut is
  // AUTOMATIC: a contribution to a first-touch or last-touch item shares the fixed 5% collaboration mix (1
  // collaboration point per qualifying contribution, split evenly). Owners no longer set a per-content delegation.
  _awardHtml() {
    const who = this._data.author?.login ? '@' + esc(this._data.author.login) : 'The contributor';
    return `<div class="award"><b>If you approve</b><p>${who} is credited as a contributor on this content and earns a contribution point. If this item is the first-touch or last-touch item when a member converts, that point also shares the automatic 5% collaboration mix. Rewards are automatic, so you do not set a revenue split.</p></div>`;
  }

  _decideHtml() {
    // App mode (SOW-026): the gate records the reviewer's GitHub identity, which a fork-scoped token cannot
    // provide, so the decision is taken on github.com. Show a deep link instead of the in-client buttons.
    if (this._data && this._data.canActInClient === false) {
      return `<div class="decide">
        <p class="hint">Approving records your GitHub identity as the reviewer, which the membership gate reads. In this mode, approve or decline on GitHub.</p>
        <div class="actions"><a class="btn approve" href="${esc(this._data.html_url || '#')}" target="_blank" rel="noopener">Open on GitHub to decide</a></div>
      </div>`;
    }
    return `<div class="decide">
      <textarea data-msg placeholder="Optional note to the contributor (required when requesting changes)"></textarea>
      <div class="actions">
        <button class="btn approve" data-decide="approve" type="button" ${this._busy ? 'disabled' : ''}>Approve &amp; merge</button>
        <button class="btn" data-decide="request-changes" type="button" ${this._busy ? 'disabled' : ''}>Request changes</button>
        <button class="btn decline" data-decide="decline" type="button" ${this._busy ? 'disabled' : ''}>Decline</button>
      </div>
      ${this._error ? `<p class="err">${esc(this._error)}</p>` : ''}
      <p class="hint">Approving submits an approval the membership gate reads, then merges the change. The client never merges directly.</p>
    </div>`;
  }
}

define('gbti-contrib-review', GbtiContribReview);
export { GbtiContribReview };
