// sow-350 (owner, 2026-09-16): "Share preview not respecting line breaks in block quotes."
//
// A quote of several paragraphs is written with a bare `>` line between them. Four places got that wrong, in two
// different ways:
//   - the Share composer's preview joined every line of a quote with a space, so three paragraphs showed as one;
//   - the shared client renderer (the Shares feed, the reader, the comment editor, the WorkBench Preview) drew
//     every `>` LINE as its own <blockquote>, so the same quote showed as five boxes, two of them empty, while
//     the site build drew one quote holding three paragraphs;
//   - the block editor and the Preview's commit read a quote back as one run of inline text, so a single edit
//     saved a quote of three paragraphs as one paragraph.
// The site build (remark + GFM) is the reference: the published page is what every client surface previews.
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
import { renderMarkdown, renderMarkdownWithBlocks } from '../client/src/markdown.mjs';
import { parseBlocks, serializeBlocks, inlineHtmlToMd, textBlockToHtml, textBlockFromHtml } from '../client-ui/src/markdown-blocks.mjs';
import { readBlockDom, applyBlockEdit } from '../client-ui/src/block-commit.mjs';
import { domToMarkdown, editorHtmlFromMarkdown } from '../client-ui/src/prose-editor-core.mjs';
import { GbtiShareComposer } from '../client-ui/src/elements/gbti-share-composer.mjs';
import { GbtiDocEditor } from '../client-ui/src/elements/gbti-doc-editor.mjs';
import { remarkContentBlocks } from '../src/lib/remark-content-blocks.mjs';
import { sanitizeSchema, rehypeStyleAllowlist } from '../src/lib/markdown-sanitize.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// The owner's note had this shape: two paragraphs, then one quote of three paragraphs split by bare `>` lines.
const QUOTE = [
  '> The first paragraph of the quoted passage.',
  '>',
  '> The second paragraph, which **carries** a [link](https://example.test/a).',
  '>',
  '> The third and last paragraph.',
].join('\n');
const NOTE = `An opening line from the author.\n\nA second line before the quote.\n\n${QUOTE}`;

const blockquotes = (html) => html.match(/<blockquote[\s\S]*?<\/blockquote>/g) || [];
const parasIn = (html) => (html.match(/<p[\s>]/g) || []).length;

// The site chain, as test/image-caption.test.mjs builds it: the reference for what a published page shows.
const site = (md) => unified().use(remarkParse).use(remarkGfm).use(remarkContentBlocks)
  .use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw).use(rehypeSanitize, sanitizeSchema)
  .use(rehypeStyleAllowlist).use(rehypeStringify).process(md).then(String);
// Structure only: whitespace between tags or after a break, soft line breaks, the <br> spelling and the renderer's own link
// attributes are not what this suite is about.
const shape = (html) => String(html)
  .replace(/<br\s*\/?>\s*/g, '<br>') // the site writes a newline after a break; a browser draws neither
  .replace(/ (target|rel)="[^"]*"/g, '')
  .replace(/>\s+</g, '><')
  .replace(/\s+/g, ' ')
  .trim();

// A parsed HTML tree wearing the DOM subset the read-backs use (test/prose-editor.test.mjs builds the same kind).
const toHtml = (n) => toHtmlRaw(n, { characterReferences: { useNamedReferences: true } });
const adapt = (h) => {
  if (h.type === 'text') return { nodeType: 3, textContent: h.value };
  if (h.type !== 'element') return { nodeType: 8 };
  const props = h.properties || {};
  const cls = Array.isArray(props.className) ? props.className.join(' ') : (props.className || '');
  const childNodes = h.children.map(adapt);
  return {
    nodeType: 1, tagName: h.tagName.toUpperCase(), childNodes,
    get children() { return childNodes.filter((c) => c.nodeType === 1); },
    get textContent() { return toHtml(h.children).replace(/<[^>]+>/g, ''); },
    get innerHTML() { return toHtml(h.children); },
    get outerHTML() { return toHtml(h); },
    getAttribute: (n) => (n === 'class' ? cls : null),
    querySelector: () => null,
  };
};
const element = (html) => adapt(fromHtml(html, { fragment: true }).children.find((c) => c.type === 'element'));
const surface = (html) => ({ nodeType: 1, tagName: 'DIV', childNodes: fromHtml(html, { fragment: true }).children.map(adapt) });

test('the client renderer draws a quote of three paragraphs as ONE quote holding three paragraphs', () => {
  const html = renderMarkdown(NOTE);
  const quotes = blockquotes(html);
  assert.equal(quotes.length, 1, `one quote, got ${quotes.length}: ${html}`);
  assert.equal(parasIn(quotes[0]), 3, `three paragraphs inside it: ${quotes[0]}`);
  assert.ok(!/<blockquote[^>]*>\s*<\/blockquote>/.test(html), 'no empty quote box');
  assert.match(quotes[0], /<strong>carries<\/strong>/, 'inline markdown still renders inside a quote');
  assert.match(quotes[0], /<a href="https:\/\/example\.test\/a"[^>]*>link<\/a>/, 'and so do links');
});

