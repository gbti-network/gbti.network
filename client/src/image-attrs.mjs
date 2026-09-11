// Image layout words: how an author says "full width" or "float left" about ONE image, in markdown that stays
// markdown. An image line may carry a brace suffix of layout words after its closing paren:
//
//   ![alt](./images/x.png){full}        the image spans the column
//   ![alt](./images/x.png){left wrap}   floats left at up to half the column; the next paragraphs flow beside it
//   ![alt](./images/x.png){right}       sits on its own line, against the right edge
//   ![alt](./images/x.png){center}      the explicit form of the default placement
//
// The vocabulary is closed. A brace group carrying any other word is NOT layout, and the line reads exactly as
// it did before this existed (the block editor sees a paragraph, the renderers print the braces). Node-free and
// dependency-free on purpose: the site's remark pass (src/lib/remark-content-blocks.mjs), the client renderer
// (client/src/markdown.mjs) and the block editor's parser (client-ui/src/markdown-blocks.mjs) all read the SAME
// words through this one module, so a layout an author sets in the Preview renders the same on the published
// page, in the extension reader and in the WorkBench editor.
//
// Why a suffix and not raw <img width="100%"> HTML: a raw image tag in markdown skips Astro's image optimisation
// and cannot resolve a repo-relative ./images/ path, and the block editor cannot edit it. The words become
// classes (img-full, img-left, img-center, img-right, img-wrap) that the site sanitizer allow-lists exactly, so
// no author-controlled attribute ever reaches the page.

export const IMAGE_LAYOUT_WORDS = Object.freeze(['full', 'left', 'center', 'right', 'wrap']);
const ALIGNS = new Set(['left', 'center', 'right']);

/** The class an allow-list may admit on an image, and nothing else. Shared with the sanitizer's schema. */
export const IMAGE_LAYOUT_CLASS_RE = /^img-(full|left|center|right|wrap)$/;

/**
 * A whole image line: `![alt](url)` with an OPTIONAL `{words}` suffix and trailing whitespace. Group 3 is the
 * inside of the braces when present (possibly empty), undefined when the line has no suffix.
 */
export const IMAGE_LINE_RE = /^!\[([^\]]*)\]\(([^)\s]*)(?:\s+"([^"]*)")?\)(?:\{([^}]*)\})?\s*$/;

/** A caption (the image title: `![alt](url "caption")`) holds no double quote and no line break, so the line stays
 *  one regex group; whitespace collapses. '' when nothing is left. */
export function cleanCaption(s) {
  return String(s ?? '').replace(/"/g, '').replace(/\s+/g, ' ').trim();
}

/** The ` "caption"` part of an image line, or '' when there is no caption. */
export function imageTitleSuffix(caption) {
  const c = cleanCaption(caption);
  return c ? ` "${c}"` : '';
}

/**
 * Parse the inside of a brace suffix into a layout. Returns `{}` for no suffix (null/undefined), a layout with
 * only the keys that are set (`width: 'full'`, `align: 'left'|'center'|'right'`, `wrap: true`), or NULL when
 * the words are not layout: an unknown word, empty braces, or two different alignments. Null means "leave the
 * line alone", which is what keeps a member's `{note}` or a code sample from being eaten.
 */
export function parseImageLayout(suffix) {
  if (suffix == null) return {};
  const words = String(suffix).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const out = {};
  for (const w of words) {
    if (!IMAGE_LAYOUT_WORDS.includes(w)) return null;
    if (w === 'full') out.width = 'full';
    else if (w === 'wrap') out.wrap = true;
    else if (ALIGNS.has(w)) {
      if (out.align && out.align !== w) return null;
      out.align = w;
    }
  }
  return out;
}

/** Only the layout keys, only when set. A block or a stale object can carry more; this is what gets serialized. */
export function normalizeImageLayout(layout) {
  const out = {};
  if (layout?.width === 'full') out.width = 'full';
  if (ALIGNS.has(layout?.align)) out.align = layout.align;
  if (layout?.wrap === true) out.wrap = true;
  return out;
}

/** The `{words}` suffix for a layout, in canonical order (width, align, wrap), or '' when there is nothing to say. */
export function imageLayoutSuffix(layout) {
  const n = normalizeImageLayout(layout);
  const words = [];
  if (n.width) words.push(n.width);
  if (n.align) words.push(n.align);
  if (n.wrap) words.push('wrap');
  return words.length ? `{${words.join(' ')}}` : '';
}

/**
 * The classes a renderer puts on the image. `img-wrap` is emitted only beside a left or right alignment, because
 * wrapping means "float to that side": with no side there is nothing to float to, and the CSS has no rule for it.
 */
export function imageLayoutClasses(layout) {
  const n = normalizeImageLayout(layout);
  const out = [];
  if (n.width) out.push('img-full');
  if (n.align) out.push(`img-${n.align}`);
  if (n.wrap && (n.align === 'left' || n.align === 'right')) out.push('img-wrap');
  return out;
}

/**
 * Split a text that BEGINS with a brace suffix (the text node remark leaves right after an image node) into the
 * parsed layout and the rest of the text. Null when the text does not start with `{...}` or the words inside are
 * not layout, in which case the caller leaves the text exactly as it is.
 */
export function splitImageSuffix(text) {
  const m = /^\{([^}]*)\}/.exec(String(text ?? ''));
  if (!m) return null;
  const layout = parseImageLayout(m[1]);
  if (!layout) return null;
  return { layout, rest: String(text).slice(m[0].length) };
}

/**
 * Parse a whole image LINE. `{ alt, url, caption, layout }` for `![alt](url)`, `![alt](url "caption")`, with no
 * suffix or a valid one; null for anything else, including an image line whose braces are not layout (the block
 * parser then reads a paragraph, exactly as it did before). caption is '' when the line has no title.
 */
export function parseImageLine(line) {
  const m = IMAGE_LINE_RE.exec(String(line ?? ''));
  if (!m) return null;
  const layout = parseImageLayout(m[4]);
  if (!layout) return null;
  return { alt: m[1], url: m[2], caption: cleanCaption(m[3]), layout };
}

/**
 * One control click applied to a layout. Pure, shared by the Preview's image bar and the editor's image card so
 * the two surfaces cannot disagree about what a click means:
 *   natural  clears the width          full     sets it (the alignment is kept for when Natural comes back)
 *   left / right  set the side, keeping any wrap   center  sets the side and clears wrap (nothing to float to)
 *   wrap     toggles wrapping, and only beside a left or right alignment (a no-op otherwise)
 * Unknown actions return the layout unchanged. Always a NEW normalized object.
 */
export function applyImageLayoutAction(layout, action) {
  const n = normalizeImageLayout(layout);
  switch (String(action || '')) {
    case 'natural': delete n.width; break;
    case 'full': n.width = 'full'; break;
    case 'left': case 'right': n.align = action; break;
    case 'center': n.align = 'center'; delete n.wrap; break;
    case 'wrap':
      if (n.align === 'left' || n.align === 'right') { if (n.wrap) delete n.wrap; else n.wrap = true; }
      break;
    default: break;
  }
  return n;
}
