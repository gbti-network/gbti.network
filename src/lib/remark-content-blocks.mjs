// SOW-062 Phase 5d: renders the body ```callout <variant> and ```embed blocks on the STATIC site, mirroring the
// in-extension reader (client/src/markdown.mjs). A REMARK pass (not rehype): it runs on the mdast, where a fenced
// block is a `code` node with reliable `lang` + `meta` (the hast conversion drops `meta`), and replaces the callout
// / embed code node with a raw-HTML node BEFORE Shiki highlights it. Same hand-written style as rehypeDemoteBodyH1,
// no new dependency. Only a NORMALIZED provider URL (via the one shared embedUrl) becomes an iframe src -- never
// author-supplied HTML -- and callout bodies are HTML-escaped, so no author script executes.
import { embedUrl, bareVideoLine } from '../../client/src/video-embed.mjs';
import { splitImageSuffix, imageLayoutClasses } from '../../client/src/image-attrs.mjs'; // ![a](b){full} -> class="img-full"

const CALLOUT_VARIANTS = ['info', 'note', 'warning', 'tip'];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Inline formatting on ALREADY-escaped text, identical to the reader's inline() so callouts match across renderers.
const inline = (escaped) => escaped
  .replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`)
  .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`)
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

function renderBlock(node) {
  if (node.lang === 'callout') {
    const meta = String(node.meta || '').trim();
    const v = CALLOUT_VARIANTS.includes(meta) ? meta : 'note';
    const body = String(node.value || '').split('\n').map((l) => inline(esc(l))).join('<br/>');
    return `<div class="callout callout-${v}" role="note"><div class="callout-body">${body}</div></div>`;
  }
  // embed
  const url = String(node.value || '').trim();
  const src = embedUrl(url);
  // sow-158: sandbox matches the in-extension reader (client/src/markdown.mjs) so both renderers cage the frame.
  // 2026-09-12: allow-popups-to-escape-sandbox. The sandbox propagates into any tab the player opens (channel,
  // "Watch on YouTube"), and Chrome refuses to navigate a sandboxed context to a COOP page such as a youtube.com
  // watch page: ERR_BLOCKED_BY_RESPONSE. The flag frees the NEW tab only, never the framed player.
  if (src) return `<div class="embed-wrap"><iframe src="${esc(src)}" loading="lazy" allowfullscreen title="Embedded video" sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"></iframe></div>`;
  return `<p><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a></p>`;
}

// ---- Comments: a bare video URL on its own line frames the player (owner, 2026-09-11) ----
//
// Only COMMENT files get this. A comment is recognised by its source path (Astro hands the vfile the file URL)
// or by its frontmatter (a comment carries targetType + targetSlug; no article does). An article body keeps
// rendering exactly as written: authors there have the ```embed fence and the video: field.
function isCommentSource(file) {
  const p = String(file?.path || (Array.isArray(file?.history) ? file.history[0] : '') || '');
  if (/(^|[\\/])comments[\\/]/.test(p)) return true;
  const fm = file?.data?.astro?.frontmatter;
  return !!(fm && typeof fm === 'object' && fm.targetType && fm.targetSlug);
}

// A paragraph as its source LINES (soft breaks split text nodes; a hard break node splits too), each line the
// inline nodes it carries, so a split keeps every other line's formatting intact.
function paragraphLines(p) {
  const lines = [[]];
  for (const ch of p.children || []) {
    if (ch.type === 'break') { lines.push([]); continue; }
    if (ch.type === 'text' && ch.value.includes('\n')) {
      ch.value.split('\n').forEach((part, k) => { if (k > 0) lines.push([]); if (part !== '') lines[lines.length - 1].push({ type: 'text', value: part }); });
      continue;
    }
    lines[lines.length - 1].push(ch);
  }
  return lines;
}

// The video URL when a line is nothing but one: a plain text line, or (remark-gfm autolink literal) a link
// whose label IS its URL. A titled link ([watch](url)) stays a link.
function bareVideoOfLine(line) {
  const nodes = line.filter((n) => !(n.type === 'text' && !n.value.trim()));
  if (nodes.length !== 1) return null;
  const n = nodes[0];
  if (n.type === 'text') return bareVideoLine(n.value);
  if (n.type === 'link') {
    const label = (n.children || []).map((c) => (typeof c.value === 'string' ? c.value : '')).join('');
    if (label.trim() !== String(n.url || '').trim()) return null;
    return bareVideoLine(n.url);
  }
  return null;
}

