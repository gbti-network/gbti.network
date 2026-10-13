// sow-453: the article component library (owner, 2026-10-13, option B picked on the design canvas, D liked too):
// ```tags, ```bar, ```facts and ```button, one parser for every renderer, a catalogue the MCP server lists, and
// validate_content warnings for a malformed block.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import {
  DATA_BLOCKS, KNOWN_FENCES, parsePercent, parseBar, parseFacts, parseButton, renderDataBlock, dataBlockToMarkdown,
  barWidthCss, dataBlocksCss, checkComponentBlocks,
} from '../client/src/content-blocks.mjs';
import { COMPONENTS, listComponents } from '../client/src/components-catalog.mjs';
import { remarkContentBlocks } from '../src/lib/remark-content-blocks.mjs';
import { sanitizeSchema } from '../src/lib/markdown-sanitize.mjs';
import { renderMarkdown } from '../client/src/markdown.mjs';
import { stripSiteOnlyFences, prepareDevtoBody } from '../clients/syndication/devto-body.mjs';
import { parseBlocks, serializeBlocks } from '../client-ui/src/markdown-blocks.mjs';
import { dispatch, TOOLS } from '../client/src/mcp-tools.mjs';

const site = async (md) => String(await unified().use(remarkParse).use(remarkGfm).use(remarkContentBlocks)
  .use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw).use(rehypeSanitize, sanitizeSchema).use(rehypeStringify).process(md));
const F = '```';
const TAGS = `${F}tags\nOfficial and community\nAlways included\n${F}`;
const BAR = `${F}bar\nlabel: 2026 videos about WordPress\nvalue: 60%\nnote: 118K subscribers · 240 WordPress videos in 2026\n${F}`;
const FACTS = `${F}facts\nType: Official and community\nAbout WordPress: 60% {bar}\n${F}`;
const BUTTON = `${F}button\nSubscribe to @WordPress\nhttps://www.youtube.com/@WordPress?sub_confirmation=1\n${F}`;

test('parsers: percentages, bar keys, fact rows, button forms', () => {
  assert.equal(parsePercent('60%'), 60);
  assert.equal(parsePercent('0%'), 0);
  assert.equal(parsePercent('100 %'), 100);
  assert.equal(parsePercent('101%'), null);
  assert.equal(parsePercent('60'), null);
  assert.equal(parsePercent('6.5%'), null);
  assert.deepEqual(parseBar('label: A\nvalue: 7%\nnote: n\nextra'), { label: 'A', value: 7, raw: '7%', note: 'n', unknown: ['extra'] });
  const f = parseFacts('Type: X\nShare: 46% {bar}\nTime: 10:30\nno colon');
  assert.deepEqual(f.rows.map((r) => [r.k, r.v, r.bar]), [['Type', 'X', null], ['Share', '46%', 46], ['Time', '10:30', null]]);
  assert.deepEqual(f.bad, ['no colon']);
  assert.deepEqual(parseButton('Go\nhttps://a.example/x'), { label: 'Go', url: 'https://a.example/x', rawUrl: 'https://a.example/x' });
  assert.equal(parseButton('Go | https://a.example').url, 'https://a.example');
  assert.equal(parseButton('Go\njavascript:alert(1)').url, null);
});

