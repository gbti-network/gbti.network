// Nested lists, one model for every surface (owner report, 2026-09-12: a numbered list with bulleted details under
// each item came back as one flat numbered list of 19 items after a save from the WorkBench editor). The block
// editor, the client renderer (the Preview, the extension reader, the members-only body) and the Preview's
// edit-in-place read-back all go through these functions, so an item's depth and its own marker survive a load,
// an edit and a save exactly as CommonMark writes them. Node-free and dependency-free.
//
// An item is { text, depth, ordered }: depth 0 is the top level; `ordered` is the item's own marker, so bullets
// under a numbered item stay bullets. A plain string item means { text, depth: 0 } with the list's marker.

export const LIST_ITEM_RE = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

/** A line that starts a list item, at any indentation. */
export function isListLine(line) {
  return LIST_ITEM_RE.test(String(line ?? ''));
}

/**
 * Read one list run starting at `start`: consecutive list lines, with depth from an indent stack (a line indented
 * more than the open level opens a deeper one; less pops back to the matching level; tabs count four). A marker
 * change at depth 0 ENDS the run, because CommonMark starts a new list there; a change at a deeper level does not
 * (bullets under a numbered item). Returns { items, next } where `next` is the first line NOT consumed.
 */
export function takeListRun(lines, start = 0) {
  const items = [];
  const stack = [0];
  let topOrdered = null;
  let i = start;
  while (i < lines.length) {
    const m = LIST_ITEM_RE.exec(String(lines[i] ?? ''));
    if (!m) break;
    const indent = m[1].replace(/\t/g, '    ').length;
    const ordered = /^\d/.test(m[2]);
    while (stack.length > 1 && indent < stack[stack.length - 1]) stack.pop();
    if (indent > stack[stack.length - 1]) stack.push(indent);
    const depth = stack.length - 1;
    if (depth === 0) {
      if (topOrdered === null) topOrdered = ordered;
      else if (ordered !== topOrdered) break;
    }
    items.push({ text: m[3], depth, ordered });
    i++;
  }
  return { items, next: i };
}

/**
 * Every item as { text, depth, ordered }. A string item is a top-level item with the list's marker; a depth can
 * never jump more than one level below the item before it (the first item is always depth 0); every top-level
 * item carries the LIST's marker (one list, one marker at its root), deeper items keep their own.
 */
export function normalizeListItems(items, ordered = false) {
  const out = [];
  let prevDepth = -1;
  for (const raw of Array.isArray(items) ? items : []) {
    const it = (raw && typeof raw === 'object') ? raw : { text: raw, depth: 0 };
    let depth = Math.max(0, Math.floor(Number(it.depth) || 0));
    if (depth > prevDepth + 1) depth = prevDepth + 1;
    const own = typeof it.ordered === 'boolean' ? it.ordered : false;
    out.push({ text: String(it.text ?? ''), depth, ordered: depth === 0 ? !!ordered : own });
    prevDepth = depth;
  }
  return out;
}

/** True when nothing about the list needs more than plain strings: all top level, one marker. */
export function isFlatList(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return true;
  const first = list[0];
  const firstOrdered = first && typeof first === 'object' ? !!first.ordered : null;
  return list.every((it) => {
    if (!it || typeof it !== 'object') return firstOrdered === null;
    return (Number(it.depth) || 0) === 0 && !!it.ordered === firstOrdered;
  });
}

/**
 * Items -> markdown lines. A child is indented by the width of its parent's marker (`- ` two, `1. ` three,
 * `10. ` four), which is what CommonMark needs to read it as a child list, so the site parses exactly what the
 * editor wrote. Numbers restart with each sibling run.
 */
