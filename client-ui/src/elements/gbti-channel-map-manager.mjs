// <gbti-channel-map-manager> (SOW-087): the superadmin editor for the category -> Discord-channel map
// (house/content-channels.yml), the per-type Discord post templates (house/syndication-config.yml), and the
// moderation word lists (house/moderation-flags.yml). Every edit opens a house PR via the admin ops (the
// SOW-038 governance model; CODEOWNERS + the SOW-005 gate are the real boundary) and goes live at the next
// reconcile KV-mirror sync. Inert in public (no injected client). Host-agnostic. Clones the
// gbti-news-source-manager pattern (lazy load on first render with a client, per the SOW-070 upgrade race).
import { GbtiElement, define, esc } from '../base.mjs';
import { submitAck } from '../workspace-core.mjs';

const CSS = `
  :host { display:block; }
  h4 { margin:18px 0 8px; font-family:var(--font-display, inherit); font-size:15px; }
  h4:first-child { margin-top:0; }
  .hint { font-size:12.5px; color:var(--muted); }
  .msg { font-size:13px; color:var(--accent); margin:0 0 12px; }
  .busy { opacity:.55; pointer-events:none; }
  .add { display:flex; gap:8px; flex-wrap:wrap; margin:8px 0 12px; }
  .add input, .add select { flex:1 1 140px; min-width:0; font:inherit; color:var(--fg); background:var(--paper, transparent); border:1px solid var(--line); border-radius:7px; padding:7px 9px; }
  .btn { flex:none; border:1px solid var(--accent); background:var(--accent); color:#fff; border-radius:7px; font:inherit; font-weight:700; font-size:13px; padding:7px 14px; cursor:pointer; }
  .list { list-style:none; margin:0 0 6px; padding:0; }
  .row { display:flex; align-items:center; gap:10px; padding:7px 2px; border-top:1px solid var(--line); }
  .list .row:first-child { border-top:0; }
  .key { font-family:var(--font-mono, monospace); font-size:12.5px; color:var(--fg); font-weight:600; }
  .val { font-family:var(--font-mono, monospace); font-size:12px; color:var(--muted); }
  .sp { flex:1; }
  .lk { flex:none; border:1px solid var(--line); background:var(--paper, transparent); color:var(--fg); border-radius:7px; font:inherit; font-size:12.5px; font-weight:600; padding:4px 10px; cursor:pointer; }
  .lk:hover { border-color:var(--danger, #e06c6c); color:var(--danger, #e06c6c); }
  .tmpl { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:0 0 8px; }
  .tmpl .t { flex:none; width:70px; font-family:var(--font-mono, monospace); font-size:12.5px; color:var(--muted); }
  .tmpl input { flex:1 1 260px; min-width:0; font:inherit; font-size:13px; color:var(--fg); background:var(--paper, transparent); border:1px solid var(--line); border-radius:7px; padding:7px 9px; }
  .chips { display:flex; flex-wrap:wrap; gap:6px; margin:6px 0 10px; }
  .chip { display:inline-flex; align-items:center; gap:6px; font-size:12.5px; color:var(--fg); background:var(--paper, transparent); border:1px solid var(--line); border-radius:999px; padding:3px 10px; }
  .chip button { border:0; background:none; color:var(--muted); cursor:pointer; font:inherit; padding:0; }
  .chip button:hover { color:var(--danger, #e06c6c); }
  .muted { color:var(--muted); }
`;

class GbtiChannelMapManager extends GbtiElement {
  connectedCallback() { super.connectedCallback?.(); }