/** Replace a paragraph holding bare video lines with [paragraph, embed, paragraph...]; null when it holds none. */
export function splitParagraphEmbeds(p) {
  const lines = paragraphLines(p);
  if (!lines.some((l) => bareVideoOfLine(l))) return null;
  const out = [];
  let buf = [];
  const flush = () => {
    if (!buf.length) return;
    const children = [];
    buf.forEach((l, k) => { if (k > 0) children.push({ type: 'text', value: '\n' }); children.push(...l); });
    if (children.some((c) => c.type !== 'text' || c.value.trim())) out.push({ type: 'paragraph', children });
    buf = [];
  };
  for (const l of lines) {
    const url = bareVideoOfLine(l);
    if (url) { flush(); out.push({ type: 'html', value: renderBlock({ lang: 'embed', value: url }) }); }
    else buf.push(l);
  }
  flush();
  return out;
}

/**
 * Image layout words. `![alt](url){full}` parses as an image node followed by a text node beginning "{full}"; the
 * words become the image's classes (img-full, img-left, img-center, img-right, img-wrap: client/src/image-attrs.mjs)
 * and the braces leave the text. Braces carrying anything else are not layout and stay exactly as written. Astro
 * keeps className through its image optimiser, so the built <img> carries the class; the sanitizer admits these
 * five classes on an image and nothing else. Applies to EVERY source, not only comments: it is how an author's
 * Preview choice (full width, align left, wrap) reaches the published article.
 */
export function applyImageLayouts(paragraph) {
  const kids = paragraph?.children;
  if (!Array.isArray(kids)) return;
  for (let j = 0; j + 1 < kids.length; j++) {
    const im = kids[j];
    const tx = kids[j + 1];
    if (!im || im.type !== 'image' || !tx || tx.type !== 'text') continue;
    const split = splitImageSuffix(tx.value);
    if (!split) continue;
    const cls = imageLayoutClasses(split.layout);
    if (cls.length) {
      im.data = im.data || {};
      im.data.hProperties = { ...(im.data.hProperties || {}), className: cls };
    }
    if (split.rest.trim() === '') kids.splice(j + 1, 1); else tx.value = split.rest;
  }
}

/**
 * A lone image WITH a title (`![alt](url "caption")`) becomes a figure: the image, then a figcaption holding the
 * title, with the layout classes on the FIGURE so a float or full width carries the caption along. Returns the
 * figure node to put in the paragraph's place, or null when the paragraph is not exactly one titled image (an
 * inline titled image keeps its title= tooltip). The image node itself is kept, so Astro's image optimiser still
 * sees it; its title moves to the caption and its classes to the figure.
 */
export function figureForCaptionedImage(paragraph) {
  const kids = paragraph?.children;
  if (!Array.isArray(kids) || kids.length !== 1) return null;
  const im = kids[0];
  if (!im || im.type !== 'image' || !String(im.title || '').trim()) return null;
  const caption = String(im.title).replace(/\s+/g, ' ').trim();
  const cls = im.data?.hProperties?.className || [];
  im.title = null;
  if (im.data?.hProperties) delete im.data.hProperties.className;
  return {
    type: 'figure',
    data: { hName: 'figure', ...(cls.length ? { hProperties: { className: cls } } : {}) },
    children: [im, { type: 'figcaption', data: { hName: 'figcaption' }, children: [{ type: 'text', value: caption }] }],
  };
}

export function remarkContentBlocks() {
  return (tree, file) => {
    const autoEmbed = isCommentSource(file);
    const walk = (node) => {
      if (!node || !Array.isArray(node.children)) return;
      for (let i = 0; i < node.children.length; i++) {
        const n = node.children[i];
        if (n && n.type === 'paragraph') {
          applyImageLayouts(n);
          const fig = figureForCaptionedImage(n);
          if (fig) { node.children[i] = fig; continue; }
        }
        if (n && n.type === 'code' && (n.lang === 'callout' || n.lang === 'embed')) {
          node.children[i] = { type: 'html', value: renderBlock(n) };
        } else if (autoEmbed && n && n.type === 'paragraph') {
          const rep = splitParagraphEmbeds(n);
          if (rep) { node.children.splice(i, 1, ...rep); i += rep.length - 1; }
        } else {
          walk(n);
        }
      }
    };
    walk(tree);
  };
}
