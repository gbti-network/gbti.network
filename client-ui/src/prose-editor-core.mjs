// The comment editor's core (owner, 2026-09-11: "not block based; markdown / visual editor based; full width; the
// block controls subtle, in a header"). <gbti-prose-editor> is ONE contenteditable surface showing the comment as
// prose; what it stores is markdown, produced from the surface by domToMarkdown below. The surface is filled from
// markdown by the client renderer (client/src/markdown.mjs, the comment branch: a bare video line is the same
// full-width poster the published comment shows), so what the author edits is what the reader gets.
//
// Everything here is DOM-free in the sense that matters for tests: domToMarkdown reads only nodeType, tagName,
// childNodes, textContent, innerHTML, outerHTML and getAttribute, so test/prose-editor.test.mjs feeds it a parsed
// HTML tree through a small adapter and never needs a browser.
import { inlineHtmlToMd } from './markdown-blocks.mjs';
import { renderMarkdown } from '../../client/src/markdown.mjs';

/** A comment body may not exceed this many bytes (the hosted validator's cap for a comment file). */
export const COMMENT_MAX_BYTES = 8000;
export function commentBodyTooLong(md) {
  try { return new TextEncoder().encode(String(md ?? '')).length > COMMENT_MAX_BYTES; }
  catch { return String(md ?? '').length > COMMENT_MAX_BYTES; }
}

/** The header's controls, in order. `act` is what the element's click handler switches on. A null entry is a gap. */
export const PROSE_CONTROLS = Object.freeze([
  { act: 'bold', label: 'Bold', key: 'B' },
  { act: 'italic', label: 'Italic', key: 'I' },
  { act: 'code', label: 'Inline code' },
  { act: 'link', label: 'Link' },
  null,
  { act: 'quote', label: 'Quote' },
  { act: 'ul', label: 'Bulleted list' },
  { act: 'ol', label: 'Numbered list' },
  { act: 'codeblock', label: 'Code block' },
  { act: 'video', label: 'Video' },
]);

/** The HTML the surface is filled with for a markdown value; an empty value gets one empty paragraph for the caret. */
export function editorHtmlFromMarkdown(md) {
  const html = renderMarkdown(String(md ?? ''), { autoEmbed: true }).trim();
  return html || '<p><br></p>';
}

const ELEMENT = 1;
const TEXT = 3;
const BLOCK_TAGS = new Set(['P', 'DIV', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'TABLE', 'FIGURE', 'SECTION', 'ARTICLE']);
const tagOf = (n) => String(n?.tagName || '').toUpperCase();
const attr = (n, name) => (typeof n?.getAttribute === 'function' ? n.getAttribute(name) : null) || '';
const kids = (n) => Array.from(n?.childNodes || []);
const escapeText = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** The poster card the renderer emits for a video line; it carries the URL the markdown needs. */
const isCard = (n) => n?.nodeType === ELEMENT && /(^|\s)md-embed(\s|$)/.test(attr(n, 'class')) && !!attr(n, 'data-embed-url');
const isBlock = (n) => n?.nodeType === ELEMENT && (BLOCK_TAGS.has(tagOf(n)) || isCard(n));
const hasBlockChild = (n) => kids(n).some(isBlock);
/** A nested walk (inside a list item or a quote) wants plain strings: a quote object is its text there. */
const flat = (blocks) => blocks.map((b) => (b && typeof b === 'object' && b.quote ? b.text : b)).filter((b) => typeof b === 'string' && b.trim());

/** Inline HTML -> inline markdown, trailing whitespace and hard breaks trimmed. rendererAnchors: the surface was
 *  filled by the client renderer, whose target=_blank rel=noopener anchors ARE `[text](url)`. */
const inline = (html) => inlineHtmlToMd(html, { rendererAnchors: true }).replace(/\s+$/, '').replace(/^\n+/, ''); // a mid-text "  \n" is a hard break and stays

/** A code block's text: <br> is a newline (a browser inserts one per Enter in a pre), other tags go, entities decode. */
function codeText(el) {
  const html = String(el?.innerHTML ?? '');
  const t = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?div[^>]*>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&quot;/gi, '"').replace(/&#0*39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return t.replace(/\n+$/, '');
}

function codeLang(pre) {
  const code = kids(pre).find((c) => c.nodeType === ELEMENT && tagOf(c) === 'CODE') || null;
  const el = code || pre;
  const lang = attr(el, 'data-lang') || (/(?:^|\s)language-([\w+-]+)/.exec(attr(el, 'class')) || [])[1] || '';
  return { el, lang: String(lang).replace(/[^\w+-]/g, '') };
}