test('the client renderer agrees with the site build on every quote shape an author writes', async () => {
  const cases = [
    NOTE,
    '> one line',
    '> a soft\n> line break',
    '> a hard  \n> line break',
    '> intro\n>\n> 1. one\n> 2. two',
    '> intro\n>\n> - one\n> - two',
    '> outer\n>\n> > inner',
    'A paragraph\n> interrupted by a quote',
    '> first quote\n\n> a second, separate quote',
    '> quote\n\nAfter the quote.',
  ];
  for (const md of cases) assert.equal(shape(renderMarkdown(md)), shape(await site(md)), JSON.stringify(md));
});

test('a footnote reference inside a quote still resolves against the document', () => {
  const html = renderMarkdown('> Quoted.[^1]\n>\n> More.\n\n[^1]: The source.');
  assert.match(html, /<blockquote><p>Quoted\.<sup class="md-fnref" data-fn="1"><a href="#fn-1"/); // sow-355: data-fn
  assert.equal((html.match(/<section class="md-footnotes">/g) || []).length, 1, 'one footnote section, at the end');
  assert.match(html, /<li id="fn-1">The source\./);
});

test('the Preview stamps a quote as ONE block whose range is the whole run, and re-parses it exactly', () => {
  const md = `Intro.\n\n${QUOTE}\n\nOutro.`;
  const { html, blocks } = renderMarkdownWithBlocks(md);
  const stamps = [...html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*data-blk="(\d+)"/gi)].map((m) => m[1].toUpperCase());
  assert.deepEqual(stamps, ['P', 'BLOCKQUOTE', 'P'], 'the paragraphs inside the quote carry no stamp of their own');
  assert.deepEqual(blocks[1], { start: 2, end: 6 });
  const src = md.split('\n').slice(2, 7).join('\n');
  assert.equal(serializeBlocks(parseBlocks(src)), src);
});

test('the Preview commit reads a quote back paragraph by paragraph and writes nothing when nothing changed', () => {
  const { html } = renderMarkdownWithBlocks(QUOTE);
  const read = readBlockDom(element(html));
  assert.deepEqual(read, {
    kind: 'quote',
    text: 'The first paragraph of the quoted passage.\n\nThe second paragraph, which **carries** a [link](https://example.test/a).\n\nThe third and last paragraph.',
  });
  assert.equal(applyBlockEdit(QUOTE, read).join('\n'), QUOTE, 'an untouched quote commits back to its own source');
  const edited = element(html.replace('The third and last paragraph.', 'The third paragraph, edited.'));
  assert.deepEqual(applyBlockEdit(QUOTE, readBlockDom(edited)), QUOTE.replace('The third and last paragraph.', 'The third paragraph, edited.').split('\n'));
});

test('the Preview commit keeps what a browser and a real article put inside a quote', () => {
  const md = (h) => readBlockDom(element(h));
  assert.deepEqual(md('<blockquote><p>a</p><div>b</div></blockquote>'), { kind: 'quote', text: 'a\n\nb' }, 'Enter adds a div: a paragraph');
  assert.deepEqual(md('<blockquote>lead <b>in</b><p>x</p></blockquote>'), { kind: 'quote', text: 'lead **in**\n\nx' }, 'bare text is a paragraph too');
  assert.deepEqual(md('<blockquote>one &lt; two</blockquote>'), { kind: 'quote', text: 'one < two' }, 'a quote with no paragraph inside still reads');
  assert.equal(md('<blockquote><p>a</p><pre><code>x</code></pre></blockquote>'), null, 'code inside a quote is refused, not flattened');
  assert.equal(md('<blockquote><p>a</p><blockquote><p>b</p></blockquote></blockquote>'), null, 'so is a nested quote');
  // members/gbtilabs/posts/chicago-style-footnoting-in-ai-generated-content quotes a numbered reference list.
  const src = '> The phrase was developed as a pangram.\n>\n> // References\n>\n> 1. Millington R. The History of Typing Test Phrases.';
  const { html } = renderMarkdownWithBlocks(src);
  assert.match(html, /<blockquote[^>]*><p>The phrase[\s\S]*<ol>/, 'the list inside the quote renders as a list');
  const edited = element(html.replace('a pangram', 'an early pangram'));
  assert.deepEqual(applyBlockEdit(src, readBlockDom(edited)), src.replace('a pangram', 'an early pangram').split('\n'), 'and survives an edit to a paragraph beside it');
});

