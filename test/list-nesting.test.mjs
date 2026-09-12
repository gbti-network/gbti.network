// Nested lists (owner report, 2026-09-12): a numbered list with bulleted details under each item came back as one
// flat numbered list after a save from the WorkBench editor, because the block model was flat (indentation stripped
// on read, never written back) and every save rewrites the body through it. One node-free core now carries depth
// and marker per item for the block editor, the client renderer and the Preview's read-back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { fromHtml } from 'hast-util-from-html';
import { toHtml as toHtmlRaw } from 'hast-util-to-html';
import {
  takeListRun, serializeListItems, listHtml, normalizeListItems, isFlatList, indentListItem, isListLine,
} from '../client/src/list-items.mjs';
import { renderMarkdown, renderMarkdownWithBlocks } from '../client/src/markdown.mjs';
import { parseBlocks, serializeBlocks } from '../client-ui/src/markdown-blocks.mjs';
import { readBlockDom, applyBlockEdit, planListIndent, readListDom } from '../client-ui/src/block-commit.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const toHtml = (n) => toHtmlRaw(n, { characterReferences: { useNamedReferences: true } });

// The owner's list shape: numbered apps, bulleted details under each.
const OWNER = ['1. SavePoint Radio Instance', '   - http://savepoint.fm', '2. Browser accessible SNES emulator', '   - https://neko.m1k1o.net/', '   - More details coming soon.', '3. Starlight Surveillance System'];
const OWNER_MD = OWNER.join('\n');

test('takeListRun: depth from indentation, a marker per item, a top-level marker change ends the run', () => {
  const run = takeListRun(OWNER, 0);
  assert.deepEqual(run.items.map((it) => [it.depth, it.ordered, it.text.slice(0, 8)]),
    [[0, true, 'SavePoin'], [1, false, 'http://s'], [0, true, 'Browser '], [1, false, 'https://'], [1, false, 'More det'], [0, true, 'Starligh']]);
  assert.equal(run.next, 6);
  assert.deepEqual(takeListRun(['- a', '  - b', '    - c', '- d'], 0).items.map((it) => it.depth), [0, 1, 2, 0], 'two-space nesting and a jump back two levels');
  assert.deepEqual(takeListRun(['- a', '\t- b'], 0).items.map((it) => it.depth), [0, 1], 'a tab indents');
  assert.deepEqual(takeListRun(['- a', '1. b', '- c'], 0), { items: [{ text: 'a', depth: 0, ordered: false }], next: 1 }, 'a marker change at the top level starts a new list');
  assert.deepEqual(takeListRun(['1. a', '   - b', '   1. c'], 0).items.map((it) => [it.depth, it.ordered]), [[0, true], [1, false], [1, true]], 'a marker change below the top level stays in the run');
  assert.deepEqual(takeListRun(['- a', 'text', '- b'], 0).next, 1, 'a non-list line ends the run');
  assert.equal(isListLine('   - x'), true);
  assert.equal(isListLine('-x'), false);
});

test('serializeListItems: a child is indented by its parent marker width, numbers restart per run, and it round-trips', () => {
  assert.deepEqual(serializeListItems(takeListRun(OWNER, 0).items, true), OWNER, 'the owner shape round-trips exactly');
  assert.deepEqual(serializeListItems(['a', 'b'], false), ['- a', '- b'], 'plain strings are a flat list with the list marker');
  assert.deepEqual(serializeListItems(['a', 'b'], true), ['1. a', '2. b']);
  assert.deepEqual(serializeListItems([{ text: 'a', depth: 0 }, { text: 'b', depth: 1 }, { text: 'c', depth: 2, ordered: true }, { text: 'd', depth: 2, ordered: true }, { text: 'e', depth: 0 }], true),
    ['1. a', '   - b', '     1. c', '     2. d', '2. e'], 'three levels: 3 spaces under "1. ", 2 more under "- "; the second top item is 2.');
  const ten = serializeListItems(Array.from({ length: 11 }, (_, i) => ({ text: `i${i}`, depth: i === 10 ? 1 : 0 })), true);
  assert.equal(ten[9], '10. i9');
  assert.equal(ten[10], '    - i10', 'a child of "10. " is indented four');
  const three = ['- a', '  - b', '    - c', '  - d', '- e'];
  assert.deepEqual(serializeListItems(takeListRun(three, 0).items, false), three);
});

