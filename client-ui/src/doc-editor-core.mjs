// The visual editor's block palette, pure and node-tested. gbti-doc-editor keeps the full list; a COMPACT
// editor (the comment box, owner 2026-09-11) offers the subset a reply needs and nothing that belongs to an
// article: no images (the media staging flow), no headings or tables, and no members-only split (a comment's
// audience is the whole comment, chosen with the Members only / Public control, not a divider inside it).
export const COMPACT_KEYS = Object.freeze(['paragraph', 'quote', 'code', 'ul', 'ol', 'embed']);

/** The palette rows a mode offers: the full list, or the compact subset in the full list's order. */
export function paletteFor(all, { compact = false } = {}) {
  const list = Array.isArray(all) ? all : [];
  return compact ? list.filter((c) => c && COMPACT_KEYS.includes(c.key)) : list.slice();
}

/** A comment body may not exceed this many bytes (the hosted validator's cap for a comment file). */
export const COMMENT_MAX_BYTES = 8000;
export function commentBodyTooLong(md) {
  try { return new TextEncoder().encode(String(md ?? '')).length > COMMENT_MAX_BYTES; }
  catch { return String(md ?? '').length > COMMENT_MAX_BYTES; }
}
