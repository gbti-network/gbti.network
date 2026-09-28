// <gbti-news-admin> (sow-420): the superadmin card on a news story, in the extension's news reader under the channel
// card. It is the website's card (sow-338, src/components/news/NewsAdminControls.astro) brought into the extension,
// with the same two controls and the same words:
//   - Modify source weight: take more or less from the publication that sent this story. Saved as a pull request
//     against house/news-source-weights.yml, so it takes effect on the next deploy.
//   - Remove this story: out of the news index within five minutes (the edge store), with an Undo.
//
// Owner, 2026-09-28: "we want our superadmin ability to add weight or remove weight to news sources from the
// extension." The reader mounts this for a superadmin only, and that is presentation: the Worker re-checks
// superadmin on every call, so anyone else who reached it would get a 403 and change nothing.
//
// The reader rebuilds its whole shadow DOM on every render and re-inserts THIS node each time, so everything the card
// shows is derived from state held on the element, never from its own DOM.
import { GbtiElement, define, esc } from '../base.mjs';
import { weightLabel, stepToward } from '../../../membership/news-source-weight-edits.mjs';
import { pendingEdits, overlayWeights } from '../news-source-manager-core.mjs'; // sow-415: a saved step shows before it merges

// The words, kept identical to the website card. test/extension-news-admin.test.mjs holds the two in step.
export const NEWS_ADMIN_COPY = {
  eyebrow: 'Superadmin',
  weightLabel: 'Modify source weight',
  down: 'Take less from this source',
  up: 'Take more from this source',
  weightNote: 'A change is saved as a pull request and takes effect on the next deploy.',
  saving: 'Saving...',
  backToNormal: 'Back to normal. It takes effect on the next deploy.',
  weightFailed: 'That did not save. Try again in a minute.',
  remove: 'Remove this story',
  removing: 'Removing...',
  removed: 'Removed',
  removeNote: 'It leaves the news index within five minutes. The post in Discord stays.',
  removedNote: 'Use Undo beside the story to put it back.',
  failed: 'That did not go through. Try again in a minute.',
  removedNotice: 'Removed from the news index. Readers stop seeing it within five minutes.',
  undo: 'Undo',
  restoring: 'Putting it back...',
  restoredNotice: 'Back in the news index. Reload to read it again.',
};
const C = NEWS_ADMIN_COPY;

/** The note after a weight is saved, word for word as the website says it. */
export const savedWeightNote = (weight) => (weight === 0
  ? C.backToNormal
  : `Saved. We will take ${weightLabel(weight).toLowerCase()} from this source on the next deploy.`);

/** The confirm before a removal, word for word as the website asks it. */
export const removeQuestion = (title) => `Remove ${title ? `"${title}"` : 'this story'} from the news index? You can put it back from this page.`;

// Held across stories and across reopenings: the weights file is read from main, and a saved step reaches main only
// when its pull request merges, about half a minute later. Without this, reopening a story straight after a save
// would show the step main still holds.
const HELD = pendingEdits();

const CSS = `
  :host { display:block; }
  .card { border:1px solid var(--line); background:var(--panel); border-radius:7px; padding:16px; -webkit-backdrop-filter:var(--glass-blur); backdrop-filter:var(--glass-blur); }
  .na-eyebrow { margin:0 0 12px; font-size:11px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:var(--accent); }
  .na-block + .na-block { margin-top:18px; padding-top:18px; border-top:1px solid var(--line); }
  .na-label { font-size:13px; font-weight:700; color:var(--fg); }
  .na-steps { display:flex; align-items:center; gap:10px; margin-top:10px; }
  /* BASE_CSS paints every bare button brand green, so each button here sets its own background and hover. */
  button.na-arrow { width:30px; height:30px; flex:none; padding:0; border-radius:8px; cursor:pointer; font:inherit; font-size:17px; line-height:1;
    background:none; border:1.5px solid var(--line); color:var(--fg); }
  button.na-arrow:hover:not([disabled]) { background:none; border-color:var(--brand); color:var(--accent); }
  button.na-arrow[disabled] { opacity:.35; cursor:default; }
  .na-step { font-size:13.5px; font-weight:700; min-width:84px; text-align:center; color:var(--fg); }
  .na-note { margin:10px 0 0; font-size:12px; line-height:1.5; color:var(--muted); }
  button.na-remove { width:100%; font:inherit; font-size:13px; font-weight:700; line-height:1; padding:9px 12px; border-radius:999px; cursor:pointer;
    background:none; border:1.5px solid var(--line); color:var(--fg); }
  button.na-remove:hover:not([disabled]) { background:none; border-color:#c2413b; color:#c2413b; }
  button.na-remove[disabled] { opacity:.55; cursor:default; }
  /* AT THE END on purpose: a media query adds no specificity, so placed above the base rules it would lose on
     source order. On a phone these are thumbs on a stepper, so they get a real tap target. */
  @media (max-width:640px) {
    button.na-arrow { width:44px; height:44px; font-size:19px; }
    button.na-remove { padding:13px 12px; }
    .na-step { min-width:96px; font-size:14.5px; }
  }
`;

