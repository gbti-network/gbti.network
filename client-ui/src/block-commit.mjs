// sow-235: committing an edited block from the WorkBench Preview back into the Markdown source.
//
// The Preview renders the body with renderMarkdownWithBlocks (client/src/markdown.mjs), which stamps every emitted
// block with a data-blk index and records that block's SOURCE line range. Editing happens in the rendered DOM, so
// the commit has to turn a block of HTML back into the right number of Markdown lines.
//
// The naive version replaced a block's whole range with ONE line, which is why only single-line paragraphs and
// headings were ever editable: a two-item list would have collapsed to a single bullet and a fenced code block
// would have lost its fences. It also could not have worked, because the rendered HTML does not carry everything
// the Markdown does. A table's column alignment survives only as a style attribute, a fence's language only as a
// class, and a list's ordered-ness only as the tag name.
//
// So the block is rebuilt from its OWN SOURCE rather than from the DOM: re-parse the original range with
// parseBlocks, replace only the text-bearing fields with what the author edited, and re-serialize. Everything the
// DOM cannot express is carried through untouched because it never left the source. parseBlocks/serializeBlocks
// are the doc editor's existing model, reused rather than reimplemented.
import { parseBlocks, serializeBlocks, inlineHtmlToMd, MEMBERS_MARKER } from './markdown-blocks.mjs';

/** Rendered tags the Preview can edit. hr has nothing to edit; a callout/embed renders as a div and is not text. */
export const EDITABLE_BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'UL', 'OL', 'TABLE', 'PRE']);

/** A read of kind K may only be written onto a source block of this type. A mismatch means the two parsers
 *  disagree about this range (an embed fence falls back to a <p>, for one), and the commit refuses rather than
 *  writing a paragraph over something that is not one. */
const COMPATIBLE = { paragraph: 'paragraph', heading: 'heading', quote: 'quote', list: 'list', table: 'table', code: 'code' };

/**
 * Which source lines a block DELETE should remove. Pure, so the decision is tested here rather than in a browser.
 *
 * A block carries one blank-line separator with it, or two paragraphs fuse into one when it goes. The separator
 * is normally the blank AFTER the block; for the last block in a document there is none, so the blank BEFORE it
 * is taken instead. Returns null when the delete is refused, which includes any request that would empty the
 * document: a document with no blocks has nowhere to put the caret, and recovering from that needs a rebuild.
 */
export function planBlockDelete(sourceText, range) {
  if (!range || typeof range.start !== 'number' || typeof range.end !== 'number') return null;
  const lines = String(sourceText ?? '').replace(/\r\n/g, '\n').split('\n');
  if (range.start < 0 || range.end < range.start || range.end >= lines.length) return null;
  let start = range.start;
  let end = range.end;
  if (end + 1 < lines.length && lines[end + 1].trim() === '') end++;
  else if (start > 0 && lines[start - 1].trim() === '') start--;
  const out = lines.slice(0, start).concat(lines.slice(end + 1));
  if (!out.join('\n').trim()) return null; // never delete the last remaining content
  return out;
}

export function isEditableBlockTag(tag) {
  return EDITABLE_BLOCK_TAGS.has(String(tag || '').toUpperCase());
}

/**
 * Read the edited block out of the DOM as a plain object. Browser-only and deliberately thin: everything that can
 * be decided without a DOM lives in applyBlockEdit, which is where the tests are.
 */
export function readBlockDom(el) {
  if (!el) return null;
  const tag = String(el.tagName || '').toUpperCase();
  // rendererAnchors: this HTML came from the site renderer, so an anchor wearing its target=_blank rel=noopener
  // reads back as the [text](url) it was authored as instead of raw <a> HTML.
  const md = (html) => inlineHtmlToMd(html, { rendererAnchors: true }).trim();
  const kids = (node, sel) => Array.from(node.querySelectorAll(sel));

  if (tag === 'UL' || tag === 'OL') return { kind: 'list', items: kids(el, 'li').map((li) => md(li.innerHTML)) };
  if (tag === 'PRE') {
    // Code stays literal: no inline transform, and the trailing newline the renderer adds is not content.
    const code = el.querySelector('code') || el;
    return { kind: 'code', code: String(code.textContent ?? '').replace(/\n$/, '') };
  }
  if (tag === 'TABLE') {
    const rows = kids(el, 'tr').map((tr) => Array.from(tr.children).map((c) => md(c.innerHTML)));
    return { kind: 'table', head: rows[0] || [], rows: rows.slice(1) };
  }
  if (tag === 'BLOCKQUOTE') return { kind: 'quote', text: md(el.innerHTML) };
  if (/^H[1-6]$/.test(tag)) return { kind: 'heading', text: md(el.innerHTML) };
  if (tag === 'P') return { kind: 'paragraph', text: md(el.innerHTML) };
  return null;
}

