// A partner's name in a page body links to its masked partner path, from the `keywords` on a live row of
// house/outbound-links.yml (first: SurfacedBy, 2026-10-28). The owner's rule for how many: in each rendered body,
// the FIRST mention, and the LAST as well when the word appears more than three times. One link reads as a
// reference; a link on every mention reads as an advert.
//
// Runs AFTER the sanitizer, so it never has to be trusted by it, and BEFORE rehypeExternalLinks and
// rehypeSponsoredLinks, so the link it inserts gets exactly the rel every other partner link in a body gets
// (`sponsored nofollow noopener`, from the store's path list) and no new rel logic lives here.
//
// What is never linked, and never COUNTED, so the first mention is always one in ordinary prose:
// - text already inside a link;
// - any title or headline: a heading, a caption, a definition term, a bold run-in head (see SKIP and
//   isHeadlineBold). A link in a heading reads as navigation, and the heading is often the brand name on its own page;
// - a table header: the sortable-table script rebuilds a header from its text and would erase the link;
// - a <summary>, where a link swallows the toggle;
// - code, and anything else that is not prose.
// A mention that is part of an address, a handle or a path (`surfacedby.com`, `@surfacedby`, `surfacedby/OpenGEO`)
// is not a mention of the brand, and the match follows the keyword's own capitalisation, so a package or account
// name written in lower case (`pip install surfacedby`) is left alone too.

/**
 * Elements whose text is never linked and never counted. Titles and headlines of every kind are out (owner,
 * 2026-10-28: "First mention should not include titles or headlines"): headings, a table's header cells and
 * caption, a figure's caption, a definition term, a fieldset legend, a disclosure's summary.
 */
const SKIP = new Set(['a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'th', 'caption', 'figcaption', 'dt', 'legend', 'summary', 'code', 'pre', 'kbd', 'samp', 'script', 'style', 'button', 'svg', 'math', 'textarea', 'select', 'option']);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The matcher for one term: as the keyword is capitalised, word-bounded, and refusing the shapes of an address, a
 * handle or a path on either side. Built per call, so its `lastIndex` state never leaks between bodies.
 */
export function termPattern(term) {
  const body = escapeRe(String(term)).replace(/ /g, '\\s+');
  return new RegExp(`(?<![A-Za-z0-9_./@:-])${body}(?![A-Za-z0-9_/:@-])(?!\\.[A-Za-z0-9])`, 'g');
}

/** Which of `count` mentions get a link: the first, and the last too when there are more than three. */
export function chosenMentions(count) {
  if (count <= 0) return [];
  return count > 3 ? [0, count - 1] : [0];
}

const textOf = (n) => (n.type === 'text' ? n.value : Array.isArray(n.children) ? n.children.map(textOf).join('') : '');
const meaningful = (children) => (children || []).filter((c) => !(c.type === 'text' && !c.value.trim()));

/**
 * A bold label doing a headline's job: the run-in head that opens a paragraph or a list item ("**Content.** Briefs
 * and drafts..."), or a paragraph that is nothing but bold text. Markdown writers use both as headings, so they are
 * headlines for this rule too. Bold that merely EMPHASISES a word inside a sentence is prose and is linked as usual.
 */
export function isHeadlineBold(node, parent) {
  if (node?.type !== 'element' || (node.tagName !== 'strong' && node.tagName !== 'b')) return false;
  if (!parent || (parent.tagName !== 'p' && parent.tagName !== 'li')) return false;
  const kids = meaningful(parent.children);
  if (kids[0] !== node) return false;
  return kids.length === 1 || /[.:!?]\s*$/.test(textOf(node));
}

/** Every eligible mention of `re` in the tree, in document order, as `{ node, parent, start, end }`. */
function mentionsIn(tree, re) {
  const out = [];
  const walk = (node, parent) => {
    if (node.type === 'text' && parent) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(node.value)) !== null) out.push({ node, parent, start: m.index, end: m.index + m[0].length });
      return;
    }
    if (node.type === 'element' && (SKIP.has(node.tagName) || isHeadlineBold(node, parent))) return;
    if (Array.isArray(node.children)) for (const c of [...node.children]) walk(c, node);
  };
  walk(tree, null);
  return out;
}

/** Replace one text node with text, link, text segments for the given mentions (all in that node). */
function linkWithin(entry, mentions, path) {
  const { node, parent } = entry;
  const at = parent.children.indexOf(node);
  if (at === -1) return;
  const parts = [];
  let cursor = 0;
  for (const m of [...mentions].sort((a, b) => a.start - b.start)) {
    if (m.start > cursor) parts.push({ type: 'text', value: node.value.slice(cursor, m.start) });
    parts.push({
      type: 'element',
      tagName: 'a',
      properties: { href: path, dataKeywordLink: '' },
      children: [{ type: 'text', value: node.value.slice(m.start, m.end) }],
    });
    cursor = m.end;
  }
  if (cursor < node.value.length) parts.push({ type: 'text', value: node.value.slice(cursor) });
  parent.children.splice(at, 1, ...parts);
}

/** rehype plugin. `keywords` is `[{ term, path }]` from scripts/lib/outbound-links-store.mjs outboundKeywords. */
export function rehypeKeywordLinks({ keywords = [] } = {}) {
  const list = (Array.isArray(keywords) ? keywords : []).filter((k) => k && typeof k.term === 'string' && typeof k.path === 'string');
  return (tree) => {
    // One term at a time, re-walking after each, so a link inserted for one term is skipped by the next.
    for (const { term, path } of list) {
      const found = mentionsIn(tree, termPattern(term));
      const chosen = chosenMentions(found.length).map((i) => found[i]);
      const byNode = new Map();
      for (const m of chosen) {
        if (!byNode.has(m.node)) byNode.set(m.node, []);
        byNode.get(m.node).push(m);
      }
      for (const [, ms] of byNode) linkWithin(ms[0], ms, path);
    }
  };
}
