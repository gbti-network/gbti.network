// sow-322: list marker styles. The item that opens a list run may end with a brace group naming the style
// (`- a {square}`, `1. a {lower-alpha}`: client/src/list-attrs.mjs); the list core carries it on that item only;
// the three renderers emit an allow-listed list-* class for it; the plain-text renderers drop it; and a click on
// the list bar means one thing on both surfaces (applyListAction). Every existing list is byte-identical: the
// two defaults write nothing and no corpus item carries a style word.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { fromHtml } from 'hast-util-from-html';
import { toHtml as toHtmlRaw } from 'hast-util-to-html';
import {
  LIST_STYLE_WORDS, LIST_STYLE_DEFAULTS, LIST_STYLE_CLASS_RE, styleKind, isDefaultStyle, normalizeListStyle,
  listStyleClass, listStyleSuffix, listStyleFromClass, splitListSuffix, stripListStyleSuffix,
} from '../client/src/list-attrs.mjs';
import {
  takeListRun, serializeListItems, listHtml, normalizeListItems, isFlatList, indentListItem, opensRun, runOf,
  listRunState, applyListAction,
} from '../client/src/list-items.mjs';
import { renderMarkdown } from '../client/src/markdown.mjs';
import { parseBlocks, serializeBlocks } from '../client-ui/src/markdown-blocks.mjs';
import { readBlockDom, applyBlockEdit, readListDom, planListIndent, listBlockOf, planListAttrs, planListUnwrap } from '../client-ui/src/block-commit.mjs';
import { listStyleProseCss } from '../client-ui/src/list-style-ui.mjs';
import { remarkContentBlocks, applyListStyle } from '../src/lib/remark-content-blocks.mjs';
import { sanitizeSchema, rehypeStyleAllowlist } from '../src/lib/markdown-sanitize.mjs';
import { mdToPlain, mdToHtml } from '../membership/markdown-plain.mjs';
import { bioExcerpt } from '../src/lib/members-directory.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const CLASSES = ['list-circle', 'list-square', 'list-lower-alpha', 'list-upper-alpha', 'list-lower-roman', 'list-upper-roman'];
const STYLED = ['1. Apps {upper-roman}', '   - savepoint {square}', '   - neko', '2. Cameras', '   - reolink', '   1. wired'];

// ---- the words --------------------------------------------------------------------------------------------------

test('the vocabulary: two kinds, a default each, and a class for every non-default word', () => {
  assert.deepEqual(LIST_STYLE_WORDS, ['disc', 'circle', 'square', 'decimal', 'lower-alpha', 'upper-alpha', 'lower-roman', 'upper-roman']);
  assert.deepEqual(LIST_STYLE_DEFAULTS, { bullet: 'disc', number: 'decimal' });
  assert.equal(styleKind('square'), 'bullet');
  assert.equal(styleKind('lower-roman'), 'number');
  assert.equal(styleKind('banana'), null);
  assert.equal(styleKind('Square'), null, 'the words are lower-case');
  assert.equal(isDefaultStyle('disc'), true);
  assert.equal(isDefaultStyle('decimal'), true);
  assert.equal(isDefaultStyle('circle'), false);
  assert.equal(isDefaultStyle('nope'), false);
  assert.equal(normalizeListStyle('square', false), 'square');
  assert.equal(normalizeListStyle('square', true), null, 'a bullet word on a numbered run is no style');
  assert.equal(normalizeListStyle('lower-alpha', false), null, 'and a number word on a bullet run');
  assert.equal(normalizeListStyle('disc', false), null, 'the default is no style');
  assert.equal(normalizeListStyle('decimal', true), null);
  assert.equal(normalizeListStyle('banana', false), null);
  for (const c of CLASSES) assert.ok(LIST_STYLE_CLASS_RE.test(c), c);
  for (const c of ['list-disc', 'list-decimal', 'list-evil', 'list-square ', 'contains-task-list', 'list-square list-circle']) assert.ok(!LIST_STYLE_CLASS_RE.test(c), c);
  assert.equal(listStyleClass('square'), 'list-square');
  assert.equal(listStyleClass('disc'), null, 'the default has no class');
  assert.equal(listStyleClass(null), null);
  assert.equal(listStyleSuffix('upper-alpha', true), '{upper-alpha}');
  assert.equal(listStyleSuffix('upper-alpha', false), '', 'the wrong kind writes nothing');
  assert.equal(listStyleSuffix('decimal', true), '', 'the default writes nothing');
  assert.equal(listStyleFromClass('ce ce-list list-square'), 'square');
  assert.equal(listStyleFromClass(['contains-task-list', 'list-lower-roman']), 'lower-roman');
  assert.equal(listStyleFromClass('ce ce-list'), null);
});