/** Walk one node's children into markdown blocks (strings). Consecutive inline nodes fuse into one paragraph. */
function walk(node, out) {
  let buf = '';
  const flush = () => { const t = inline(buf); if (t.trim()) out.push(t); buf = ''; };
  for (const c of kids(node)) {
    if (c.nodeType === TEXT) { buf += escapeText(c.textContent); continue; }
    if (c.nodeType !== ELEMENT) continue;
    if (!isBlock(c)) {
      if (tagOf(c) === 'BR') { buf += '<br>'; continue; }
      buf += String(c.outerHTML ?? ''); continue;
    }
    flush();
    blockOf(c, out);
  }
  flush();
}

function blockOf(n, out) {
  const t = tagOf(n);
  if (isCard(n)) { out.push(attr(n, 'data-embed-url').trim()); return; }
  if (t === 'P' || t === 'DIV' || t === 'SECTION' || t === 'ARTICLE' || t === 'FIGURE') {
    if (hasBlockChild(n)) { walk(n, out); return; }
    const text = inline(n.innerHTML);
    if (text.trim()) out.push(text);
    return;
  }
  if (t === 'BLOCKQUOTE') {
    // The client renderer draws every `> ` line as its own <blockquote>, so consecutive quotes here are ONE quote
    // in the markdown (joined with a newline, not a blank line); an empty quote is the `>` line between two
    // paragraphs of a quote. domToMarkdown fuses the run.
    const inner = [];
    if (hasBlockChild(n)) walk(n, inner); else { const text = inline(n.innerHTML); if (text.trim()) inner.push(text); }
    const lines = flat(inner);
    out.push({ quote: true, text: lines.length ? lines.join('\n').split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n') : '>' });
    return;
  }
  if (t === 'UL' || t === 'OL') {
    const items = [];
    for (const li of kids(n)) {
      if (li.nodeType !== ELEMENT || tagOf(li) !== 'LI') continue;
      let text;
      if (hasBlockChild(li)) {
        const inner = [];
        walk(li, inner);
        // A nested list, or a line break a browser wrapped in a <div>, continues the item indented under it.
        text = flat(inner).join('\n').split('\n').map((l, i) => (i === 0 ? l : (l ? `  ${l}` : ''))).join('\n');
      } else text = inline(li.innerHTML);
      if (text.trim()) items.push(text);
    }
    if (!items.length) return;
    out.push(items.map((it, i) => (t === 'OL' ? `${i + 1}. ${it}` : `- ${it}`)).join('\n'));
    return;
  }
  if (t === 'PRE') {
    const { el, lang } = codeLang(n);
    out.push('```' + lang + '\n' + codeText(el) + '\n```');
    return;
  }
  if (/^H[1-6]$/.test(t)) {
    const text = inline(n.innerHTML);
    if (text.trim()) out.push(`${'#'.repeat(Number(t[1]))} ${text}`);
    return;
  }
  if (t === 'HR') { out.push('---'); return; }
  if (t === 'LI') { const text = inline(n.innerHTML); if (text.trim()) out.push(`- ${text}`); return; }
  if (t === 'TABLE') { const text = inline(n.innerHTML); if (text.trim()) out.push(text); return; }
}

/**
 * The markdown for what the surface holds. Paragraphs (P, DIV, bare text and inline runs at the root) go through
 * the same inline read-back the Preview commits with; quotes, the two lists, code blocks, headings and rules keep
 * their shape; the video poster card is written as its URL alone on a line, which the comment pipeline embeds on
 * the site and in every client renderer. Empty blocks (the <div><br></div> a browser leaves behind) vanish.
 */
export function domToMarkdown(root) {
  const out = [];
  walk(root, out);
  // Fuse a run of quote blocks into one quote, dropping the empty `>` lines at either end of the run.
  const blocks = [];
  let run = null;
  const closeRun = () => {
    if (!run) return;
    while (run.length && run[0] === '>') run.shift();
    while (run.length && run[run.length - 1] === '>') run.pop();
    if (run.length) blocks.push(run.join('\n'));
    run = null;
  };
  for (const b of out) {
    if (b && typeof b === 'object' && b.quote) { (run ||= []).push(b.text); continue; }
    closeRun();
    if (typeof b === 'string' && b.trim()) blocks.push(b);
  }
  closeRun();
  return blocks.join('\n\n');
}
