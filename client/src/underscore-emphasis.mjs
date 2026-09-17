// sow-355 (owner, 2026-09-16): "they are not showing bolded and italics and are keeping the underscores even when
// in visual mode." Neither the client renderer (client/src/markdown.mjs) nor the block editor's inline converter
// (client-ui/src/markdown-blocks.mjs) knew `_x_` or `__x__`, so every underscore emphasis showed as literal text in
// the WorkBench, the Preview, the reader and the comment editor, while the site build (remark) drew it as italic.
//
// This is the underscore half of CommonMark's emphasis rules, applied to text that has ALREADY been through the
// star rules and the link rule, so it runs over HTML. It is a small delimiter-run scanner rather than a regex,
// because the underscore rules turn on what sits either side of a run: an underscore run opens or closes only when
// it is not inside a word, which is what keeps snake_case_names and most URLs literal.
//
// Opaque spans are treated as single punctuation characters for those neighbour checks and are never scanned:
//   - an HTML tag, so an underscore inside an attribute (an href) is never touched;
//   - an entity (&amp; &quot; &#39;), which stands for one punctuation character;
//   - a code span, whose content is literal;
//   - an escaped underscore (\_), which is a literal underscore and never a delimiter;
//   - a placeholder the callers use (\u0000A<n>\u0000 and \uE000<n>\uE001), which stands for a tag or code span.
//
// Pure and dependency-free: client/src is published standalone, and client-ui imports this file directly.

const OPAQUE = /\u0000A\d+\u0000|\uE000\d+\uE001|<[^>]*>|&(?:[a-z][a-z0-9]*|#\d+|#x[0-9a-f]+);|`[^`\n]*`|\\_/giy;
const WS = /\s/u;
const PUNCT = /[\p{P}\p{S}]/u;

// Split into tokens: { opaque: raw } or { ch } (one code point each).
function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    OPAQUE.lastIndex = i;
    const m = OPAQUE.exec(src);
    if (m) { out.push({ opaque: m[0] }); i += m[0].length; continue; }
    const cp = src.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    out.push({ ch });
    i += ch.length;
  }
  return out;
}

// The character class a neighbour counts as: 'ws' (whitespace or the line edge), 'punct', or 'word'.
function kind(tok) {
  if (!tok) return 'ws';
  if (tok.opaque !== undefined) return 'punct';
  if (WS.test(tok.ch)) return 'ws';
  if (PUNCT.test(tok.ch)) return 'punct';
  return 'word';
}

/**
 * Apply underscore emphasis to already-escaped inline HTML.
 * @param {string} html
 * @param {object} [opts]
 * @param {string} [opts.em]      the opening italic tag (default `<em>`)
 * @param {string} [opts.strong]  the opening bold tag (default `<strong>`)
 * @param {boolean} [opts.keepEscapes] keep `\_` as written (the editor, which must read back byte for byte);
 *   otherwise an escaped underscore renders as a plain `_`, as the published page draws it
 */
export function underscoreEmphasis(html, { em = '<em>', strong = '<strong>', keepEscapes = false } = {}) {
  const src = String(html ?? '');
  if (!src.includes('_')) return src;
  const toks = tokenize(src);

  // Delimiter runs, with CommonMark's left/right-flanking tests and the underscore restriction.
  const runs = [];
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].ch !== '_') continue;
    let j = i;
    while (j + 1 < toks.length && toks[j + 1].ch === '_') j++;
    const before = kind(toks[i - 1]);
    const after = kind(toks[j + 1]);
    const left = after !== 'ws' && (after !== 'punct' || before === 'ws' || before === 'punct');
    const right = before !== 'ws' && (before !== 'punct' || after === 'ws' || after === 'punct');
    runs.push({
      at: i, len: j - i + 1, count: j - i + 1,
      canOpen: left && (!right || before === 'punct'),
      canClose: right && (!left || after === 'punct'),
      opens: [], closes: [],
    });
    i = j;
  }
  if (!runs.length) return render(toks, new Map(), keepEscapes);

  // CommonMark's "process emphasis", for one delimiter character. Inner matches are found first, so each later
  // match on the same opener wraps outside the earlier ones.
  const emClose = em.replace(/^<([a-z]+)[\s\S]*$/i, '</$1>');
  const strongClose = strong.replace(/^<([a-z]+)[\s\S]*$/i, '</$1>');
  const stack = [];
  for (const r of runs) {
    if (r.canClose) {
      while (r.count > 0) {
        let k = stack.length - 1;
        for (; k >= 0; k--) {
          const o = stack[k];
          if (o.count === 0) continue;
          const oddMatch = (o.canClose || r.canOpen) && (o.len + r.len) % 3 === 0 && !(o.len % 3 === 0 && r.len % 3 === 0);
          if (!oddMatch) break;
        }
        if (k < 0) break;
        const o = stack[k];
        const use = o.count >= 2 && r.count >= 2 ? 2 : 1;
        o.count -= use;
        r.count -= use;
        o.opens.unshift(use === 2 ? strong : em);
        r.closes.push(use === 2 ? strongClose : emClose);
        stack.length = o.count > 0 ? k + 1 : k; // openers between the pair can no longer match
      }
    }
    if (r.count > 0 && r.canOpen) stack.push(r);
  }
  return render(toks, new Map(runs.map((r) => [r.at, r])), keepEscapes);
}

function render(toks, runAt, keepEscapes) {
  let out = '';
  for (let i = 0; i < toks.length; i++) {
    const r = runAt.get(i);
    if (r) {
      out += r.closes.join('') + '_'.repeat(r.count) + r.opens.join('');
      i += r.len - 1;
      continue;
    }
    const t = toks[i];
    if (t.opaque !== undefined) out += t.opaque === '\\_' && !keepEscapes ? '_' : t.opaque;
    else out += t.ch;
  }
  return out;
}

// The marker an underscore-written emphasis carries, so the editors can write it back with the delimiter the
// author used. Without it, opening and saving a paragraph would rewrite every `_x_` as `*x*`.
export const UNDERSCORE_MARK = 'data-md="_"';