test('splitListSuffix: a trailing word of the right kind with text before it, and nothing else', () => {
  assert.deepEqual(splitListSuffix('First item {square}', false), { style: 'square', rest: 'First item' });
  assert.deepEqual(splitListSuffix('First item{square}', false), { style: 'square', rest: 'First item' }, 'no space needed');
  assert.deepEqual(splitListSuffix('First item {disc}  ', false), { style: null, rest: 'First item' }, 'the default is recognised and stripped, and carries nothing');
  assert.deepEqual(splitListSuffix('a {lower-alpha}', true), { style: 'lower-alpha', rest: 'a' });
  assert.equal(splitListSuffix('a {lower-alpha}', false), null, 'a number word on a bullet run is the author\'s text');
  assert.equal(splitListSuffix('a {square}', true), null, 'a bullet word on a numbered run likewise');
  assert.equal(splitListSuffix('a {note}', false), null, 'an unknown word');
  assert.equal(splitListSuffix('{square}', false), null, 'a bare group is a paragraph of braces, not an empty styled item');
  assert.equal(splitListSuffix('   {square}', false), null);
  assert.deepEqual(splitListSuffix('{square}', false, { bare: true }), { style: 'square', rest: '' }, 'unless the caller knows content precedes it');
  assert.equal(splitListSuffix('![a](./x.png){full}', false), null, 'an image\'s own layout suffix is not a list style');
  assert.deepEqual(splitListSuffix('![a](./x.png){full} {square}', false), { style: 'square', rest: '![a](./x.png){full}' }, 'but a list style may follow it');
  assert.equal(splitListSuffix('a {square} b', false), null, 'the group must end the text');
  assert.equal(splitListSuffix('', false), null);
});

test('stripListStyleSuffix: a list LINE loses a suffix of its marker\'s kind and nothing else changes', () => {
  assert.equal(stripListStyleSuffix('- a {square}'), '- a');
  assert.equal(stripListStyleSuffix('   1. a {upper-roman}'), '   1. a');
  assert.equal(stripListStyleSuffix('* a {circle}'), '* a', 'a star bullet');
  assert.equal(stripListStyleSuffix('1) a {lower-alpha}'), '1) a', 'a paren number (the plain renderer accepts it)');
  assert.equal(stripListStyleSuffix('- a {lower-alpha}'), '- a {lower-alpha}', 'the wrong kind stays');
  assert.equal(stripListStyleSuffix('- a {note}'), '- a {note}');
  assert.equal(stripListStyleSuffix('- {square}'), '- {square}', 'a bare group stays');
  assert.equal(stripListStyleSuffix('A paragraph {square}'), 'A paragraph {square}', 'not a list line');
  assert.equal(stripListStyleSuffix(''), '');
});

// ---- the core -----------------------------------------------------------------------------------------------------

test('takeListRun reads a style off the item that opens a run, and leaves a suffix anywhere else as text', () => {
  const run = takeListRun(STYLED, 0);
  assert.deepEqual(run.items, [
    { text: 'Apps', depth: 0, ordered: true, style: 'upper-roman' },
    { text: 'savepoint', depth: 1, ordered: false, style: 'square' },
    { text: 'neko', depth: 1, ordered: false },
    { text: 'Cameras', depth: 0, ordered: true },
    { text: 'reolink', depth: 1, ordered: false },
    { text: 'wired', depth: 1, ordered: true },
  ], 'each run opener carries its own style; the key is absent everywhere else');
  assert.deepEqual(takeListRun(['- a', '- b {square}'], 0).items, [{ text: 'a', depth: 0, ordered: false }, { text: 'b {square}', depth: 0, ordered: false }],
    'a suffix on the second item is the author\'s text');
  assert.deepEqual(takeListRun(['- a {disc}', '- b'], 0).items, [{ text: 'a', depth: 0, ordered: false }, { text: 'b', depth: 0, ordered: false }],
    'the default is stripped and carries nothing');
  assert.deepEqual(takeListRun(['1. a {square}'], 0).items, [{ text: 'a {square}', depth: 0, ordered: true }], 'the wrong kind stays text');
  assert.deepEqual(takeListRun(['- {square}'], 0).items, [{ text: '{square}', depth: 0, ordered: false }], 'a bare group stays text');
  assert.deepEqual(takeListRun(['- a', '  - b', '  1. c {lower-alpha}'], 0).items.map((it) => it.style || null), [null, null, 'lower-alpha'],
    'a marker change below the top level opens a run that may carry its own style');
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => opensRun(run.items, i)), [true, true, false, false, true, true]);
  assert.deepEqual(runOf(run.items, 3), [0, 3], 'the top level is one run');
  assert.deepEqual(runOf(run.items, 2), [1, 2]);
  assert.deepEqual(runOf(run.items, 5), [5]);
});

