// sow-355 (owner, 2026-09-16): "we also need to fix the markdown issues in this workbench editor, they are not
// showing bolded and italics and are keeping the underscores even when in visual mode."
//
// Neither the block editor's inline converter nor the client renderer knew underscore emphasis (`_x_`, `__x__`),
// and the block editor showed a footnote reference (`[^1]`) as literal text. The site build (remark + GFM) draws
// all of them, so the WorkBench showed an article differently from the page it publishes. Measured on the Moon
// article before the fix: 0 of its underscore spans and 0 of its footnote references rendered in the editor.
//
// Every import here already existed before the fix, so this file loads against the unchanged code and fails on
// its assertions rather than on a missing export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fromHtml } from 'hast-util-from-html';
import { toHtml as toHtmlRaw } from 'hast-util-to-html';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { visit } from 'unist-util-visit';
import { renderMarkdown, renderMarkdownWithBlocks } from '../client/src/markdown.mjs';
import { parseBlocks, inlineMdToHtml, inlineHtmlToMd, textBlockToHtml, textBlockFromHtml } from '../client-ui/src/markdown-blocks.mjs';
import { readBlockDom, applyBlockEdit } from '../client-ui/src/block-commit.mjs';
import { domToMarkdown, editorHtmlFromMarkdown } from '../client-ui/src/prose-editor-core.mjs';
import { remarkContentBlocks } from '../src/lib/remark-content-blocks.mjs';
import { sanitizeSchema, rehypeStyleAllowlist } from '../src/lib/markdown-sanitize.mjs';

const MOON = 'members/atwellpub/posts/the-moon-is-a-harsh-mistress-revisiting-a-scifi-masterpiece-in-the-age-of-emergent-ai/index.md';
const moonBody = () => fs.readFileSync(new URL(`../${MOON}`, import.meta.url), 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');

// The site chain, as test/quote-paragraphs.test.mjs builds it: the reference for what a published page shows.
const site = (md) => unified().use(remarkParse).use(remarkGfm).use(remarkContentBlocks)
  .use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw).use(rehypeSanitize, sanitizeSchema)
  .use(rehypeStyleAllowlist).use(rehypeStringify).process(md).then(String);
// Structure only. The delimiter marker is the client's own bookkeeping, and the renderer's link attributes and
// whitespace between tags are not what this suite is about.
const shape = (html) => String(html)
  .replace(/ data-md="_"/g, '')
  .replace(/ (target|rel)="[^"]*"/g, '')
  .replace(/>\s+</g, '><')
  .replace(/\s+/g, ' ')
  .trim();

// A parsed HTML tree, so a read-back sees what a browser hands it (re-serialized attributes and entities).
const reserialize = (html) => toHtmlRaw(fromHtml(html, { fragment: true }), { characterReferences: { useNamedReferences: true } });
const adapt = (h) => {
  if (h.type === 'text') return { nodeType: 3, textContent: h.value };
  if (h.type !== 'element') return { nodeType: 8 };
  const props = h.properties || {};
  const cls = Array.isArray(props.className) ? props.className.join(' ') : (props.className || '');
  const childNodes = h.children.map(adapt);
  const ser = (n) => toHtmlRaw(n, { characterReferences: { useNamedReferences: true } });
  return {
    nodeType: 1, tagName: h.tagName.toUpperCase(), childNodes,
    get children() { return childNodes.filter((c) => c.nodeType === 1); },
    get textContent() { return ser(h.children).replace(/<[^>]+>/g, ''); },
    get innerHTML() { return ser(h.children); },
    get outerHTML() { return ser(h); },
    getAttribute: (n) => (n === 'class' ? cls : null),
    querySelector: () => null,
  };
};
const element = (html) => adapt(fromHtml(html, { fragment: true }).children.find((c) => c.type === 'element'));
const surface = (html) => ({ nodeType: 1, tagName: 'DIV', childNodes: fromHtml(html, { fragment: true }).children.map(adapt) });

const EMPHASIS_SHAPES = [
  'In our story, _Mannie_ discovers the truth.',
  'a snake_case_name and foo_bar_ stay literal',
  'the “_wood wide web”_ of fungal threads',
  'published _“Perceptrons,”_ a rigorous analysis',
  'the paper _“Attention Is All You Need._” Unlike',
  '**_[“The Moon is a Harsh Mistress”](https://amzn.to/3I9oF49)_** stands',
  '__strong__ and _em_ and ___both___',
  '_an **inner** bold_ and **an _inner_ italic**',
  'escaped \\_not emphasis\\_ here',
  '_[a link](https://example.com/a_b_c)_ in italics',
  '5_000_000 and _ spaced _ are not emphasis',
  '*star* and _under_ side by side',
  '_x_y does not close inside a word',
  'Thanks, _truly_. And (_parenthesised_) too.',
];

test('the client renderer agrees with the site build on underscore emphasis', async () => {
  for (const md of EMPHASIS_SHAPES) {
    assert.equal(shape(renderMarkdown(md)), shape(await site(md)), JSON.stringify(md));
  }
});

test('the block editor shows underscore emphasis and reads every shape back exactly as written', () => {
  for (const md of EMPHASIS_SHAPES) {
    const html = inlineMdToHtml(md);
    assert.equal(inlineHtmlToMd(html), md, `direct: ${JSON.stringify(md)} -> ${html}`);
    assert.equal(inlineHtmlToMd(reserialize(html)), md, `through a parsed tree: ${JSON.stringify(md)}`);
  }
  assert.match(inlineMdToHtml('In our story, _Mannie_ discovers'), /<em data-md="_">Mannie<\/em>/);
  assert.match(inlineMdToHtml('__strong__'), /<strong data-md="_">strong<\/strong>/);
  assert.ok(!/<em/.test(inlineMdToHtml('a snake_case_name')), 'an underscore inside a word is not emphasis');
  assert.ok(!/<em/.test(inlineMdToHtml('<a href="https://e.test/_x_/">l</a>')), 'an underscore inside an href is never touched');
});