test('normalizeListItems clamps a depth jump and gives top-level items the list marker; isFlatList knows the plain case', () => {
  assert.deepEqual(normalizeListItems([{ text: 'a', depth: 3 }, { text: 'b', depth: 5, ordered: true }], true),
    [{ text: 'a', depth: 0, ordered: true }, { text: 'b', depth: 1, ordered: true }]);
  assert.equal(isFlatList(['a', 'b']), true);
  assert.equal(isFlatList([{ text: 'a', depth: 0, ordered: true }, { text: 'b', depth: 0, ordered: true }]), true);
  assert.equal(isFlatList([{ text: 'a', depth: 0, ordered: true }, { text: 'b', depth: 1, ordered: false }]), false);
  assert.equal(isFlatList([]), true);
});

test('listHtml nests children inside their parent item, one tag per run', () => {
  assert.equal(listHtml(takeListRun(OWNER, 0).items, (t) => t, { ordered: true }),
    '<ol><li>SavePoint Radio Instance<ul><li>http://savepoint.fm</li></ul></li><li>Browser accessible SNES emulator<ul><li>https://neko.m1k1o.net/</li><li>More details coming soon.</li></ul></li><li>Starlight Surveillance System</li></ol>');
  assert.equal(listHtml(['a', 'b'], (t) => t.toUpperCase()), '<ul><li>A</li><li>B</li></ul>');
  assert.equal(listHtml([{ text: 'a', depth: 0 }, { text: 'b', depth: 1, ordered: true }, { text: 'c', depth: 1, ordered: false }], (t) => t),
    '<ul><li>a<ol><li>b</li></ol><ul><li>c</li></ul></li></ul>', 'a marker change below the top level is a new nested list in the same item');
  assert.equal(listHtml(['a'], (t) => t, { ordered: true, rootAttrs: 'class="ce" data-id="x"' }), '<ol class="ce" data-id="x"><li>a</li></ol>', 'root attributes land on the outermost tag only');
});

test('indentListItem: the first item never indents, a depth is clamped, children travel with their parent', () => {
  assert.equal(indentListItem(['a', 'b'], 0, 1), null);
  assert.deepEqual(indentListItem(['a', 'b', 'c'], 1, 1).map((it) => it.depth), [0, 1, 0]);
  assert.deepEqual(indentListItem([{ text: 'a', depth: 0 }, { text: 'b', depth: 1 }], 1, 1), null, 'no deeper than one below the item before it');
  assert.deepEqual(indentListItem(takeListRun(OWNER, 0).items, 2, 1, true).map((it) => it.depth), [0, 1, 1, 2, 2, 0], 'the second app and its details move together');
  assert.deepEqual(indentListItem(takeListRun(OWNER, 0).items, 1, -1, true).map((it) => it.depth), [0, 0, 0, 1, 1, 0]);
  assert.equal(indentListItem(['a', 'b'], 1, -1), null, 'already at the top');
  assert.equal(indentListItem(['a', 'b'], 5, 1), null);
});

test('the block parser keeps strings for a flat list and objects for a nested one; both serialize', () => {
  assert.deepEqual(parseBlocks('- a\n- b'), [{ type: 'list', ordered: false, items: ['a', 'b'] }], 'the shape every reader has always seen');
  assert.deepEqual(parseBlocks('1. a\n2. b'), [{ type: 'list', ordered: true, items: ['a', 'b'] }]);
  const nested = parseBlocks(OWNER_MD);
  assert.equal(nested.length, 1);
  assert.equal(nested[0].ordered, true);
  assert.deepEqual(nested[0].items[1], { text: 'http://savepoint.fm', depth: 1, ordered: false });
  assert.equal(serializeBlocks(nested), OWNER_MD, 'the owner shape round-trips through the block model');
  assert.equal(parseBlocks('- x\n1. y').length, 2, 'a top-level marker change is two blocks');
  assert.equal(serializeBlocks(parseBlocks('- a\n  - b\n    - c\n  - d\n- e')), '- a\n  - b\n    - c\n  - d\n- e');
});