test('serializeListItems writes the suffix on run openers only, the default writes nothing, and it is idempotent', () => {
  assert.deepEqual(serializeListItems(takeListRun(STYLED, 0).items, true), STYLED, 'the styled shape round-trips exactly');
  for (const word of LIST_STYLE_WORDS) {
    const ordered = styleKind(word) === 'number';
    const lines = serializeListItems([{ text: 'a', depth: 0, style: word }, { text: 'b', depth: 0 }], ordered);
    const expect = isDefaultStyle(word) ? `${ordered ? '1. ' : '- '}a` : `${ordered ? '1. ' : '- '}a {${word}}`;
    assert.equal(lines[0], expect, word);
    assert.deepEqual(serializeListItems(takeListRun(lines, 0).items, ordered), lines, `${word} round-trips`);
  }
  assert.deepEqual(serializeListItems([{ text: 'a', depth: 0 }, { text: 'b', depth: 0, style: 'square' }], false), ['- a', '- b'],
    'a style on a non-opener is dropped rather than written where the parser would read text');
  assert.deepEqual(serializeListItems([{ text: '', depth: 0, style: 'square' }, { text: 'b', depth: 0 }], false), ['- ', '- b'],
    'an empty opener drops its style rather than writing a bare {square}');
  assert.deepEqual(serializeListItems([{ text: 'a', depth: 0, style: 'square' }], true), ['1. a'], 'the wrong kind is dropped');
  assert.deepEqual(serializeListItems(['a', 'b'], false), ['- a', '- b'], 'plain strings are untouched');
});

test('normalizeListItems keeps a style only on an opener of the matching kind and never emits the key otherwise', () => {
  assert.deepEqual(normalizeListItems([{ text: 'a', depth: 0, style: 'square' }, { text: 'b', depth: 0, style: 'circle' }], false),
    [{ text: 'a', depth: 0, ordered: false, style: 'square' }, { text: 'b', depth: 0, ordered: false }]);
  assert.deepEqual(normalizeListItems([{ text: 'a', depth: 0, style: 'square' }], true), [{ text: 'a', depth: 0, ordered: true }], 'a kind mismatch drops it');
  assert.deepEqual(normalizeListItems([{ text: 'a', depth: 0, style: 'disc' }], false), [{ text: 'a', depth: 0, ordered: false }], 'the default is no style');
  assert.deepEqual(normalizeListItems(['a', 'b'], true), [{ text: 'a', depth: 0, ordered: true }, { text: 'b', depth: 0, ordered: true }], 'the unstyled shape is exactly what it was');
  assert.equal(isFlatList([{ text: 'a', depth: 0, ordered: false, style: 'square' }]), false, 'a style needs the object shape');
  assert.equal(isFlatList([{ text: 'a', depth: 0, ordered: false }]), true);
});

test('listHtml puts the class on the run\'s own tag, merged into the root attributes as ONE class attribute', () => {
  assert.equal(listHtml(takeListRun(STYLED, 0).items, (t) => t, { ordered: true }),
    '<ol class="list-upper-roman"><li>Apps<ul class="list-square"><li>savepoint</li><li>neko</li></ul></li><li>Cameras<ul><li>reolink</li></ul><ol><li>wired</li></ol></li></ol>');
  const root = listHtml([{ text: 'a', depth: 0, style: 'square' }], (t) => t, { rootAttrs: 'class="ce ce-list" contenteditable="true" data-id="7"' });
  assert.equal(root, '<ul class="ce ce-list list-square" contenteditable="true" data-id="7"><li>a</li></ul>');
  assert.equal((root.match(/class=/g) || []).length, 1, 'never a second class attribute');
  assert.equal(listHtml([{ text: 'a', depth: 0, style: 'square' }], (t) => t, { rootAttrs: 'data-id="7"' }), '<ul data-id="7" class="list-square"><li>a</li></ul>');
  assert.equal(listHtml(['a'], (t) => t), '<ul><li>a</li></ul>', 'no style, no class attribute at all');
});