  async load() {
    if (!this.client) { this.render(); return; }
    try {
      const [channels, flags, templates, engagement] = await Promise.all([
        this.client.contentChannelPool(),
        this.client.moderationFlagPool(),
        this.client.syndicationTemplatePool(),
        this.client.newsEngagementSettings ? this.client.newsEngagementSettings() : null,
      ]);
      this._channels = channels?.channels || [];
      this._lists = flags?.lists || {};
      this._templates = templates?.templates || {};
      this._types = templates?.types || ['share', 'post', 'product', 'prompt'];
      this._engagement = engagement?.settings || null; // SOW-111
      this._tiers = engagement?.tiers || ['paid', 'paid-trial', 'signed-in'];
    } catch {
      this._channels = [];
      this._lists = {};
      this._templates = {};
      this._engagement = null;
      this._msg = 'Could not load the channel map.';
    }
    this._loading = false;
    this.render();
  }

  render() {
    if (!this.client) { this.set(this.css(CSS) + `<p class="muted">Open in the GBTI client (superadmin) to manage category channels.</p>`); return; }
    if (!this._channels) { if (!this._loading) { this._loading = true; this.load(); } this.set(this.css(CSS) + `<p class="muted">Loading the channel map...</p>`); return; }

    const rows = this._channels.map((c) => `<li class="row">
        <span class="key">${esc(c.category || '')}</span><span class="val">#${esc(c.channelId || '')}</span><span class="sp"></span>
        <button class="lk" type="button" data-unmap="${esc(c.category)}">Unmap</button>
      </li>`).join('');

    const tmplRows = (this._types || []).map((t) => `<div class="tmpl">
        <span class="t">${esc(t)}</span>
        <input data-tmpl="${esc(t)}" type="text" maxlength="500" value="${esc(this._templates?.[t] || '')}" placeholder="built-in message" />
        <button class="btn" type="button" data-tmpl-save="${esc(t)}">Save</button>
      </div>`).join('');

    const listBlocks = Object.entries(this._lists || {}).map(([name, terms]) => {
      const chips = (Array.isArray(terms) ? terms : []).map((w) => `<span class="chip">${esc(w)}<button type="button" data-term-remove data-list="${esc(name)}" data-term="${esc(w)}" aria-label="Remove ${esc(w)}">✕</button></span>`).join('');
      return `<h4>${esc(name)} terms <span class="hint">(a title/blurb hit holds the item for approval)</span></h4>
        <div class="chips">${chips || '<span class="muted">No terms.</span>'}</div>
        <div class="add">
          <input data-term-input="${esc(name)}" type="text" maxlength="64" placeholder="Add a ${esc(name)} term or phrase" />
          <button class="btn" type="button" data-term-add="${esc(name)}">Add</button>
        </div>`;
    }).join('');

    this.set(this.css(CSS) + `<div class="${this._busy ? 'busy' : ''}">
      ${this._msg ? `<p class="msg">${esc(this._msg)}</p>` : ''}
      <h4>Category channels <span class="hint">(${this._channels.length} mapped; an unmapped category only posts to its featured channel)</span></h4>
      <ul class="list">${rows || '<li class="muted">No categories mapped yet. Seed with scripts/seed-content-channels.mjs or add one below.</li>'}</ul>
      <div class="add">
        <input data-map-cat type="text" placeholder="category key (topic or top-level taxonomy)" />
        <input data-map-ch type="text" inputmode="numeric" placeholder="Discord channel id" />
        <button class="btn" type="button" data-map-add>Map</button>
      </div>
      <h4>Discord post templates <span class="hint">(variables: {memberdiscord} {fullName} {author} {shareurl} {title} {category}; blank = default)</span></h4>
      ${tmplRows}
      ${this._engagementHtml()}
      ${listBlocks}
    </div>`);
    this._wire();
  }

