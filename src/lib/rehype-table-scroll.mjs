// sow-470: a table in a rendered body gets a real scroll container around it, built here rather than in CSS.
//
// The rule this replaces was `display: block; width: max-content` ON THE TABLE, added by sow-248 after five of
// 52 articles pushed a phone page sideways by up to 213px at 390px. It worked, and it cost: `display: block`
// stops a table being a table, so it cannot fill its column, and column widths stop being negotiated across
// rows. A wrapper gives the same overflow behaviour back without taking the table's own layout away.
//
// Built here and not in the page's enhancer script, which is where the `.code-card` wrapper comes from,
// because that script runs in the browser. A reader with JavaScript off would get no wrapper at all, and the
// overflow bug sow-248 measured would come straight back for them. A build-time wrapper has no such hole.
//
// Runs AFTER the sanitizer, for the same reason rehypeExternalLinks and rehypeSponsoredLinks do: the sanitize
// schema's className allowlist does not carry `table-scroll` and would strip it. Nothing here reads or trusts
// the table's content, so running late costs no safety.

/** True for a hast element node with this tag name. */
const isTag = (node, tag) => node && node.type === 'element' && node.tagName === tag;

/**
 * Wrap `node`'s table children in a scroll div, in place.
 *
 * A table already inside a `.table-scroll` is left alone, so a second pass (or a body that arrived with its own
 * wrapper) cannot nest two of them and produce a scroll area inside a scroll area.
 */
function wrapTables(parent) {
  if (!Array.isArray(parent.children)) return;
  const cls = parent.properties?.className || [];
  if (isTag(parent, 'div') && (cls.includes('table-scroll') || cls.includes('table-wrap'))) return;
  for (let i = 0; i < parent.children.length; i += 1) {
    const child = parent.children[i];
    if (isTag(child, 'table')) {
      // TWO elements, and the outer one is load-bearing. The right-edge fade has to be pinned to the visible
      // edge, and an absolutely positioned pseudo-element inside an `overflow-x: auto` box is positioned
      // against the SCROLLED content instead: measured on a 390px render, the fade rendered 216px off-screen
      // to the right, where no reader would ever see it. The outer div does not scroll, so it can hold it.
      parent.children[i] = {
        type: 'element',
        tagName: 'div',
        properties: { className: ['table-wrap'] },
        children: [{
          type: 'element',
          tagName: 'div',
          properties: { className: ['table-scroll'] },
          children: [child],
        }],
      };
      // Descend into the table itself: a nested table is rare but is still a table, and the wrapper we just
      // made is not a parent we want to re-enter (the guard above would stop us anyway).
      wrapTables(child);
    } else {
      wrapTables(child);
    }
  }
}

export function rehypeTableScroll() {
  return (tree) => { wrapTables(tree); };
}
