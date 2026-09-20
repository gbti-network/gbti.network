// <gbti-news-source-manager> (SOW-056 P2): the superadmin news-source-pool manager. Lists the sources from
// house/news-sources.yml (client.newsSourcePool) and lets a superadmin ADD / REMOVE / ENABLE-DISABLE each via the
// admin ops, which open an auto-merged house PR (the SOW-038 governance model; the key never leaves the host's
// token + the gate is the real boundary). Edits go live at the Pages-deploy cadence (the worker reads the rebuilt
// /news-sources.json next cron). Inert in public (no injected client). Host-agnostic.
//
// sow-374: TWO SUBTABS, Sources and Blocked words (owner, 2026-09-19). The blocked-word list arrived in sow-372
// appended under 126 source rows, where nobody scrolling for it would ever meet it. They are two different
// decisions, which publications we read and what we refuse to republish, so they get two views rather than one
// long page.
//
// sow-374: THE WEIGHT LIVES IN THE SOURCE ROW, not in a third subtab. The five-step weight shipped in sow-338 with
// its only control on an individual news STORY's sidebar, which means it could be set for a publication whose
// story you happened to be reading and for no other. A third tab listing only the sources that diverge from
// neutral was the alternative, and it is the same data seen through a keyhole: you could adjust what is already
// adjusted and never reach the other hundred. Putting the stepper in the row makes every source reachable, and
// neutral needs no listing of its own because it is what a row reads when nobody has voted.
import { GbtiElement, define, esc } from '../base.mjs';
import { houseEditAck } from '../workspace-core.mjs'; // SOW-072 P2 + sow-275: the one consistent ack, reporting whether the edit merges on its own
import { normalizeBanword } from '../../../membership/news-banwords.mjs'; // sow-372: the words that keep a story out
import { weightLabel, stepToward, WEIGHT_MIN, WEIGHT_MAX } from '../../../membership/news-source-weight-edits.mjs'; // sow-338: how hard we lean on a source

const hostOf = (url) => { try { return new URL(url).host; } catch { return url || ''; } };

