// List marker styles (sow-322): how an author says "square bullets" or "lower alpha numbering" about ONE list
// run, in markdown that stays markdown. The item that OPENS a run may carry a brace suffix naming the style:
//
//   - First item {square}          the run's bullets are squares
//   1. First item {lower-alpha}    the run is numbered a. b. c.
//
// The vocabulary is closed and each word belongs to one kind of list: bullets take disc, circle, square; numbers
// take decimal, lower-alpha, upper-alpha, lower-roman, upper-roman. disc and decimal are each kind's default:
// they are recognised and stripped but never written, so a list with the default style is byte-identical to a
// list that never heard of styles. A brace group carrying any other word, a word of the other kind, or a group
// with no text before it, is NOT a style and reads exactly as it did before this existed (the sow-319 rule for
// an image's braces). Node-free and dependency-free on purpose: the site's remark pass
// (src/lib/remark-content-blocks.mjs), the client renderer (client/src/markdown.mjs through list-items.mjs), the
// block editor's parser (client-ui/src/markdown-blocks.mjs) and the plain-text renderers all read the SAME words
// through this one module, so a style chosen on the Preview renders the same on the published page, in the
// extension reader and in the WorkBench editor.
//
// Why a suffix on the first item and not a class on a raw <ul>: raw HTML skips the block editor and the
// sanitizer allow-lists classes exactly, so the words become the classes list-circle, list-square,
// list-lower-alpha, list-upper-alpha, list-lower-roman, list-upper-roman on the <ul> or <ol>, and no
// author-controlled attribute ever reaches the page. The words a click means live in list-items.mjs
// (applyListAction); this module only knows the words.

const BULLET_WORDS = Object.freeze(['disc', 'circle', 'square']);
const NUMBER_WORDS = Object.freeze(['decimal', 'lower-alpha', 'upper-alpha', 'lower-roman', 'upper-roman']);

/** Every style word, bullets first, each kind's default first within its kind. */
export const LIST_STYLE_WORDS = Object.freeze([...BULLET_WORDS, ...NUMBER_WORDS]);

/** The default of each kind: recognised, stripped, never written. */
export const LIST_STYLE_DEFAULTS = Object.freeze({ bullet: 'disc', number: 'decimal' });

/** The class an allow-list may admit on a list, and nothing else. Shared with the sanitizer's schema. The two
 *  defaults have no class: they write nothing and the plain marker rules already render them. */
export const LIST_STYLE_CLASS_RE = /^list-(circle|square|lower-alpha|upper-alpha|lower-roman|upper-roman)$/;

/** 'bullet', 'number', or null for a word outside the vocabulary. */
export function styleKind(word) {
  const w = String(word ?? '');
  if (BULLET_WORDS.includes(w)) return 'bullet';
  if (NUMBER_WORDS.includes(w)) return 'number';
  return null;
}

/** True when the word is the default of its kind (disc for bullets, decimal for numbers). */
export function isDefaultStyle(word) {
  const kind = styleKind(word);
  return !!kind && LIST_STYLE_DEFAULTS[kind] === String(word);
}

/**
 * The style a run of the given kind may carry, or null: an unknown word, a word of the other kind, and the
 * kind's own default all normalize to "no style". This is what keeps a mismatched style from surviving a kind
 * flip and what keeps the default from ever being written.
 */
export function normalizeListStyle(word, ordered) {
  const kind = styleKind(word);
  if (!kind || kind !== (ordered ? 'number' : 'bullet')) return null;
  return isDefaultStyle(word) ? null : String(word);
}

/** The class a renderer puts on the <ul> or <ol> for a style, or null for none (the default has no class). */
export function listStyleClass(style) {
  return style && LIST_STYLE_CLASS_RE.test(`list-${style}`) ? `list-${style}` : null;
}

/** The `{word}` suffix for a style, or '' for the default. The serializer puts a space before it. */
export function listStyleSuffix(style, ordered) {
  const s = normalizeListStyle(style, ordered);
  return s ? `{${s}}` : '';
}

/** The style named by a class list (a string or an array), or null when no list-* class is present. */
export function listStyleFromClass(className) {
  const tokens = Array.isArray(className) ? className : String(className ?? '').split(/\s+/);
  for (const t of tokens) {
    const m = LIST_STYLE_CLASS_RE.exec(String(t));
    if (m) return m[1];
  }
  return null;
}

const SUFFIX_RE = /^([\s\S]*?)\s*\{([a-z-]+)\}\s*$/;

/**
 * Split an item's text into `{ style, rest }` when it ENDS with a style suffix of the given kind: the word must
 * be in the vocabulary and belong to the run's kind (a bullet word on a numbered run is the author's text), and
 * unless `bare` is set there must be text before the braces (an item that is only `{square}` is a paragraph
 * of braces, not an empty item with a style). `style` is null for the kind's default, which is recognised and
 * stripped but carries nothing. Null when the text carries no such suffix, in which case the caller leaves the
 * text exactly as it is. `bare` is for a caller that knows content precedes the text it holds (the site's
 * remark pass sees `- **bold** {square}` as a strong node then a text node holding only the braces).
 */
export function splitListSuffix(text, ordered, { bare = false } = {}) {
  const m = SUFFIX_RE.exec(String(text ?? ''));
  if (!m) return null;
  const kind = styleKind(m[2]);
  if (!kind || kind !== (ordered ? 'number' : 'bullet')) return null;
  const rest = m[1];
  if (!bare && rest.trim() === '') return null;
  return { style: normalizeListStyle(m[2], !!ordered), rest };
}

const LINE_RE = /^(\s*)([-*+]|\d+[.)])(\s+)([\s\S]*)$/;

/**
 * A whole list LINE with any style suffix removed, for the renderers that produce plain text (the syndication
 * text, a directory excerpt), where braces would read as the author's words. The kind comes from the line's
 * own marker. A line that is not a list line, or carries no suffix, comes back unchanged.
 */
export function stripListStyleSuffix(line) {
  const m = LINE_RE.exec(String(line ?? ''));
  if (!m) return String(line ?? '');
  const split = splitListSuffix(m[4], /^\d/.test(m[2]));
  if (!split) return String(line);
  return `${m[1]}${m[2]}${m[3]}${split.rest}`;
}
