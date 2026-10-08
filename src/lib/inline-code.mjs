// sow-449 (owner, 2026-10-08): "the `/qa` is not converting as markdown in our short description". A short description
// is printed as plain text, so a command written in backticks showed its backticks. Only that one piece of Markdown is
// honoured: text in PAIRED backticks becomes inline code. Nothing else in the field is read as Markdown, so a stray
// asterisk or bracket in a description cannot change how it shows, and an unpaired backtick stays as typed.
//
// Pure. InlineCode.astro renders the runs with Astro's own escaping; plainInline is for places that take text only
// (a page's description, which link previews and search engines read).

/** The text as runs, { code, text }: code for each paired-backtick span, plain for the rest. */
export function inlineCodeRuns(text) {
  const s = String(text ?? '');
  const out = [];
  const push = (code, t) => { if (!t) return; const last = out[out.length - 1]; if (last && last.code === code) last.text += t; else out.push({ code, text: t }); };
  let i = 0;
  while (i < s.length) {
    const open = s.indexOf('`', i);
    if (open < 0) break;
    const close = s.indexOf('`', open + 1);
    if (close < 0) break; // an unpaired backtick stays as typed
    if (close === open + 1) { push(false, s.slice(i, close + 1)); i = close + 1; continue; } // `` is not a span
    push(false, s.slice(i, open));
    push(true, s.slice(open + 1, close));
    i = close + 1;
  }
  push(false, s.slice(i));
  return out;
}

/** The text with the backticks of each code span removed, for a field that takes plain text. */
export const plainInline = (text) => inlineCodeRuns(text).map((r) => r.text).join('');
