// sow-497, 2026-11-08: the ```cards block (option B, "card grid", on the Minecraft plugin promo canvas). A grid of
// cards, each a picture, a name, a line and a meta line, and the whole card is the link. The block has to work in every
// layer that reads a fence: both renderers, the published page's sanitizer, cross-posts, the component checker, the
// agent catalog, the WorkBench block model and the shared stylesheet.
//
// The test that matters most is the image one. A picture written as <img> inside an HTML string ships as its raw
// ./images/ path, which Astro never emits, so it 404s on the built page while every check passes. The site's pass must
// hand each picture to Astro as a real mdast image node; that test inspects the tree, not the HTML.
//
// The modules are imported as namespaces (and the new one dynamically, falling back to an empty object), so that
// against code without the block every case fails on an assertion rather than on a missing export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import * as blocks from '../client/src/content-blocks.mjs';
import { renderMarkdown } from '../client/src/markdown.mjs';
import { remarkContentBlocks } from '../src/lib/remark-content-blocks.mjs';
import { sanitizeSchema, rehypeIframeHostAllowlist, rehypeStyleAllowlist, rehypeIdSafety } from '../src/lib/markdown-sanitize.mjs';
import { parseBlocks, serializeBlocks } from '../client-ui/src/markdown-blocks.mjs';
import { COMPONENTS } from '../client/src/components-catalog.mjs';
import { dataBlocksToMarkdown, rewriteRelativeImages } from '../clients/syndication/devto-body.mjs';
import { resolveMarkdownAssets } from '../client-ui/src/assets.mjs';
import { bodyImageRefs } from '../src/lib/workbench-client-core.mjs';

const cards = await import('../client/src/content-cards.mjs').catch(() => ({}));

// The PUBLISHED pipeline, in astro.config.mjs order, as faq-block.test.mjs builds it.
async function published(md) {
  const out = await unified()
    .use(remarkParse).use(remarkGfm).use(remarkContentBlocks)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw).use(rehypeSanitize, sanitizeSchema)
    .use(rehypeIframeHostAllowlist).use(rehypeStyleAllowlist).use(rehypeIdSafety)
    .use(rehypeStringify).process(md);
  return String(out);
}
// The mdast tree after the site's pass, as Astro's remarkCollectImages (which runs next) sees it.
async function siteTree(md) {
  const proc = unified().use(remarkParse).use(remarkGfm).use(remarkContentBlocks);
  return proc.run(proc.parse(md));
}
const all = (node, type, out = []) => {
  if (node?.type === type) out.push(node);
  for (const c of node?.children || []) all(c, type, out);
  return out;
};

const CARDS = [
  '```cards',
  '![Jockey Radio music discs in many colours](./images/jockey-radio.webp)',
  'title: Jockey Radio',
  'text: Live radio, streams and your own audio on music discs, heard through Simple Voice Chat.',
  'meta: Minecraft 26.2 · Free',
  'link: https://gbti.network/projects/jockey-radio/',
  'label: See the plugin',
  '---',
  "![A Traveler's Chest on a sandy shore](./images/travelers-chest.webp)",
  "title: Traveler's Chest",
  'text: Chests that refill themselves after a cooldown you set.',
  'meta: Minecraft 1.20 to 1.20.4, 1.21 to 1.21.11, 26.1 to 26.3',
  'link: https://gbti.network/projects/travelers-chest/',
  '---',
  'title: A card with no link',
  'text: Plain **text** stays plain.',
  '```',
].join('\n');
const INNER = CARDS.split('\n').slice(1, -1).join('\n');
const DOC = `Before the cards.\n\n${CARDS}\n\nAfter the cards.\n`;

test('cards: is a known data block, and a --- line starts the next card', () => {
  assert.ok(blocks.DATA_BLOCKS.includes('cards'));
  assert.ok(blocks.KNOWN_FENCES.includes('cards'));
  assert.equal(typeof cards.parseCards, 'function', 'content-cards.mjs exports parseCards');
  const p = cards.parseCards(INNER);
  assert.equal(p.cols, 2);
  assert.deepEqual(p.cards.map((c) => c.title), ['Jockey Radio', "Traveler's Chest", 'A card with no link']);
  assert.deepEqual(p.cards[0].image, { alt: 'Jockey Radio music discs in many colours', src: './images/jockey-radio.webp' });
  assert.equal(p.cards[0].link, 'https://gbti.network/projects/jockey-radio/');
  assert.equal(p.cards[0].label, 'See the plugin');
  assert.equal(p.cards[1].label, '');
  assert.equal(p.cards[2].link, null);
  assert.equal(cards.parseCards(INNER, '3').cols, 3);
});