test('indentListItem: a style belongs to the run, so it moves to the new opener and never travels with the item', () => {
  const base = takeListRun(['1. a', '   - b {square}', '   - c'], 0).items;
  assert.deepEqual(serializeListItems(indentListItem(base, 1, -1, true), true), ['1. a', '2. b', '   - c {square}'],
    'Shift+Tab on the opener: b joins the numbered run unstyled, c opens the bullet run and takes square');
  assert.deepEqual(serializeListItems(indentListItem(base, 2, 1, true), true), ['1. a', '   - b {square}', '     - c'],
    'Tab on c: nothing to move, the run keeps its style');
  const flat = takeListRun(['- a {square}', '- b', '- c'], 0).items;
  assert.deepEqual(serializeListItems(indentListItem(flat, 1, 1, false), false), ['- a {square}', '  - b', '- c'], 'the opener stays, the style stays');
  const fresh = takeListRun(['- a', '  - b {circle}', '  1. c {lower-alpha}', '  2. d'], 0).items;
  assert.deepEqual(serializeListItems(indentListItem(fresh, 2, 1, false), false), ['- a', '  - b {circle}', '    1. c', '  1. d {lower-alpha}'],
    'Tab on the opener of a nested numbered run: c opens a fresh level unstyled, d opens the numbered run and takes lower-alpha');
  const joins = takeListRun(['- a', '  - b {circle}', '    - b1', '  1. c {lower-alpha}'], 0).items;
  assert.deepEqual(serializeListItems(indentListItem(joins, 3, 1, false), false), ['- a', '  - b {circle}', '    - b1', '    - c'],
    'c indented into b1\'s run takes that run\'s marker and drops its own style; its old run is gone, so the style is too');
  assert.deepEqual(takeListRun(['- a', '  - b', '- c {square}'], 0).items[2].text, 'c {square}', 'a suffix on a top-level non-opener is text, so there is nothing to move');
  const lone = takeListRun(['- a', '  - b {circle}', '- c'], 0).items;
  assert.deepEqual(serializeListItems(indentListItem(lone, 1, -1, false), false), ['- a', '- b', '- c'], 'the run vanished with its opener, so the style is gone');
  assert.deepEqual(planListIndent('1. a\n   - b {square}\n   - c', 1, -1), ['1. a', '2. b', '   - c {square}'], 'the Preview\'s Tab planner carries it');
});

