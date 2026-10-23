// sow-470: the two build-time halves of article tables.
//
// The wrapper is the part that MUST be built rather than scripted. sow-248 fixed a measured phone overflow
// (five of 52 articles, up to 213px at 390px) with a CSS rule on the table itself; replacing that with a
// wrapper only keeps the fix if the wrapper exists without JavaScript, which is why it is a rehype pass and
// why this test reads the built tree rather than the page script.
import test from 'node:test';
import assert from 'node:assert/strict';

import { rehypeTableScroll } from '../src/lib/rehype-table-scroll.mjs';
import { remarkTableSort, sortMarkerValue } from '../src/lib/remark-table-sort.mjs';

const el = (tagName, children = [], properties = {}) => ({ type: 'element', tagName, properties, children });
const root = (children) => ({ type: 'root', children });

const run = (tree) => { rehypeTableScroll()(tree); return tree; };

test('a table is wrapped in an outer wrap plus an inner scroll container', () => {
  const tree = run(root([el('p'), el('table')]));
  assert.equal(tree.children.length, 2);
  const outer = tree.children[1];
  assert.equal(outer.tagName, 'div');
  assert.deepEqual(outer.properties.className, ['table-wrap'], 'the outer one does not scroll, so it can hold the fade');
  const inner = outer.children[0];
  assert.deepEqual(inner.properties.className, ['table-scroll'], 'the inner one scrolls');
  assert.equal(inner.children.length, 1);
  assert.equal(inner.children[0].tagName, 'table', 'the table itself is kept, not replaced');
});

test('a table nested inside other elements is still wrapped', () => {
  const tree = run(root([el('div', [el('section', [el('table')])])]));
  const section = tree.children[0].children[0];
  assert.equal(section.children[0].tagName, 'div');
  assert.equal(section.children[0].children[0].children[0].tagName, 'table');
});

test('every table on a page is wrapped, not just the first', () => {
  const tree = run(root([el('table'), el('p'), el('table')]));
  const wraps = tree.children.filter((c) => c.tagName === 'div');
  assert.equal(wraps.length, 2);
  for (const w of wraps) assert.deepEqual(w.properties.className, ['table-wrap']);
});

test('running twice does not nest a second pair of wrappers', () => {
  const tree = run(run(root([el('table')])));
  const outer = tree.children[0];
  assert.deepEqual(outer.properties.className, ['table-wrap']);
  assert.deepEqual(outer.children[0].properties.className, ['table-scroll']);
  assert.equal(outer.children[0].children[0].tagName, 'table', 'not a third div');
});

test('a tree with no table is untouched', () => {
  const tree = run(root([el('p'), el('ul')]));
  assert.deepEqual(tree.children.map((c) => c.tagName), ['p', 'ul']);
});

// --- the author's override --------------------------------------------------------------------------------

const mdRoot = (children) => ({ type: 'root', children });
const html = (value) => ({ type: 'html', value });
const table = () => ({ type: 'table', children: [] });
const runMd = (tree) => { remarkTableSort()(tree); return tree; };

test('the marker is recognised in the forms an author would actually type', () => {
  assert.equal(sortMarkerValue(html('<!-- sort: on -->')), 'on');
  assert.equal(sortMarkerValue(html('<!--sort:off-->')), 'off');
  assert.equal(sortMarkerValue(html('<!--  SORT:  On  -->')), 'on');
  assert.equal(sortMarkerValue(html('<!-- sort: maybe -->')), null);
  assert.equal(sortMarkerValue(html('<!-- something else -->')), null);
  assert.equal(sortMarkerValue({ type: 'paragraph' }), null);
});

