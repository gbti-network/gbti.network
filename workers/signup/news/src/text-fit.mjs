// sow-402: ending shortened news text at a clean point. Shared by the AI summary (classify.mjs) and the imported
// excerpt (feeds.mjs), so the two cannot disagree about what "a whole word" is. Pure.

/**
 * `s` cut to at most `max` characters INCLUDING a trailing "…", ending on a whole word. The cut backs up to the
 * last space when it would land inside a word, and drops trailing punctuation or an opening quote so the text
 * does not end on ",…" or "(…". A single word longer than the room is cut hard (nothing better exists). Returns
 * '' when nothing is left.
 */
export function cutAtWord(s, max) {
  const text = String(s ?? '');
  const room = Math.max(0, max - 1); // one character for the ellipsis
  let head = text.slice(0, room);
  if (text.length > room && text[room] !== ' ') {
    const sp = head.lastIndexOf(' ');
    if (sp > 0) head = head.slice(0, sp);
  }
  head = head.replace(/[\s,;:.!?(\[{"'“‘–—-]+$/u, '');
  return head ? `${head}…` : '';
}