test('an emphasis the author makes keeps the star, and an underscore that cannot work falls back to it', () => {
  assert.equal(inlineHtmlToMd('a <em>b</em> c'), 'a *b* c', 'the toolbar italic is unchanged');
  assert.equal(inlineHtmlToMd('a <i>b</i> c'), 'a *b* c');
  assert.equal(inlineHtmlToMd('a <b>b</b> c'), 'a **b** c');
  // Typing a letter straight after an underscore italic would leave `_bar_baz`, which publishes the underscores.
  assert.equal(inlineHtmlToMd('foo<em data-md="_">bar</em>baz'), 'foo*bar*baz');
  assert.equal(inlineHtmlToMd('<em data-md="_">bar</em> baz'), '_bar_ baz');
});

test('a run of footnote definitions keeps one definition per line', () => {
  const defs = '[^1]: The first note.\n[^2]: The second, with _emphasis_.\n[^note-3]: The third.';
  const html = textBlockToHtml(defs);
  assert.equal((html.match(/<br data-md="fn">/g) || []).length, 2);
  assert.equal(textBlockFromHtml(html), defs);
  assert.equal(textBlockFromHtml(reserialize(html)), defs);
  // An ordinary soft break is still a space, as the published page draws it.
  assert.equal(inlineMdToHtml('one line\nand the next'), 'one line and the next');
});

test('the block editor shows a footnote reference as a chip that reads back as the reference', () => {
  const html = inlineMdToHtml('on Luna[^1], a prison colony');
  assert.match(html, /<sup class="md-fnchip" contenteditable="false" data-fn="1">1<\/sup>/);
  assert.equal(inlineHtmlToMd(html), 'on Luna[^1], a prison colony');
  assert.equal(inlineHtmlToMd(reserialize(html)), 'on Luna[^1], a prison colony');
  assert.equal(inlineMdToHtml('[^1]: a definition'), '[^1]: a definition', 'a definition line is not a reference');
  assert.ok(!/md-fnchip/.test(inlineMdToHtml('[^x](https://e.test)')), 'a link whose text starts with a caret stays a link');
  assert.equal(inlineHtmlToMd(inlineMdToHtml('an id_with_underscores[^my_note].')), 'an id_with_underscores[^my_note].');
});

test('the Moon article: every underscore span and footnote reference renders, and every block reads back unchanged', async () => {
  const body = moonBody();
  // The site's own count, from the syntax tree: emphasis written with underscores, and footnote references.
  const tree = unified().use(remarkParse).use(remarkGfm).parse(body);
  let siteUnderscore = 0;
  let siteRefs = 0;
  visit(tree, (n) => {
    if ((n.type === 'emphasis' || n.type === 'strong') && body[n.position.start.offset] === '_') siteUnderscore++;
    if (n.type === 'footnoteReference') siteRefs++;
  });
  assert.ok(siteUnderscore >= 26 && siteRefs >= 19, `the article carries what the report measured: ${siteUnderscore}, ${siteRefs}`);

  let marked = 0;
  let chips = 0;
  let checked = 0;
  for (const b of parseBlocks(body)) {
    const texts = b.type === 'list' ? (b.items || []).map((it) => (typeof it === 'string' ? it : it.text)) : ['paragraph', 'heading', 'quote'].includes(b.type) ? [b.text] : [];
    for (const text of texts) {
      if (typeof text !== 'string') continue;
      const html = b.type === 'list' ? inlineMdToHtml(text) : textBlockToHtml(text);
      marked += (html.match(/<(em|strong) data-md="_">/g) || []).length;
      chips += (html.match(/class="md-fnchip"/g) || []).length;
      const back = b.type === 'list' ? inlineHtmlToMd(reserialize(html)) : textBlockFromHtml(reserialize(html));
      // Every block reads back byte for byte, the footnote definitions included: they are one paragraph of
      // definition lines, and a line that starts a definition is kept as a line rather than read as a soft break.
      assert.equal(back, text, `a ${b.type} block read back differently`);
      checked++;
    }
  }
  assert.ok(checked > 20, `checked ${checked} blocks`);
  assert.equal(marked, siteUnderscore, 'the editor renders every underscore emphasis the site renders');
  assert.equal(chips, siteRefs, 'and every footnote reference as a chip');
});

test('the Preview commit and the comment editor keep underscores and footnote references', () => {
  const md = 'In our story, _Mannie_ talks to Mike[^1] and __wakes__ him.\n\n[^1]: The computer.';
  const { html } = renderMarkdownWithBlocks(md);
  const para = html.match(/<p[^>]*data-blk="0"[^>]*>[\s\S]*?<\/p>/)?.[0] ?? '';
  assert.match(para, /<em data-md="_">Mannie<\/em>/);
  const read = readBlockDom(element(para));
  const line = 'In our story, _Mannie_ talks to Mike[^1] and __wakes__ him.';
  assert.deepEqual(read, { kind: 'paragraph', text: line });
  assert.deepEqual(applyBlockEdit(line, read), [line], 'an untouched paragraph commits back to its own source');

  const comment = 'An _honest_ note with __weight__.';
  assert.equal(domToMarkdown(surface(editorHtmlFromMarkdown(comment))), comment);
});