test('applyListAction: what one click means, on a flat list, a nested run and the top level', () => {
  const flat = { ordered: false, items: ['a', 'b'] };
  const frozen = JSON.stringify(flat);
  assert.deepEqual(applyListAction(flat, 0, 'ordered'), { ordered: true, items: [{ text: 'a', depth: 0, ordered: true }, { text: 'b', depth: 0, ordered: true }] });
  assert.equal(applyListAction(flat, 1, 'unordered'), null, 'already bullets: nothing changes');
  assert.deepEqual(applyListAction(flat, 1, 'style:square'), { ordered: false, items: [{ text: 'a', depth: 0, ordered: false, style: 'square' }, { text: 'b', depth: 0, ordered: false }] },
    'a style lands on the run\'s opener whichever item the caret is in');
  assert.equal(applyListAction(flat, 0, 'style:disc'), null, 'the default of an unstyled run: nothing changes');
  assert.equal(applyListAction(flat, 0, 'style:default'), null);
  assert.equal(applyListAction(flat, 0, 'style:banana'), null, 'an unknown word');
  assert.equal(applyListAction(flat, 0, 'explode'), null, 'an unknown action');
  assert.equal(applyListAction(flat, 5, 'ordered'), null, 'out of range');
  assert.equal(applyListAction({ ordered: false, items: [] }, 0, 'ordered'), null);
  assert.equal(JSON.stringify(flat), frozen, 'the input is untouched');
  const squared = applyListAction(flat, 0, 'style:square');
  assert.deepEqual(applyListAction(squared, 1, 'style:default').items, [{ text: 'a', depth: 0, ordered: false }, { text: 'b', depth: 0, ordered: false }], 'default clears it');
  assert.deepEqual(applyListAction(squared, 1, 'ordered').items, [{ text: 'a', depth: 0, ordered: true }, { text: 'b', depth: 0, ordered: true }], 'a kind flip drops the mismatched style');
  assert.deepEqual(serializeListItems(applyListAction(squared, 0, 'style:lower-alpha').items, true), ['1. a {lower-alpha}', '2. b'],
    'a style of the other kind flips the run to that kind');
  // Nested: the click acts on the run holding the caret's item; the children keep their own markers.
  const nested = { ordered: true, items: takeListRun(STYLED, 0).items };
  const sub = applyListAction(nested, 2, 'ordered');
  assert.deepEqual(serializeListItems(sub.items, sub.ordered), ['1. Apps {upper-roman}', '   1. savepoint', '   2. neko', '2. Cameras', '   - reolink', '   1. wired'],
    'the nested bullet run becomes numbers and drops its square; the top level is untouched');
  const top = applyListAction(nested, 3, 'unordered');
  assert.deepEqual(serializeListItems(top.items, top.ordered), ['- Apps', '  - savepoint {square}', '  - neko', '- Cameras', '  - reolink', '  1. wired'],
    'the top level flips as a whole, the block marker with it, and its upper-roman goes; the sublists keep theirs');
  assert.equal(top.ordered, false);
  const styledSub = applyListAction(nested, 4, 'style:circle');
  assert.deepEqual(serializeListItems(styledSub.items, styledSub.ordered)[4], '   - reolink {circle}', 'each level is styled on its own');
  const merged = applyListAction({ ordered: false, items: takeListRun(['- a', '  - b', '  1. c'], 0).items }, 2, 'style:square');
  assert.deepEqual(serializeListItems(merged.items, merged.ordered), ['- a', '  - b {square}', '  - c'],
    'a flipped run that merges into its neighbour puts the style on the merged run\'s opener');
});

test('listRunState reports the run the caret is in', () => {
  const items = takeListRun(STYLED, 0).items;
  assert.deepEqual(listRunState(items, true, 0), { ordered: true, style: 'upper-roman', depth: 0 });
  assert.deepEqual(listRunState(items, true, 3), { ordered: true, style: 'upper-roman', depth: 0 }, 'the second top item is in the same run');
  assert.deepEqual(listRunState(items, true, 2), { ordered: false, style: 'square', depth: 1 }, 'neko is in savepoint\'s run');
  assert.deepEqual(listRunState(items, true, 4), { ordered: false, style: null, depth: 1 });
  assert.deepEqual(listRunState(items, true, 5), { ordered: true, style: null, depth: 1 });
  assert.deepEqual(listRunState(['a'], false, 9), { ordered: false, style: null, depth: 0 }, 'an index past the end clamps');
  assert.deepEqual(listRunState([], true, 0), { ordered: true, style: null, depth: 0 });
});

// ---- the block model and the three renderers ---------------------------------------------------------------------

test('the block parser keeps the style in the object shape and writes it back; an unstyled list stays strings', () => {
  assert.deepEqual(parseBlocks('- a {square}\n- b'), [{ type: 'list', ordered: false, items: [{ text: 'a', depth: 0, ordered: false, style: 'square' }, { text: 'b', depth: 0, ordered: false }] }]);
  assert.deepEqual(parseBlocks('- a\n- b'), [{ type: 'list', ordered: false, items: ['a', 'b'] }], 'the shape every reader has always seen');
  assert.equal(serializeBlocks(parseBlocks(STYLED.join('\n'))), STYLED.join('\n'), 'the styled owner shape round-trips through the block model');
  assert.deepEqual(parseBlocks('- {square}'), [{ type: 'list', ordered: false, items: ['{square}'] }], 'a bare group is text');
});

test('the client renderer emits the class for a style suffix and prints a foreign one as text', () => {
  assert.equal(renderMarkdown('- a {square}\n- b'), '<ul class="list-square"><li>a</li><li>b</li></ul>');
  assert.equal(renderMarkdown('1. a {lower-alpha}\n   - b {circle}\n2. c'), '<ol class="list-lower-alpha"><li>a<ul class="list-circle"><li>b</li></ul></li><li>c</li></ol>');
  assert.equal(renderMarkdown('- a {note}'), '<ul><li>a {note}</li></ul>');
  assert.equal(renderMarkdown('1. a {square}'), '<ol><li>a {square}</li></ol>', 'the wrong kind is text');
  assert.equal(renderMarkdown('- a {disc}'), '<ul><li>a</li></ul>', 'the default is stripped and sets no class');
  assert.equal(renderMarkdown('- a\n- b'), '<ul><li>a</li><li>b</li></ul>', 'no suffix, no class attribute at all');
});