test('the client renderer nests the list as one block with the full source range', () => {
  const r = renderMarkdownWithBlocks(`p\n\n${OWNER_MD}\n\nq`);
  assert.match(r.html, /<ol data-blk="1"><li>SavePoint Radio Instance<ul><li>http:\/\/savepoint\.fm<\/li><\/ul><\/li>/);
  assert.deepEqual(r.blocks, [{ start: 0, end: 0 }, { start: 2, end: 7 }, { start: 9, end: 9 }]);
  assert.equal(renderMarkdown('- x\n1. y'), '<ul><li>x</li></ul>\n<ol><li>y</li></ol>', 'a top-level marker change is two lists');
  assert.equal(renderMarkdown('- **a**\n  - [l](https://x.test)'), '<ul><li><strong>a</strong><ul><li><a href="https://x.test" target="_blank" rel="noopener">l</a></li></ul></li></ul>', 'inline markdown still renders inside items');
  assert.equal(renderMarkdown('- a\n- b\n\ntext'), '<ul><li>a</li><li>b</li></ul>\n<p>text</p>', 'a flat list renders as before');
});

// The Preview's read-back, driven over a parsed HTML tree wearing the DOM subset it reads.
const adapt = (h) => {
  if (h.type === 'text') return { nodeType: 3, textContent: h.value };
  if (h.type !== 'element') return { nodeType: 8 };
  const el = { nodeType: 1, tagName: h.tagName.toUpperCase(), childNodes: h.children.map(adapt),
    get children() { return this.childNodes.filter((c) => c.nodeType === 1); },
    get innerHTML() { return toHtml(h.children); },
    get textContent() { return toHtml(h.children).replace(/<[^>]+>/g, ''); },
    querySelectorAll(sel) { const out = []; const walk = (n) => { for (const c of n.children || []) { if (c.tagName === sel.toUpperCase()) out.push(c); walk(c); } }; walk(this); return out; },
  };
  return el;
};
const dom = (html) => adapt(fromHtml(html, { fragment: true }).children[0]);

test('the read-back keeps nesting: each item its own text, depth and marker', () => {
  const el = dom(listHtml(takeListRun(OWNER, 0).items, (t) => t, { ordered: true }));
  const items = readListDom(el, (h) => h);
  assert.deepEqual(items.map((it) => [it.depth, it.ordered]), [[0, true], [1, false], [0, true], [1, false], [1, false], [0, true]]);
  assert.equal(items[0].text, 'SavePoint Radio Instance', 'the nested list is not part of the parent item text');
  const read = readBlockDom(el);
  assert.equal(read.kind, 'list');
  assert.deepEqual(applyBlockEdit(OWNER_MD, read), OWNER, 'an untouched nested list commits back to the same lines');
  const edited = readBlockDom(dom('<ol><li>SavePoint Radio Instance<ul><li>http://savepoint.fm (live)</li></ul></li><li>Browser accessible SNES emulator</li></ol>'));
  assert.deepEqual(applyBlockEdit('1. SavePoint Radio Instance\n   - http://savepoint.fm\n2. Browser accessible SNES emulator', edited),
    ['1. SavePoint Radio Instance', '   - http://savepoint.fm (live)', '2. Browser accessible SNES emulator'], 'an edit inside a nested item keeps the nesting');
  assert.deepEqual(applyBlockEdit('- a\n- b', readBlockDom(dom('<ul><li>a</li><li>b changed</li></ul>'))), ['- a', '- b changed'], 'a flat list still round-trips as strings');
});

test('planListIndent: Tab and Shift+Tab rewrite one list block through the source', () => {
  assert.deepEqual(planListIndent('- a\n- b\n- c', 1, 1), ['- a', '  - b', '- c']);
  assert.deepEqual(planListIndent('- a\n  - b\n- c', 1, -1), ['- a', '- b', '- c']);
  assert.equal(planListIndent('- a\n- b', 0, 1), null, 'the first item never indents');
  assert.equal(planListIndent('A paragraph.', 0, 1), null, 'never over a paragraph');
  assert.equal(planListIndent('- a\n\n- b', 1, 1), null, 'never over two blocks');
  assert.deepEqual(planListIndent(OWNER_MD, 2, 1), ['1. SavePoint Radio Instance', '   - http://savepoint.fm', '   - Browser accessible SNES emulator', '     - https://neko.m1k1o.net/', '     - More details coming soon.', '2. Starlight Surveillance System'],
    'the second app nests under the first with its details, and the numbering follows');
});

