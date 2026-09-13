// Footnotes last (owner report, 2026-09-13, the Proxmox article): an item with a members-only section rendered its
// footnotes ABOVE the locked box, because the markdown renderer appends the footnotes to the end of the PUBLIC body
// and the members-only section is placed after that body. The two blocks ran together and the reader could not tell
// where one ended. Footnotes belong to the whole piece, so they go under the members-only section.
//
// This splits rendered markdown into the body and its trailing footnotes section, so a template can place the
// members-only section between them. It only ever REORDERS what the renderer produced: when the footnotes section is
// not cleanly the last thing in the HTML, the input comes back whole as the body and nothing moves.

const OPEN = /<section\b[^>]*\bdata-footnotes(?=[\s=>/])[^>]*>/gi;

export function splitTrailingFootnotes(html) {
  const s = typeof html === 'string' ? html : '';
  let last = null;
  for (const m of s.matchAll(OPEN)) last = m;
  if (!last) return { body: s, footnotes: '' };
  const tail = s.slice(last.index);
  if (!/<\/section>\s*$/i.test(tail)) return { body: s, footnotes: '' };
  const opens = (tail.match(/<section\b/gi) || []).length;
  const closes = (tail.match(/<\/section>/gi) || []).length;
  if (opens !== closes) return { body: s, footnotes: '' };
  return { body: s.slice(0, last.index), footnotes: tail.trim() };
}
