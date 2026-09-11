// <gbti-prose-editor>: the comment editor (owner, 2026-09-11: "not block based; markdown / visual editor based;
// full width of the container; the block controls subtle, in a header"). ONE contenteditable surface that shows
// the comment as prose, a quiet header of controls above it, and markdown in and out through `.value`. The
// surface is filled by the client renderer's comment branch (a bare video line is the same full-width poster the
// published comment shows) and read back by domToMarkdown (prose-editor-core.mjs), so what the author edits is
// what the reader gets. Replaces the block editor's compact mode in gbti-comment-box (both hosts, one element).
import { GbtiElement, define, esc } from '../base.mjs';
import { embedUrl } from '../../../client/src/video-embed.mjs';
import { createSelectionToolbar } from '../selection-toolbar.mjs'; // only its link panel is used here
import { EMBED_POSTER_CSS } from '../embed-lightbox.mjs';
import { domToMarkdown, editorHtmlFromMarkdown, PROSE_CONTROLS } from '../prose-editor-core.mjs';

const ic = {
  code: '<path d="M9 8l-4 4 4 4M15 8l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  quote: '<path d="M9 7c-2.2 0-4 1.8-4 4 0 2.2 1.8 3.7 4 3.7.2 1.8-.9 2.6-2.4 3.3M19 7c-2.2 0-4 1.8-4 4 0 2.2 1.8 3.7 4 3.7.2 1.8-.9 2.6-2.4 3.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  ul: '<circle cx="5" cy="7" r="1.4" fill="currentColor"/><circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="5" cy="17" r="1.4" fill="currentColor"/><path d="M9.5 7h10M9.5 12h10M9.5 17h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  ol: '<path d="M9.5 7h10M9.5 12h10M9.5 17h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M4 6l1-.5V9M3.6 15.5c.3-.8 1.8-.8 1.8.3 0 .8-1.6 1.2-1.8 2.2H5.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  codeblock: '<rect x="3.5" y="5" width="17" height="14" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 9.5l-2.5 2.5 2.5 2.5M14 9.5l2.5 2.5-2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  video: '<rect x="3.5" y="6" width="11" height="12" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M14.5 10l6-2.8v9.6l-6-2.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  x: '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ic[k] || ''}</svg>`;

const CSS = `
  :host { display: block; width: 100%; font-family: var(--font-body); color: var(--fg); }
  .box { position: relative; border: 1.5px solid var(--line); border-radius: 10px; background: var(--panel); }
  .box:focus-within { border-color: var(--brand); }
  /* The header: small, muted, brand on hover. Quiet by design (owner, 2026-09-11). */
  .hdr { display: flex; flex-wrap: wrap; align-items: center; gap: 1px; padding: 4px 6px; border-bottom: 1px solid var(--line); }
  .hdr button { width: 28px; height: 26px; display: inline-flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 6px;
    background: transparent; color: var(--muted); cursor: pointer; font: 700 13px/1 var(--font-body); }
  .hdr button:hover, .hdr button:focus-visible { color: var(--brand); background: rgba(31,158,95,.1); outline: 0; }
  .hdr button svg { width: 16px; height: 16px; }
  .hdr .k-italic { font-style: italic; font-family: Georgia, 'Times New Roman', serif; font-weight: 600; }
  .hdr .sep { width: 1px; height: 16px; background: var(--line); margin: 0 4px; }
  .vid { display: flex; gap: 6px; align-items: center; padding: 6px 8px; border-bottom: 1px solid var(--line); }
  .vid[hidden] { display: none; }
  .vid input { flex: 1; min-width: 0; font: inherit; font-size: 13px; padding: 6px 9px; border: 1px solid var(--line); border-radius: 7px; background: transparent; color: var(--fg); }
  .vid input.bad { border-color: #c0392b; }
  .vid button { font: inherit; font-size: 12.5px; font-weight: 600; padding: 6px 10px; border: 1px solid var(--line); border-radius: 7px; background: transparent; color: var(--muted); cursor: pointer; }
  .vid button.vid-add { border-color: var(--brand); background: var(--brand); color: #fff; }
  .surface { position: relative; min-height: 96px; padding: 10px 12px; font-size: 14.5px; line-height: 1.6; outline: 0; caret-color: var(--brand); word-break: break-word; }
  .surface.empty::before { content: attr(data-ph); position: absolute; left: 12px; top: 10px; color: var(--muted); pointer-events: none; }
  .surface p, .surface div { margin: 0 0 .7em; }
  .surface > :last-child { margin-bottom: 0; }
  .surface blockquote { margin: 0 0 .7em; padding: 2px 0 2px 12px; border-left: 3px solid var(--line); color: var(--muted); }
  .surface blockquote + blockquote { margin-top: -.7em; }
  .surface ul, .surface ol { margin: 0 0 .7em 1.3em; padding: 0; }
  .surface pre { margin: 0 0 .7em; padding: 10px 12px; border-radius: 8px; background: var(--ink-2, #25232b); color: #e6e4ee; font: 13px/1.5 var(--f-mono, ui-monospace, monospace); white-space: pre-wrap; }
  .surface code { font-family: var(--f-mono, ui-monospace, monospace); font-size: .92em; background: var(--tint, rgba(127,127,127,.15)); padding: .1em .35em; border-radius: 4px; }
  .surface pre code { background: none; padding: 0; font-size: inherit; }
  .surface a { color: var(--brand); }
  .surface strong { font-weight: 700; }
  ${EMBED_POSTER_CSS}
  .surface .md-embed { margin: .4em 0 .9em; }
  .surface .md-embed .md-embed-open { cursor: default; }
  .pe-x { position: absolute; top: 8px; right: 8px; z-index: 2; width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center;
    padding: 0; border: 0; border-radius: 999px; background: rgba(0,0,0,.62); color: #fff; cursor: pointer; }
  .pe-x svg { width: 15px; height: 15px; }
  .pe-x:hover { background: #c0392b; }
`;

class GbtiProseEditor extends GbtiElement {
  /** Markdown in, markdown out. The surface is read back on every get, so the value is always current. */
  get value() { const s = this._surface(); return s ? domToMarkdown(s) : String(this._pending ?? ''); }
  set value(md) { this._pending = String(md ?? ''); if (this._surface()) this._load(this._pending); }
  get placeholder() { return this.getAttribute('placeholder') || 'Write a comment'; }
  _surface() { return this.$('[data-surface]'); }

  render() {
    // The base re-renders on every client change; the author's text must survive that, so the shell is built once.
    if (this._rendered) return;
    this._rendered = true;
    const controls = PROSE_CONTROLS.map((c) => (c
      ? `<button type="button" data-act="${c.act}" title="${esc(c.label)}" aria-label="${esc(c.label)}">${c.key ? `<span class="k k-${c.act}">${c.key}</span>` : svg(c.act)}</button>`
      : '<span class="sep" aria-hidden="true"></span>')).join('');
    this.set(this.css(CSS) + `<div class="box" data-box>
      <div class="hdr" role="toolbar" aria-label="Formatting">${controls}</div>
      <div class="vid" data-vid hidden>
        <input type="url" data-vid-url placeholder="Paste a YouTube or Vimeo link" aria-label="Video link" />
        <button type="button" class="vid-add" data-vid-add>Add</button>
        <button type="button" data-vid-cancel>Cancel</button>
      </div>
      <div class="surface" contenteditable="true" data-surface data-ph="${esc(this.placeholder)}" role="textbox" aria-multiline="true"></div>
    </div>`);
    this._wire();
    this._load(this._pending ?? '');
  }

  _load(md) {
    const s = this._surface();
    if (!s) return;
    s.innerHTML = editorHtmlFromMarkdown(md);
    this._decorateCards();
    this._syncEmpty();
  }

  /** A video card is one atomic, non-editable thing with its own Remove; Backspace over it removes it whole. */
  _decorateCards() {
    for (const card of this.$$('[data-surface] .md-embed')) {
      if (card.dataset.peCard) continue;
      card.dataset.peCard = '1';
      card.setAttribute('contenteditable', 'false');
      const x = document.createElement('button');
      x.type = 'button'; x.className = 'pe-x'; x.title = 'Remove video'; x.setAttribute('aria-label', 'Remove video');
      x.innerHTML = svg('x');
      x.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); card.remove(); this._changed(); });
      card.appendChild(x);
    }
  }
  _syncEmpty() { const s = this._surface(); if (s) s.classList.toggle('empty', !String(this.value || '').trim()); }
  _changed() { this._syncEmpty(); this.emit('input'); }
  _sel() { try { return (this.root.getSelection ? this.root.getSelection() : null) || document.getSelection(); } catch { return document.getSelection(); } }
  /** The nearest ancestor of `node` with this tag, stopping at the surface. */
  _closest(node, tag) {
    const s = this._surface();
    let n = node && node.nodeType === 1 ? node : node?.parentNode;
    while (n && n !== s) { if (String(n.tagName || '').toUpperCase() === tag) return n; n = n.parentNode; }
    return null;
  }
  /** The top-level block of the surface that holds `node`. */
  _blockAt(node) {
    const s = this._surface();
    let n = node;
    while (n && n.parentNode && n.parentNode !== s) n = n.parentNode;
    return n && n.parentNode === s ? n : null;
  }

  _wire() {
    const surface = this._surface();
    if (!surface) return;
    // The shared toolbar module supplies the link panel (URL, text, nofollow, new tab, remove). editableOf returns
    // null so its floating bar never shows over this surface: the header is the one set of controls here.
    this._tb = createSelectionToolbar({ root: this.root, host: () => this.$('[data-box]'), editableOf: () => null, onCommit: () => this._changed() });
    this.$$('[data-act]').forEach((b) => {
      b.addEventListener('mousedown', (e) => e.preventDefault()); // the selection must survive the click
      b.addEventListener('click', () => this._act(b.dataset.act));
    });
    surface.addEventListener('input', () => this._changed());
    // Plain text only: pasted markup never enters the surface (what a paste MEANS is markdown, typed as text).
    surface.addEventListener('paste', (e) => {
      e.preventDefault();
      const t = (e.clipboardData || window.clipboardData)?.getData('text/plain') || '';
      if (t) document.execCommand('insertText', false, t);
    });
    surface.addEventListener('keydown', (e) => this._key(e));
    this.$('[data-vid-add]')?.addEventListener('click', () => this._addVideo());
    this.$('[data-vid-cancel]')?.addEventListener('click', () => this._toggleVideo(false));
    this.$('[data-vid-url]')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this._addVideo(); }
      if (e.key === 'Escape') { e.preventDefault(); this._toggleVideo(false); }
    });
  }

  _act(act) {
    const surface = this._surface();
    if (!surface) return;
    if (act === 'video') { this._toggleVideo(true); return; }
    surface.focus();
    switch (act) {
      case 'bold': document.execCommand('bold'); break;
      case 'italic': document.execCommand('italic'); break;
      case 'code': this._toggleCode(); break;
      case 'link': this._link(); return; // commits through the panel
      case 'quote': this._formatBlock('BLOCKQUOTE'); break;
      case 'codeblock': this._formatBlock('PRE'); break;
      case 'ul': document.execCommand('insertUnorderedList'); break;
      case 'ol': document.execCommand('insertOrderedList'); break;
      default: return;
    }
    this._changed();
  }
  /** Quote and code block toggle: the same control puts a block back to a paragraph. */
  _formatBlock(tag) {
    const sel = this._sel();
    const inside = sel && this._closest(sel.anchorNode, tag);
    document.execCommand('formatBlock', false, inside ? 'p' : tag.toLowerCase());
  }
  /** Inline code has no execCommand: wrap the selection in <code>, or unwrap the <code> the caret sits in. */
  _toggleCode() {
    const sel = this._sel();
    if (!sel || !sel.rangeCount) return;
    const existing = this._closest(sel.anchorNode, 'CODE');
    if (existing && !this._closest(existing, 'PRE')) { existing.replaceWith(document.createTextNode(existing.textContent)); return; }
    if (sel.isCollapsed) return;
    const r = sel.getRangeAt(0);
    const node = document.createElement('code');
    try { node.appendChild(r.extractContents()); r.insertNode(node); } catch { /* the selection spans blocks */ }
  }
  /** Link: the panel over the anchor the selection is in, or a new anchor around the selection. */
  _link() {
    const sel = this._sel();
    if (!sel || !sel.rangeCount) return;
    let a = this._closest(sel.anchorNode, 'A');
    if (!a) {
      if (sel.isCollapsed) return; // nothing to link: select the words first
      const r = sel.getRangeAt(0);
      a = document.createElement('a');
      a.setAttribute('href', '');
      try { a.appendChild(r.extractContents()); r.insertNode(a); } catch { return; }
    }
    this._tb?.editLink(this._surface(), a);
  }
  _key(e) {
    if (e.key !== 'Enter' || e.shiftKey) return;
    const sel = this._sel();
    const pre = sel && this._closest(sel.anchorNode, 'PRE');
    if (pre) {
      // Enter in a code block is a newline; Enter on an empty last line leaves the block for a new paragraph.
      e.preventDefault();
      const last = pre.lastChild;
      const prev = last?.previousSibling;
      const isBr = (n) => n && n.nodeType === 1 && String(n.tagName).toUpperCase() === 'BR';
      if (isBr(last) && isBr(prev) && sel.isCollapsed && this._closest(sel.anchorNode, 'PRE') === pre && !sel.anchorNode.nextSibling) {
        last.remove(); prev.remove();
        const p = document.createElement('p'); p.innerHTML = '<br>';
        pre.after(p);
        this._caretIn(p);
      } else document.execCommand('insertLineBreak');
      this._changed();
      return;
    }
    const quote = sel && this._closest(sel.anchorNode, 'BLOCKQUOTE');
    if (quote && sel.isCollapsed) {
      // Enter on an empty quote line leaves the quote (outdent is how a browser lifts a line out of a blockquote).
      const line = this._closest(sel.anchorNode, 'DIV') || this._closest(sel.anchorNode, 'P') || quote;
      if (!String(line.textContent || '').trim()) { e.preventDefault(); document.execCommand('outdent'); this._changed(); }
    }
  }
  _caretIn(el) {
    try {
      const r = document.createRange(); r.selectNodeContents(el); r.collapse(true);
      const sel = this._sel(); sel.removeAllRanges(); sel.addRange(r);
    } catch { /* focus alone is enough */ }
  }

  _toggleVideo(show) {
    const row = this.$('[data-vid]');
    const input = this.$('[data-vid-url]');
    if (!row || !input) return;
    if (show) {
      const sel = this._sel();
      this._vidAnchor = sel && sel.anchorNode ? this._blockAt(sel.anchorNode) : null; // the input will take the selection
      row.hidden = false; input.value = ''; input.classList.remove('bad');
      setTimeout(() => input.focus(), 0);
    } else { row.hidden = true; this._surface()?.focus(); }
  }
  /** The link becomes its own line in the markdown and renders as the poster at once. */
  _addVideo() {
    const input = this.$('[data-vid-url]');
    const surface = this._surface();
    if (!input || !surface) return;
    const url = String(input.value || '').trim();
    if (!url || !embedUrl(url)) { input.classList.add('bad'); input.focus(); return; }
    const p = document.createElement('p');
    p.textContent = url;
    const anchor = this._vidAnchor && this._vidAnchor.parentNode === surface ? this._vidAnchor : null;
    if (anchor) anchor.after(p); else surface.appendChild(p);
    this._load(this.value); // the renderer turns the line into the poster card
    this._toggleVideo(false);
    // The caret goes into a paragraph right after the new card, so the author can keep writing.
    const cards = this.$$('[data-surface] .md-embed').filter((c) => c.getAttribute('data-embed-url') === url);
    const card = cards[cards.length - 1];
    if (card) {
      let next = card.nextElementSibling;
      if (!next || String(next.tagName).toUpperCase() !== 'P') { next = document.createElement('p'); next.innerHTML = '<br>'; card.after(next); }
      surface.focus();
      this._caretIn(next);
    }
    this._changed();
  }
}

define('gbti-prose-editor', GbtiProseEditor);
