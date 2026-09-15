// Nested lists, one model for every surface (owner report, 2026-09-12: a numbered list with bulleted details under
// each item came back as one flat numbered list of 19 items after a save from the WorkBench editor). The block
// editor, the client renderer (the Preview, the extension reader, the members-only body) and the Preview's
// edit-in-place read-back all go through these functions, so an item's depth and its own marker survive a load,
// an edit and a save exactly as CommonMark writes them. Node-free and dependency-free.
//
// An item is { text, depth, ordered, style? }: depth 0 is the top level; `ordered` is the item's own marker, so
// bullets under a numbered item stay bullets. A plain string item means { text, depth: 0 } with the list's marker.
// sow-322: `style` is a marker style word (list-attrs.mjs) and belongs to a RUN, so it is carried ONLY by the item
// that opens the run (the first sibling at its depth after its parent, or after a marker change at that depth);
// the key is absent everywhere else. In markdown the style is a brace suffix on that item: `- a {square}`.
import { splitListSuffix, normalizeListStyle, listStyleClass, styleKind } from './list-attrs.mjs';

export const LIST_ITEM_RE = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

/** A line that starts a list item, at any indentation. */
export function isListLine(line) {
  return LIST_ITEM_RE.test(String(line ?? ''));
}

/** Whether an item of `depth` and `ordered` placed at position `i` (after items[0..i-1]) would open a run. */
function opensRunBefore(items, i, depth, ordered) {
  for (let j = i - 1; j >= 0; j--) {
    if (items[j].depth < depth) return true;                          // the parent: nothing at this level before it
    if (items[j].depth === depth) return items[j].ordered !== ordered; // a sibling: the same marker means the run is open
  }
  return true;
}

/** True when item `i` opens a sibling run. The ONE definition the serializer, the renderer and normalize share. */
export function opensRun(items, i) {
  const it = items[i];
  return !!it && opensRunBefore(items, i, it.depth, it.ordered);
}

/** The indices of the sibling run holding item `i` (its same-depth, same-marker siblings between the same parent
 *  boundaries), in order. Children of those siblings are not members. */
export function runOf(items, i) {
  const d = items[i].depth;
  const o = items[i].ordered;
  let start = i;
  for (let j = i - 1; j >= 0; j--) {
    if (items[j].depth < d) break;
    if (items[j].depth === d) { if (items[j].ordered !== o) break; start = j; }
  }
  const out = [];
  for (let j = start; j < items.length; j++) {
    if (j > start && items[j].depth < d) break;
    if (items[j].depth === d) { if (items[j].ordered !== o) break; out.push(j); }
  }
  return out;
}

/**
 * Read one list run starting at `start`: consecutive list lines, with depth from an indent stack (a line indented
 * more than the open level opens a deeper one; less pops back to the matching level; tabs count four). A marker
 * change at depth 0 ENDS the run, because CommonMark starts a new list there; a change at a deeper level does not
 * (bullets under a numbered item). A style suffix on an item that opens a run is split off into `style` (a
 * suffix anywhere else is the author's text). Returns { items, next } where `next` is the first line NOT consumed.
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
  for (let k = 0; k < items.length; k++) {
    if (!opensRun(items, k)) continue;
    const split = splitListSuffix(items[k].text, items[k].ordered);
    if (!split) continue;
    items[k].text = split.rest;
    if (split.style) items[k].style = split.style;
  }
  return { items, next: i };
}

/**
 * Every item as { text, depth, ordered } (+ `style` on a run opener). A string item is a top-level item with the
 * list's marker; a depth can never jump more than one level below the item before it (the first item is always
 * depth 0); every top-level item carries the LIST's marker (one list, one marker at its root), deeper items keep
 * their own. A style survives only on an item that opens a run and only when its kind matches the item's marker;
 * the key is never emitted otherwise, so a list without styles is exactly the shape it always was.
 */
export function normalizeListItems(items, ordered = false) {
  const out = [];
  let prevDepth = -1;
  for (const raw of Array.isArray(items) ? items : []) {
    const it = (raw && typeof raw === 'object') ? raw : { text: raw, depth: 0 };
    let depth = Math.max(0, Math.floor(Number(it.depth) || 0));
    if (depth > prevDepth + 1) depth = prevDepth + 1;
    const own = typeof it.ordered === 'boolean' ? it.ordered : false;
    const isOrdered = depth === 0 ? !!ordered : own;
    const item = { text: String(it.text ?? ''), depth, ordered: isOrdered };
    const style = it.style ? normalizeListStyle(it.style, isOrdered) : null;
    if (style && opensRunBefore(out, out.length, depth, isOrdered)) item.style = style;
    out.push(item);
    prevDepth = depth;
  }
  return out;
}

/** True when nothing about the list needs more than plain strings: all top level, one marker, no style. */
export function isFlatList(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return true;
  const first = list[0];
  const firstOrdered = first && typeof first === 'object' ? !!first.ordered : null;
  return list.every((it) => {
    if (!it || typeof it !== 'object') return firstOrdered === null;
    return (Number(it.depth) || 0) === 0 && !!it.ordered === firstOrdered && !it.style;
  });
}

