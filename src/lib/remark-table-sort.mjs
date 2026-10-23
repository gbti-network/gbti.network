// sow-470: `<!-- sort: on -->` or `<!-- sort: off -->` on the line before a table, as the author's override of
// the rule that decides which tables get sort controls.
//
// Why it runs on mdast rather than later: the marker is an HTML comment, and the sanitizer removes comment
// nodes, so by the time the rehype passes run there is nothing left to read. Here it is still an `html` node.
// It sets `data.hProperties`, which mdast-to-hast copies onto the `<table>` element, so the value arrives as
// `data-sort` on the table; `markdown-sanitize.mjs` allows that attribute on a table with exactly the two
// values below, so nothing an author writes can widen it.
//
// The marker is CONSUMED (removed from the tree), because leaving it would render as a stray comment in the
// published HTML and tell a reader nothing.

const MARKER = /^<!--\s*sort:\s*(on|off)\s*-->\s*$/i;

/** The marker's value when this node is one, else null. */
export function sortMarkerValue(node) {
  if (!node || node.type !== 'html') return null;
  const m = MARKER.exec(String(node.value || '').trim());
  return m ? m[1].toLowerCase() : null;
}

function applyIn(parent) {
  if (!Array.isArray(parent.children)) return;
  for (let i = 0; i < parent.children.length; i += 1) {
    const node = parent.children[i];
    const value = sortMarkerValue(node);
    if (value) {
      // The next sibling, which for a marker on its own line is the table.
      const next = parent.children[i + 1];
      if (next && next.type === 'table') {
        next.data = next.data || {};
        // `dataSort`, not `data-sort`: hast's property model is camelCase and the sanitizer's allowlist is
        // keyed by that name. Setting the literal `data-sort` DOES serialize correctly on its own, which is
        // what makes this worth a comment: the attribute reached the HTML in a pipeline without sanitising
        // and was then stripped by the real one, so the override silently did nothing on the live site.
        next.data.hProperties = { ...(next.data.hProperties || {}), dataSort: value };
        parent.children.splice(i, 1); // consume the marker
        i -= 1;
        continue;
      }
      // A marker with no table after it is left alone rather than silently eaten, so the author can see that
      // it did not attach to anything.
    }
    applyIn(node);
  }
}

export function remarkTableSort() {
  return (tree) => { applyIn(tree); };
}