  // SOW-111: the news auto-share settings (an item posts to its mapped category channel on member engagement).
  _engagementHtml() {
    const e = this._engagement;
    if (!e) return '';
    const tierOpts = (this._tiers || []).map((t) => `<option value="${esc(t)}" ${e.tier === t ? 'selected' : ''}>${esc(t)}</option>`).join('');
    return `<h4>News auto-share <span class="hint">(engagement posts a news item to its mapped category channel; one comment posts immediately)</span></h4>
      <div class="add">
        <select data-eng-enabled aria-label="News auto-share on or off">
          <option value="true" ${e.enabled ? 'selected' : ''}>On</option>
          <option value="false" ${e.enabled ? '' : 'selected'}>Off</option>
        </select>
        <input data-eng-threshold type="number" min="1" max="1000" value="${esc(String(e.open_threshold))}" aria-label="Distinct opens before auto-post" />
        <select data-eng-tier aria-label="Whose engagement counts">${tierOpts}</select>
        <select data-eng-comment aria-label="A comment posts immediately">
          <option value="true" ${e.comment_autopost ? 'selected' : ''}>Comment posts</option>
          <option value="false" ${e.comment_autopost ? '' : 'selected'}>Comment does not post</option>
        </select>
        <button class="btn" type="button" data-eng-save>Save</button>
      </div>
      <p class="hint" style="margin:-6px 0 14px">Opens count distinct members at the threshold; banned accounts never count. Applies after the next reconcile mirror sync.</p>`;
  }

  _wire() {
    this.on('[data-eng-save]', 'click', () => {
      const enabled = this.$('[data-eng-enabled]')?.value === 'true';
      const openThreshold = Number(this.$('[data-eng-threshold]')?.value || 0);
      const tier = this.$('[data-eng-tier]')?.value || 'paid';
      const commentAutopost = this.$('[data-eng-comment]')?.value === 'true';
      if (!Number.isInteger(openThreshold) || openThreshold < 1) { this._msg = 'The open threshold must be a whole number of 1 or more.'; this.render(); return; }
      this._run(() => this.client.setNewsEngagement({ enabled, openThreshold, tier, commentAutopost }));
    });
    this.on('[data-map-add]', 'click', () => {
      const category = (this.$('[data-map-cat]')?.value || '').trim().toLowerCase();
      const channelId = (this.$('[data-map-ch]')?.value || '').trim();
      if (!category || !channelId) { this._msg = 'A category key and a Discord channel id are required.'; this.render(); return; }
      this._run(() => this.client.setContentChannel({ category, channelId }));
    });
    this.$$('[data-unmap]').forEach((b) => b.addEventListener('click', () => {
      const category = b.dataset.unmap;
      if (typeof confirm === 'function' && !confirm(`Unmap category "${category}"?`)) return;
      this._run(() => this.client.removeContentChannel({ category }));
    }));
    this.$$('[data-tmpl-save]').forEach((b) => b.addEventListener('click', () => {
      const type = b.dataset.tmplSave;
      const template = (this.$(`[data-tmpl="${type}"]`)?.value || '').trim();
      this._run(() => this.client.setSyndicationTemplate({ type, template }));
    }));
    this.$$('[data-term-add]').forEach((b) => b.addEventListener('click', () => {
      const list = b.dataset.termAdd;
      const term = (this.$(`[data-term-input="${list}"]`)?.value || '').trim();
      if (!term) { this._msg = 'Enter a term first.'; this.render(); return; }
      this._run(() => this.client.addModerationFlagTerm({ list, term }));
    }));
    this.$$('[data-term-remove]').forEach((b) => b.addEventListener('click', () =>
      this._run(() => this.client.removeModerationFlagTerm({ list: b.dataset.list, term: b.dataset.term }))));
  }

  async _run(fn) {
    this._busy = true; this._msg = ''; this.render();
    try {
      const r = await fn();
      this._msg = r?.noop ? 'No change (already in that state).'
        : (r?.prNumber ? submitAck({ prNumber: r.prNumber, autoMerge: false }) : 'Done.');
    } catch (e) {
      this._msg = e?.message || 'That edit failed.';
    }
    this._busy = false;
    await this.load();
  }
}

define('gbti-channel-map-manager', GbtiChannelMapManager);
export { GbtiChannelMapManager };