test('what the serializer writes is what the site renders as nesting', async () => {
  const md = serializeBlocks(parseBlocks(OWNER_MD));
  const html = String(await unified().use(remarkParse).use(remarkGfm).use(remarkRehype).use(rehypeStringify).process(md));
  // remark-gfm autolinks the bare URLs, so an item may wrap its text in an anchor.
  assert.match(html, /<ol>\s*<li>SavePoint Radio Instance\s*<ul>\s*<li>(<a [^>]*>)?http:\/\/savepoint\.fm(<\/a>)?<\/li>\s*<\/ul>\s*<\/li>/, html);
  assert.match(html, /<li>Browser accessible SNES emulator\s*<ul>\s*<li>(<a [^>]*>)?https:\/\/neko\.m1k1o\.net\/(<\/a>)?<\/li>\s*<li>More details coming soon\.<\/li>\s*<\/ul>\s*<\/li>/, html);
});

test('the editor and the Preview wire Tab and Shift+Tab, and both read lists back through the shared walk', () => {
  const de = read('client-ui/src/elements/gbti-doc-editor.mjs');
  assert.ok(de.includes("this.$$('.ce[data-edit=\"list\"]').forEach((el) => el.addEventListener('keydown', (e) => {"), 'Tab in a list block');
  assert.ok(de.includes('listTabKeydown(e, { el, ordered: !!b.ordered,'), 'through the shared list-editing helper');
  const le = read('client-ui/src/list-editing.mjs');
  assert.ok(le.includes("if (!e || e.key !== 'Tab' || !el) return false;") && le.includes('indentListItem(current, index, e.shiftKey ? -1 : 1, !!ordered)'), 'Shift+Tab outdents');
  assert.ok(de.split('\n').length <= 900, 'the editor stays under the 900-line cap');
  assert.ok(de.includes("else if (f === 'list') { const items = readListDom(el, (h) => inlineHtmlToMd(h));"), 'the editor reads lists through the shared walk');
  assert.ok(de.includes('return listHtml(items, inlineMdToHtml, { ordered: !!b.ordered, rootAttrs:'), 'and renders them nested');
  assert.ok(!de.includes("Array.from(el.querySelectorAll('li')).map((li) => inlineHtmlToMd(li.innerHTML))"), 'the flat read is gone');
  const pv = read('src/pages/workbench/preview.astro');
  assert.ok(pv.includes("if (ev.key === 'Tab' && editing && (el.tagName === 'UL' || el.tagName === 'OL')) {"), 'the Preview handles Tab in a list');
  assert.ok(pv.includes("return planListIndent((edited || before).join('\\n'), index, delta);"), 'through the splice path, text edits folded in first');
  const md = read('client/src/markdown.mjs');
  assert.ok(!md.includes('listBuf.push('), 'the renderer no longer builds flat <li> strings');
  assert.ok(md.includes('emit(listHtml(run.items,'), 'it emits the nested list as one block');
});

test('a nested list takes the marker of its OWN list, and every body keeps it close under its parent item', () => {
  // The drive on the Preview showed the bulleted details under a numbered app as "1.", "1. 2.": the descendant rule
  // `.prose-gbti ol li` also matched a bullet list nested inside the numbered one and, written last, won.
  const src = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  const prose = src('src/components/blog/Prose.astro');
  assert.ok(prose.includes('.prose-gbti ul > li { list-style: disc; }'), 'bullets from the child combinator');
  assert.ok(prose.includes('.prose-gbti ol > li { list-style: decimal; }'), 'numbers from the child combinator');
  assert.ok(!/\.prose-gbti (ul|ol) li \{/.test(prose), 'no descendant list-style rule is left');
  assert.ok(prose.includes('.prose-gbti li > ul, .prose-gbti li > ol { margin: 0.25em 0 0; }'), 'a nested list sits close');
  assert.ok(src('client-ui/src/elements/gbti-reader.mjs').includes('.body li > ul,.body li > ol { margin:.25em 0 0; }'), 'reader');
  assert.ok(src('client-ui/src/elements/gbti-locked-content.mjs').includes('.unlocked li > ul, .unlocked li > ol { margin: .25em 0 0 1.2em; }'), 'locked body');
});