const CSS = `
  :host { display:block; }
  .head { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; margin:0 0 12px; }
  .head h3 { margin:0; font-family:var(--font-display, inherit); font-size:17px; }
  .hint { font-size:12.5px; color:var(--muted); }
  .msg { font-size:13px; color:var(--accent); margin:0 0 12px; }
  .busy { opacity:.55; pointer-events:none; }
  .add { display:flex; gap:8px; flex-wrap:wrap; margin:0 0 14px; }
  .add input { flex:1 1 130px; min-width:0; font:inherit; color:var(--fg); background:var(--paper, transparent); border:1px solid var(--line); border-radius:7px; padding:7px 9px; }
  .add input[data-add-url] { flex:2 1 220px; }
  .btn { flex:none; border:1px solid var(--accent); background:var(--accent); color:#fff; border-radius:7px; font:inherit; font-weight:700; font-size:13px; padding:7px 14px; cursor:pointer; }
  .list { list-style:none; margin:0; padding:0; }
  .src { border-top:1px solid var(--line); }
  .src:first-child { border-top:0; }
  .src.off { opacity:.55; }
  .row { display:flex; align-items:center; gap:10px; padding:9px 2px; }
  .id { font-family:var(--font-mono, monospace); font-size:12px; color:var(--muted); flex:none; }
  .nm { font-weight:600; color:var(--fg); }
  .url { font-size:12.5px; color:var(--muted); text-decoration:none; }
  .url:hover { color:var(--accent); }
  .sp { flex:1; }
  .lk { flex:none; border:1px solid var(--line); background:var(--paper, transparent); color:var(--fg); border-radius:7px; font:inherit; font-size:12.5px; font-weight:600; padding:5px 11px; cursor:pointer; }
  .lk:hover { border-color:var(--accent); color:var(--accent); }
  .lk.danger:hover { border-color:var(--danger, #e06c6c); color:var(--danger, #e06c6c); }
  .muted { color:var(--muted); }

  /* sow-374: the subtab bar. Two views of one screen, so it reads as a segmented control rather than as the
     page's own tab row above it. */
  .subtabs { display:flex; gap:4px; margin:0 0 16px; border-bottom:1px solid var(--line); }
  .subtab { border:0; border-bottom:2px solid transparent; background:transparent; color:var(--muted); font:inherit;
    font-size:13.5px; font-weight:600; padding:8px 14px; margin-bottom:-1px; cursor:pointer; }
  .subtab:hover { color:var(--fg); background:transparent; }
  .subtab[aria-selected="true"] { color:var(--fg); border-bottom-color:var(--accent); }
  .subtab .count { color:var(--muted); font-weight:500; }

  /* sow-374: the weight stepper in a source row. 28px targets, because the first version of the sibling control
     measured 25x19 and was under the size a thumb can hit. The label is fixed-width so 126 rows do not shuffle
     sideways as their values differ. */
  .wt { display:inline-flex; align-items:center; gap:2px; flex:none; }
  .wt button { display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; flex:none;
    border:1px solid var(--line); background:var(--paper, transparent); color:var(--fg); font:inherit; font-size:15px;
    line-height:1; padding:0; border-radius:7px; cursor:pointer; }
  .wt button:hover:not(:disabled) { border-color:var(--accent); color:var(--accent); background:var(--paper, transparent); }
  .wt button:disabled { opacity:.35; cursor:default; }
  .wt .val { display:inline-block; min-width:74px; text-align:center; font-size:12px; color:var(--muted); }
  .wt .val.set { color:var(--fg); font-weight:600; }

  /* sow-372: the blocked-word list, now its own view rather than a block under the sources. */
  .bw h4 { margin:0 0 4px; font-family:var(--font-display, inherit); font-size:15px; }
  .chips { display:flex; flex-wrap:wrap; gap:8px; margin:12px 0 0; }
  .chip { display:inline-flex; align-items:center; gap:4px; border:1px solid var(--line); border-radius:999px; padding:3px 3px 3px 12px; font-size:13px; color:var(--fg); }
  /* 26px square, not the 19px the padding alone gave it: measured in a browser at 25x19, which is under the
     24px minimum a thumb can hit. The chip's own padding shrinks on the button side to keep the pill compact. */
  .chip button { display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px; flex:none; border:0; background:transparent; color:var(--muted); font:inherit; font-size:15px; line-height:1; padding:0; border-radius:999px; cursor:pointer; }
  .chip button:hover { background:var(--danger, #e06c6c); color:#fff; }

  @media (max-width: 640px) {
    .row { flex-wrap:wrap; }
    .wt .val { min-width:64px; }
  }
`;

class GbtiNewsSourceManager extends GbtiElement {
  // SOW-070 fix: this element is in admin.html's static markup, so it upgrades BEFORE admin.mjs injects the client.
  // Don't load eagerly here; render() retries the load the moment the client arrives (setClient re-renders subscribers).
  connectedCallback() { super.connectedCallback?.(); }

  async load() {
    if (!this.client) { this.render(); return; }
    try {
      const pool = await this.client.newsSourcePool();
      this._sources = pool?.sources || [];
      this._banwords = Array.isArray(pool?.banwords) ? pool.banwords : [];
      // sow-374: neutral is ABSENCE in the stored file, so a source missing from this map reads as 0 rather than
      // as unknown. That is the same convention the pipeline applies, and it is why an unweighted pool is empty.
      this._weights = (pool?.weights && typeof pool.weights === 'object') ? pool.weights : {};
    } catch { this._sources = []; this._banwords = []; this._weights = {}; this._msg = 'Could not load the news sources.'; }
    this._loading = false;
    this.render();
  }

  /** Which subtab is showing. Held on the element so a re-render after a save does not throw the reader back. */
  get _view() { return this._viewKey === 'banwords' ? 'banwords' : 'sources'; }

