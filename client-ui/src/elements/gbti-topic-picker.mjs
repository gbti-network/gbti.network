// <gbti-topic-picker> (SOW-054 Phase 3/5): the followed-topics control shared by onboarding (the welcome Topics
// step) and member settings. Fetches /topics.json (the vocabulary) + the caller's prefs.categories (current
// selection), renders toggle chips, and persists each toggle via client.setPrefs({ categories }). Emits
// 'topics-change' with the new selection. Inert without a signed-in client (shows the vocabulary, persists nothing).
import { GbtiElement, define, esc } from '../base.mjs';
import { topicsFromJson, toggleTopic, selectedTopics, filterTopics, groupTopics, selectAllTopics } from '../topic-picker-core.mjs';

const SITE = 'https://gbti.network';
const MAX_TOPICS = 200; // SOW-080: mirrors membership/member-prefs.mjs MAX_CATEGORIES (the Worker truncates beyond this)

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .bar { display:flex; align-items:center; gap:10px; margin:0 0 12px; }
  .srch { flex:1; min-width:0; font:inherit; font-size:13px; color:var(--fg); background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:8px 12px; }
  .srch:focus { outline:none; border-color:var(--accent); }
  .cnt { flex:none; font-size:12px; color:var(--muted); white-space:nowrap; }
  .mini { flex:none; font:inherit; font-size:12.5px; font-weight:600; color:var(--muted); background:var(--panel);
    border:1px solid var(--line); border-radius:8px; padding:7px 11px; cursor:pointer; white-space:nowrap; }
  .mini:hover { color:var(--fg); border-color:var(--accent); }
  .grp { margin:14px 0 8px; font-size:12px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--muted); }
  .grp:first-child { margin-top:0; }
  .chips { display:flex; flex-wrap:wrap; gap:8px; }
  .chip { font:inherit; font-size:13px; font-weight:600; color:var(--muted); background:var(--panel); border:1px solid var(--line); border-radius:999px; padding:7px 14px; cursor:pointer; }
  .chip:hover { color:var(--fg); border-color:var(--accent); }
  .chip.on { color:#fff; background:var(--accent); border-color:var(--accent); }
  .muted { color:var(--muted); font-size:14px; }
  .list.busy { opacity:.6; pointer-events:none; }
`;

class GbtiTopicPicker extends GbtiElement {
  connectedCallback() {
    this._topics = null; // [{key,label,group?}] or null while loading
    this._selected = []; // selected topic keys
    this._busy = false;
    this._query = ''; // SOW-080: the search filter
    super.connectedCallback?.();
    this._load();
  }

  async _load() {
    // The vocabulary is public; the current selection needs a signed-in client (else it stays empty).
    try { const r = await fetch(`${SITE}/topics.json`, { cache: 'no-cache' }); this._topics = topicsFromJson(await r.json()); }
    catch { this._topics = []; }
    if (this.client?.getPrefs) {
      try { const p = await this.client.getPrefs(); this._selected = selectedTopics(p?.categories); } catch { this._selected = []; }
    }
    this.render();
  }

  /** The current selection (topic keys), for a host that wants to read it on a Continue/Save action. */
  get selected() { return [...this._selected]; }

  render() {
    if (!this._topics) { this.set(this.css(CSS) + `<p class="muted">Loading topics...</p>`); return; }
    if (!this._topics.length) { this.set(this.css(CSS) + `<p class="muted">No topics available right now.</p>`); return; }
    // SOW-080: a search filter + a selected-count (cap surfaced) above the chips. The chip list re-renders IN PLACE on
    // search/toggle (via _renderChips), so the search box keeps its value + focus.
    this.set(this.css(CSS) + `
      <div class="bar">
        <input type="search" class="srch" placeholder="Filter topics" aria-label="Filter topics" />
        <span class="cnt" data-cnt></span>
        <button class="mini" data-all type="button">Select all</button>
        <button class="mini" data-clear type="button">Clear</button>
      </div>
      <div class="list" data-list></div>`);
    const srch = this.$('.srch');
    if (srch) {
      srch.value = this._query;
      srch.addEventListener('input', () => { this._query = srch.value; this._renderChips(); });
    }
    // Select all works on the FILTERED view when a query is active (so "select every AI topic" composes with
    // the search box); with no query it selects the whole vocabulary. Both persist as ONE setPrefs call.
    this.on('[data-all]', 'click', () => this._setSelection(selectAllTopics(this._selected, filterTopics(this._topics, this._query), MAX_TOPICS)));
    this.on('[data-clear]', 'click', () => this._setSelection([]));
    this._renderChips();
  }

  _renderChips() {
    const list = this.$('[data-list]');
    if (!list) return;
    const sel = new Set(this._selected);
    const groups = groupTopics(filterTopics(this._topics, this._query)).filter((g) => g.topics.length);
    const chipsFor = (topics) => topics
      .map((t) => `<button class="chip ${sel.has(t.key) ? 'on' : ''}" data-topic="${esc(t.key)}" type="button" aria-pressed="${sel.has(t.key)}">${esc(t.label)}</button>`)
      .join('');
    list.className = `list ${this._busy ? 'busy' : ''}`;
    list.innerHTML = groups.length
      ? groups.map((g) => `${g.group ? `<h4 class="grp">${esc(g.group)}</h4>` : ''}<div class="chips">${chipsFor(g.topics)}</div>`).join('')
      : `<p class="muted">No topics match "${esc(this._query)}".</p>`;
    const cnt = this.$('[data-cnt]');
    if (cnt) {
      const n = this._selected.length;
      cnt.textContent = n ? `${n} selected${n >= MAX_TOPICS ? ` (max ${MAX_TOPICS})` : ''}` : '';
    }
    this.$$('[data-topic]').forEach((b) => b.addEventListener('click', () => this._toggle(b.dataset.topic)));
  }

  _toggle(key) {
    return this._setSelection(toggleTopic(this._selected, key));
  }

  /** Apply + persist a whole selection (a single toggle, Select all, or Clear) as one setPrefs call. */
  async _setSelection(next) {
    this._selected = next;
    this._renderChips(); // optimistic; preserves the search box + focus
    this.dispatchEvent(new CustomEvent('topics-change', { detail: { topics: [...next] }, bubbles: true, composed: true }));
    if (this.client?.setPrefs) {
      this._busy = true; this._renderChips();
      try { const p = await this.client.setPrefs({ categories: next }); this._selected = selectedTopics(p?.categories); }
      catch { /* keep the optimistic selection; the Worker is the authority on the next load */ }
      this._busy = false; this._renderChips();
    }
  }
}

define('gbti-topic-picker', GbtiTopicPicker);
export { GbtiTopicPicker };
