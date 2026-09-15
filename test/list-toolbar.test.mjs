// sow-322: the list bar. Bullets | Numbers, the marker styles of the current kind, Remove list, shown while the
// caret or selection is inside a list on the WorkBench Preview and the editor, through the same selection toolbar
// the image bar lives in. The buttons are one shared set (list-style-ui.mjs); the editor's hooks are pure enough
// to drive here over a fake list element; the two surfaces' wiring is pinned by reading their source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fromHtml } from 'hast-util-from-html';
import { toHtml as toHtmlRaw } from 'hast-util-to-html';
import { LIST_STYLE_GROUPS, listStyleButtonsHtml, listStylePressed, listStyleProseCss } from '../client-ui/src/list-style-ui.mjs';
import { listBarTools } from '../client-ui/src/list-editing.mjs';
import { listHtml } from '../client/src/list-items.mjs';
import { createSelectionToolbar } from '../client-ui/src/selection-toolbar.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the list controls: the kind toggle, the styles of the CURRENT kind only, and Remove list', () => {
  assert.deepEqual(LIST_STYLE_GROUPS.kind.map((b) => b.action), ['unordered', 'ordered']);
  assert.deepEqual(LIST_STYLE_GROUPS.bullet.map((b) => b.action), ['style:disc', 'style:circle', 'style:square']);
  assert.deepEqual(LIST_STYLE_GROUPS.number.map((b) => b.action), ['style:decimal', 'style:lower-alpha', 'style:upper-alpha', 'style:lower-roman', 'style:upper-roman']);
  assert.deepEqual(LIST_STYLE_GROUPS.remove.map((b) => b.action), ['unwrap']);
  const bullets = listStyleButtonsHtml({ ordered: false, style: null });
  assert.equal((bullets.match(/data-la="/g) || []).length, 6, 'kind (2) + bullet styles (3) + remove (1)');
  assert.match(bullets, /data-la="unordered"[^>]*aria-pressed="true"/);
  assert.match(bullets, /data-la="style:disc"[^>]*aria-pressed="true"/, 'the default is pressed when no style is set');
  assert.ok(!/data-la="style:lower-alpha"/.test(bullets), 'a bullet run never sees the number styles');
  assert.ok(!/data-la="ordered"[^>]*aria-pressed/.test(bullets));
  const numbers = listStyleButtonsHtml({ ordered: true, style: 'lower-roman' });
  assert.equal((numbers.match(/data-la="/g) || []).length, 8, 'kind (2) + number styles (5) + remove (1)');
  assert.match(numbers, /data-la="ordered"[^>]*aria-pressed="true"/);
  assert.match(numbers, /data-la="style:lower-roman"[^>]*aria-pressed="true"/);
  assert.ok(!/data-la="style:decimal"[^>]*aria-pressed/.test(numbers), 'the default is not pressed when a style is set');
  assert.match(numbers, /data-la="unwrap"[^>]*>Remove list</);
  assert.equal((numbers.match(/gbti-stb-sep/g) || []).length, 2, 'two separators between three groups');
  assert.equal(listStylePressed({ ordered: false, style: 'square' }, 'style:square'), true);
  assert.equal(listStylePressed({ ordered: false, style: 'square' }, 'style:disc'), false);
  assert.equal(listStylePressed({ ordered: true, style: null }, 'style:square'), false, 'a bullet word is never pressed on a number run');
  assert.equal(listStylePressed({ ordered: true }, 'unwrap'), false);
  for (const s of ['<', '>', '"']) assert.ok(!LIST_STYLE_GROUPS.number.some((b) => b.label.includes(s) || b.title.includes(s)), 'labels and titles are plain text');
  assert.ok(!/[–—]/.test(JSON.stringify(LIST_STYLE_GROUPS) + listStyleProseCss('.x')), 'no dashes in shipped strings');
});

// A rendered list block wearing the DOM subset the hooks read: children, innerHTML, class, querySelectorAll('li'),
// dataset, focus. Built from the same listHtml the editor renders with.
const toHtml = (n) => toHtmlRaw(n, { characterReferences: { useNamedReferences: true } });
const adapt = (h, log) => {
  if (h.type === 'text') return { nodeType: 3, textContent: h.value };
  if (h.type !== 'element') return { nodeType: 8 };
  const cls = Array.isArray(h.properties?.className) ? h.properties.className.join(' ') : (h.properties?.className || '');
  const el = { nodeType: 1, tagName: h.tagName.toUpperCase(), childNodes: h.children.map((c) => adapt(c, log)), className: cls,
    dataset: { edit: h.properties?.dataEdit, id: h.properties?.dataId == null ? undefined : String(h.properties.dataId) },
    getAttribute(name) { return name === 'class' ? (cls || null) : null; },
    focus() { log.push(`focus:${h.tagName}`); },
    get children() { return this.childNodes.filter((c) => c.nodeType === 1); },
    get innerHTML() { return toHtml(h.children); },
    get textContent() { return toHtml(h.children).replace(/<[^>]+>/g, ''); },
    querySelectorAll(sel) { const out = []; const walk = (n) => { for (const c of n.children || []) { if (c.tagName === sel.toUpperCase()) out.push(c); walk(c); } }; walk(this); return out; },
  };
  for (const c of el.childNodes) c.parentNode = el;
  return el;
};
const listEl = (b, log) => adapt(fromHtml(listHtml(b.items, (t) => t, { ordered: !!b.ordered, rootAttrs: `class="ce ce-list" data-edit="list" data-id="${b._id}"` }), { fragment: true }).children[0], log);

function fakeEditor(blocks) {
  const log = [];
  let uid = 100;
  const host = {
    blocks: () => blocks,
    byId: (id) => blocks.find((b) => String(b._id) === String(id)),
    indexOf: (id) => blocks.findIndex((b) => String(b._id) === String(id)),
    withId: (b) => { b._id = ++uid; return b; },
    ceOf: (node) => { let n = node; while (n) { if (n.className && String(n.className).split(' ').includes('ce')) return n; n = n.parentNode; } return null; },
    render: () => { log.push('render'); host.current = blocks.filter((b) => b.type === 'list').map((b) => listEl(b, log)); },
    change: () => log.push('change'),
    query: (sel) => { const m = /data-id="(\d+)"/.exec(sel); return host.current.find((el) => el.dataset.id === m[1]) || null; },
    selection: () => null,
    focusBlock: (id) => log.push(`focusBlock:${id}`),
    current: [],
  };
  host.render();
  log.length = 0;
  return { host, log };
}

test('listBarTools (editor): listOf finds the list host, stateOf reads the model, a click mutates the model and re-renders', () => {
  const blocks = [{ _id: 1, type: 'paragraph', text: 'p' }, { _id: 2, type: 'list', ordered: false, items: ['a', 'b'] }];
  const { host, log } = fakeEditor(blocks);
  const tools = listBarTools(host);
  const el = host.current[0];
  assert.equal(tools.listOf(el.children[1].childNodes[0]), el, 'from a text node inside an item up to the list host');
  assert.equal(tools.listOf({ className: 'ce ce-p', dataset: { edit: 'text' } }), null, 'a paragraph host is not a list');
  assert.equal(tools.listOf(null), null);
  assert.deepEqual(tools.stateOf(el, 1), { ordered: false, style: null, depth: 0 });
  tools.onAction(el, 1, 'style:square');
  assert.deepEqual(blocks[1], { _id: 2, type: 'list', ordered: false, items: [{ text: 'a', depth: 0, ordered: false, style: 'square' }, { text: 'b', depth: 0, ordered: false }] },
    'the style lands on the opener in the object shape');
  assert.deepEqual(log, ['render', 'change', 'focus:ul'], 'render, change, then the caret goes back to the list');
  assert.deepEqual(tools.stateOf(host.current[0], 0), { ordered: false, style: 'square', depth: 0 }, 'the re-rendered block reports the style');
  assert.match(host.current[0].className, /list-square/, 'and wears the class on its root tag');
  log.length = 0;
  tools.onAction(host.current[0], 0, 'ordered');
  assert.deepEqual(blocks[1].items, ['a', 'b'], 'a kind flip drops the mismatched style and the flat shape comes back');
  assert.equal(blocks[1].ordered, true);
  log.length = 0;
  tools.onAction(host.current[0], 0, 'unordered');
  tools.onAction(host.current[0], 0, 'unordered');
  assert.deepEqual(log, ['render', 'change', 'focus:ul'], 'a no-op click renders nothing');
  tools.onAction({ dataset: { id: '999' } }, 0, 'ordered');
  assert.deepEqual(log, ['render', 'change', 'focus:ul'], 'an unknown block is ignored');
});

test('listBarTools (editor): Remove list splices one paragraph per item in the list\'s place', () => {
  const blocks = [{ _id: 1, type: 'paragraph', text: 'p' }, { _id: 2, type: 'list', ordered: true, items: [{ text: 'a', depth: 0, ordered: true, style: 'lower-alpha' }, { text: 'b', depth: 1, ordered: false }, { text: '', depth: 0, ordered: true }] }, { _id: 3, type: 'paragraph', text: 'q' }];
  const { host, log } = fakeEditor(blocks);
  listBarTools(host).onAction(host.current[0], 1, 'unwrap');
  assert.deepEqual(blocks.map((b) => [b.type, b.text ?? null]), [['paragraph', 'p'], ['paragraph', 'a'], ['paragraph', 'b'], ['paragraph', 'q']], 'the nested item flattens, the empty one goes');
  assert.deepEqual(log, ['render', 'change', `focusBlock:${blocks[1]._id}`], 'the caret lands on the first new paragraph');
  const empty = [{ _id: 5, type: 'list', ordered: false, items: [''] }];
  const e2 = fakeEditor(empty);
  listBarTools(e2.host).onAction(e2.host.current[0], 0, 'unwrap');
  assert.deepEqual(empty.map((b) => [b.type, b.text]), [['paragraph', '']], 'an all-empty list leaves one empty paragraph, never nothing');
});

test('the selection toolbar offers the list bar as an opt-in, follows the caret, and the stub carries the method', () => {
  const src = read('client-ui/src/selection-toolbar.mjs');
  assert.ok(src.includes('imageTools = null, listTools = null,'), 'opt-in beside the image bar');
  assert.ok(src.includes('showImageTools() {}, showListTools() {} };'), 'the stub keeps the shape');
  assert.ok(src.includes('showListTools(el, index) { showListTools(el, index); },'), 'the real one');
  // The caret trigger: the list bar is decided BEFORE the collapsed-selection bail-out, which itself is unchanged.
  assert.ok(src.includes("if (!sel || sel.isCollapsed || sel.rangeCount === 0) { hideTb(); if (list) showListTools(list); return; }"), 'a caret alone shows the list bar and still hides the B/I bar');
  assert.ok(src.includes("if (!el) { hideTb(); if (list) showListTools(list); return; }"));
  assert.ok(src.includes('if (list) showListTools(list, undefined, { lift: !!tb && tb.style.display !== \'none\' });'), 'a selection shows both bars, the list bar lifted a row');
  // Placement: above the LIST BLOCK, right-aligned, pinned to the viewport top once the block has scrolled past.
  // Measured twice on 2026-09-15: a bar above the caret's item took the click meant for the item before it, and a
  // left-aligned bar above the block hid a one-line paragraph before the list.
  assert.ok(src.includes('place(lb, blockRect, true);'), 'the bar sits above the list block');
  assert.ok(!src.includes("querySelectorAll('li')[idx]"), 'never above the item under the caret');
  assert.ok(src.includes('const pinned = blockRect.top < 48;') && src.includes('if (pinned) lb.style.top = `${8 - hr.top}px`;'), 'a scrolled-past block pins the bar to the viewport top');
  assert.ok(src.includes("lb.style.left = 'auto';") && src.includes('lb.style.right = `${Math.max(0, hr.right - blockRect.right)}px`;'), 'right-aligned to the block by its right edge');
  assert.ok(src.indexOf("lb.style.right = ") < src.indexOf('const extra = lb.offsetHeight - 38;'), 'the wrap shift measures the height AFTER the horizontal placement');
  assert.ok(src.includes('if (extra > 0 && !pinned)') && src.includes('if (lift && !pinned)'), 'a pinned bar ignores the wrap and lift shifts');
  assert.ok(src.includes("if (act === 'unwrap') hideListBar();"), 'Remove list puts the bar away first');
  assert.ok(src.includes('listTools.onAction(target, index, act)'), 'a click hands the item index and the action to the host');
  assert.ok(src.includes("if (lb && lb.style.display !== 'none' && !(path.includes(lb) || (lbEl && path.includes(lbEl)))) hideListBar();"), 'a click outside the list hides it');
  assert.ok(src.includes('hide() { hideTb(); hidePanel(); hideImagePanel(); hideImageBar(); hideListBar(); },'));
  assert.ok(src.includes('lb?.remove();') && src.includes('lb = null; lbEl = null;'), 'destroy releases it');
  assert.ok(src.includes('.gbti-listbar { flex-wrap: wrap; max-width: calc(100% - 8px); }'), 'the bar wraps on a narrow column like the image bar');
  const tb = createSelectionToolbar({ root: null, host: () => null, editableOf: () => null, listTools: {} });
  assert.doesNotThrow(() => tb.showListTools(null, 0), 'the stub is inert');
  assert.ok(src.split('\n').length <= 900, 'selection-toolbar.mjs stays under the 900-line cap');
});

test('the editor passes the list bar hooks and stays under the cap; the Preview wires the same bar through its splice path', () => {
  const de = read('client-ui/src/elements/gbti-doc-editor.mjs');
  assert.ok(de.includes("import { listTabKeydown, listBarTools } from '../list-editing.mjs';"), 'the hooks come from list-editing.mjs');
  assert.ok(de.includes('listTools: listBarTools({'), 'and are passed to the shared toolbar');
  assert.ok(de.includes('selection: () => (this.root.getSelection ? this.root.getSelection() : document.getSelection()),'), 'over the shadow root selection');
  for (const f of ['client-ui/src/elements/gbti-doc-editor.mjs', 'client-ui/src/doc-editor-css.mjs', 'client-ui/src/list-editing.mjs', 'client-ui/src/block-commit.mjs', 'client/src/list-items.mjs']) {
    const lines = read(f).split('\n').length;
    assert.ok(lines <= 900, `${f} is ${lines} lines; the cap is 900`);
  }
  const pv = read('src/pages/workbench/preview.astro');
  assert.ok(pv.includes('listTools: {'), 'the Preview opts in');
  assert.ok(pv.includes("return el && (el.tagName === 'UL' || el.tagName === 'OL') ? el : null;"), 'listOf is the contenteditable list block under the caret');
  assert.ok(pv.includes('return b ? listRunState(b.items, !!b.ordered, index) : '), 'stateOf reads the SOURCE through the shared run state');
  assert.ok(pv.includes("return action === 'unwrap' ? planListUnwrap(src) : planListAttrs(src, index, action);"), 'a click rewrites the block through spliceBlock, text edits folded in first');
  assert.ok(pv.includes("const edited = applyBlockEdit(before.join('\\n'), readBlockDom(el));\n                const src = (edited || before).join('\\n');"), 'the fold-in precedes the planner');
  const hook = pv.slice(pv.indexOf('listTools: {'), pv.indexOf('return action === \'unwrap\''));
  assert.ok(hook.includes('delete el.dataset.pvSnap;'), 'the replaced node must not commit a stale read on blur (the Tab handler\'s rule)');
  assert.ok(pv.includes("if (again) { again.focus(); if (li) caretAtEndOfItem(li, document.getSelection()); }"), 'the caret goes back to the same item, which re-shows the bar');
  assert.ok(pv.includes("const { listRunState } = await import('../../../client/src/list-items.mjs');"));
  assert.ok(pv.includes('listBlockOf, planListAttrs, planListUnwrap } = await import(\'../../../client-ui/src/block-commit.mjs\');'));
});