const site = (md) => unified().use(remarkParse).use(remarkGfm).use(remarkContentBlocks)
  .use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw).use(rehypeSanitize, sanitizeSchema)
  .use(rehypeStyleAllowlist).use(rehypeStringify).process(md).then((v) => String(v).replace(/\n/g, ''));

test('the site chain: the suffix becomes an allow-listed class on the list and leaves the text, nested lists included', async () => {
  assert.equal(await site('- a {square}\n- b'), '<ul class="list-square"><li>a</li><li>b</li></ul>');
  assert.equal(await site('1. a {lower-alpha}\n   - b {circle}\n2. c'), '<ol class="list-lower-alpha"><li>a<ul class="list-circle"><li>b</li></ul></li><li>c</li></ol>');
  assert.equal(await site('- **a** {square}'), '<ul class="list-square"><li><strong>a</strong></li></ul>', 'a group after an inline node counts, and its text node goes');
  assert.equal(await site('- a {note}'), '<ul><li>a {note}</li></ul>');
  assert.equal(await site('- {square}'), '<ul><li>{square}</li></ul>', 'a bare group is text');
  assert.equal(await site('1. a {square}'), '<ol><li>a {square}</li></ol>', 'the wrong kind is text');
  assert.equal(await site('- a {disc}'), '<ul><li>a</li></ul>', 'the default sets no class');
  assert.equal(await site('- a\n- b {square}'), '<ul><li>a</li><li>b {square}</li></ul>', 'only the first item opens the run');
  assert.equal(await site('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
});

test('the site chain: a task list keeps its GFM class beside a style, and a raw list keeps only the allowed classes', async () => {
  const task = await site('- [ ] a {square}\n- [x] b');
  assert.match(task, /^<ul class="list-square contains-task-list">/, task);
  assert.match(task, /type="checkbox"/, 'the checkboxes still render');
  assert.match(await site('- [ ] a\n- [x] b'), /^<ul class="contains-task-list">/, 'an unstyled task list is exactly what it was');
  const raw = await site('<ul class="evil list-square"><li>a</li></ul>\n\n<ol class="contains-task-list list-upper-roman"><li>b</li></ol>');
  assert.equal(raw, '<ul class="list-square"><li>a</li></ul><ol class="contains-task-list list-upper-roman"><li>b</li></ol>');
  for (const tag of ['ul', 'ol']) {
    const rules = (sanitizeSchema.attributes[tag] || []).filter((a) => Array.isArray(a) && a[0] === 'className');
    assert.equal(rules.length, 1, `${tag} has ONE className rule (hast-util-sanitize honours only the first)`);
    assert.ok(rules[0].includes('contains-task-list'), `${tag} keeps the GFM task-list class`);
    assert.ok(rules[0].some((v) => String(v) === String(LIST_STYLE_CLASS_RE)), `${tag} admits the shared regex, not a copy that can drift`);
  }
});

test('applyListStyle (pure): the last text child of the first item is consumed or trimmed, and the class replaces the computed one', () => {
  const list = { type: 'list', ordered: false, children: [{ type: 'listItem', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'a {square}' }] }] }] };
  applyListStyle(list);
  assert.deepEqual(list.data.hProperties.className, ['list-square']);
  assert.equal(list.children[0].children[0].children[0].value, 'a');
  const bare = { type: 'list', ordered: false, children: [{ type: 'listItem', children: [{ type: 'paragraph', children: [{ type: 'text', value: '{square}' }] }] }] };
  applyListStyle(bare);
  assert.equal(bare.data, undefined);
  assert.equal(bare.children[0].children[0].children[0].value, '{square}');
  const task = { type: 'list', ordered: true, children: [{ type: 'listItem', checked: false, children: [{ type: 'paragraph', children: [{ type: 'text', value: 'a {upper-alpha}' }] }] }] };
  applyListStyle(task);
  assert.deepEqual(task.data.hProperties.className, ['list-upper-alpha', 'contains-task-list']);
  const dflt = { type: 'list', ordered: true, children: [{ type: 'listItem', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'a {decimal}' }] }] }] };
  applyListStyle(dflt);
  assert.equal(dflt.data, undefined, 'the default sets no hProperties at all');
  assert.equal(dflt.children[0].children[0].children[0].value, 'a');
});

