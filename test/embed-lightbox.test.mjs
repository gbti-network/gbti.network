// ```embed lightbox in an article (owner, 2026-10-13: "The video example should be an embed and full col width and
// open in lightbox and lazy loaded"). The site builds the linked thumbnail (no player in the page); the extension and
// preview renderer draw the poster; the doc editor keeps the word; cross-posts get a linked thumbnail, not code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { remarkContentBlocks } from '../src/lib/remark-content-blocks.mjs';
import { sanitizeSchema } from '../src/lib/markdown-sanitize.mjs';
import { renderMarkdown } from '../client/src/markdown.mjs';
import { parseBlocks, serializeBlocks } from '../client-ui/src/markdown-blocks.mjs';
import { embedFencesToLinks, stripSiteOnlyFences } from '../clients/syndication/devto-body.mjs';

const site = async (md) => String(await unified().use(remarkParse).use(remarkGfm).use(remarkContentBlocks)
  .use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw).use(rehypeSanitize, sanitizeSchema).use(rehypeStringify).process(md));
const URL = 'https://www.youtube.com/watch?v=n-ETaiZvHns';

test('site: a lightbox embed builds the linked thumbnail and no player', async () => {
  const html = await site(`\`\`\`embed lightbox\n${URL}\n\`\`\`\n`);
  assert.match(html, /<div class="embed-wrap embed-lightbox"><a href="https:\/\/www\.youtube\.com\/watch\?v=n-ETaiZvHns">/);
  assert.match(html, /<img src="https:\/\/i\.ytimg\.com\/vi\/n-ETaiZvHns\/hqdefault\.jpg" alt="Play video" loading="lazy" decoding="async">/);
  assert.doesNotMatch(html, /<iframe/);
});

test('site: a plain embed still builds the inline player', async () => {
  const html = await site(`\`\`\`embed\n${URL}\n\`\`\`\n`);
  assert.match(html, /<div class="embed-wrap"><iframe/);
  assert.doesNotMatch(html, /embed-lightbox/);
});

test('site: an unrecognised URL with lightbox stays a plain link', async () => {
  const html = await site('```embed lightbox\nhttps://example.com/x\n```\n');
  assert.doesNotMatch(html, /embed-lightbox|<iframe/);
  assert.match(html, /<a href="https:\/\/example\.com\/x"/);
});

test('extension and preview renderer: a lightbox embed is the poster, a plain one the inline player', () => {
  assert.match(renderMarkdown(`\`\`\`embed lightbox\n${URL}\n\`\`\``), /md-embed-poster[\s\S]*md-embed-open[\s\S]*loading="lazy"/);
  assert.doesNotMatch(renderMarkdown(`\`\`\`embed lightbox\n${URL}\n\`\`\``), /<iframe/);
  assert.match(renderMarkdown(`\`\`\`embed\n${URL}\n\`\`\``), /<iframe/);
});

test('the doc editor keeps the lightbox word, and adds none to a plain embed', () => {
  assert.equal(serializeBlocks(parseBlocks(`A\n\n\`\`\`embed lightbox\n${URL}\n\`\`\``)), `A\n\n\`\`\`embed lightbox\n${URL}\n\`\`\``);
  assert.equal(serializeBlocks(parseBlocks(`A\n\n\`\`\`embed\n${URL}\n\`\`\``)), `A\n\n\`\`\`embed\n${URL}\n\`\`\``);
});

test('cross-posts: embed fences become a linked thumbnail (YouTube) or a link', () => {
  const out = embedFencesToLinks(`x\n\n\`\`\`embed lightbox\n${URL}\n\`\`\`\n\n\`\`\`embed\nhttps://vimeo.com/1\n\`\`\`\n\n\`\`\`js\nok\n\`\`\`\n`);
  assert.match(out, /\[!\[Video\]\(https:\/\/i\.ytimg\.com\/vi\/n-ETaiZvHns\/hqdefault\.jpg\)\]\(https:\/\/www\.youtube\.com\/watch\?v=n-ETaiZvHns\)/);
  assert.match(out, /<https:\/\/vimeo\.com\/1>/);
  assert.match(out, /```js\nok\n```/);
  assert.doesNotMatch(stripSiteOnlyFences(out), /```embed/);
});