export function serializeListItems(items, ordered = false) {
  const norm = normalizeListItems(items, ordered);
  const lines = [];
  const counters = [];      // per depth: the number of the last ordered item in the current run
  const indents = [];       // per depth: the indent string of the current run
  const markerWidth = [];   // per depth: the width of the last marker written at that depth
  let prevDepth = -1;
  let prevOrderedAtDepth = [];
  for (const it of norm) {
    if (it.depth > prevDepth) {
      counters[it.depth] = 0;
      indents[it.depth] = it.depth === 0 ? '' : indents[it.depth - 1] + ' '.repeat(markerWidth[it.depth - 1] || 2);
      prevOrderedAtDepth[it.depth] = it.ordered;
    } else if (it.depth < prevDepth) {
      // back out to a shallower level: the deeper runs are over
      counters.length = it.depth + 1;
      prevOrderedAtDepth.length = it.depth + 1;
    }
    if (prevOrderedAtDepth[it.depth] !== it.ordered) { counters[it.depth] = 0; prevOrderedAtDepth[it.depth] = it.ordered; }
    counters[it.depth] = (counters[it.depth] || 0) + 1;
    const marker = it.ordered ? `${counters[it.depth]}. ` : '- ';
    markerWidth[it.depth] = marker.length;
    lines.push(`${indents[it.depth]}${marker}${it.text}`);
    prevDepth = it.depth;
  }
  return lines;
}

/**
 * Items -> nested <ul>/<ol> markup: one tag per sibling run (from the run's marker), a child list inside its
 * parent's <li>. `inline(text)` renders an item's inline content. `rootAttrs` lands on the outermost tag (the
 * editor makes that tag its contenteditable host).
 */
export function listHtml(items, inline = (t) => t, { ordered = false, rootAttrs = '' } = {}) {
  const norm = normalizeListItems(items, ordered);
  let html = '';
  const open = [];
  const openList = (it) => {
    const tag = it.ordered ? 'ol' : 'ul';
    html += `<${tag}${!open.length && rootAttrs ? ` ${rootAttrs}` : ''}>`;
    open.push({ tag, ordered: it.ordered });
  };
  const closeList = () => { html += `</li></${open.pop().tag}>`; };
  for (const it of norm) {
    while (open.length > it.depth + 1) closeList();
    if (open.length === it.depth + 1) {
      const cur = open[open.length - 1];
      if (cur.ordered !== it.ordered) { closeList(); openList(it); html += `<li>${inline(it.text)}`; }
      else html += `</li><li>${inline(it.text)}`;
    } else {
      openList(it);
      html += `<li>${inline(it.text)}`;
    }
  }
  while (open.length) closeList();
  return html;
}

/**
 * Move item `index` one level in (+1) or out (-1), its own children moving with it. The first item never indents;
 * a depth is clamped to one below the item before it. An item that lands beside existing siblings takes their
 * marker (a numbered app pushed under another app joins its bulleted details as a bullet); an item opening a
 * fresh level keeps its own. Returns the new items, or null when nothing changes.
 */
export function indentListItem(items, index, delta, ordered = false) {
  const norm = normalizeListItems(items, ordered);
  const i = Number(index);
  if (!(i >= 0 && i < norm.length) || !delta) return null;
  const oldDepth = norm[i].depth;
  const maxDepth = i === 0 ? 0 : norm[i - 1].depth + 1;
  const newDepth = Math.max(0, Math.min(maxDepth, oldDepth + (delta > 0 ? 1 : -1)));
  if (newDepth === oldDepth) return null;
  const shift = newDepth - oldDepth;
  const out = norm.map((it) => ({ ...it }));
  out[i].depth = newDepth;
  for (let j = i - 1; j >= 0; j--) {
    if (out[j].depth < newDepth) break;                 // the parent: no sibling run before this item
    if (out[j].depth === newDepth) { out[i].ordered = out[j].ordered; break; }
  }
  for (let j = i + 1; j < out.length && out[j].depth > oldDepth; j++) out[j].depth = Math.max(0, out[j].depth + shift);
  return normalizeListItems(out, ordered);
}
