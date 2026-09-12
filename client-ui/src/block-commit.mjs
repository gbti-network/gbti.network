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
import { parseBlocks, serializeBlocks, inlineHtmlToMd } from './markdown-blocks.mjs';
import { normalizeImageLayout, cleanCaption } from '../../client/src/image-attrs.mjs';
import { normalizeListItems, isFlatList, indentListItem, serializeListItems } from '../../client/src/list-items.mjs';

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

  if (tag === 'UL' || tag === 'OL') return { kind: 'list', items: readListDom(el, md) };
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
      // Strings stay strings (a flat list); objects carry depth and marker (a nested one). The block's marker is
      // the top level's marker.
      const items = normalizeListItems(read.items, !!b.ordered);
      b.ordered = items.length ? !!items[0].ordered : !!b.ordered;
      b.items = isFlatList(items) ? items.map((it) => it.text) : items;
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
 * sow-235: insert an image block AFTER a single anchor block, from an image already attached to the item. Returns
 * the anchor block's replacement LINES (the block verbatim, a blank separator, then the image line) so the caller
 * splices it over the block's range with the SAME machinery applyBlockEdit uses. This is an insert, not an edit
 * of an existing block, so it is a distinct planner rather than a mode of applyBlockEdit. Pure: no DOM. Refused on
 * an empty ref or a range that does not parse to exactly one block.
 */
export function planImageInsert(sourceText, imageRef, alt) {
  const url = String(imageRef ?? '').trim();
  if (!url) return null;
  // A blank anchor (the paragraph the author emptied before pasting) is REPLACED by the image rather than kept
  // above it as an empty line: applyBlockEdit hands an emptied paragraph over as '', and an image pasted into an
  // empty block should land where the block was.
  if (!String(sourceText ?? '').trim()) return [serializeBlocks([{ type: 'image', alt: String(alt ?? ''), url }])];
  const blocks = parseBlocks(String(sourceText ?? ''));
  if (blocks.length !== 1) return null;
  const kept = String(sourceText ?? '').replace(/\r\n/g, '\n').split('\n');
  while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();   // own the separator we are about to add
  const imageLine = serializeBlocks([{ type: 'image', alt: String(alt ?? ''), url }]);
  return [...kept, '', imageLine];
}

/**
 * The rendered form of an image block: a paragraph holding exactly one image and no text (client/src/markdown.mjs
 * wraps a lone image line in <p>). It has no text to edit, so the Preview offers the image bar over it instead of
 * a caret. DOM-only by nature, and deliberately thin.
 */
export function isImageBlockEl(el) {
  const t = String(el?.tagName || '').toUpperCase();
  const kids = el?.children ? Array.from(el.children) : [];
  const tag = (n) => String(n?.tagName || '').toUpperCase();
  // A captioned image renders as a figure (the image, then its caption strip); it is the same one image block.
  if (t === 'FIGURE') return kids.length >= 1 && tag(kids[0]) === 'IMG' && kids.slice(1).every((k) => tag(k) === 'FIGCAPTION');
  if (t !== 'P') return false;
  return kids.length === 1 && tag(kids[0]) === 'IMG' && String(el.textContent || '').trim() === '';
}

/** The single image block a source range holds, or null when the range is not exactly one image block. */
export function imageBlockOf(sourceText) {
  const blocks = parseBlocks(String(sourceText ?? ''));
  return blocks.length === 1 && blocks[0].type === 'image' ? blocks[0] : null;
}

/**
 * Rewrite ONE image block's layout words ({full}, {left wrap}: client/src/image-attrs.mjs) and nothing else: alt and
 * url are carried through from the source. Returns the replacement LINES for spliceBlock, or null when the range
 * is not exactly one image block, so a click on the image bar can never write over a paragraph.
 */
export function planImageLayout(sourceText, layout) {
  const b = imageBlockOf(sourceText);
  if (!b) return null;
  return [serializeBlocks([{ type: 'image', alt: b.alt ?? '', url: b.url ?? '', ...(b.caption ? { caption: b.caption } : {}), ...normalizeImageLayout(layout) }])];
}

/**
 * Set, change or remove ONE image block's caption (the image title: `![alt](url "caption")`), keeping alt, url and
 * the layout words. '' removes it. Null unless the range is exactly one image block.
 */
export function planImageCaption(sourceText, caption) {
  const b = imageBlockOf(sourceText);
  if (!b) return null;
  const c = cleanCaption(caption);
  const { caption: _old, ...rest } = b;
  return [serializeBlocks([{ ...rest, ...(c ? { caption: c } : {}) }])];
}

/**
 * Read a rendered list back as { text, depth, ordered } items in document order: each <li>'s OWN inline content
 * (the nested list that may follow it inside the same <li> is not its text), its depth from the lists between it
 * and the block, its marker from its parent tag. Shared by the Preview and the block editor so the two cannot
 * drift. `md(html)` turns inline HTML into markdown.
 */
export function readListDom(el, md) {
  const out = [];
  const tagOf = (n) => String(n?.tagName || '').toUpperCase();
  const walk = (list, depth) => {
    for (const li of Array.from(list.children || [])) {
      if (tagOf(li) !== 'LI') continue;
      const own = String(li.innerHTML ?? '').replace(/<(ul|ol)\b[\s\S]*$/i, '');
      out.push({ text: md(own), depth, ordered: tagOf(list) === 'OL' });
      for (const sub of Array.from(li.children || [])) if (tagOf(sub) === 'UL' || tagOf(sub) === 'OL') walk(sub, depth + 1);
    }
  };
  walk(el, 0);
  return out;
}

/**
 * Tab / Shift+Tab on ONE list block's item: move it (and its children) one level in or out and return the block's
 * replacement lines, or null when the range is not a single list, the item is out of range, or nothing changes
 * (the first item never indents; a depth is clamped to one below the item before it).
 */
export function planListIndent(sourceText, itemIndex, delta) {
  const blocks = parseBlocks(String(sourceText ?? ''));
  if (blocks.length !== 1 || blocks[0].type !== 'list') return null;
  const b = blocks[0];
  const next = indentListItem(b.items, itemIndex, delta, !!b.ordered);
  if (!next) return null;
  return serializeListItems(next, !!b.ordered);
}

/** The <li> of a rendered list block that holds the selection's anchor, and its index in document order. DOM only. */
export function listItemAtSelection(el, sel) {
  let n = sel?.anchorNode || null;
  if (n && n.nodeType !== 1) n = n.parentNode;
  while (n && n !== el && String(n.tagName || '').toUpperCase() !== 'LI') n = n.parentNode;
  if (!n || n === el) return { li: null, index: -1 };
  const all = Array.from(el.querySelectorAll('li'));
  return { li: n, index: all.indexOf(n) };
}

/** Put the caret at the end of an <li>'s own text, before any nested list it holds. DOM only. */
export function caretAtEndOfItem(li, sel) {
  if (!li || !sel) return;
  let last = null;
  for (const c of Array.from(li.childNodes || [])) {
    const t = String(c.tagName || '').toUpperCase();
    if (c.nodeType === 1 && (t === 'UL' || t === 'OL')) break;
    last = c;
  }
  try {
    const r = document.createRange();
    if (last) { r.selectNodeContents(last); r.collapse(false); } else { r.setStart(li, 0); r.collapse(true); }
    sel.removeAllRanges(); sel.addRange(r);
  } catch { /* focus alone is enough */ }
}