test('the comment editor reads a quote of paragraphs back as the markdown the author wrote', () => {
  const roundTrip = (md) => domToMarkdown(surface(editorHtmlFromMarkdown(md)));
  assert.equal(roundTrip(QUOTE), QUOTE);
  assert.equal(roundTrip(NOTE), NOTE);
  assert.equal(roundTrip('> a hard  \n> line break'), '> a hard  \n> line break');
  assert.equal(roundTrip('> intro\n>\n> - one\n> - two'), '> intro\n>\n> - one\n> - two');
  // A soft break joins, exactly as the published comment shows it. It always did on the site; the editor used to
  // show two lines and publish one.
  assert.equal(roundTrip('> a soft\n> line break'), '> a soft line break');
  assert.equal(domToMarkdown(surface('<blockquote><p>a</p>\n<p>b</p></blockquote>')), '> a\n>\n> b');
});

test('the Share composer previews a quote exactly as the published Share draws it', () => {
  const preview = new GbtiShareComposer()._notePreviewHtml(NOTE);
  const quotes = blockquotes(preview);
  assert.equal(quotes.length, 1);
  assert.equal(parasIn(quotes[0]), 3, `three paragraphs in the preview: ${quotes[0]}`);
  // The feed renders a published note with renderMarkdown (gbti-shares-feed.mjs _resolveBody, through
  // client.preview), so the preview's quote must be that renderer's quote.
  assert.equal(shape(quotes[0]), shape(blockquotes(renderMarkdown(NOTE))[0]));
  const callout = new GbtiShareComposer()._notePreviewHtml('```callout note\nline one\n\nline two\n```');
  assert.match(callout, /line one<br><br>line two/, 'a callout keeps its blank line, as the published callout does');
});

test('the block editor shows and saves a quote of paragraphs without running them together', () => {
  const text = parseBlocks(QUOTE)[0].text;
  const html = textBlockToHtml(text);
  assert.equal((html.match(/<br><br>/g) || []).length, 2, `a blank line shows as a blank line: ${html}`);
  assert.equal(textBlockFromHtml(html), text);
  assert.equal(serializeBlocks([{ type: 'quote', text: textBlockFromHtml(html) }]), QUOTE);
  // A single paragraph reads back exactly as the old inline read-back did.
  for (const h of ['plain', 'a <b>b</b> c', 'line<br>break', 'trailing<br>', 'x <a href="https://e.test">l</a>']) {
    assert.equal(textBlockFromHtml(h), inlineHtmlToMd(h).replace(/\n$/, ''), h);
  }
  assert.equal(textBlockFromHtml('a<br><br><br><br>b'), 'a\n\nb', 'extra blank lines collapse, as markdown does');
  const ed = new GbtiDocEditor();
  assert.ok(ed._ce('ce-q', 'text', { _id: 'q1', text }, 'Quote').includes(html), 'the quote field is filled through the helper');
  const src = read('client-ui/src/elements/gbti-doc-editor.mjs');
  assert.equal((src.match(/inlineHtmlToMd\((ce|el)\.innerHTML\)/g) || []).length, 1, 'only the table cell, which holds no paragraphs, keeps the inline-only read-back');
  assert.equal((src.match(/textBlockFromHtml\((ce|el)\.innerHTML\)/g) || []).length, 3, 'the commit, the retype and the input read-backs all keep paragraphs');
});

test('every surface that draws a rendered quote styles the paragraphs inside it', () => {
  assert.ok(read('client-ui/src/elements/gbti-shares-feed.mjs').includes('.body blockquote { margin:0 0 .7em; padding:2px 0 2px 12px; border-left:3px solid var(--line); color:var(--muted); }'), 'the feed draws a quote as the composer previews it');
  assert.ok(read('client-ui/src/elements/gbti-shares-feed.mjs').includes('.body blockquote > :last-child { margin-bottom:0; }'));
  assert.ok(read('client-ui/src/elements/gbti-reader.mjs').includes('.body blockquote > :last-child { margin-bottom:0; }'));
  assert.ok(read('client-ui/src/elements/gbti-prose-editor.mjs').includes('.surface blockquote > :last-child { margin-bottom: 0; }'));
});

test('the comment editor takes a paragraph out of a quote without outdent', () => {
  // Driven in Chrome on 2026-09-16: formatBlock('p') leaves a <p> inside a quote where it is, and outdent re-colours
  // the lifted text with inline styles, drops its bold on the way back to markdown, and leaves a stray break in the
  // paragraph below. So both the Quote button and Enter on an empty quote line move the paragraph on the DOM.
  const src = read('client-ui/src/elements/gbti-prose-editor.mjs');
  assert.ok(!src.includes("document.execCommand('outdent')"), 'outdent is not called (the comments name it, on purpose)');
  assert.ok(src.includes('if (line) { this._liftLine(inside, line); return; }'), 'the Quote button lifts a paragraph line');
  assert.ok(src.includes('if (line) this._liftLine(quote, line);'), 'Enter on an empty paragraph line lifts it');
  assert.ok(src.includes("else { const p = document.createElement('p'); p.innerHTML = '<br>'; quote.replaceWith(p); this._caretIn(p); }"), 'an empty bare quote becomes an empty paragraph');
  assert.ok(src.split('\n').length <= 900);
});