  render() {
    if (!this.client) { this.set(this.css(CSS) + `<p class="muted">Open in the GBTI client (admin) to manage news sources.</p>`); return; }
    if (!this._sources) { if (!this._loading) { this._loading = true; this.load(); } this.set(this.css(CSS) + `<p class="muted">Loading news sources...</p>`); return; }
    const view = this._view;
    this.set(this.css(CSS) + `<div class="${this._busy ? 'busy' : ''}">
      <div class="subtabs" role="tablist" aria-label="News settings">
        <button class="subtab" type="button" role="tab" data-view="sources" aria-selected="${view === 'sources'}">Sources <span class="count">${this._sources.length}</span></button>
        <button class="subtab" type="button" role="tab" data-view="banwords" aria-selected="${view === 'banwords'}">Blocked words <span class="count">${(this._banwords || []).length}</span></button>
      </div>
      ${this._msg ? `<p class="msg">${esc(this._msg)}</p>` : ''}
      ${view === 'banwords' ? this._banwordsView() : this._sourcesView()}
    </div>`);
    this._wire();
  }

  _sourcesView() {
    const enabled = this._sources.filter((s) => s && s.enabled !== false).length;
    const weighted = Object.keys(this._weights || {}).length;
    const rows = this._sources.map((s) => {
      const on = s && s.enabled !== false;
      return `<li class="src ${on ? '' : 'off'}"><div class="row">`
        + `<code class="id">${esc(s.id || '')}</code><span class="nm">${esc(s.name || '')}</span>`
        + `<a class="url" href="${esc(s.url || '')}" target="_blank" rel="noopener nofollow">${esc(hostOf(s.url))}</a>`
        + `<span class="sp"></span>`
        + this._weightControl(s)
        + `<button class="lk" type="button" data-toggle="${esc(s.id)}" data-on="${on ? '1' : '0'}">${on ? 'Disable' : 'Enable'}</button>`
        + `<button class="lk danger" type="button" data-remove="${esc(s.id)}">Remove</button>`
        + `</div></li>`;
    }).join('');
    return `<div class="head"><span class="hint">${this._sources.length} sources, ${enabled} enabled, ${weighted} weighted</span></div>
      <div class="add">
        <input data-add-id type="text" placeholder="source-id (optional)" />
        <input data-add-name type="text" placeholder="Name" />
        <input data-add-url type="text" placeholder="https://... RSS/Atom feed URL" />
        <button class="btn" type="button" data-add>Add source</button>
      </div>
      <p class="hint" style="margin:-6px 0 14px">The next news ingest confirms the feed fetches; a source that never returns items can be removed here. The arrows change how often we check a publication and how much we keep from it.</p>
      <ul class="list">${rows || '<li class="muted">No sources yet.</li>'}</ul>`;
  }

  /**
   * sow-374: the five-step weight, in the row. The label says what the step DOES ("Much less"), never the number,
   * because -1 is only meaningful to whoever wrote the table. The arrows disable at each end rather than wrapping
   * or silently clamping, so the scale's edges are visible instead of being discovered.
   */
  _weightControl(s) {
    const id = String(s?.id || '');
    const w = Number(this._weights?.[id]) || 0;
    return `<span class="wt">`
      + `<button type="button" data-wt="${esc(id)}" data-dir="-1" aria-label="Take less from ${esc(s?.name || id)}" title="Take less from this source"${w <= WEIGHT_MIN ? ' disabled' : ''}>&minus;</button>`
      + `<span class="val${w === 0 ? '' : ' set'}">${esc(weightLabel(w))}</span>`
      + `<button type="button" data-wt="${esc(id)}" data-dir="1" aria-label="Take more from ${esc(s?.name || id)}" title="Take more from this source"${w >= WEIGHT_MAX ? ' disabled' : ''}>+</button>`
      + `</span>`;
  }

