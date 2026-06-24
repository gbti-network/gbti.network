// SOW-062 Phase 4: a minimal, node-free Markdown <-> block model for the in-house block body editor. The repo
// stays the database (the on-disk body is Markdown), so the editor PARSES the body into typed blocks and
// SERIALIZES them back to Markdown. The SOW-016 `<!-- members-only -->` split marker is a first-class block and
// round-trips EXACTLY (the Worker splits on it at publish). Inline Markdown (bold/links) is left as block text
// (we model block STRUCTURE, not inline), so it round-trips verbatim.

export const MEMBERS_MARKER = '<!-- members-only -->';
export const BLOCK_TYPES = ['paragraph', 'heading', 'code', 'quote', 'list', 'image', 'embed', 'members'];

const isMarker = (l) => l.trim() === MEMBERS_MARKER;
const isFence = (l) => /^```/.test(l);
const isHeading = (l) => /^#{1,6}\s+/.test(l);
const isQuote = (l) => /^>\s?/.test(l);
const isListItem = (l) => /^\s*([-*]|\d+\.)\s+/.test(l);
const isImageOnly = (l) => /^!\[[^\]]*\]\([^)]*\)\s*$/.test(l);
const isBareUrl = (l) => /^https?:\/\/\S+$/.test(l.trim());

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
    case 'quote': return String(b.text ?? '').split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
    case 'list': {
      const items = Array.isArray(b.items) ? b.items : String(b.text ?? '').split('\n').filter((x) => x !== '');
      return items.map((it, i) => (b.ordered ? `${i + 1}. ` : '- ') + it).join('\n');
    }
    case 'image': return `![${b.alt ?? ''}](${b.url ?? ''})`;
    case 'embed': return String(b.url ?? '');
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
      const code = [];
      i++;
      while (i < n && !/^```\s*$/.test(lines[i])) { code.push(lines[i]); i++; }
      i++; // skip the closing fence
      blocks.push({ type: 'code', lang, code: code.join('\n') });
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
    if (isBareUrl(line)) { blocks.push({ type: 'embed', url: line.trim() }); i++; continue; }
    // paragraph: consecutive lines that start no other block
    const para = [];
    while (i < n) {
      const l = lines[i];
      if (l.trim() === '' || isMarker(l) || isFence(l) || isHeading(l) || isQuote(l) || isListItem(l) || isImageOnly(l) || isBareUrl(l)) break;
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
    case 'members': return { type: 'members' };
    default: return { type: 'paragraph', text: '' };
  }
}
