// sow-452: the ```directory block, a sortable list in an article (owner, 2026-10-12: "we should have the ability to
// sort by Channel Category or by Relavents or By subscriber count"). The fence becomes one allow-listed placeholder
// on the site and in the extension renderer, cross-posts drop it, the doc editor keeps it, and the sort itself reads
// each entry's own text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { parseRank, parseSubscribers, parseStats, orderItems, SORT_MODES } from '../src/lib/sort-list.mjs';
import { remarkContentBlocks } from '../src/lib/remark-content-blocks.mjs';
import { sanitizeSchema } from '../src/lib/markdown-sanitize.mjs';
import { renderMarkdown } from '../client/src/markdown.mjs';
import { stripSiteOnlyFences, prepareDevtoBody } from '../clients/syndication/devto-body.mjs';
import { prepareHashnodeBody } from '../clients/syndication/hashnode-body.mjs';
import { parseBlocks, serializeBlocks } from '../client-ui/src/markdown-blocks.mjs';

const site = async (md) => String(await unified().use(remarkParse).use(remarkGfm).use(remarkContentBlocks)
  .use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw).use(rehypeSanitize, sanitizeSchema).use(rehypeStringify).process(md));

test('parseRank reads "#N." headings only', () => {
  assert.equal(parseRank('#100. WordCamp Asia'), 100);
  assert.equal(parseRank('  #7. Seven'), 7);
  assert.equal(parseRank('100. No hash'), null);
  assert.equal(parseRank('#12 no stop'), null);
  assert.equal(parseRank(''), null);
});

test('parseSubscribers reads K, M and plain counts', () => {
  assert.equal(parseSubscribers('4.5K subscribers'), 4500);
  assert.equal(parseSubscribers('Developer educators · 1.24M subscribers · 9%'), 1240000);
  assert.equal(parseSubscribers('625 subscribers'), 625);
  assert.equal(parseSubscribers('1,240 subscribers'), 1240);
  assert.equal(parseSubscribers('1 subscriber'), 1);
  assert.equal(parseSubscribers('no count here'), null);
});

test('parseStats takes the type from the first segment, and only from a stats line', () => {
  assert.deepEqual(parseStats('Plugin and theme companies · 4.5K subscribers · 83% of 2026 videos about WordPress'),
    { type: 'Plugin and theme companies', subscribers: 4500 });
  assert.deepEqual(parseStats('4.5K subscribers · 83%'), { type: null, subscribers: 4500 });
  assert.equal(parseStats('A paragraph about the channel.'), null);
});

const ITEMS = [
  { rank: 3, type: 'B', subscribers: 10, index: 0 },
  { rank: 2, type: 'A', subscribers: 500, index: 1 },
  { rank: 1, type: 'B', subscribers: 500, index: 2 },
  { rank: 4, type: 'A', subscribers: 50, index: 3 },
  { rank: 5, type: 'B', subscribers: null, index: 4 },
];
const ranks = (groups) => groups.flatMap((g) => g.items.map((i) => i.rank));

test('score is the countdown: highest number first, #1 last', () => {
  const g = orderItems(ITEMS, 'score');
  assert.equal(g.length, 1);
  assert.equal(g[0].label, null);
  assert.deepEqual(ranks(g), [5, 4, 3, 2, 1]);
});

test('subscribers is largest first, ties keep the countdown, unknown counts last', () => {
  assert.deepEqual(ranks(orderItems(ITEMS, 'subscribers')), [2, 1, 4, 3, 5]);
});

test('category groups by type, biggest group first, countdown inside', () => {
  const g = orderItems(ITEMS, 'category');
  assert.deepEqual(g.map((x) => [x.label, x.items.map((i) => i.rank)]), [['B', [5, 3, 1]], ['A', [4, 2]]]);
});

test('an unknown mode falls back to the countdown and the input is not mutated', () => {
  const copy = ITEMS.map((i) => ({ ...i }));
  assert.deepEqual(ranks(orderItems(ITEMS, 'nope')), [5, 4, 3, 2, 1]);
  assert.deepEqual(ITEMS, copy);
  assert.deepEqual(SORT_MODES.map((m) => m.key), ['score', 'category', 'subscribers']);
});

test('site: the fence becomes the one allow-listed placeholder, not a code block', async () => {
  const html = await site('Intro\n\n```directory\n```\n\n### #2. Two\n\nText\n');
  assert.match(html, /<div class="sortlist"><\/div>/);
  assert.doesNotMatch(html, /<pre|<code/);
  assert.match(html, /<h3>#2\. Two<\/h3>/);
});

test('site: the sanitizer keeps sortlist and still drops look-alike classes', async () => {
  const html = await site('<div class="sortlist-bar evil">x</div>\n\n<div class="sortlist">y</div>\n');
  assert.doesNotMatch(html, /sortlist-bar|evil/);
  assert.match(html, /<div class="sortlist">y<\/div>/);
});

test('extension renderer: the fence renders the empty placeholder', () => {
  const html = renderMarkdown('```directory\n```\n\n### #1. One\n');
  assert.match(html, /<div class="sortlist"><\/div>/);
  assert.doesNotMatch(html, /<pre|language-directory/);
});

test('cross-posts drop the fence and keep the entries', () => {
  const body = 'Lead\n\n```directory\nsort: score\n```\n\n### #2. Two\n\n```js\nkeep();\n```\n';
  const out = stripSiteOnlyFences(body);
  assert.doesNotMatch(out, /directory|sort: score/);
  assert.match(out, /### #2\. Two/);
  assert.match(out, /```js\nkeep\(\);\n```/);
  const file = `---\ntype: post\ntitle: T\nslug: t\nauthor: a\nstatus: published\nvisibility: public\n---\n\n${body}`;
  const item = { type: 'post', author: 'a', slug: 't' };
  for (const prep of [prepareDevtoBody, prepareHashnodeBody]) {
    const r = prep(file, item);
    assert.equal(r.ok, true, r.reason);
    assert.doesNotMatch(r.body, /```directory/);
    assert.match(r.body, /### #2\. Two/);
  }
});

test('the doc editor keeps the fence on a round trip', () => {
  // An empty fence comes back with a blank line inside, which is still the same block for every renderer.
  const out = serializeBlocks(parseBlocks('Lead\n\n```directory\n```\n\n### #1. One\n\nText'));
  assert.match(out, /```directory\n\n?```/);
  assert.match(renderMarkdown(out), /<div class="sortlist"><\/div>/);
  assert.doesNotMatch(stripSiteOnlyFences(out), /directory/);
});