  // sow-372: the superadmin's blocked-word list. A word here keeps every story carrying it out of the stream,
  // in the hourly ingest and in what the feed serves, so the note says both and says what it does NOT touch.
  _banwordsView() {
    const words = this._banwords || [];
    const chips = words.map((w) => `<span class="chip">${esc(w)}<button type="button" data-unban="${esc(w)}" aria-label="Stop blocking ${esc(w)}" title="Stop blocking ${esc(w)}">&times;</button></span>`).join('');
    return `<div class="bw">
      <h4>Blocked words</h4>
      <p class="hint">A story whose headline or summary carries one of these never enters the stream, and any already in the window stop showing. Whole words only, so "trump" leaves a trumpet alone. This is what we republish from other publications; it never touches member writing.</p>
      <div class="add" style="margin-top:12px">
        <input data-bw-word type="text" placeholder="word or short phrase" />
        <button class="btn" type="button" data-bw-add>Block word</button>
      </div>
      <div class="chips">${chips || '<span class="muted">No blocked words.</span>'}</div>
    </div>`;
  }

  _wire() {
    this.$$('[data-view]').forEach((b) => b.addEventListener('click', () => {
      this._viewKey = b.dataset.view;
      this._msg = ''; // an ack from the other view would read as if it belonged to this one
      this.render();
    }));
    this.on('[data-bw-add]', 'click', () => {
      const raw = this.$('[data-bw-word]')?.value || '';
      // Normalized here for immediate feedback, and again server-side, where it is the boundary.
      const word = normalizeBanword(raw);
      if (!word) { this._msg = 'A blocked word is 2 to 40 characters: letters and digits with at least one letter, single spaces or hyphens between them.'; this.render(); return; }
      this._run(() => this.client.addNewsBanword({ word }));
    });
    this.$$('[data-unban]').forEach((b) => b.addEventListener('click', () => {
      const word = b.dataset.unban;
      if (typeof confirm === 'function' && !confirm(`Stop blocking "${word}"? Stories carrying it come back on the next hourly fetch.`)) return;
      this._run(() => this.client.removeNewsBanword({ word }));
    }));
    this.$$('[data-wt]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.wt;
      const next = stepToward(Number(this._weights?.[id]) || 0, Number(b.dataset.dir));
      this._run(() => this.client.setNewsSourceWeight({ id, weight: next }));
    }));
    this.on('[data-add]', 'click', () => {
      const id = (this.$('[data-add-id]')?.value || '').trim();
      const name = (this.$('[data-add-name]')?.value || '').trim();
      const url = (this.$('[data-add-url]')?.value || '').trim();
      // Client-side URL validation for immediate feedback (the pure edit re-checks server-side). A full
      // fetch+parseFeed check is not done here: the extension cannot fetch arbitrary URLs (narrow host_permissions
      // by design), and the news ingest is fail-soft (a non-fetching source returns 0 items, no outage) — remove it
      // here if it never returns items. See the SOW for the optional server-side validate-feed follow-up.
      if (!url) { this._msg = 'A feed URL is required.'; this.render(); return; }
      let ok = false;
      try { ok = /^https?:$/.test(new URL(url).protocol); } catch { ok = false; }
      if (!ok) { this._msg = 'Enter a valid http(s) RSS/Atom feed URL.'; this.render(); return; }
      this._run(() => this.client.addNewsSource({ id, name, url }));
    });
    this.$$('[data-toggle]').forEach((b) => b.addEventListener('click', () =>
      this._run(() => this.client.setNewsSourceEnabled({ id: b.dataset.toggle, enabled: b.dataset.on !== '1' }))));
    this.$$('[data-remove]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.remove;
      if (typeof confirm === 'function' && !confirm(`Remove news source "${id}"?`)) return;
      this._run(() => this.client.removeNewsSource({ id }));
    }));
  }

  async _run(fn) {
    this._busy = true; this._msg = ''; this.render();
    try {
      const r = await fn();
      this._msg = r?.noop ? 'No change (already in that state).'
        : (r?.prNumber ? houseEditAck(r) : 'Done.');
    } catch (e) {
      this._msg = e?.message || 'That edit failed.';
    }
    this._busy = false;
    await this.load();
  }
}

define('gbti-news-source-manager', GbtiNewsSourceManager);
export { GbtiNewsSourceManager };