// ---- the read-back and the planners --------------------------------------------------------------------------------

const toHtml = (n) => toHtmlRaw(n, { characterReferences: { useNamedReferences: true } });
const adapt = (h) => {
  if (h.type === 'text') return { nodeType: 3, textContent: h.value };
  if (h.type !== 'element') return { nodeType: 8 };
  const cls = Array.isArray(h.properties?.className) ? h.properties.className.join(' ') : (h.properties?.className || '');
  const el = { nodeType: 1, tagName: h.tagName.toUpperCase(), childNodes: h.children.map(adapt), className: cls,
    getAttribute(name) { return name === 'class' ? (cls || null) : null; },
    get children() { return this.childNodes.filter((c) => c.nodeType === 1); },
    get innerHTML() { return toHtml(h.children); },
    get textContent() { return toHtml(h.children).replace(/<[^>]+>/g, ''); },
    querySelectorAll(sel) { const out = []; const walk = (n) => { for (const c of n.children || []) { if (c.tagName === sel.toUpperCase()) out.push(c); walk(c); } }; walk(this); return out; },
  };
  return el;
};
const dom = (html) => adapt(fromHtml(html, { fragment: true }).children[0]);

test('readListDom returns the style from the class, and a text edit committed from either surface keeps it', () => {
  const el = dom(listHtml(takeListRun(STYLED, 0).items, (t) => t, { ordered: true }));
  const items = readListDom(el, (h) => h);
  assert.deepEqual(items.map((it) => it.style || null), ['upper-roman', 'square', null, null, null, null]);
  assert.deepEqual(applyBlockEdit(STYLED.join('\n'), readBlockDom(el)), STYLED, 'an untouched styled list commits back to the same lines');
  const edited = readBlockDom(dom('<ol class="list-upper-roman"><li>Apps (edited)<ul class="list-square"><li>savepoint</li></ul></li></ol>'));
  assert.deepEqual(applyBlockEdit('1. Apps {upper-roman}\n   - savepoint {square}', edited), ['1. Apps (edited) {upper-roman}', '   - savepoint {square}'],
    'an edit inside the opener keeps the style');
  assert.deepEqual(readListDom(dom('<ul class="ce ce-list list-circle" contenteditable="true"><li>a</li></ul>'), (h) => h), [{ text: 'a', depth: 0, ordered: false, style: 'circle' }],
    'the editor\'s root carries the class among its own');
  assert.deepEqual(readListDom(dom('<ul><li>a</li></ul>'), (h) => h), [{ text: 'a', depth: 0, ordered: false }], 'no class, no key');
});

test('planListAttrs and planListUnwrap act on exactly one list block and refuse anything else', () => {
  assert.deepEqual(planListAttrs('- a\n- b', 1, 'ordered'), ['1. a', '2. b']);
  assert.deepEqual(planListAttrs('- a\n- b', 1, 'style:square'), ['- a {square}', '- b']);
  assert.deepEqual(planListAttrs('- a {square}\n- b', 0, 'style:default'), ['- a', '- b']);
  assert.deepEqual(planListAttrs(STYLED.join('\n'), 2, 'ordered'), ['1. Apps {upper-roman}', '   1. savepoint', '   2. neko', '2. Cameras', '   - reolink', '   1. wired']);
  assert.equal(planListAttrs('- a\n- b', 0, 'unordered'), null, 'nothing changes');
  assert.equal(planListAttrs('A paragraph.', 0, 'ordered'), null, 'never over a paragraph');
  assert.equal(planListAttrs('- a\n\n- b', 0, 'ordered'), null, 'never over two blocks');
  assert.equal(planListAttrs('- a', 0, 'unwrap'), null, 'unwrap is not an attribute change');
  assert.deepEqual(planListUnwrap('- a\n- b'), ['a', '', 'b']);
  assert.deepEqual(planListUnwrap(STYLED.join('\n')), ['Apps', '', 'savepoint', '', 'neko', '', 'Cameras', '', 'reolink', '', 'wired'], 'nested items flatten in order, the styles go');
  assert.deepEqual(planListUnwrap('- **a** [l](https://x.test)\n-  \n- c'), ['**a** [l](https://x.test)', '', 'c'], 'inline markdown stays, an empty item goes');
  assert.deepEqual(planListUnwrap('- '), [''], 'an all-empty list leaves one empty line');
  assert.equal(planListUnwrap('A paragraph.'), null);
  assert.equal(planListUnwrap('- a\n\n- b'), null);
  assert.deepEqual(listBlockOf('- a {square}'), { type: 'list', ordered: false, items: [{ text: 'a', depth: 0, ordered: false, style: 'square' }] });
  assert.equal(listBlockOf('![A](./x.png)'), null);
});

