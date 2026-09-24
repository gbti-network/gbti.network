// <gbti-topic-picker> (SOW-054 Phase 3/5): the followed-topics control shared by onboarding (the welcome Topics
// step) and member settings. Fetches /topics.json (the vocabulary) + the caller's prefs.categories (current
// selection), renders toggle chips, and persists each toggle via client.setPrefs({ categories }). Emits
// 'topics-change' with the new selection. Inert without a signed-in client (shows the vocabulary, persists nothing).
import { GbtiElement, define, esc } from '../base.mjs';
import { topicsFromJson, groupOrderFromJson, toggleTopic, selectedTopics, filterTopics, groupTopics, selectAllTopics, seedDefaultTopics } from '../topic-picker-core.mjs';

const SITE = 'https://gbti.network';
const MAX_TOPICS = 200; // SOW-080: mirrors membership/member-prefs.mjs MAX_CATEGORIES (the Worker truncates beyond this)
// sow-207 QA: seeding the default topics is remembered so it happens AT MOST ONCE per browser. Without this, a
// member who deliberately pressed Clear during onboarding would have the defaults silently restored the next time
// the step loaded, because an empty selection and "never chose" are indistinguishable to the client (the Worker
// normalizes a missing prefs record to `{ categories: [] }`). Opt-in per host via the `seed-defaults` attribute,
// so ONLY onboarding seeds: the Settings picker must never re-impose topics on an established member.
const SEEDED_KEY = 'gbti-welcome-topics-seeded';

// sow-227: restyled to the design the owner approved on 2026-09-23 (the "Category Picker" canvas), in the website's
// look: the directory search pill, the prompts page facet headings, and selected chips in the site's green tint with a
// check (it was white on --accent, about 1.9:1 in dark mode). Every button names its own background and hover,
// because BASE_CSS turns a bare button green on hover.
const MONO = `'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace`;
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .bar { display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin:0 0 6px; }
  .sw { position:relative; flex:1; min-width:220px; }
  .sw svg { position:absolute; left:16px; top:50%; transform:translateY(-50%); width:16px; height:16px; color:var(--fg-mute); pointer-events:none; }
  .srch { width:100%; font-family:${MONO}; font-size:13.5px; color:var(--fg); background:var(--panel); border:1.5px solid var(--line-2); border-radius:999px; padding:10px 18px 10px 42px; }
  .srch:focus { outline:none; border-color:var(--brand); box-shadow:0 0 0 3px var(--green-tint); }
  .srch::placeholder { color:var(--fg-mute); }
  .cnt { flex:none; font-family:${MONO}; font-size:12px; color:var(--fg-mute); white-space:nowrap; }
  .mini { flex:none; font:inherit; font-size:13px; font-weight:600; color:var(--fg); background:var(--panel);
    border:1.5px solid var(--line-2); border-radius:8px; padding:7px 13px; cursor:pointer; white-space:nowrap; }
  .mini:hover { background:var(--panel); color:var(--fg); border-color:var(--brand); }
  .gh { display:flex; align-items:baseline; gap:8px; margin:18px 0 9px; }
  .grp { margin:0; font-size:12px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--fg-mute); }
  .tally { font-family:${MONO}; font-size:11px; color:var(--fg-mute); }
  .chips { display:flex; flex-wrap:wrap; gap:8px; }
  .chip { display:inline-flex; align-items:center; gap:6px; font:inherit; font-size:13.5px; font-weight:600; color:var(--muted); background:var(--panel);
    border:1.5px solid var(--line-2); border-radius:999px; padding:6px 13px; cursor:pointer; }
  .chip:hover { background:var(--panel); color:var(--fg); border-color:var(--brand); }
  .chip.on, .chip.on:hover { color:var(--accent); background:var(--green-tint); border-color:var(--brand); }
  .chip svg { width:13px; height:13px; margin-left:-2px; flex:none; }
  .muted { color:var(--fg-mute); font-size:14px; }
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
    try {
      const data = await (await fetch(`${SITE}/topics.json`, { cache: 'no-cache' })).json();
      this._topics = topicsFromJson(data);
      this._groupOrder = groupOrderFromJson(data); // sow-227: the Categories screen's heading order
    } catch { this._topics = []; }
    if (this.client?.getPrefs) {
      try { const p = await this.client.getPrefs(); this._selected = selectedTopics(p?.categories); } catch { this._selected = []; }
      await this._seedDefaults();
    }
    this.render();
  }

  /**
   * Give a member with NO topics the owner's default group, once, and PERSIST it.
   *
   * Persisting rather than merely highlighting is the whole point: the welcome step's Continue does not save
   * anything itself, so a member who accepts the defaults by not touching them would otherwise finish
   * onboarding with an untuned feed, which is exactly the outcome a default group exists to prevent.
   *
   * Silent on failure. This is a nicety layered on top of the step, so a failed write must leave the member
   * looking at a normal, usable picker rather than an error about something they never asked for.
   */
  async _seedDefaults() {
    if (!this.hasAttribute('seed-defaults') || this._selected.length) return;
    try { if (localStorage.getItem(SEEDED_KEY) === '1') return; } catch { /* storage blocked: seed anyway */ }
    const next = seedDefaultTopics(this._selected, this._topics);
    if (!next.length) return; // the vocabulary did not load, or every default key is gone from it
    try { localStorage.setItem(SEEDED_KEY, '1'); } catch { /* private mode: at worst it seeds again next time */ }
    this._selected = next;
    this.dispatchEvent(new CustomEvent('topics-change', { detail: { topics: [...next] }, bubbles: true, composed: true }));
    if (this.client?.setPrefs) {
      try { const p = await this.client.setPrefs({ categories: next }); this._selected = selectedTopics(p?.categories); }
      catch { /* keep the optimistic selection; the Worker is the authority on the next load */ }
    }
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
        <div class="sw"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M16.5 16.5 21 21" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg><input type="search" class="srch" placeholder="Filter topics" aria-label="Filter topics" /></div>
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
    const groups = groupTopics(filterTopics(this._topics, this._query), this._groupOrder).filter((g) => g.topics.length);
    // sow-227: each heading says how many of its topics are followed ("2 of 24"), counted over the whole group, not
    // just the ones the filter shows.
    const whole = new Map(groupTopics(this._topics).map((g) => [g.group, g.topics]));
    const tally = (g) => { const all = whole.get(g) || []; const on = all.filter((t) => sel.has(t.key)).length; return on ? `${on} of ${all.length}` : `${all.length}`; };
    const chipsFor = (topics) => topics
      .map((t) => `<button class="chip ${sel.has(t.key) ? 'on' : ''}" data-topic="${esc(t.key)}" type="button" aria-pressed="${sel.has(t.key)}">${sel.has(t.key) ? CHECK : ''}${esc(t.label)}</button>`)
      .join('');
    list.className = `list ${this._busy ? 'busy' : ''}`;
    list.innerHTML = groups.length
      ? groups.map((g) => `${g.group ? `<div class="gh"><h4 class="grp">${esc(g.group)}</h4><span class="tally">${tally(g.group)}</span></div>` : ''}<div class="chips">${chipsFor(g.topics)}</div>`).join('')
      : '<p class="muted">No topic matches that filter.</p>';
    const cnt = this.$('[data-cnt]');
    if (cnt) cnt.textContent = `${this._selected.length} selected (max ${MAX_TOPICS})`;
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