/**
 * Items -> markdown lines. A child is indented by the width of its parent's marker (`- ` two, `1. ` three,
 * `10. ` four), which is what CommonMark needs to read it as a child list, so the site parses exactly what the
 * editor wrote. Numbers restart with each sibling run. A run's style is written as a ` {word}` suffix on the item
 * that opens it, and only when that item has text: a bare `{word}` line would read back as text, so an empty
 * opener drops its style rather than writing something the parser cannot return.
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
    const suffix = it.style && it.text.trim() !== '' ? ` {${it.style}}` : '';
    lines.push(`${indents[it.depth]}${marker}${it.text}${suffix}`);
    prevDepth = it.depth;
  }
  return lines;
}

/** `attrs` with `cls` merged into its class attribute (never a second class attribute, which a parser drops). */
function withClass(attrs, cls) {
  const a = String(attrs || '');
  if (!cls) return a;
  if (/\bclass="[^"]*"/.test(a)) return a.replace(/\bclass="([^"]*)"/, (_m, v) => `class="${v ? `${v} ` : ''}${cls}"`);
  return `${a ? `${a} ` : ''}class="${cls}"`;
}

/**
 * Items -> nested <ul>/<ol> markup: one tag per sibling run (from the run's marker), a child list inside its
 * parent's <li>. `inline(text)` renders an item's inline content. `rootAttrs` lands on the outermost tag (the
 * editor makes that tag its contenteditable host). A run's style is the list-* class on its own tag, merged into
 * rootAttrs on the outermost one.
 */
export function listHtml(items, inline = (t) => t, { ordered = false, rootAttrs = '' } = {}) {
  const norm = normalizeListItems(items, ordered);
  let html = '';
  const open = [];
  const openList = (it) => {
    const tag = it.ordered ? 'ol' : 'ul';
    const attrs = withClass(open.length ? '' : rootAttrs, listStyleClass(it.style));
    html += `<${tag}${attrs ? ` ${attrs}` : ''}>`;
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
 * fresh level keeps its own. A style belongs to the RUN, not the item: when the item that opened a run moves
 * away, the run's next sibling opens it and takes the style, and the moved item carries none into its new place
 * (it joins its new siblings' run, or opens a fresh unstyled level). Returns the new items, or null when nothing
 * changes.
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
  if (out[i].style) {
    for (let j = i + 1; j < out.length; j++) {
      if (out[j].depth < oldDepth) break;                                       // the run has no next sibling
      if (out[j].depth === oldDepth) { if (out[j].ordered === out[i].ordered) out[j].style = out[i].style; break; }
    }
    delete out[i].style;
  }
  out[i].depth = newDepth;
  for (let j = i - 1; j >= 0; j--) {
    if (out[j].depth < newDepth) break;                 // the parent: no sibling run before this item
    if (out[j].depth === newDepth) { out[i].ordered = out[j].ordered; break; }
  }
  for (let j = i + 1; j < out.length && out[j].depth > oldDepth; j++) out[j].depth = Math.max(0, out[j].depth + shift);
  return normalizeListItems(out, ordered);
}

/** The kind and style of the run holding item `index`: { ordered, style, depth }. What a list bar paints. */
export function listRunState(items, ordered = false, index = 0) {
  const norm = normalizeListItems(items, ordered);
  if (!norm.length) return { ordered: !!ordered, style: null, depth: 0 };
  const i = Math.min(Math.max(0, Number(index) || 0), norm.length - 1);
  const run = runOf(norm, i);
  return { ordered: norm[i].ordered, style: norm[run[0]].style || null, depth: norm[i].depth };
}

/**
 * sow-322: one list-bar click applied to a list. Pure, and the ONE authority for what a click means, shared by the
 * Preview's bar and the editor's so the two surfaces cannot disagree. `index` is the item under the caret; the
 * action acts on the sibling RUN holding it (the whole top level when the item is a top-level one, which also
 * flips the list's own marker; a nested run flips only its own items, its children keeping their markers):
 *   ordered / unordered   flip the run to that kind; a style of the other kind is dropped with it
 *   style:<word>          set the run's style (and flip the run to the word's kind first when it differs)
 *   style:default         clear the run's style (style:disc and style:decimal mean the same)
 * Returns { ordered, items } (normalized, a new object) or null when nothing changes or the action is unknown.
 */
export function applyListAction(list, index, action) {
  const ordered = !!list?.ordered;
  const norm = normalizeListItems(list?.items, ordered);
  const i = Number(index);
  if (!(i >= 0 && i < norm.length)) return null;
  const act = String(action || '');
  let wantOrdered = null;
  let wantStyle;
  if (act === 'ordered' || act === 'unordered') wantOrdered = act === 'ordered';
  else if (act.startsWith('style:')) {
    const word = act.slice('style:'.length);
    if (word === 'default') wantStyle = null;
    else {
      const kind = styleKind(word);
      if (!kind) return null;
      wantOrdered = kind === 'number';
      wantStyle = normalizeListStyle(word, wantOrdered);
    }
  } else return null;
  const out = norm.map((it) => ({ ...it }));
  if (wantOrdered !== null) for (const j of runOf(out, i)) out[j].ordered = wantOrdered;
  if (wantStyle !== undefined) {
    // The run is found again AFTER the kind change: a flipped nested run may have merged into the neighbour of its
    // new kind, and the style then belongs on that merged run's opener.
    const run = runOf(out, i);
    for (const j of run) delete out[j].style;
    if (wantStyle) out[run[0]].style = wantStyle;
  }
  const topOrdered = out[0].ordered;
  const next = normalizeListItems(out, topOrdered);
  if (JSON.stringify(next) === JSON.stringify(norm)) return null;
  return { ordered: topOrdered, items: next };
}
