// Minimal, dependency-free Markdown renderer for the CMS LOCAL PREVIEW (SOW-006). This is an approximate
// preview for authoring convenience; the authoritative render is the Astro site build. It escapes HTML
// first (the preview is shown in the local CMS, but we still never inject raw input), then handles the
// common blocks (headings, lists, blockquotes, fenced code, hr, paragraphs) and inline (code, links, bold,
// italic). Pure + unit-testable.
// SOW-062 Phase 5d: also renders the ```callout / ```embed body blocks (the shared embedUrl gives a safe iframe src).
import { embedUrl } from './video-embed.mjs';

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Inline formatting. Input is ALREADY HTML-escaped, so only markdown punctuation remains to transform.
function inline(escaped) {
  let t = escaped;
  t = t.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, txt, url) => `<a href="${url}" target="_blank" rel="noopener">${txt}</a>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return t;
}

// A fenced-code language tag -> a safe `language-x` class + data-lang attribute (consumed by the reader's code
// card for the language label + per-language styling). Only the first token after the fence is used, lowercased
// and reduced to a safe charset; an unknown/empty tag yields no class.
function codeOpen(lang) {
  const tag = String(lang || '').trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9+#.-]/g, '');
  return tag ? `<pre><code class="language-${tag}" data-lang="${tag}">` : '<pre><code>';
}

// SOW-062 Phase 5d: a fence whose info string starts with `callout` or `embed` renders as a callout box / a safe
// provider iframe instead of a code block; everything else stays a normal code block. HTML is still escaped, and the
// iframe src is a NORMALIZED provider URL (never author HTML), so no author script executes.
const CALLOUT_VARIANTS = ['info', 'note', 'warning', 'tip'];
function renderFence(lang, buf) {
  const info = String(lang || '').trim().split(/\s+/);
  const body = buf.join('\n');
  if (info[0] === 'callout') {
    const v = CALLOUT_VARIANTS.includes(info[1]) ? info[1] : 'note';
    const html = body.split('\n').map((l) => inline(escapeHtml(l))).join('<br/>');
    return `<div class="md-callout md-callout-${v}"><div class="md-callout-body">${html}</div></div>`;
  }
  if (info[0] === 'embed') {
    const url = body.trim();
    const src = embedUrl(url);
    if (src) return `<div class="md-embed"><iframe src="${escapeHtml(src)}" loading="lazy" allowfullscreen sandbox="allow-scripts allow-same-origin allow-presentation" title="Embedded video"></iframe></div>`;
    return `<p><a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a></p>`;
  }
  return `${codeOpen(lang)}${escapeHtml(body)}</code></pre>`;
}

export function renderMarkdown(md) {
  const lines = String(md ?? '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let inCode = false;
  let codeBuf = [];
  let codeLang = '';
  let listType = null;
  let listBuf = [];
  const flushList = () => {
    if (listType) {
      out.push(`<${listType}>${listBuf.join('')}</${listType}>`);
      listType = null;
      listBuf = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      if (!inCode) { inCode = true; codeBuf = []; codeLang = line.slice(3); }
      else { inCode = false; flushList(); out.push(renderFence(codeLang, codeBuf)); codeLang = ''; }
      i++; continue;
    }
    if (inCode) { codeBuf.push(line); i++; continue; }

    const esc = escapeHtml(line);
    let m;
    if ((m = /^(#{1,6})\s+(.*)$/.exec(esc))) { flushList(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); i++; continue; }
    if (/^\s*[-*]\s+/.test(line)) { if (listType !== 'ul') { flushList(); listType = 'ul'; } listBuf.push(`<li>${inline(escapeHtml(line.replace(/^\s*[-*]\s+/, '')))}</li>`); i++; continue; }
    if (/^\s*\d+\.\s+/.test(line)) { if (listType !== 'ol') { flushList(); listType = 'ol'; } listBuf.push(`<li>${inline(escapeHtml(line.replace(/^\s*\d+\.\s+/, '')))}</li>`); i++; continue; }
    if (/^\s*>\s?/.test(line)) { flushList(); out.push(`<blockquote>${inline(escapeHtml(line.replace(/^\s*>\s?/, '')))}</blockquote>`); i++; continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) { flushList(); out.push('<hr/>'); i++; continue; }
    if (/^\s*$/.test(line)) { flushList(); i++; continue; }

    // paragraph: gather consecutive plain lines
    flushList();
    const para = [esc];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6})\s|^\s*[-*]\s|^\s*\d+\.\s|^```|^\s*>/.test(lines[i])) {
      para.push(escapeHtml(lines[i]));
      i++;
    }
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  flushList();
  if (inCode) out.push(renderFence(codeLang, codeBuf));
  return out.join('\n');
}
