// SOW-062 Phase 4: a minimal, node-free Markdown <-> block model for the in-house block body editor. The repo
// stays the database (the on-disk body is Markdown), so the editor PARSES the body into typed blocks and
// SERIALIZES them back to Markdown. The SOW-016 `<!-- members-only -->` split marker is a first-class block and
// round-trips EXACTLY (the Worker splits on it at publish). Inline Markdown (bold/links) is left as block text
// (we model block STRUCTURE, not inline), so it round-trips verbatim.

export const MEMBERS_MARKER = '<!-- members-only -->';
export const BLOCK_TYPES = ['paragraph', 'heading', 'code', 'quote', 'list', 'image', 'embed', 'callout', 'members'];

// SOW-062 Phase 5: callout + body embed are stored as FENCED blocks (```callout <variant> / ```embed) so they
// reuse the same fence machinery, round-trip idempotently, and survive the reader's escape-first renderer. Members
// stays the exact marker line (the Worker splits on it). A code block whose FIRST info token is exactly "callout"
// or "embed" becomes that block; any other language stays a code block.
export const CALLOUT_VARIANTS = ['info', 'note', 'warning', 'tip'];
const normalizeVariant = (v) => (CALLOUT_VARIANTS.includes(v) ? v : 'note');

// Exported so the editor's Markdown shortcuts share ONE definition with the parser (no drift).
export const isMarker = (l) => l.trim() === MEMBERS_MARKER;
export const isFence = (l) => /^```/.test(l);
export const isHeading = (l) => /^#{1,6}\s+/.test(l);
export const isQuote = (l) => /^>\s?/.test(l);
export const isListItem = (l) => /^\s*([-*]|\d+\.)\s+/.test(l);
const isImageOnly = (l) => /^!\[[^\]]*\]\([^)]*\)\s*$/.test(l);
const isBareUrl = (l) => /^https?:\/\/\S+$/.test(l.trim());
// SOW-062 5f: a bare-URL line is an EMBED only if it is a recognized video (YouTube/Vimeo). Any other bare URL is
// ordinary paragraph text (a link), never a video-embed block -- otherwise a plain link would render as a locked
// video frame and migrate into a misleading ```embed fence.
const isVideoUrl = (l) => /(?:youtube\.com|youtu\.be|vimeo\.com)/i.test(l);

/** Serialize a block list to Markdown (blocks joined by a blank line). */
export function serializeBlocks(blocks) {
  return (Array.isArray(blocks) ? blocks : []).map(serializeBlock).join('\n\n');
}

function serializeBlock(b) {
  if (!b || typeof b !== 'object') return '';
  switch (b.type) {
    case 'members': return MEMBERS_MARKER;
    case 'heading': return `${'#'.repeat(Math.min(6, Math.max(1, b.level || 2)))} ${b.text ?? ''}`;
    case 'code': return '```' + (b.lang ?? '') + '\n' + (b.code ?? '') + '\n```';
    case 'callout': return '```callout ' + normalizeVariant(b.variant) + '\n' + (b.text ?? '') + '\n```';
    case 'quote': return String(b.text ?? '').split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
    case 'list': {
      const items = Array.isArray(b.items) ? b.items : String(b.text ?? '').split('\n').filter((x) => x !== '');
      return items.map((it, i) => (b.ordered ? `${i + 1}. ` : '- ') + it).join('\n');
    }
    case 'image': return `![${b.alt ?? ''}](${b.url ?? ''})`;
    case 'embed': return '```embed\n' + (b.url ?? '') + '\n```';
    case 'paragraph':
    default: return String(b.text ?? '');
  }
}

/** Parse a Markdown body into typed blocks. Line-based; the members marker is preserved exactly. */
export function parseBlocks(md) {
  const lines = String(md ?? '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  const n = lines.length;
  let i = 0;
  while (i < n) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; } // blank = block separator
    if (isMarker(line)) { blocks.push({ type: 'members' }); i++; continue; }
    if (isFence(line)) {
      const lang = line.replace(/^```/, '').trim();
      const info = lang.split(/\s+/);
      const code = [];
      i++;
      while (i < n && !/^```\s*$/.test(lines[i])) { code.push(lines[i]); i++; }
      i++; // skip the closing fence
      // SOW-062: ```callout <variant> and ```embed are first-class blocks; anything else stays a code block.
      if (info[0] === 'callout') blocks.push({ type: 'callout', variant: normalizeVariant(info[1]), text: code.join('\n') });
      else if (info[0] === 'embed') blocks.push({ type: 'embed', url: code.join('\n').trim() });
      else blocks.push({ type: 'code', lang, code: code.join('\n') });
      continue;
    }
    let m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) { blocks.push({ type: 'heading', level: m[1].length, text: m[2] }); i++; continue; }
    if (isQuote(line)) {
      const q = [];
      while (i < n && isQuote(lines[i])) { q.push(lines[i].replace(/^>\s?/, '')); i++; }
      blocks.push({ type: 'quote', text: q.join('\n') });
      continue;
    }
    if (isListItem(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items = [];
      while (i < n && isListItem(lines[i])) { items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '')); i++; }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    m = line.match(/^!\[([^\]]*)\]\(([^)]*)\)\s*$/);
    if (m) { blocks.push({ type: 'image', alt: m[1], url: m[2] }); i++; continue; }
    if (isBareUrl(line) && isVideoUrl(line)) { blocks.push({ type: 'embed', url: line.trim() }); i++; continue; }
    // paragraph: consecutive lines that start no other block
    const para = [];
    while (i < n) {
      const l = lines[i];
      if (l.trim() === '' || isMarker(l) || isFence(l) || isHeading(l) || isQuote(l) || isListItem(l) || isImageOnly(l) || (isBareUrl(l) && isVideoUrl(l))) break;
      para.push(l); i++;
    }
    if (para.length) blocks.push({ type: 'paragraph', text: para.join('\n') });
    else i++; // safety: never spin
  }
  return blocks;
}

/** Convenience: a fresh empty block of a type (for the editor's add/convert). */
export function emptyBlock(type) {
  switch (type) {
    case 'heading': return { type: 'heading', level: 2, text: '' };
    case 'code': return { type: 'code', lang: '', code: '' };
    case 'quote': return { type: 'quote', text: '' };
    case 'list': return { type: 'list', ordered: false, items: [''] };
    case 'image': return { type: 'image', alt: '', url: '' };
    case 'embed': return { type: 'embed', url: '' };
    case 'callout': return { type: 'callout', variant: 'note', text: '' };
    case 'members': return { type: 'members' };
    default: return { type: 'paragraph', text: '' };
  }
}