test('cards: the preview builds one link per linked card, the picture first and every field as plain text', () => {
  const html = blocks.renderDataBlock('cards', INNER);
  assert.ok(html, 'cards renders');
  assert.match(html, /^<div class="gbti-cards">/);
  assert.equal((html.match(/<a class="gbti-card" href="/g) || []).length, 2);
  assert.match(html, /<a class="gbti-card" href="https:\/\/gbti\.network\/projects\/jockey-radio\/"><span class="gbti-card-media"><img src="\.\/images\/jockey-radio\.webp" alt="Jockey Radio music discs in many colours" loading="lazy"><\/span><span class="gbti-card-body"><span class="gbti-card-title">Jockey Radio<\/span>/);
  assert.match(html, /<span class="gbti-card-meta">Minecraft 26\.2 · Free<\/span><span class="gbti-card-cta">See the plugin<\/span><\/span><\/a>/);
  assert.match(html, /<span class="gbti-card-title">Traveler&#39;s Chest<\/span>/);
  assert.match(html, /<span class="gbti-card-cta">Read more<\/span>/, 'a linked card with no label reads Read more');
  assert.match(html, /<div class="gbti-card"><span class="gbti-card-body"><span class="gbti-card-title">A card with no link<\/span><span class="gbti-card-text">Plain \*\*text\*\* stays plain\.<\/span><\/span><\/div>/);
  assert.match(blocks.renderDataBlock('cards', INNER, '3'), /^<div class="gbti-cards gbti-cards-3">/);
  assert.equal(blocks.renderDataBlock('cards', 'text: no title anywhere'), null);
});

test('cards: on the site each picture is a real image node, so Astro resizes it like any article image', async () => {
  const tree = await siteTree(DOC);
  const images = all(tree, 'image');
  assert.deepEqual(images.map((n) => n.url), ['./images/jockey-radio.webp', './images/travelers-chest.webp']);
  assert.equal(images[0].alt, 'Jockey Radio music discs in many colours');
  for (const h of all(tree, 'html')) assert.doesNotMatch(h.value, /<img/, 'no picture is hidden inside an HTML string');
  assert.equal(all(tree, 'code').length, 0, 'the fence is gone');
});

test('cards: the published page keeps the grid, the linked cards and their pictures after sanitizing', async () => {
  const html = await published(DOC);
  assert.match(html, /<div class="gbti-cards">/);
  assert.equal((html.match(/<a class="gbti-card" href="https:\/\/gbti\.network\/projects\//g) || []).length, 2);
  // remark-rehype puts a newline on each side of the picture; whitespace between block boxes draws nothing.
  assert.match(html, /<span class="gbti-card-media">\s*<img src="\.\/images\/jockey-radio\.webp" alt="Jockey Radio music discs in many colours">\s*<\/span><span class="gbti-card-body">/);
  assert.match(html, /<span class="gbti-card-title">Traveler's Chest<\/span>/);
  assert.match(html, /<div class="gbti-card"><span class="gbti-card-body">/);
  assert.match(await published(`\`\`\`cards 3\ntitle: One\n\`\`\`\n`), /<div class="gbti-cards gbti-cards-3">/);
  const evil = await published('<div class="gbti-cardsx">x</div>\n\n<a class="gbti-cardx" href="https://a.example">y</a>\n');
  assert.doesNotMatch(evil, /gbti-cardsx|gbti-cardx/, 'only the exact card classes are admitted');
});

test('cards: the WorkBench preview and the reader resolve a card picture as they resolve any ./images/ file', () => {
  const html = renderMarkdown(DOC);
  assert.equal((html.match(/<a class="gbti-card"/g) || []).length, 2);
  assert.match(html, /<img src="\.\/images\/jockey-radio\.webp"/, 'the preview rewrites every src="./..." after rendering');
  const reader = renderMarkdown(resolveMarkdownAssets(DOC, 'members/gbtilabs/posts/x/index.md'));
  assert.match(reader, /<img src="https:\/\/[^"]+\/members\/gbtilabs\/posts\/x\/images\/jockey-radio\.webp"/);
  assert.deepEqual(bodyImageRefs(DOC).map((r) => r.name), ['jockey-radio.webp', 'travelers-chest.webp'], 'publish commits the pictures');
});

test('cards: cross-posts get each picture, the name in bold linking to its page, and the meta in italics', () => {
  const md = blocks.dataBlockToMarkdown('cards', INNER);
  assert.equal(typeof md, 'string', 'cards writes markdown for a cross-post');
  assert.equal(md.split('\n\n').slice(0, 3).join('\n\n'), '![Jockey Radio music discs in many colours](./images/jockey-radio.webp)\n\n'
    + '**[Jockey Radio](https://gbti.network/projects/jockey-radio/)**: Live radio, streams and your own audio on music discs, heard through Simple Voice Chat.\n\n'
    + '*Minecraft 26.2 · Free*');
  assert.match(md, /\*\*A card with no link\*\*: Plain/);
  const devto = rewriteRelativeImages(dataBlocksToMarkdown(DOC), { source: 'post', author: 'gbtilabs', targetSlug: 'x' });
  assert.doesNotMatch(devto, /```cards/, 'no cards fence reaches dev.to as a code block');
  assert.doesNotMatch(devto, /\]\(\.\/images\//, 'the pictures point at the CDN, not the repository path');
});

test('cards: the component checker names every problem a card can have', () => {
  assert.deepEqual(blocks.checkComponentBlocks(CARDS), []);
  const bad = [
    '```cards wide',
    '![](./images/a.webp)',
    '![Second](./images/b.webp)',
    'title: One',
    'text: See [the page](https://a.example)[^1]',
    'colour: green',
    'link: ftp://a.example',
    '---',
    '![Broken(./images/c.webp)',
    '![Elsewhere](//evil.example/x.webp)',
    'text: no title here',
    '---',
    'title: Two',
    'label: Go',
    '```',
  ].join('\n');
  assert.deepEqual(blocks.checkComponentBlocks(bad).map((x) => x.message), [
    'cards option "wide" is not known; use 2 or 3 columns (it shows as 2)',
    'cards line "colour: green" is not an image line or title:, text:, meta:, link: or label:; it is left out',
    'cards: card "One" has an image with no alt text; describe the picture between the [ ]',
    'cards: card "One" has more than one image line; only the first shows',
    'cards: card "One" link "ftp://a.example" is not an http or https address; the card shows without a link',
    'cards: card "One" text has a markdown link, which shows as text; a card links through its link: line',
    'cards: card "One" text has a footnote marker, which shows as text in a card',
    'cards: card 2 has no "title:" line; it is left out',
    'cards line "![Broken(./images/c.webp)" starts like an image but is not ![alt text](path); it is left out',
    'cards image "//evil.example/x.webp" is not an https address, a site path or a ./images/ file; it is left out',
    'cards: card "Two" has label: but no link: line to go with it',
  ]);
  assert.match(blocks.checkComponentBlocks('```cards\ntext: only\n```')[0].message, /cards needs at least one card with a "title:" line/);
  assert.equal(blocks.renderDataBlock('cards', '![x](javascript:alert(1))\ntitle: T'), '<div class="gbti-cards"><div class="gbti-card"><span class="gbti-card-body"><span class="gbti-card-title">T</span></span></div></div>', 'an unaccepted picture is left out');
});

test('cards: the agent catalog describes it, and its example renders with no warnings', () => {
  const c = COMPONENTS.find((x) => x.name === 'cards');
  assert.ok(c, 'list_components has cards');
  assert.equal(c.kind, 'fence');
  assert.deepEqual(blocks.checkComponentBlocks(c.example), []);
  assert.equal((renderMarkdown(c.example).match(/<a class="gbti-card"/g) || []).length, 2);
});

test('cards: a WorkBench save writes the block back exactly as it was read', () => {
  const doc = `Before.\n\n${CARDS}\n\nAfter.`;
  assert.equal(serializeBlocks(parseBlocks(doc)), doc);
});

test('cards: the shared stylesheet styles every class the block emits, and draws the arrow without reading it out', () => {
  const css = blocks.dataBlocksCss('.x', { fg: 'F', soft: 'S', mute: 'M', line: 'L', line2: 'L2', rest: 'R', green: 'G', green700: 'G7', green700Solid: 'G7S', greenTint: 'GT', greenBorder: 'GB', surface: 'SU', card: 'C', mono: 'MO' });
  const html = blocks.renderDataBlock('cards', INNER, '3') || '';
  const classes = [...new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(' ')))];
  assert.ok(classes.length >= 8, `the block emits its classes (found ${classes.length})`);
  for (const cls of classes) assert.match(css, new RegExp(`\\.x (a)?\\.${cls}[{:, ]`), `no rule for .${cls}`);
  assert.match(css, /\.x \.gbti-card-media img\{[^}]*margin:0;border-radius:0/, 'the article image margin and corners are reset');
  assert.match(css, /\.x \.gbti-card-cta::after\{content:" \\2192";content:" \\2192" \/ ""\}/);
  assert.match(css, /\.x \.gbti-card\{[^}]*text-decoration:none/, 'the card is not underlined like a text link');
});