test('HTML: chips, bar, table, button', () => {
  assert.equal(renderDataBlock('tags', 'A\nB <b>'), '<div class="gbti-tags"><span class="gbti-tag gbti-tag-primary">A</span><span class="gbti-tag">B &lt;b&gt;</span></div>');
  const bar = renderDataBlock('bar', 'label: L\nvalue: 60%\nnote: N');
  assert.match(bar, /gbti-bar-label">L<.*gbti-bar-value">60%<.*gbti-bar-fill gbti-bar-w-60.*gbti-bar-note">N</);
  assert.match(renderDataBlock('facts', 'A: 1\nB: 46% {bar}'), /<dt>A<\/dt><dd><span>1<\/span><\/dd>.*<dt>B<\/dt><dd><span>46%<\/span><span class="gbti-bar-track gbti-bar-mini"><span class="gbti-bar-fill gbti-bar-w-46">/);
  assert.equal(renderDataBlock('button', 'Go\nhttps://a.example'), '<div class="gbti-button-row"><a class="gbti-button" href="https://a.example">Go</a></div>');
  assert.equal(renderDataBlock('button', 'Go\nnot-a-url'), '<p>Go</p>');
  assert.equal(renderDataBlock('bar', 'label: L\nvalue: lots'), '<p>L · lots</p>');
  assert.equal(renderDataBlock('tags', '\n\n'), null);
  assert.equal(renderDataBlock('nope', 'x'), null);
});

test('site: every block survives the sanitizer with exactly its classes', async () => {
  const html = await site([TAGS, BAR, FACTS, BUTTON].join('\n\n'));
  for (const c of ['gbti-tags', 'gbti-tag gbti-tag-primary', 'gbti-bar', 'gbti-bar-head', 'gbti-bar-fill gbti-bar-w-60', 'gbti-bar-note', 'gbti-facts', 'gbti-fact', 'gbti-bar-mini', 'gbti-button-row', 'gbti-button']) {
    assert.match(html, new RegExp(`class="[^"]*\\b${c}\\b`), `missing ${c}`);
  }
  assert.doesNotMatch(html, /<pre|<code/);
  const evil = await site('<div class="gbti-tagsx evil">x</div>\n\n<a class="gbti-buttonx" href="https://a.example">y</a>\n\n<dl class="other"><dt>a</dt></dl>\n');
  assert.doesNotMatch(evil, /gbti-tagsx|evil|gbti-buttonx|class="other"/);
});

test('preview and extension renderer: the same HTML as the site module', () => {
  const html = renderMarkdown([TAGS, BAR, BUTTON].join('\n\n'));
  assert.ok(html.includes(renderDataBlock('tags', 'Official and community\nAlways included')));
  assert.match(html, /gbti-bar-w-60/);
  assert.match(html, /<a class="gbti-button" href="https:\/\/www\.youtube\.com\/@WordPress\?sub_confirmation=1">/);
  assert.doesNotMatch(html, /language-(tags|bar|button)/);
});

test('cross-posts: readable markdown, no component fences left', () => {
  const out = stripSiteOnlyFences(['Intro', TAGS, BAR, FACTS, BUTTON, `${F}js\nkeep()\n${F}`].join('\n\n'));
  assert.match(out, /_Official and community_ · _Always included_/);
  assert.match(out, /\*\*60%\*\* 2026 videos about WordPress \(118K subscribers · 240 WordPress videos in 2026\)/);
  assert.match(out, /- \*\*Type:\*\* Official and community\n- \*\*About WordPress:\*\* 60%/);
  assert.match(out, /\[Subscribe to @WordPress\]\(https:\/\/www\.youtube\.com\/@WordPress\?sub_confirmation=1\)/);
  assert.doesNotMatch(out, /```(tags|bar|facts|button)/);
  assert.match(out, /```js\nkeep\(\)\n```/);
  const file = `---\ntype: post\ntitle: T\nslug: t\nauthor: a\nstatus: published\nvisibility: public\n---\n\n${TAGS}\n\n${BUTTON}\n`;
  const r = prepareDevtoBody(file, { type: 'post', author: 'a', slug: 't' });
  assert.equal(r.ok, true, r.reason);
  assert.doesNotMatch(r.body, /```tags|```button/);
  assert.equal(dataBlockToMarkdown('bar', 'label: L\nvalue: 5%'), '**5%** L');
});

test('the doc editor keeps every block on a round trip', () => {
  const md = ['Lead', TAGS, BAR, FACTS, BUTTON].join('\n\n');
  assert.equal(serializeBlocks(parseBlocks(md)), md);
});

test('styles: 101 width classes and every class the HTML uses', () => {
  const w = barWidthCss('.x');
  assert.match(w, /\.x \.gbti-bar-w-0\{width:0%\}/);
  assert.match(w, /\.x \.gbti-bar-w-100\{width:100%\}/);
  assert.equal((w.match(/gbti-bar-w-/g) || []).length, 101);
  const css = dataBlocksCss('.p', { fg: 'a', soft: 'b', mute: 'c', line: 'd', line2: 'e', rest: 'f', green: 'g', green700: 'h', green700Solid: 'h2', greenTint: 'i', greenBorder: 'j', surface: 'k', mono: 'm' });
  for (const c of ['gbti-tags', 'gbti-tag', 'gbti-tag-primary', 'gbti-bar', 'gbti-bar-head', 'gbti-bar-label', 'gbti-bar-value', 'gbti-bar-track', 'gbti-bar-fill', 'gbti-bar-note', 'gbti-facts', 'gbti-fact', 'gbti-bar-mini', 'gbti-button-row', 'gbti-button', 'gbti-button-primary', 'gbti-stats', 'gbti-stats-caption', 'gbti-stats-row', 'gbti-stat', 'gbti-stat-value', 'gbti-stat-label']) {
    assert.ok(css.includes(`.${c}`), `no rule for ${c}`);
  }
  assert.doesNotMatch(css, /undefined/);
});

test('catalogue: describes every fence the renderers know, with syntax and an example', () => {
  const names = COMPONENTS.map((c) => c.name);
  for (const f of KNOWN_FENCES) assert.ok(names.includes(f), `catalogue misses ${f}`);
  for (const d of DATA_BLOCKS) assert.ok(names.includes(d));
  for (const c of COMPONENTS) for (const k of ['name', 'purpose', 'syntax', 'example', 'renders']) assert.ok(c[k], `${c.name} lacks ${k}`);
  for (const c of COMPONENTS) assert.doesNotMatch(`${c.purpose} ${c.renders}`, /[—–]/, `${c.name} copy has a dash`);
  for (const c of COMPONENTS.filter((x) => x.kind === 'fence' && DATA_BLOCKS.includes(x.name))) {
    assert.deepEqual(checkComponentBlocks(c.example), [], `${c.name} example warns`);
  }
});

test('validator: warnings for malformed blocks, none for good ones or plain code', () => {
  assert.deepEqual(checkComponentBlocks([TAGS, BAR, FACTS, BUTTON, `${F}embed lightbox\nhttps://youtu.be/n-ETaiZvHns\n${F}`, `${F}js\nanything: here\n${F}`, `${F}\nplain\n${F}`].join('\n\n')), []);
  const w = checkComponentBlocks([`${F}bar\nlabel: A\nvalue: 120%\ncolor: red\n${F}`, `${F}facts\nno colon\nShare: lots {bar}\n${F}`, `${F}button\nGo\nftp://x\n${F}`, `${F}tags\n${F}`, `${F}callout danger\nx\n${F}`, `${F}embed big\nnot a url\n${F}`].join('\n\n'));
  const msgs = w.map((x) => `${x.block}@${x.line}: ${x.message}`).join('\n');
  for (const re of [/bar@1: .*whole percentage.*120%/, /bar@1: bar line "color: red"/, /facts@7: .*"no colon"/, /facts@7: .*"Share" asks for \{bar\}/, /button@12: .*http or https/, /tags@17: tags is empty/, /callout@20: .*"danger"/, /embed@24: embed option "big"/, /embed@24: embed needs one video URL/]) {
    assert.match(msgs, re);
  }
  assert.match(checkComponentBlocks(`${F}bar\nlabel: A\nvalue: 5%`).map((x) => x.message).join(), /never closed/);
});

test('MCP: tools/list carries list_components and tools/call returns the catalogue without sign-in', async () => {
  assert.ok(TOOLS.some((t) => t.name === 'list_components'));
  const list = await dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, {});
  assert.ok(list.result.tools.some((t) => t.name === 'list_components'));
  const call = await dispatch({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_components', arguments: {} } }, {});
  const text = call.result.content[0].text;
  const parsed = JSON.parse(text);
  assert.deepEqual(parsed.components.map((c) => c.name), listComponents().components.map((c) => c.name));
  assert.ok(parsed.components.find((c) => c.name === 'bar').syntax.includes('value:'));
});

// Option A, the pick corrected on 2026-10-13: "I am very sorry I meant to select A stat strip".
const STATS = `${F}stats\ncaption: Official and community · Always included\n118K: subscribers\n60%: of 2026 videos about WordPress\n240: WordPress videos in 2026\n${F}`;
const PRIMARY = `${F}button primary\nSubscribe to @WordPress\nhttps://www.youtube.com/@WordPress?sub_confirmation=1\n${F}`;

test('stats and the primary button: HTML on the site, the renderer and cross-posts', async () => {
  const html = await site([STATS, PRIMARY].join('\n\n'));
  assert.match(html, /<div class="gbti-stats"><div class="gbti-stats-caption">Official and community · Always included<\/div><div class="gbti-stats-row"><div class="gbti-stat"><span class="gbti-stat-value">118K<\/span> <span class="gbti-stat-label">subscribers<\/span>/);
  assert.match(html, /<a class="gbti-button gbti-button-primary" href=/);
  assert.equal((html.match(/class="gbti-stat"/g) || []).length, 3);
  const r = renderMarkdown([STATS, PRIMARY].join('\n\n'));
  assert.ok(r.includes(renderDataBlock('stats', STATS.split('\n').slice(1, -1).join('\n'))));
  assert.match(r, /gbti-button gbti-button-primary/);
  const md = stripSiteOnlyFences([STATS, PRIMARY].join('\n\n'));
  assert.match(md, /_Official and community · Always included_\n\n\*\*118K\*\* subscribers · \*\*60%\*\* of 2026 videos about WordPress · \*\*240\*\* WordPress videos in 2026/);
  assert.match(md, /\[Subscribe to @WordPress\]\(https:/);
  assert.doesNotMatch(md, /```/);
  assert.equal(serializeBlocks(parseBlocks(['A', STATS, PRIMARY].join('\n\n'))), ['A', STATS, PRIMARY].join('\n\n'));
  const evil = await site('<a class="gbti-button-secondary" href="https://a.example">x</a>\n');
  assert.doesNotMatch(evil, /gbti-button-secondary/);
});

test('stats and button options: validator warnings', () => {
  assert.deepEqual(checkComponentBlocks([STATS, PRIMARY].join('\n\n')), []);
  const msgs = checkComponentBlocks([`${F}stats\ncaption: only\n${F}`, `${F}stats\njust words\n${F}`, `${F}button huge\nGo\nhttps://a.example\n${F}`].join('\n\n')).map((x) => x.message).join('\n');
  assert.match(msgs, /stats needs at least one "value: label" line/);
  assert.match(msgs, /stats line "just words" is not "value: label"/);
  assert.match(msgs, /button option "huge" is not known/);
});