test('the marker sets data-sort on the table after it, and is consumed', () => {
  const tree = runMd(mdRoot([html('<!-- sort: off -->'), table()]));
  assert.equal(tree.children.length, 1, 'the comment is removed, not rendered');
  assert.equal(tree.children[0].type, 'table');
  // `dataSort`, hast's camelCase name. The literal 'data-sort' serializes fine on its own and is then
  // stripped by the sanitizer, which is how this shipped dead once.
  assert.deepEqual(tree.children[0].data.hProperties, { dataSort: 'off' });
});

test('an "on" marker reads as on', () => {
  const tree = runMd(mdRoot([html('<!-- sort: on -->'), table()]));
  assert.equal(tree.children[0].data.hProperties.dataSort, 'on');
});

test('a marker with no table after it is left in place rather than silently eaten', () => {
  const tree = runMd(mdRoot([html('<!-- sort: on -->'), { type: 'paragraph', children: [] }]));
  assert.equal(tree.children.length, 2);
  assert.equal(tree.children[0].type, 'html');
});

test('a table with no marker gets no data-sort at all', () => {
  const tree = runMd(mdRoot([table()]));
  assert.equal(tree.children[0].data, undefined);
});

test('an ordinary HTML comment near a table is not treated as a marker', () => {
  const tree = runMd(mdRoot([html('<!-- TODO: update these figures -->'), table()]));
  assert.equal(tree.children.length, 2, 'the comment is left alone');
  assert.equal(tree.children[1].data, undefined);
});

test('the sanitizer allows data-sort on a table, and only the two values', async () => {
  const { sanitizeSchema } = await import('../src/lib/markdown-sanitize.mjs');
  const rule = (sanitizeSchema.attributes?.table || []).find((a) => Array.isArray(a) && a[0] === 'dataSort');
  assert.ok(rule, 'a table carries a dataSort rule, or the override is stripped at build and never arrives');
  assert.deepEqual(rule.slice(1).sort(), ['off', 'on'], 'exactly these two values');
});

// --- the chain, end to end ---------------------------------------------------------------------------------
//
// THIS is the test that matters, and it exists because the unit tests above all passed while the override was
// DEAD on the live site. The remark plugin set the property correctly and the hast serialized it correctly;
// the SANITIZER then stripped it, because hast's property model is camelCase (`dataSort`) and the plugin had
// set the literal `data-sort`. Every isolated test was green. Only running the real chain showed it.
test('the override survives the real remark -> rehype -> sanitize chain', async () => {
  const { unified } = await import('unified');
  const remarkParse = (await import('remark-parse')).default;
  const remarkGfm = (await import('remark-gfm')).default;
  const remarkRehype = (await import('remark-rehype')).default;
  const rehypeSanitize = (await import('rehype-sanitize')).default;
  const rehypeStringify = (await import('rehype-stringify')).default;
  const { sanitizeSchema } = await import('../src/lib/markdown-sanitize.mjs');

  const render = (md) => unified()
    .use(remarkParse).use(remarkGfm).use(remarkTableSort)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeTableScroll)
    .use(rehypeStringify)
    .process(md).then(String);

  const body = '| Step | Do |\n| --- | --- |\n| 1 | Install |\n';
  const tag = (html) => (html.match(/<table[^>]*>/) || [''])[0];

  assert.match(tag(await render(`<!-- sort: off -->\n\n${body}`)), /data-sort="off"/,
    'the author\'s "off" has to reach the browser, or an ordered table silently gets sort controls anyway');
  assert.match(tag(await render(`<!-- sort: on -->\n\n${body}`)), /data-sort="on"/);
  assert.doesNotMatch(tag(await render(body)), /data-sort/, 'a table with no marker carries nothing');
  // The schema pins the value, so a marker the author mistypes does not become an attribute.
  assert.doesNotMatch(tag(await render(`<!-- sort: evil -->\n\n${body}`)), /data-sort/);

  const wrapped = await render(body);
  assert.match(wrapped, /<div class="table-wrap"><div class="table-scroll"><table/,
    'and both wrappers survive the sanitizer, which is what gives the fade somewhere to live');
});
