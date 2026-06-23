// <gbti-topic-picker> (SOW-054 Phase 3/5): the followed-topics control shared by onboarding (the welcome Topics
// step) and member settings. Fetches /topics.json (the vocabulary) + the caller's prefs.categories (current
// selection), renders toggle chips, and persists each toggle via client.setPrefs({ categories }). Emits
// 'topics-change' with the new selection. Inert without a signed-in client (shows the vocabulary, persists nothing).
import { GbtiElement, define, esc } from '../base.mjs';
import { topicsFromJson, toggleTopic, selectedTopics } from '../topic-picker-core.mjs';

const SITE = 'https://gbti.network';

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .chips { display:flex; flex-wrap:wrap; gap:8px; }
  .chip { font:inherit; font-size:13px; font-weight:600; color:var(--muted); background:var(--panel); border:1px solid var(--line); border-radius:999px; padding:7px 14px; cursor:pointer; }
  .chip:hover { color:var(--fg); border-color:var(--accent); }
  .chip.on { color:#fff; background:var(--accent); border-color:var(--accent); }
  .muted { color:var(--muted); font-size:14px; }
  .chips.busy { opacity:.6; pointer-events:none; }
`;

class GbtiTopicPicker extends GbtiElement {
  connectedCallback() {
    this._topics = null; // [{key,label}] or null while loading
    this._selected = []; // selected topic keys
    this._busy = false;
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
    const sel = new Set(this._selected);
    const chips = this._topics
      .map((t) => `<button class="chip ${sel.has(t.key) ? 'on' : ''}" data-topic="${esc(t.key)}" type="button" aria-pressed="${sel.has(t.key)}">${esc(t.label)}</button>`)
      .join('');
    this.set(this.css(CSS) + `<div class="chips ${this._busy ? 'busy' : ''}">${chips}</div>`);
    this.$$('[data-topic]').forEach((b) => b.addEventListener('click', () => this._toggle(b.dataset.topic)));
  }

  async _toggle(key) {
    const next = toggleTopic(this._selected, key);
    this._selected = next;
    this.render(); // optimistic
    this.dispatchEvent(new CustomEvent('topics-change', { detail: { topics: [...next] }, bubbles: true, composed: true }));
    if (this.client?.setPrefs) {
      this._busy = true;
      try { const p = await this.client.setPrefs({ categories: next }); this._selected = selectedTopics(p?.categories); }
      catch { /* keep the optimistic selection; the Worker is the authority on the next load */ }
      this._busy = false;
      this.render();
    }
  }
}

define('gbti-topic-picker', GbtiTopicPicker);
export { GbtiTopicPicker };