class GbtiNewsAdmin extends GbtiElement {
  /** The story this card acts on: { guid, source, title }. Setting it resets the card and reads the source's weight. */
  set story(s) {
    this._story = s && typeof s === 'object' ? s : null;
    clearTimeout(this._timer);
    this._timer = null;
    this._loaded = false;     // the weight has been read, so the arrows may move
    this._saved = 0;          // the step the weights file holds, as far as we know
    this._step = 0;           // what the arrows show, which may be ahead of it
    this._weightNote = C.weightNote;
    this._removal = 'idle';   // idle | removing | removed
    this._removeNote = C.removeNote;
    if (this.isConnected) this.render();
    this._load();
  }
  get story() { return this._story || null; }

  async _load() {
    const story = this._story;
    const id = String(story?.source || '');
    if (!id || !this.client?.newsSourcePool) return;
    try {
      const pool = await this.client.newsSourcePool();
      if (story !== this._story) return; // a newer story was opened while this one loaded
      const weights = overlayWeights((pool?.weights && typeof pool.weights === 'object') ? pool.weights : {}, HELD);
      this._saved = Number(weights[id]) || 0;
      this._step = this._saved;
      this._loaded = true;
    } catch {
      if (story !== this._story) return;
      this._weightNote = 'Could not read how much we take from this source. Reopen the story to try again.';
    }
    if (this.isConnected) this.render();
  }

  _move(direction) {
    if (!this._loaded) return;
    const next = stepToward(this._step, direction);
    if (next === this._step) return;
    this._step = next;
    this.render();
    // The arrows move at once and the write follows after a pause, so two quick clicks send ONE change.
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._save(), 900);
  }

  async _save() {
    this._timer = null;
    const story = this._story;
    const target = this._step;
    const before = this._saved;
    const id = String(story?.source || '');
    if (target === before || !id) return;
    this._weightNote = C.saving;
    this.render();
    try {
      await this.client.setNewsSourceWeight({ id, weight: target });
      HELD.weights.set(id, target);
      if (story !== this._story) return;
      this._saved = target;
      this._weightNote = savedWeightNote(target);
    } catch (err) {
      if (story !== this._story) return;
      // A control that keeps a step it did not save is worse than one that refuses, so it goes back and says why.
      this._step = before;
      this._weightNote = err?.message || C.weightFailed;
    }
    this.render();
  }

  async _remove() {
    const story = this._story;
    if (!story?.guid || this._removal !== 'idle') return;
    if (typeof confirm === 'function' && !confirm(removeQuestion(story.title))) return;
    this._removal = 'removing';
    this.render();
    try {
      await this.client.removeNewsItem(String(story.guid));
      if (story !== this._story) return;
      this._removal = 'removed';
      this._removeNote = C.removedNote;
      this.render();
      this.emit('gbti-news-removed', { guid: story.guid });
    } catch (err) {
      if (story !== this._story) return;
      this._removal = 'idle';
      this._removeNote = err?.message || C.failed;
      this.render();
    }
  }

  /** Called by the reader once its Undo has put the story back: the card reads as not removed again. */
  restored() {
    this._removal = 'idle';
    this._removeNote = C.removeNote;
    if (this.isConnected) this.render();
  }

  render() {
    if (!this._story) { this.set(''); return; }
    const canDown = this._loaded && stepToward(this._step, -1) !== this._step;
    const canUp = this._loaded && stepToward(this._step, 1) !== this._step;
    const removeLabel = this._removal === 'removing' ? C.removing : this._removal === 'removed' ? C.removed : C.remove;
    this.set(this.css(CSS)
      + `<div class="card" data-news-admin><p class="na-eyebrow">${esc(C.eyebrow)}</p>`
      + `<div class="na-block"><div class="na-label">${esc(C.weightLabel)}</div>`
      + `<div class="na-steps">`
      + `<button type="button" class="na-arrow" data-na-down aria-label="${esc(C.down)}"${canDown ? '' : ' disabled'}>&minus;</button>`
      + `<span class="na-step" data-na-step>${esc(this._loaded ? weightLabel(this._step) : '...')}</span>`
      + `<button type="button" class="na-arrow" data-na-up aria-label="${esc(C.up)}"${canUp ? '' : ' disabled'}>+</button>`
      + `</div><p class="na-note" data-na-weight-note>${esc(this._weightNote)}</p></div>`
      + `<div class="na-block"><button type="button" class="na-remove" data-na-remove${this._removal === 'idle' ? '' : ' disabled'}>${esc(removeLabel)}</button>`
      + `<p class="na-note" data-na-remove-note>${esc(this._removeNote)}</p></div></div>`);
    this.$('[data-na-down]')?.addEventListener('click', () => this._move(-1));
    this.$('[data-na-up]')?.addEventListener('click', () => this._move(1));
    this.$('[data-na-remove]')?.addEventListener('click', () => this._remove());
  }
}

define('gbti-news-admin', GbtiNewsAdmin);
export { GbtiNewsAdmin };