// ---- the plain-text renderers and the styles -------------------------------------------------------------------------

test('the syndication text and the directory excerpt drop the suffix, and the syndication text stays idempotent', () => {
  assert.equal(mdToPlain('Intro\n\n- a {square}\n- b\n\n1. c {lower-alpha}'), 'Intro\n\n- a\n- b\n\n1. c');
  assert.equal(mdToPlain('- a {note}'), '- a {note}', 'an unknown word is the author\'s');
  assert.equal(mdToPlain(mdToPlain('- a {square}')), mdToPlain('- a {square}'));
  assert.equal(mdToHtml('- a {square}\n- b'), '<ul><li>a</li><li>b</li></ul>');
  assert.equal(bioExcerpt('Before\n- a {square}\n- b {note}\nafter'), 'Before - a - b {note} after');
  assert.equal(bioExcerpt('A paragraph {square} stays'), 'A paragraph {square} stays');
});

test('the six classes are styled in the published prose, the reader, the members-only body and the editor, in step', () => {
  const prose = read('src/components/blog/Prose.astro');
  const shared = listStyleProseCss('.prose-gbti');
  for (const c of CLASSES) {
    assert.ok(prose.includes(`.${c} > li`), `Prose.astro styles ${c} through the child combinator`);
    assert.ok(shared.includes(`.${c} > li`), `the shared rules style ${c}`);
  }
  assert.ok(!/\.prose-gbti (ul|ol)\.list-[a-z-]+ li \{/.test(prose), 'no descendant rule, or a sublist would inherit the marker');
  const rules = (css) => css.split('\n').map((l) => l.trim()).filter((l) => /\.list-[a-z-]+ > li/.test(l));
  assert.deepEqual(rules(prose), rules(shared), 'Prose.astro and listStyleProseCss carry the same rules');
  assert.equal(rules(shared).length, 6);
  assert.ok(read('client-ui/src/elements/gbti-reader.mjs').includes("listStyleProseCss('.body')"), 'the reader scopes the shared rules to its body');
  assert.ok(read('client-ui/src/elements/gbti-locked-content.mjs').includes("listStyleProseCss('.unlocked')"), 'the members-only body to the unlocked body');
  assert.ok(read('client-ui/src/doc-editor-css.mjs').includes("listStyleProseCss('.doc-blocks')"), 'the editor to its block host, so the list block\'s own root tag is reached');
  assert.ok(!listStyleProseCss('.x').includes('list-disc') && !listStyleProseCss('.x').includes('list-decimal'), 'the defaults have no rule');
});

test('no shipped list carries a style word, so every existing list serializes exactly as before', () => {
  // The corpus guard: the words are new, so the live content must hold none. If one appears here, someone
  // wrote it by hand and the render will change on the next build; that is a content decision, not a bug.
  const walk = (dir, out) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = `${dir}/${e.name}`; if (e.isDirectory()) walk(p, out); else if (e.name.endsWith('.md')) out.push(p); } return out; };
  const files = [...walk(new URL('../members', import.meta.url).pathname, []), ...walk(new URL('../house', import.meta.url).pathname, [])];
  let runs = 0;
  for (const f of files) {
    const lines = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n').split('\n');
    let fence = false;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*```/.test(lines[i])) { fence = !fence; continue; }
      if (fence || !/^(\s*)([-*]|\d+\.)\s+/.test(lines[i])) continue;
      const run = takeListRun(lines, i);
      runs++;
      assert.ok(!run.items.some((it) => it.style), `${f}:${i + 1} carries a list style word`);
      assert.ok(run.items.every((it) => !('style' in it)), `${f}:${i + 1} emits the style key`);
      i = run.next - 1;
    }
  }
  assert.ok(runs > 300, `the corpus holds list runs to check (saw ${runs})`);
});