/**
 * Rebuild one block's Markdown from its original source plus the edit read out of the DOM.
 * Returns the replacement LINES, or null when the edit cannot be applied safely (the caller then commits nothing).
 * Pure: no DOM, no I/O.
 */
export function applyBlockEdit(sourceText, read) {
  if (!read || typeof read !== 'object') return null;
  const blocks = parseBlocks(String(sourceText ?? ''));
  // A range that does not parse to exactly one block means the caller's range is wrong, or the two parsers
  // disagree. Either way, guessing here would corrupt neighbouring content.
  if (blocks.length !== 1) return null;
  const b = { ...blocks[0] };
  if (COMPATIBLE[read.kind] !== b.type) return null;

  switch (b.type) {
    case 'list': {
      if (!Array.isArray(read.items)) return null;
      b.items = read.items.slice();
      delete b.text;            // serializeBlock prefers items, but a stale text field is a trap for the next reader
      break;
    }
    case 'table': {
      if (!Array.isArray(read.head)) return null;
      b.head = read.head.slice();
      b.rows = Array.isArray(read.rows) ? read.rows.map((r) => r.slice()) : [];
      break;                    // b.aligns is deliberately NOT touched: it exists only in the source
    }
    case 'code': {
      if (typeof read.code !== 'string') return null;
      b.code = read.code;       // b.lang likewise stays as the source had it
      break;
    }
    default: {
      if (typeof read.text !== 'string') return null;
      b.text = read.text;       // heading keeps its level, quote its marker, from the source
    }
  }
  return serializeBlocks([b]).split('\n');
}

/**
 * sow-235: change a single block's TYPE, deliberately, between paragraph and heading. Returns the replacement
 * LINES, or null when the change is refused. Pure: no DOM.
 *
 * This is the ONE place applyBlockEdit's rule "a heading keeps its level from the source" is deliberately broken,
 * which is the whole point of the control: the level comes from the CALLER, not the source. Only paragraph and
 * heading convert into each other. Anything else (a list, a fence, a table, a quote) is refused, so a stray click
 * on the control cannot flatten it. A multi-line paragraph cannot become a one-line heading, so that is refused too.
 */
export function planBlockRetype(sourceText, toType, level) {
  if (toType !== 'paragraph' && toType !== 'heading') return null;
  const blocks = parseBlocks(String(sourceText ?? ''));
  if (blocks.length !== 1) return null;
  const b = blocks[0];
  if (b.type !== 'paragraph' && b.type !== 'heading') return null;
  const text = String(b.text ?? '');
  if (toType === 'heading') {
    if (text.includes('\n')) return null;                         // a heading is a single line
    const lvl = Math.min(6, Math.max(1, Number(level) || 2));
    return serializeBlocks([{ type: 'heading', level: lvl, text }]).split('\n');
  }
  return serializeBlocks([{ type: 'paragraph', text }]).split('\n');
}

/**
 * sow-235/290: insert an image block next to a single anchor block, from an image already attached or freshly staged.
 * Returns the anchor block's replacement LINES so the caller
 * splices it over the block's range with the SAME machinery applyBlockEdit uses. This is an insert, not an edit
 * of an existing block, so it is a distinct planner rather than a mode of applyBlockEdit. Pure: no DOM. Refused on
 * an empty ref or a range that does not parse to exactly one block.
 */
export function planImageInsert(sourceText, imageRef, alt, { position = 'after' } = {}) {
  const url = String(imageRef ?? '').trim();
  if (!url) return null;
  const blocks = parseBlocks(String(sourceText ?? ''));
  if (blocks.length !== 1) return null;
  const kept = String(sourceText ?? '').replace(/\r\n/g, '\n').split('\n');
  while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();   // own the separator we are about to add
  const imageLine = serializeBlocks([{ type: 'image', alt: String(alt ?? ''), url }]);
  return position === 'before' ? [imageLine, '', ...kept] : [...kept, '', imageLine];
}

/**
 * Insert the canonical member-only split BEFORE one anchor block. The marker gates this block and everything
 * after it, matching the document editor and the publish-time splitMemberMarkdown contract. Pure: no DOM.
 *
 * A range that contains more than one block is refused. An existing marker is also refused here; each document
 * has one split, and the host checks the whole source before calling this anchor-level planner.
 */
export function planMemberSplitInsert(sourceText) {
  const source = String(sourceText ?? '').replace(/\r\n/g, '\n');
  const blocks = parseBlocks(source);
  if (blocks.length !== 1 || blocks[0]?.type === 'members' || source.includes(MEMBERS_MARKER)) return null;
  const kept = source.split('\n');
  while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();
  return [MEMBERS_MARKER, '', ...kept];
}
